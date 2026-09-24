import Parser from "rss-parser";
import { summarize } from "./llmClient.js";
import { withBrowser, fetchPageText } from "../utils/browserText.js";
import { hasAllHeaders, isNonEmpty } from "../utils/validate.js";
import config from "../../config.json" with { type: "json" };

const parser = new Parser({ timeout: 10000 });

/**
 * config.json의 newsOutlets 각 항목을 type에 따라 다르게 수집한다.
 * - type: "rss"    → RSS 파싱 (빠르고 안정적)
 * - type: "scrape" → 브라우저로 홈페이지를 직접 렌더링해서 텍스트를 긁어옴
 *                    (MBC/KBS/연합뉴스/채널A/JTBC처럼 공개 RSS가 없는 언론사용)
 */
async function fetchRssOutlet(outlet) {
  const feed = await parser.parseURL(outlet.rss);
  const content = (feed.items ?? [])
    .slice(0, 15)
    .map((it) => `- ${it.title}${it.contentSnippet ? ` — ${it.contentSnippet.slice(0, 150)}` : ""}`)
    .join("\n");
  return { outlet: outlet.name, kind: "rss", content };
}

async function fetchScrapeOutlet(browser, outlet) {
  const text = await fetchPageText(browser, outlet.url);
  return { outlet: outlet.name, kind: "scrape", content: text.slice(0, 6000) };
}

export async function fetchConfiguredOutletItems() {
  const rssOutlets = config.newsOutlets.filter((o) => o.type === "rss");
  const scrapeOutlets = config.newsOutlets.filter((o) => o.type === "scrape");

  const rssResults = await Promise.allSettled(rssOutlets.map(fetchRssOutlet));

  let scrapeResults = [];
  if (scrapeOutlets.length > 0) {
    // 브라우저 하나를 공유해서 순서대로 방문 (매번 새로 띄우면 느리고 리소스 낭비)
    scrapeResults = await withBrowser((browser) =>
      Promise.allSettled(scrapeOutlets.map((o) => fetchScrapeOutlet(browser, o)))
    );
  }

  const paired = [
    ...rssOutlets.map((o, i) => ({ name: o.name, result: rssResults[i] })),
    ...scrapeOutlets.map((o, i) => ({ name: o.name, result: scrapeResults[i] })),
  ];

  const ok = [];
  const failed = [];
  for (const { name, result } of paired) {
    if (result.status === "fulfilled") ok.push(result.value);
    else failed.push({ outlet: name, error: result.reason?.message ?? String(result.reason) });
  }
  return { ok, failed };
}

function formatForPrompt(ok) {
  return ok
    .map(({ outlet, kind, content }) => {
      const note =
        kind === "scrape"
          ? " (홈페이지를 그대로 긁어온 원문 — 메뉴/광고/무관한 텍스트가 섞여 있을 수 있음, 실제 뉴스 기사 제목처럼 보이는 것만 사용할 것)"
          : "";
      return `### ${outlet}${note}\n${content}`;
    })
    .join("\n\n");
}

/**
 * 저녁 브리핑용: 지정된 언론사들의 최신 기사를 정치/사회/경제/스포츠/연예 카테고리로
 * 나눠서 한국어로 요약.
 */
export async function getEveningNewsBrief() {
  const { ok, failed } = await fetchConfiguredOutletItems();

  if (ok.length === 0) {
    return (
      `⚠️ 설정된 언론사를 하나도 읽어오지 못했습니다.\n` +
      failed.map((f) => `- ${f.outlet}: ${f.error}`).join("\n")
    );
  }

  const raw = formatForPrompt(ok);
  const categories = config.newsCategories.join("/");

  const instruction = `아래는 여러 언론사(${ok.map((o) => o.outlet).join(", ")})의 오늘자 최신 기사 목록/원문이야.
이 중에서 실제로 중요하고 눈에 띄는 뉴스만 골라, 다음 카테고리별로 나눠서 저녁에 읽기 좋게 정리해줘: ${categories}.

형식 예시:
🗞 오늘의 뉴스 브리핑

[정치]
- 한 줄 요약 (출처: 언론사명)

[사회]
- ...

[경제]
- ...

[스포츠]
- ...

[연예]
- ...

규칙:
- 각 카테고리 2~4개, 근거 없는 내용은 만들어내지 마.
- 해당 카테고리에 뉴스가 없으면 "특이 소식 없음"이라고 써.
- "(홈페이지를 그대로 긁어온 원문)"이라고 표시된 언론사는 메뉴/배너/추천기사 위젯 등 뉴스가 아닌 텍스트가 섞여 있을 수 있으니, 실제 기사 제목으로 보이는 것만 뽑아서 사용해.
- 각 항목은 한 줄(가능하면 30자 내외)로 압축.`;

  const brief = await summarizeWithValidation(instruction, raw);

  if (failed.length > 0) {
    return `${brief}\n\n(참고: ${failed.map((f) => f.outlet).join(", ")} 수집 실패)`;
  }
  return brief;
}

/**
 * 카테고리 헤더 5개가 응답에 다 있는지 검증하고, 빠졌으면 강조 문구를 붙여 1회 재시도.
 * 재시도까지 실패하면 완전히 실패 처리하지 않고 "⚠️ 형식 확인 필요" 딱지를 붙여서 그대로 발송한다.
 */
async function summarizeWithValidation(instruction, raw) {
  const headers = config.newsCategories.map((c) => `[${c}]`);
  const isValid = (text) => isNonEmpty(text) && hasAllHeaders(text, headers);

  let brief = await summarize(instruction, raw);
  if (isValid(brief)) return brief;

  const reinforcedInstruction = `${instruction}\n\n반드시 위 형식대로 카테고리 헤더 ${headers.join("")}를 빠짐없이 모두 포함해.`;
  brief = await summarize(reinforcedInstruction, raw);
  if (isValid(brief)) return brief;

  return `⚠️ 형식 확인 필요\n\n${brief}`;
}
