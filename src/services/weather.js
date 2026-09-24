import { latLonToGrid } from "../utils/grid.js";
import { summarize } from "./llmClient.js";
import { nowInKST } from "../utils/kst.js";

const BASE_URL =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

// 단기예보는 하루 8회(02,05,08,11,14,17,20,23시)만 갱신되고, 발표 후 약 10분 뒤부터 조회 가능.
// 서버의 시스템 시간대와 무관하게 항상 한국 시각(KST) 기준으로 계산한다.
function getLatestBaseDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = get("hour") === "24" ? 0 : Number(get("hour"));
  const minute = Number(get("minute"));

  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const minutesReady = hour * 60 + minute - 10; // 10분 여유
  let chosenHour = null;
  for (const h of slots) {
    if (h * 60 <= minutesReady) chosenHour = h;
  }

  // KST 기준 오늘 날짜를 Date 객체로 안전하게 구성 (UTC = KST - 9h)
  const kstMidnightUtcMs = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day"))
  ) - 9 * 60 * 60 * 1000;
  const d = new Date(kstMidnightUtcMs);

  if (chosenHour === null) {
    // 오늘 첫 발표(02시) 이전이면 전날 23시 발표를 사용
    d.setUTCDate(d.getUTCDate() - 1);
    chosenHour = 23;
  }
  const base_date =
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  const base_time = String(chosenHour).padStart(2, "0") + "00";
  return { base_date, base_time };
}

/**
 * 위경도 기준 단기예보(3일치, 1시간 단위) 원본 items 배열을 가져온다.
 */
export async function fetchForecastItems(lat, lon) {
  const serviceKey = process.env.KMA_SERVICE_KEY;
  if (!serviceKey) throw new Error("KMA_SERVICE_KEY가 설정되지 않았습니다 (.env 확인)");

  const { nx, ny } = latLonToGrid(lat, lon);
  const { base_date, base_time } = getLatestBaseDateTime();

  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", base_date);
  url.searchParams.set("base_time", base_time);
  url.searchParams.set("nx", String(nx));
  url.searchParams.set("ny", String(ny));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`기상청 API 호출 실패: ${res.status}`);
  const json = await res.json();

  const header = json?.response?.header;
  if (!header || header.resultCode !== "00") {
    throw new Error(
      `기상청 API 오류: ${header?.resultCode} ${header?.resultMsg ?? "알 수 없는 오류"}`
    );
  }
  return json.response.body.items.item ?? [];
}

const PTY_LABEL = {
  0: "없음",
  1: "비",
  2: "비/눈",
  3: "눈",
  4: "소나기",
  5: "빗방울",
  6: "빗방울눈날림",
  7: "눈날림",
};

/**
 * items(카테고리별로 흩어진 행들)를 "YYYYMMDDHHmm" 시각 기준으로 묶어
 * { time, TMP, POP, PTY, SKY, REH } 형태의 시간대별 예보 배열로 변환.
 */
function groupByTime(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.fcstDate}${it.fcstTime}`;
    if (!map.has(key)) {
      map.set(key, { date: it.fcstDate, time: it.fcstTime });
    }
    map.get(key)[it.category] = it.fcstValue;
  }
  return [...map.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * 오늘 날짜의, [fromHHmm, 24:00) 구간에 해당하는 시간대만 필터링 (한국 시각 기준).
 * fromHHmm이 지금보다 과거면 "지금"으로 보정한다(이미 지난 시각 예보는 의미 없음).
 */
function filterFromTimeUntilMidnight(rows, fromHHmm) {
  const { dateStr: todayStr, hour } = nowInKST();
  const nowHHmm = Number(`${hour}00`);
  const startHHmm = Math.max(Number(fromHHmm), nowHHmm);
  return rows.filter((r) => r.date === todayStr && Number(r.time) >= startHHmm);
}

/**
 * 외출 브리핑용: 출발 시각부터 자정까지 강수/강설 여부 중심 날씨 요약.
 * @param {number} lat
 * @param {number} lon
 * @param {string} placeLabel - "강남역" 같은 사람이 읽을 장소 이름 (요약 프롬프트용)
 * @param {string} departureHHmm - "1830" 처럼 4자리 시각(HHmm). 생략 시 현재 시각 사용.
 */
export async function getDepartureWeatherBrief(lat, lon, placeLabel, departureHHmm) {
  const items = await fetchForecastItems(lat, lon);
  const rows = groupByTime(items);
  const from = departureHHmm ?? `${nowInKST().hour}00`;
  const relevant = filterFromTimeUntilMidnight(rows, from);

  const table = relevant
    .map((r) => {
      const pty = PTY_LABEL[Number(r.PTY)] ?? r.PTY;
      return `${r.time.slice(0, 2)}시: 기온 ${r.TMP ?? "-"}°C, 강수확률 ${r.POP ?? "-"}%, 강수형태 ${pty}, 하늘상태코드 ${r.SKY ?? "-"}`;
    })
    .join("\n");

  const instruction = `아래는 "${placeLabel}" 지역의, 외출 시각(${from.slice(0, 2)}시${from.slice(2)}분경)부터
자정까지 시간대별 기상청 단기예보 데이터야. 이걸 바탕으로 외출 준비하는 사람에게 줄 날씨 브리핑을 작성해줘.

반드시 지킬 것:
1. 가장 먼저 "외출 시각부터 자정 사이에 비/눈이 오는지 여부"를 한 문장으로 명확히 알려줘 (온다면 대략 몇 시쯤인지).
2. 그다음 기온 범위(최저~최고), 우산 필요 여부를 알려줘.
3. 마지막에 전반적인 날씨(맑음/흐림 등)와 옷차림 관련 짧은 팁 한 줄.
4. 전체 5줄 이내로, 수치는 원본 데이터에 있는 값만 사용해.`;

  return summarize(instruction, table);
}
