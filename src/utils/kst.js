// 서버가 어느 시간대(TZ)에서 돌든 항상 "한국 시각" 기준으로 날짜/시각/요일을 얻는 공용 유틸.
// weather.js, stock.js 등 여러 서비스가 공유한다.

/**
 * @returns {{ dateStr: string, hour: string, weekday: number }}
 * dateStr: "YYYYMMDD", hour: "00"~"23", weekday: 0(일)~6(토)
 */
export function nowInKST(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;

  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    dateStr: `${get("year")}${get("month")}${get("day")}`,
    hour: get("hour") === "24" ? "00" : get("hour"),
    weekday: WEEKDAY_INDEX[get("weekday")],
  };
}
