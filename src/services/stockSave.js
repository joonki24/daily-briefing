import { summarize } from "./llmClient.js";
import { withBrowser, fetchPageText } from "../utils/browserText.js";
import config from "../../config.json" with { type: "json" };

/**
 * SAVE(saveticker.com)는 공식 공개 API/RSS가 없으므로 브라우저 자동화로
 * 뉴스/시황 페이지를 직접 렌더링해서 텍스트를 긁어온다.
 *
 * 주의:
 * - saveticker.com은 SAVE 앱/서비스 이용약관 대상입니다. 이 스크립트는 "개인이
 *   자신의 용도로 하루 1~2회" 접근하는 것을 전제로 최소한의 요청만 보내도록
 *   설계했습니다. 상업적 재배포, 과도한 요청 빈도는 피하세요.
 * - 사이트 구조(HTML class/selector)가 바뀌면 아래 SELECTORS를 갱신해야 합니다.
 *   막히면 `npx playwright screenshot https://www.saveticker.com/news out.png`
 *   로 실제 렌더링 결과를 먼저 확인하세요.
 */

const SELECTORS = {
  // 뉴스 카드/리스트 아이템으로 보이는 요소들의 텍스트를 넉넉히 긁어온다.
  // (정확한 클래스명이 아니라, 페이지 전체 본문 텍스트 중 의미있는 블록만
  //  추리는 휴리스틱 방식이라 사이트가 리뉴얼되어도 잘 안 깨지는 편이다.)
  articleLike: "main, article, [class*='news'], [class*='card'], [class*='list']",
};

export async function fetchSaveRawText() {
  return withBrowser((browser) => fetchPageText(browser, config.stockSource.url));
}

/**
 * SAVE에서 긁어온 원문을 "아침에 3~5줄로 읽을 수 있는 미국 증시 요약"으로 가공.
 */
export async function getMorningStockBrief() {
  const raw = await fetchSaveRawText();

  if (!raw || raw.length < 50) {
    return "⚠️ SAVE(saveticker.com) 페이지에서 내용을 가져오지 못했습니다. 사이트 구조가 바뀌었거나 접근이 차단되었을 수 있어요. stockSave.js의 selector/waitUntil 옵션을 점검해 주세요.";
  }

  const instruction = `너는 나의 개인 아침 브리핑 작성자야. 아래는 'SAVE(오선의 미국 증시 라이브)' 웹페이지에서
그대로 긁어온 원문(메뉴, 광고, 관련없는 텍스트가 섞여 있을 수 있음)이야.
이 중에서 "미국 증시 시황/뉴스"에 해당하는 내용만 골라서, 출근 전에 30초 안에 읽을 수 있게
아래 형식으로 아주 간략히 한국어로 요약해줘.

형식:
📈 미국 증시 브리핑
- 주요 지수(나스닥/S&P500/다우) 등락: (원문에 수치가 있으면 반영, 없으면 "수치 확인 안됨"이라고 표시)
- 오늘 시장을 움직인 핵심 이슈 2~3개 (한 줄씩)
- 한국 시장 개장 전 참고할 점이 있다면 한 줄

수치를 추측하거나 지어내지 말고, 원문에 없는 내용은 쓰지 마.`;

  return summarize(instruction, raw.slice(0, 12000));
}
