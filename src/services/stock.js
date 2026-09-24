// 증시 브리핑. 지수/실적/경제지표 모두 구조화된 숫자·필드 데이터라 LLM을 쓰지 않고
// 템플릿 문자열로 포맷팅한다 (docs/pipeline-architecture.dc.html의 "패턴 A" 참고).
// 단 하나의 예외: 화~토 브리핑 밑의 "시장 이슈"는 뉴스 기사(비정형 텍스트)를 요약하는 것이라
// Claude를 쓴다("패턴 B"). 숫자는 건드리지 않고, 실패하면 이 줄만 빠진다.
//
// 요일별 분기 (한국 시각 기준):
//   화~토 아침 → 전날 미국장 마감 요약 (getDailyBrief)
//   일요일 아침 → 이번 주(월~금) 주간 요약 (getWeeklyBrief)
//   월요일 아침 → 이번 주 실적 발표(S&P100 필터) + 경제지표(High 필터) 프리뷰 (getMondayPreviewBrief)

import config from "../../config.json" with { type: "json" };
import { withRetry } from "../utils/retry.js";
import { isNonEmpty } from "../utils/validate.js";
import { nowInKST } from "../utils/kst.js";
import { summarize } from "./llmClient.js";
import Parser from "rss-parser";
import { load } from "cheerio";

const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const FOREXFACTORY_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export async function getMorningStockBrief() {
  const { weekday } = nowInKST();

  let brief;
  if (weekday === 0) {
    brief = await getWeeklyBrief();
  } else if (weekday === 1) {
    brief = await getMondayPreviewBrief();
  } else {
    brief = await getDailyBrief();
  }

  if (!isNonEmpty(brief, { minLen: 10, maxLen: 2500 })) {
    throw new Error("증시 브리핑 생성 결과가 비어 있거나 형식에 맞지 않습니다.");
  }
  return brief;
}

// ── 화~토: 전날 마감 요약 ──────────────────────────────────────

async function getDailyBrief() {
  const holdings = getHoldings();
  const symbols = [...config.stock.indices.map((idx) => idx.symbol), ...holdings];
  const entries = await fetchTwelveDataBatch("quote", symbols);

  const quotes = config.stock.indices.map((idx) => {
    const q = parseQuote(entries[idx.symbol]);
    if (!q) throw new Error(`증시 지수 값이 비정상입니다: ${idx.symbol}`);
    return { ...idx, ...q };
  });

  let brief = formatDailyBrief(quotes);
  if (holdings.length > 0) {
    const lines = holdings.map((symbol) => formatHoldingLine(symbol, parseQuote(entries[symbol]), ""));
    brief += `\n\n📊 내 보유 종목\n${lines.join("\n")}`;
  }
  const reminder = await getHoldingsEarningsReminder();
  if (reminder) brief += `\n\n${reminder}`;
  const issues = await getMarketIssues();
  return issues ? `${brief}\n\n📌 시장 이슈\n${issues}` : brief;
}

// 보유 종목은 개인 포트폴리오라 공개 저장소의 config.json이 아니라 서버 .env에만 둔다.
function getHoldings() {
  return (process.env.HOLDINGS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function parseQuote(entry) {
  if (!entry || entry.status === "error") return undefined;
  const close = Number(entry.close);
  const percentChange = Number(entry.percent_change);
  if (!Number.isFinite(close) || !Number.isFinite(percentChange)) return undefined;
  return { close: entry.close, percentChange: entry.percent_change, datetime: entry.datetime };
}

function formatHoldingLine(symbol, q, prefix) {
  if (!q) return `- ${symbol}: 조회 실패`;
  const pct = Number(q.percentChange);
  return `- ${symbol}: ${formatNumber(q.close)} (${prefix}${pct >= 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(2)}%)`;
}

// ── 시장 이슈 요약 (뉴스 기사 → Claude, 실패하면 undefined) ─────
// 개인/가족용 전제: 하루 한 번 가장 관련 있는 기사 몇 개만 읽고, 본문은 저장·전달하지 않으며
// 요약에만 쓴다. 결과에는 출처를 표기한다 (연합뉴스 기사 하단에 무단전재·AI 활용 금지 문구가 있어
// 공개 서비스로 확장하면 안 된다).

const ISSUE_MAX_AGE_HOURS = 30;
const ISSUE_MAX_ARTICLES = 2;
const ISSUE_BODY_CHARS = 3500;
// 언론사별 기사 본문 컨테이너. 위에서부터 시도해 본문이 충분히 잡히는 첫 번째를 쓴다.
const ARTICLE_SELECTORS = [".story-news.article", "#articletxt", ".article-body", "#articleBody", "article"];

async function getMarketIssues() {
  try {
    const candidates = await fetchIssueCandidates();
    if (candidates.length === 0) return undefined;

    const picked = [];
    for (const c of candidates) {
      if (picked.length >= ISSUE_MAX_ARTICLES) break;
      const body = await fetchArticleBody(c.link);
      if (body) picked.push({ ...c, body });
    }
    // 본문을 못 읽었으면 RSS의 제목/첫 문단만이라도 재료로 쓴다.
    const material = picked.length > 0
      ? picked.map((a) => `[${a.source}] ${a.title}\n${a.body}`).join("\n\n")
      : candidates.slice(0, 6).map((c) => `- ${c.title}${c.snippet ? ` — ${c.snippet}` : ""}`).join("\n");
    const sources = [...new Set((picked.length > 0 ? picked : candidates.slice(0, 6)).map((a) => a.source))];

    const instruction = `아래는 어제 미국 증시(한국 시각 오늘 새벽 마감)를 다룬 뉴스 기사야.
이 내용만 근거로, 출근 전에 30초 안에 훑어볼 "시장 이슈" 요약을 3~4줄로 만들어줘. 길게 쓰지 말고 가장 중요한 것만.

규칙:
- 각 줄은 "- "로 시작하고 40자 안팎(최대 60자). 기사 문장을 그대로 옮기지 말고 사실만 짧게 재정리하고, 어색하거나 겹치는 표현은 쓰지 마.
- 왜 움직였는지(원인) → 금리·유가 등 핵심 수치 → 눈에 띈 종목/업종 → 예정된 주요 이벤트 순으로, 기사에 있는 것만.
- 기사에 없는 사실·수치는 절대 쓰지 마. 확실하지 않으면 그 줄을 빼.
- 지수가 올랐다/내렸다는 사실과 등락률(%)은 위에 따로 표시되니 반복하지 마. "왜" 그랬는지와 그 근거(금리·유가·종목·발언 등)만 써.
- "- 예정: ..." 줄은 기사에 날짜/요일이 명시된 앞으로의 일정(회담, 발표, 회의 등)이 있을 때만 마지막에 한 줄. 시장 전망·확률(예: 금리 인상 가능성 %)은 일정이 아니니 일반 줄로 쓰거나 빼.
- 머리말·맺음말 없이 "- "로 시작하는 줄만 출력.`;

    const text = await summarize(instruction, material);
    // "예정:" 줄은 기사에 앞으로의 일정을 가리키는 표현(요일, 예정, 열릴/열리는, 앞두고, 내일, 다음 주)이
    // 있을 때만 남긴다. 모델이 일반 상식으로 일정을 지어내는 걸 코드로 한 번 더 막는다.
    // (기사 첫머리의 "23일(현지시간)"은 지난 날짜라 날짜 숫자만으로는 판단하지 않는다.)
    const hasDate = /([월화수목금토일]요일|예정|열릴|열리는|앞두고|내일|다음 주)/.test(material);
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- ") && (hasDate || !l.startsWith("- 예정")));
    if (lines.length < 2 || lines.length > 6) return undefined;
    return `${lines.join("\n")}\n(출처: ${sources.join("·")})`;
  } catch (err) {
    console.warn("[stock] 시장 이슈 요약 실패 (지수 브리핑만 발송):", err.message);
    return undefined;
  }
}

// RSS에서 "어제 미국장" 관련 기사 후보를 최신순으로 모은다. 종합 기사(종합/브리핑)를 앞에 둔다.
async function fetchIssueCandidates() {
  const { issueFeeds, issueKeywords } = config.stock;
  const parser = new Parser({ timeout: 10000 });
  const cutoff = Date.now() - ISSUE_MAX_AGE_HOURS * 3600 * 1000;

  const results = await Promise.allSettled(issueFeeds.map((f) => parser.parseURL(f.url)));
  const seen = new Set();
  const found = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const it of r.value.items ?? []) {
      const title = (it.title ?? "").trim();
      if (!title || !it.link || seen.has(title)) continue;
      if (!issueKeywords.some((k) => title.includes(k))) continue;
      const time = it.isoDate ? new Date(it.isoDate).getTime() : 0;
      if (it.isoDate && time < cutoff) continue;
      seen.add(title);
      found.push({
        source: issueFeeds[i].name.split(" ")[0],
        title,
        link: it.link,
        time,
        snippet: (it.contentSnippet ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        comprehensive: /종합|브리핑/.test(title),
      });
    }
  });
  // 본문이 충실한 종합 기사 우선, 그다음 최신순
  return found.sort((a, b) => Number(b.comprehensive) - Number(a.comprehensive) || b.time - a.time);
}

// 기사 페이지에서 본문 문단만 뽑는다. 못 뽑으면 undefined (그 기사는 건너뜀).
async function fetchArticleBody(link) {
  try {
    const res = await fetch(link, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return undefined;
    const $ = load(await res.text());
    // 선택자를 하나씩 순서대로 시도해서 본문이 충분히 잡히는 첫 컨테이너를 쓴다. (한 번에 합치면 문서에서
    // 먼저 나오는 <article> 같은 바깥 태그가 잡혀 본문이 몇 문단만 나온다.)
    let paragraphs = [];
    for (const selector of ARTICLE_SELECTORS) {
      paragraphs = $(selector)
        .first()
        .find("p")
        .map((_, p) => $(p).text().replace(/\s+/g, " ").trim())
        .get()
        .filter((t) => t.length > 20 && !/저작권자|제보는|@[a-z0-9.-]+\.(co\.kr|com)/i.test(t));
      if (paragraphs.join("").length > 200) break;
    }
    const body = paragraphs.join("\n").slice(0, ISSUE_BODY_CHARS);
    return body.length > 200 ? body : undefined;
  } catch {
    return undefined;
  }
}

// 무료 티어는 분당 8크레딧이고 배치 호출도 심볼당 1크레딧이라, 8개씩 끊어 청크 사이에 1분 쉰다.
// 429가 나면 한도가 풀릴 때까지 기다린 뒤 withRetry가 다시 시도한다.
const TWELVE_DATA_CHUNK = 8;
const RATE_LIMIT_WAIT_MS = 61000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// endpoint: "quote" | "time_series". 반환: { 심볼: 응답 객체 } (심볼별 실패는 status "error"로 남는다)
async function fetchTwelveDataBatch(endpoint, symbols, extraParams = "") {
  const apiKey = requireEnv("TWELVE_DATA_API_KEY");
  const result = {};

  for (let i = 0; i < symbols.length; i += TWELVE_DATA_CHUNK) {
    if (i > 0) await sleep(RATE_LIMIT_WAIT_MS);
    const chunk = symbols.slice(i, i + TWELVE_DATA_CHUNK);
    const url = `${TWELVE_DATA_BASE}/${endpoint}?symbol=${chunk.join(",")}${extraParams}&apikey=${apiKey}`;

    const json = await withRetry(
      async () => {
        const res = await fetch(url);
        if (res.status === 429) {
          await sleep(RATE_LIMIT_WAIT_MS);
          throw new Error("Twelve Data 호출 한도 초과(429)");
        }
        if (!res.ok) throw new Error(`Twelve Data 호출 실패: ${res.status}`);
        const body = await res.json();
        if (body.code === 429) {
          await sleep(RATE_LIMIT_WAIT_MS);
          throw new Error("Twelve Data 호출 한도 초과(429)");
        }
        if (chunk.length > 1 && body.status === "error" && !chunk.some((s) => body[s])) {
          throw new Error(`Twelve Data 오류: ${body.message ?? JSON.stringify(body)}`);
        }
        return body;
      },
      { backoffMs: [2000, 5000] }
    );

    if (chunk.length === 1) result[chunk[0]] = json;
    else for (const s of chunk) result[s] = json[s];
  }
  return result;
}

function formatDailyBrief(quotes) {
  const { dateStr: todayKst } = nowInKST();
  const todayLikeTradeDate = toYYYYMMDD(quotes[0]?.datetime) === todayYesterdayGuess(todayKst);

  const header = todayLikeTradeDate
    ? "📈 미국 증시 브리핑"
    : `📈 미국 증시 브리핑 (${quotes[0]?.datetime ?? "최근"} 마감 기준 — 휴장 등으로 새 데이터 없음)`;

  const lines = quotes.map((q) => {
    const sign = Number(q.percentChange) >= 0 ? "▲" : "▼";
    const pct = Number(q.percentChange);
    return `- ${q.label}: ${formatNumber(q.close)} (${sign}${Math.abs(pct).toFixed(2)}%)`;
  });

  return [header, ...lines].join("\n");
}

// ── 일요일: 주간 요약 ──────────────────────────────────────────

async function getWeeklyBrief() {
  const holdings = getHoldings();
  const symbols = [...config.stock.indices.map((idx) => idx.symbol), ...holdings];
  const entries = await fetchTwelveDataBatch("time_series", symbols, "&interval=1day&outputsize=6");

  const indexLines = config.stock.indices.map((idx) => {
    const w = parseWeekly(entries[idx.symbol]);
    if (!w) return `- ${idx.label}: 데이터 부족`;
    return `- ${idx.label}: ${formatNumber(w.last)} (주간 ${w.pct >= 0 ? "▲" : "▼"}${Math.abs(w.pct).toFixed(2)}%)`;
  });
  let brief = ["📈 이번 주 미국 증시 주간 요약", ...indexLines].join("\n");

  if (holdings.length > 0) {
    const lines = holdings.map((symbol) => {
      const w = parseWeekly(entries[symbol]);
      return formatHoldingLine(symbol, w && { close: w.last, percentChange: w.pct }, "주간 ");
    });
    brief += `\n\n📊 내 보유 종목\n${lines.join("\n")}`;
  }
  const reminder = await getHoldingsEarningsReminder();
  return reminder ? `${brief}\n\n${reminder}` : brief;
}

// values는 최신순. 주간 등락 = 지난주 금요일 종가 대비 이번 주 마지막 거래일 종가.
// 월요일 종가를 기준으로 삼으면 월요일 하루치 등락이 빠지므로, 이번 주 월요일보다 앞선 첫 거래일을 기준으로 한다.
function parseWeekly(entry) {
  const values = entry?.status === "error" ? undefined : entry?.values;
  if (!Array.isArray(values) || values.length < 2) return undefined;

  const latest = values[0];
  const dow = new Date(`${latest.datetime.slice(0, 10)}T00:00:00Z`).getUTCDay();
  const mondayStr = shiftDate(latest.datetime.slice(0, 10), -((dow + 6) % 7));
  const base = values.find((v) => v.datetime.slice(0, 10) < mondayStr);

  const baseClose = Number(base?.close);
  const last = Number(latest.close);
  if (!Number.isFinite(baseClose) || !Number.isFinite(last) || baseClose === 0) return undefined;
  return { last, pct: ((last - baseClose) / baseClose) * 100 };
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 월요일: 실적/경제지표 프리뷰 ──────────────────────────────

async function getMondayPreviewBrief() {
  const [earnings, econEvents] = await Promise.all([
    fetchSp100Earnings(),
    fetchHighImpactEvents(),
  ]);
  const brief = formatMondayPreview(earnings, econEvents, new Set(getHoldings()));
  const reminder = await getHoldingsEarningsReminder();
  return reminder ? `${brief}\n\n${reminder}` : brief;
}

// 아침 브리핑(KST) 시점의 미국 현지 날짜는 KST 날짜보다 하루 전이라, 발표일이 "오늘(KST 날짜)"이면
// 미국 현지 기준으로는 내일 발표다 — 그래서 이 날 아침에 "실적 발표 전날" 알림을 붙인다.
// 부가 기능이라 실패해도 브리핑 본문은 그대로 나간다.
async function getHoldingsEarningsReminder() {
  const holdings = new Set(getHoldings());
  if (holdings.size === 0) return "";
  try {
    const rows = await fetchEarningsRows();
    const { dateStr: todayKst } = nowInKST();
    const due = rows.filter((r) => holdings.has(r.symbol) && toCompactDate(r.reportDate) === todayKst);
    if (due.length === 0) return "";
    const lines = due.map((r) => `- ${r.symbol} (${r.name}) · 미국 현지 내일(${r.reportDate}) 발표${formatEarningsTime(r.timeOfTheDay)}`);
    return `⏰ 보유 종목 실적 발표 임박\n${lines.join("\n")}`;
  } catch (err) {
    console.error("[stock] 보유 종목 실적 알림 생성 실패:", err.message);
    return "";
  }
}

function formatEarningsTime(timeOfTheDay) {
  if (timeOfTheDay === "pre-market") return " (장 시작 전)";
  if (timeOfTheDay === "post-market") return " (장 마감 후)";
  return "";
}

// 같은 날 월요일 프리뷰와 임박 알림이 각각 부르므로, Alpha Vantage 일일 한도를 아끼려고 날짜별로 캐싱한다.
let earningsCache = { dateStr: "", rows: [] };

async function fetchEarningsRows() {
  const { dateStr } = nowInKST();
  if (earningsCache.dateStr === dateStr) return earningsCache.rows;

  const apiKey = requireEnv("ALPHA_VANTAGE_API_KEY");
  const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${apiKey}`;

  const csv = await withRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Alpha Vantage 호출 실패: ${res.status}`);
      const text = await res.text();
      if (text.startsWith("{")) {
        const json = JSON.parse(text);
        throw new Error(`Alpha Vantage 오류: ${json.Note ?? json.Information ?? JSON.stringify(json)}`);
      }
      return text;
    },
    { backoffMs: [2000, 5000] }
  );

  const rows = parseCsv(csv);
  earningsCache = { dateStr, rows };
  return rows;
}

async function fetchSp100Earnings() {
  const rows = await fetchEarningsRows();
  const watched = new Set([...config.stock.sp100, ...getHoldings()]);
  const { dateStr: todayKst } = nowInKST();
  const weekEnd = addDaysToYYYYMMDD(todayKst, 7);

  return rows.filter((r) => {
    if (!watched.has(r.symbol) || !r.reportDate) return false;
    const reportDate = toCompactDate(r.reportDate);
    return reportDate >= todayKst && reportDate <= weekEnd;
  });
}

async function fetchHighImpactEvents() {
  const events = await withRetry(
    async () => {
      const res = await fetch(FOREXFACTORY_CALENDAR_URL);
      if (!res.ok) throw new Error(`ForexFactory 호출 실패: ${res.status}`);
      return res.json();
    },
    { backoffMs: [2000, 5000] }
  );

  return (events ?? []).filter((e) => e.impact === "High" && e.country === "USD");
}

function formatMondayPreview(earnings, econEvents, holdingSet) {
  const earningsLines =
    earnings.length > 0
      ? earnings.map((e) => `- ${holdingSet.has(e.symbol) ? "⭐ " : ""}${e.symbol} (${e.name}) · ${e.reportDate}${formatEarningsTime(e.timeOfTheDay)}`)
      : ["특이 일정 없음"];

  const econLines =
    econEvents.length > 0
      ? econEvents.map((e) => `- ${e.title} · ${formatEventDate(e.date)}`)
      : ["특이 일정 없음"];

  return [
    "📅 이번 주 증시 프리뷰",
    "",
    "[이번 주 실적 발표]",
    ...earningsLines,
    "",
    "[이번 주 경제지표]",
    ...econLines,
  ].join("\n");
}

// ── 유틸 ────────────────────────────────────────────────────────

function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key}가 설정되지 않았습니다 (.env 확인)`);
  return value;
}

function formatNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n);
}

function toYYYYMMDD(datetimeStr) {
  if (!datetimeStr) return "";
  return datetimeStr.slice(0, 10).replaceAll("-", "");
}

// 오늘(KST) 기준 "어제"를 대략적으로 구한다 (휴장 여부 판단용, 정밀한 달력 계산 불필요).
function todayYesterdayGuess(todayKst) {
  const d = new Date(
    Number(todayKst.slice(0, 4)),
    Number(todayKst.slice(4, 6)) - 1,
    Number(todayKst.slice(6, 8))
  );
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function addDaysToYYYYMMDD(dateStr, days) {
  const d = new Date(Number(dateStr.slice(0, 4)), Number(dateStr.slice(4, 6)) - 1, Number(dateStr.slice(6, 8)));
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function toCompactDate(isoDate) {
  return isoDate.replaceAll("-", "");
}

function formatEventDate(isoDateTime) {
  const d = new Date(isoDateTime);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Alpha Vantage EARNINGS_CALENDAR는 CSV 전용 응답(CRLF 줄바꿈). 컬럼이 고정돼 있어 간단히 직접 파싱한다.
function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cols[i]));
    return row;
  });
}
