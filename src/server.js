import express from "express";
import config from "../config.json" with { type: "json" };
import { getRouteBrief } from "./services/route.js";
import { getDepartureWeatherBrief } from "./services/weather.js";
import { runMorningJob, runEveningJob } from "./scheduler.js";
import { readRecentRuns } from "./utils/runLog.js";

export function createServer() {
  const app = express();
  app.use(express.json());

  // 아이폰 단축어가 보내는 토큰을 검사 (Authorization 헤더 또는 ?token= 쿼리)
  app.use((req, res, next) => {
    const expected = process.env.WEBHOOK_TOKEN;
    if (!expected) return next(); // 토큰 미설정 시 통과 (로컬 테스트용, 운영 시 반드시 설정!)
    const got =
      req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
    if (got !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  // 최근 파이프라인 실행 이력 조회 (logs/runs.jsonl 기반).
  app.get("/logs", (req, res) => {
    const limit = Number(req.query.limit) || 20;
    res.json({ ok: true, runs: readRecentRuns(limit) });
  });

  /**
   * iOS 단축어에서 호출하는 메인 엔드포인트.
   * GET/POST 둘 다 허용 (단축어의 "URL 콘텐츠 가져오기" 액션에서 GET이 제일 쓰기 쉬움).
   *
   * 쿼리 파라미터:
   *   place  - 필수. 목적지 이름 (예: "강남역", "판교역 2번출구")
   *   time   - 선택. 출발 예정 시각 "HH:mm" 또는 "HHmm" (없으면 지금 시각으로 처리)
   *
   * 예: GET /depart?place=강남역&time=18:30&token=WEBHOOK_TOKEN
   */
  app.all("/depart", async (req, res) => {
    try {
      const place = req.query.place ?? req.body?.place;
      const timeRaw = req.query.time ?? req.body?.time;

      if (!place) {
        return res.status(400).json({ error: "place 파라미터가 필요합니다." });
      }

      const departureHHmm = timeRaw ? normalizeTime(timeRaw) : undefined;

      const homeLat = Number(process.env.HOME_LAT);
      const homeLon = Number(process.env.HOME_LON);

      const [routeResult, weatherBrief] = await Promise.all([
        getRouteBrief(homeLat, homeLon, place),
        getDepartureWeatherBrief(homeLat, homeLon, place, departureHHmm).catch(
          (e) => `날씨 조회 실패: ${e.message}`
        ),
      ]);

      const message =
        `🧭 ${place}\n\n` +
        `[경로]\n${routeResult.brief}\n\n` +
        `[날씨]\n${weatherBrief}`;

      // 단축어는 이 응답의 텍스트를 그대로 "알림 표시"에 넣어 쓰면 됨.
      res.json({ ok: true, message, destination: routeResult.destination });
    } catch (err) {
      console.error("[/depart] 오류:", err);
      res.status(500).json({ ok: false, error: err.message ?? String(err) });
    }
  });

  // 수동 테스트/디버깅용 (자동 스케줄과 별개로 즉시 실행해보고 싶을 때)
  app.post("/test/morning", async (req, res) => {
    await runMorningJob();
    res.json({ ok: true });
  });
  app.post("/test/evening", async (req, res) => {
    await runEveningJob();
    res.json({ ok: true });
  });

  return app;
}

// "18:30", "1830", "6:30" 등을 "1830" 형태(HHmm)로 정규화.
function normalizeTime(input) {
  const cleaned = String(input).trim();
  const m = cleaned.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) throw new Error(`인식할 수 없는 시각 형식: ${input}`);
  const hh = m[1].padStart(2, "0");
  return `${hh}${m[2]}`;
}
