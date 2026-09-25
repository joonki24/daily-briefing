// 기상청 레이더 합성영상. 비/눈 예보 시 외출 준비 브리핑에 곁들이는 부가 기능.
// 주의: getCmpImg가 주는 이미지 URL(www.kma.go.kr/repositary/...)은
// 인증키 없이 공개 접근되므로, 목록 조회에만 서비스키가 필요하다.

import { withRetry } from "../utils/retry.js";
import { nowInKST } from "../utils/kst.js";

const LIST_URL = "https://apis.data.go.kr/1360000/RadarImgInfoService/getCmpImg";
const IMAGE_BASE_URL = "https://www.kma.go.kr/repositary/image/rdr/img";

/**
 * 오늘(KST) 생성된 레이더 합성영상 중 가장 최근 것의 URL을 반환.
 * 부가 기능이라 실패해도 본 응답을 막지 않도록, 에러 대신 undefined를 반환한다.
 */
export async function getLatestRadarImageUrl() {
  const apiKey = process.env.KMA_RADAR_SERVICE_KEY;
  if (!apiKey) {
    console.warn("[radarImage] KMA_RADAR_SERVICE_KEY가 설정되지 않아 레이더 이미지를 건너뜁니다.");
    return undefined;
  }

  try {
    const { dateStr } = nowInKST();
    const url = new URL(LIST_URL);
    // data.go.kr이 주는 키가 인코딩된 형태든 아니든 안전하게 동작하도록 디코딩 후 넣는다
    // (URLSearchParams가 알아서 한 번만 인코딩함 — weather.js와 동일한 패턴).
    url.searchParams.set("serviceKey", decodeURIComponent(apiKey));
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "300");
    url.searchParams.set("data", "CMP_WRC");
    url.searchParams.set("time", dateStr);
    url.searchParams.set("dataType", "JSON");

    const filenames = await withRetry(
      async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`레이더영상 API 호출 실패: ${res.status}`);
        const json = await res.json();
        if (json.response?.header?.resultCode !== "00") {
          throw new Error(`레이더영상 API 오류: ${json.response?.header?.resultMsg ?? "알 수 없음"}`);
        }
        return json.response?.body?.items?.item?.[0]?.["rdr-img-file"] ?? [];
      },
      { backoffMs: [2000, 5000] }
    );

    if (filenames.length === 0) {
      console.warn("[radarImage] 오늘 날짜의 레이더 영상 목록이 비어 있습니다.");
      return undefined;
    }

    // API가 파일명이 아니라 "http://www.kma.go.kr/.../RDR_CMP_WRC_*.png" 전체 URL을 준다.
    // 그 앞에 기본 주소를 또 붙이면 존재하지 않는 파일이라 기상청이 HTML 페이지를 돌려준다.
    const latest = filenames[filenames.length - 1];
    const fileName = latest.slice(latest.lastIndexOf("/") + 1);
    return `${IMAGE_BASE_URL}/${fileName}`;
  } catch (err) {
    console.warn("[radarImage] 레이더 이미지 조회 실패 (부가 기능이라 무시):", err.message);
    return undefined;
  }
}
