/**
 * ntfy.sh로 아이폰에 푸시 알림을 보낸다.
 * - 아이폰 App Store에서 "ntfy" 앱 설치
 * - 앱에서 .env의 NTFY_TOPIC과 동일한 이름으로 구독(subscribe)
 * - 별도 로그인/가입 불필요
 */
export async function pushNotification(title, message) {
  const topic = process.env.NTFY_TOPIC;
  const server = process.env.NTFY_SERVER || "https://ntfy.sh";
  if (!topic) {
    console.warn("[notify] NTFY_TOPIC이 설정되어 있지 않아 알림을 보내지 않았습니다.");
    return { skipped: true };
  }

  const res = await fetch(`${server}/${topic}`, {
    method: "POST",
    headers: {
      Title: encodeRfc2047(title),
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: message,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ntfy 전송 실패: ${res.status} ${text}`);
  }
  return { ok: true };
}

// ntfy는 Title 헤더에 non-ASCII(한글)를 그대로 못 받는 경우가 있어 RFC 2047로 인코딩.
function encodeRfc2047(str) {
  const b64 = Buffer.from(str, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
