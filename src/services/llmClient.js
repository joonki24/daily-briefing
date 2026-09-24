// 요약 생성용 LLM 클라이언트. Claude Haiku 4.5 사용.
// - 발급: https://console.anthropic.com (ANTHROPIC_API_KEY)
// - 이 프로젝트는 하루 20건 안팎만 호출하므로 비용이 매우 낮다 (Haiku 4.5 기준 월 1달러 안팎).

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "../utils/retry.js";

const MODEL = "claude-haiku-4-5";

// SDK 자체 재시도는 끄고, withRetry로 재시도 정책(횟수/백오프/429 처리)을 직접 제어한다.
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다 (.env 확인)");
  }
  return new Anthropic({ apiKey, maxRetries: 0 });
}

/**
 * 주어진 원문(raw)을 지시문(instruction)에 따라 요약/가공해서 텍스트로 반환.
 * @param {string} instruction - 무엇을 해달라는 지시 (톤, 길이, 항목 등)
 * @param {string} raw - 원본 데이터 (스크레이핑/뉴스/API 응답 등)
 */
export async function summarize(instruction, raw) {
  const client = getClient();

  const response = await withRetry(
    () =>
      client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: `${instruction}\n\n---\n원본 데이터:\n${raw}` }],
      }),
    {
      backoffMs: [2000, 5000],
      isRetryable: isRetryableError,
      getRetryAfterMs: getRetryAfterMs,
    }
  );

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) {
    throw new Error(`Claude 응답이 비어 있습니다 (stop_reason: ${response.stop_reason ?? "알 수 없음"})`);
  }

  return text;
}

function isRetryableError(err) {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIStatusError) return err.status >= 500;
  return false;
}

function getRetryAfterMs(err) {
  const retryAfter = err?.headers?.get?.("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
