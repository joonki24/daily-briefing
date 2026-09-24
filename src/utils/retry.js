// 범용 재시도 헬퍼. 수집(fetch)/LLM 호출 등 여러 곳에서 재사용한다.

/**
 * @param {() => Promise<any>} fn
 * @param {object} [opts]
 * @param {number[]} [opts.backoffMs] - 각 재시도 전 대기시간(ms). 길이가 재시도 횟수를 결정한다.
 * @param {(error: unknown) => boolean} [opts.isRetryable] - 이 에러를 재시도할지 판단
 * @param {(error: unknown) => number | undefined} [opts.getRetryAfterMs] - 서버가 알려준 대기시간(429 등) 우선 사용
 */
export async function withRetry(fn, opts = {}) {
  const backoffMs = opts.backoffMs ?? [2000, 5000];
  const isRetryable = opts.isRetryable ?? (() => true);
  const getRetryAfterMs = opts.getRetryAfterMs ?? (() => undefined);

  let lastError;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === backoffMs.length;
      if (isLastAttempt || !isRetryable(err)) throw err;

      const wait = getRetryAfterMs(err) ?? backoffMs[attempt];
      await sleep(wait);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
