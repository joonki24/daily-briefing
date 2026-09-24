// 브리핑 검증 규칙을 조립할 때 쓰는 빌딩블록. 파이프라인마다 이 함수들을 조합해서 쓴다.

/**
 * 빈 응답/길이 체크 (모든 브리핑 공통 규칙).
 */
export function isNonEmpty(text, { minLen = 20, maxLen = 2000 } = {}) {
  const trimmed = (text ?? "").trim();
  return trimmed.length >= minLen && trimmed.length <= maxLen;
}

/**
 * 응답에 지정된 헤더(예: "[정치]")가 전부 존재하는지 확인.
 * @param {string} text
 * @param {string[]} headers
 */
export function hasAllHeaders(text, headers) {
  return headers.every((h) => text.includes(h));
}

/**
 * 정규식 패턴 중 하나라도 매칭되는지 확인 (예: "📈"/"📉" 등 동의어 허용).
 * @param {string} text
 * @param {RegExp[]} patterns
 */
export function hasKeyword(text, patterns) {
  return patterns.some((p) => p.test(text));
}
