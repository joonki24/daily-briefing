// 증시 브리핑. 지수/실적/경제지표 모두 구조화된 숫자·필드 데이터라 LLM을 쓰지 않고
// 템플릿 문자열로 포맷팅한다 (docs/pipeline-architecture.dc.html의 "패턴 A" 참고).
//
// 요일별 분기 (한국 시각 기준):
//   화~토 아침 → 전날 미국장 마감 요약 (getDailyBrief)
//   일요일 아침 → 이번 주(월~금) 주간 요약 (getWeeklyBrief)
//   월요일 아침 → 이번 주 실적 발표(S&P100 필터) + 경제지표(High 필터) 프리뷰 (getMondayPreviewBrief)

import config from "../../config.json" with { type: "json" };
import { withRetry } from "../utils/retry.js";
import { isNonEmpty } from "../utils/validate.js";
import { nowInKST } from "../utils/kst.js";

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

  if (!isNonEmpty(brief, { minLen: 10, maxLen: 2000 })) {
    throw new Error("증시 브리핑 생성 결과가 비어 있거나 형식에 맞지 않습니다.");
  }
  return brief;
}

// ── 화~토: 전날 마감 요약 ──────────────────────────────────────

async function getDailyBrief() {
  const quotes = await Promise.all(
    config.stock.indices.map((idx) => fetchQuote(idx.symbol).then((q) => ({ ...idx, ...q })))
  );

  const invalid = quotes.filter((q) => !Number.isFinite(Number(q.close)) || !Number.isFinite(Number(q.percentChange)));
  if (invalid.length > 0) {
    throw new Error(`증시 지수 값이 비정상입니다: ${invalid.map((q) => q.symbol).join(", ")}`);
  }

  return formatDailyBrief(quotes);
}

async function fetchQuote(symbol) {
  const apiKey = requireEnv("TWELVE_DATA_API_KEY");
  const url = `${TWELVE_DATA_BASE}/quote?symbol=${symbol}&apikey=${apiKey}`;

  return withRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Twelve Data 호출 실패: ${res.status}`);
      const json = await res.json();
      if (json.status === "error" || json.code) {
        throw new Error(`Twelve Data 오류(${symbol}): ${json.message ?? JSON.stringify(json)}`);
      }
      return {
        close: json.close,
        percentChange: json.percent_change,
        change: json.change,
        datetime: json.datetime,
      };
    },
    { backoffMs: [2000, 5000] }
  );
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
  const series = await Promise.all(
    config.stock.indices.map((idx) => fetchWeeklySeries(idx.symbol).then((s) => ({ ...idx, series: s })))
  );
  return formatWeeklyBrief(series);
}

async function fetchWeeklySeries(symbol) {
  const apiKey = requireEnv("TWELVE_DATA_API_KEY");
  const url = `${TWELVE_DATA_BASE}/time_series?symbol=${symbol}&interval=1day&outputsize=6&apikey=${apiKey}`;

  return withRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Twelve Data 호출 실패: ${res.status}`);
      const json = await res.json();
      if (json.status === "error" || json.code) {
        throw new Error(`Twelve Data 오류(${symbol}): ${json.message ?? JSON.stringify(json)}`);
      }
      // values: 최신순. 이번 주 첫 거래일(월) 종가 대비 마지막 거래일(금) 종가로 주간 등락 계산.
      return (json.values ?? []).slice(0, 5).reverse();
    },
    { backoffMs: [2000, 5000] }
  );
}

function formatWeeklyBrief(indexSeries) {
  const lines = indexSeries.map(({ label, series }) => {
    if (series.length < 2) return `- ${label}: 데이터 부족`;
    const first = Number(series[0].close);
    const last = Number(series[series.length - 1].close);
    const pct = ((last - first) / first) * 100;
    const sign = pct >= 0 ? "▲" : "▼";
    return `- ${label}: ${formatNumber(last)} (주간 ${sign}${Math.abs(pct).toFixed(2)}%)`;
  });
  return ["📈 이번 주 미국 증시 주간 요약", ...lines].join("\n");
}

// ── 월요일: 실적/경제지표 프리뷰 ──────────────────────────────

async function getMondayPreviewBrief() {
  const [earnings, econEvents] = await Promise.all([
    fetchSp100Earnings(),
    fetchHighImpactEvents(),
  ]);
  return formatMondayPreview(earnings, econEvents);
}

async function fetchSp100Earnings() {
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
  const sp100 = new Set(config.stock.sp100);
  const { dateStr: todayKst } = nowInKST();
  const weekEnd = addDaysToYYYYMMDD(todayKst, 7);

  return rows.filter((r) => {
    if (!sp100.has(r.symbol) || !r.reportDate) return false;
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

function formatMondayPreview(earnings, econEvents) {
  const earningsLines =
    earnings.length > 0
      ? earnings.map((e) => `- ${e.symbol} (${e.name}) · ${e.reportDate}`)
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
