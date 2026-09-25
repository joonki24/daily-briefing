import express from "express";
import config from "../config.json" with { type: "json" };
import { getRouteBrief } from "./services/route.js";
import { getDepartureWeatherBrief } from "./services/weather.js";
import { getLatestRadarImageUrl } from "./services/radarImage.js";
import { runMorningJob, runEveningJob } from "./scheduler.js";
import { readRecentRuns, logRun } from "./utils/runLog.js";
import { BRIEF_NAMES, loadBrief } from "./utils/briefStore.js";
import { nowInKST } from "./utils/kst.js";

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
   * 스케줄 잡이 만들어 둔 "가장 최근 브리핑"을 돌려준다 (name: morning | evening).
   * 폰 단축어의 "자동화"가 정해진 시각에 이걸 가져와 알림으로 띄운다 — ntfy 앱이 필요 없다.
   * 요청 때마다 새로 만들지 않고 저장본을 주므로 응답이 즉시 오고, 가족이 몇 명이 써도 AI 호출 비용이 늘지 않는다.
   */
  app.get("/brief/:name", (req, res) => {
    const { name } = req.params;
    if (!BRIEF_NAMES.includes(name)) {
      return res.status(404).json({ ok: false, error: `${BRIEF_NAMES.join(" 또는 ")}만 가능합니다.` });
    }
    const brief = loadBrief(name);
    if (!brief) {
      return res.status(404).json({ ok: false, error: "아직 생성된 브리핑이 없습니다." });
    }

    // 오늘(KST) 만든 게 아니면(서버가 꺼져 있었던 경우 등) 오래된 내용이라고 맨 앞에 표시한다.
    const stale = nowInKST(new Date(brief.generatedAt)).dateStr !== nowInKST().dateStr;
    const message = stale ? `⚠️ 오늘 브리핑이 아직 만들어지지 않아 이전 내용입니다.

${brief.message}` : brief.message;
    res.json({ ok: brief.ok, title: brief.title, message, generatedAt: brief.generatedAt, stale });
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
    const startedAt = Date.now();
    try {
      const place = req.query.place ?? req.body?.place;
      const timeRaw = req.query.time ?? req.body?.time;

      if (!place) {
        return res.status(400).json({ error: "place 파라미터가 필요합니다." });
      }

      const departureHHmm = timeRaw ? normalizeTime(timeRaw) : undefined;

      const homeLat = Number(process.env.HOME_LAT);
      const homeLon = Number(process.env.HOME_LON);

      // 경로/날씨를 독립적으로 처리 — 하나가 실패해도 나머지로 부분 응답한다
      // (요청 트리거라 사용자가 화면 앞에서 기다리는 중이므로, 완전 실패보다 부분 정보가 낫다).
      const [routeSettled, weatherSettled] = await Promise.allSettled([
        getRouteBrief(homeLat, homeLon, place),
        getDepartureWeatherBrief(homeLat, homeLon, place, departureHHmm),
      ]);

      const routeOk = routeSettled.status === "fulfilled";
      const weatherOk = weatherSettled.status === "fulfilled";

      if (!routeOk && !weatherOk) {
        logRun({
          pipeline: "depart",
          trigger: "request",
          status: "failed",
          durationMs: Date.now() - startedAt,
          error: `경로: ${routeSettled.reason?.message}; 날씨: ${weatherSettled.reason?.message}`,
        });
        return res.status(500).json({
          ok: false,
          error: "경로와 날씨 모두 조회하지 못했습니다.",
        });
      }

      const routeText = routeOk ? routeSettled.value.brief : `⚠️ 조회 실패: ${routeSettled.reason.message}`;
      const weatherText = weatherOk ? weatherSettled.value.brief : `⚠️ 조회 실패: ${weatherSettled.reason.message}`;

      const message = `🧭 ${place}\n\n[경로]\n${routeText}\n\n[날씨]\n${weatherText}`;
      const partial = !routeOk || !weatherOk;

      // 비/눈이 예보된 경우에만 레이더 이미지 조회 — 부가 기능이라 실패해도 본 응답에 영향 없게.
      const wantsRadar = weatherOk && weatherSettled.value.hasPrecipitation;
      const radarImageUrl = wantsRadar
        ? await getLatestRadarImageUrl().catch(() => undefined)
        : undefined;
      const radarMissing = wantsRadar && !radarImageUrl;

      const notes = [
        partial ? (routeOk ? "날씨 실패" : "경로 실패") : undefined,
        radarMissing ? "레이더 이미지 없음" : undefined,
      ].filter(Boolean);

      logRun({
        pipeline: "depart",
        trigger: "request",
        status: partial ? "degraded" : "success",
        durationMs: Date.now() - startedAt,
        note: notes.length > 0 ? notes.join(", ") : undefined,
      });

      // 단축어는 이 응답의 텍스트를 그대로 "알림 표시"에 넣어 쓰면 됨.
      res.json({
        ok: true,
        message,
        partial,
        destination: routeOk ? routeSettled.value.destination : undefined,
        radarImageUrl,
      });
    } catch (err) {
      console.error("[/depart] 오류:", err);
      logRun({
        pipeline: "depart",
        trigger: "request",
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: String(err.message ?? err),
      });
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
