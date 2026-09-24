import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * 브라우저 하나를 띄워서 fn(browser)를 실행하고, 끝나면 확실히 닫아준다.
 * 여러 페이지를 연속으로 긁을 때 브라우저를 매번 새로 띄우지 않도록 공유하는 용도.
 */
export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * 주어진 URL을 렌더링해서 화면에 보이는 텍스트만 뽑아온다 (스크립트/스타일 제거).
 * 로그인 없이 볼 수 있는 공개 페이지 전제.
 */
export async function fetchPageText(browser, url, { waitMs = 1500, timeoutMs = 20000 } = {}) {
  const page = await browser.newPage({ userAgent: UA });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.waitForTimeout(waitMs);
    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("script,style,noscript").forEach((el) => el.remove());
      return clone.innerText;
    });
    return text.replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await page.close();
  }
}
