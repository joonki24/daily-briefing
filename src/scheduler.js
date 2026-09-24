import cron from "node-cron";
import config from "../config.json" with { type: "json" };
import { getMorningStockBrief } from "./services/stockSave.js";
import { getEveningNewsBrief } from "./services/news.js";
import { pushNotification } from "./services/notify.js";
import { logRun } from "./utils/runLog.js";

function hhmmToCron(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${m} ${h} * * *`; // 매일 h시 m분
}

async function runMorningJob() {
  console.log("[scheduler] 아침 증시 브리핑 시작");
  const startedAt = Date.now();
  try {
    const brief = await getMorningStockBrief();
    await pushNotification("오늘의 미국 증시 브리핑", brief);
    console.log("[scheduler] 아침 브리핑 발송 완료");
    logRun({ pipeline: "morning", trigger: "schedule", status: "success", durationMs: Date.now() - startedAt });
  } catch (err) {
    console.error("[scheduler] 아침 브리핑 실패:", err);
    await pushNotification("⚠️ 아침 브리핑 실패", String(err.message ?? err)).catch(() => {});
    logRun({
      pipeline: "morning",
      trigger: "schedule",
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: String(err.message ?? err),
    });
  }
}

async function runEveningJob() {
  console.log("[scheduler] 저녁 뉴스 브리핑 시작");
  const startedAt = Date.now();
  try {
    const brief = await getEveningNewsBrief();
    await pushNotification("오늘의 뉴스 브리핑", brief);
    console.log("[scheduler] 저녁 브리핑 발송 완료");
    logRun({ pipeline: "evening", trigger: "schedule", status: "success", durationMs: Date.now() - startedAt });
  } catch (err) {
    console.error("[scheduler] 저녁 브리핑 실패:", err);
    await pushNotification("⚠️ 저녁 브리핑 실패", String(err.message ?? err)).catch(() => {});
    logRun({
      pipeline: "evening",
      trigger: "schedule",
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: String(err.message ?? err),
    });
  }
}

export function startScheduler() {
  const tz = config.timezone || "Asia/Seoul";

  if (config.morning?.enabled) {
    cron.schedule(hhmmToCron(config.morning.time), runMorningJob, { timezone: tz });
    console.log(`[scheduler] 아침 브리핑 등록: 매일 ${config.morning.time} (${tz})`);
  }

  if (config.evening?.enabled) {
    cron.schedule(hhmmToCron(config.evening.time), runEveningJob, { timezone: tz });
    console.log(`[scheduler] 저녁 브리핑 등록: 매일 ${config.evening.time} (${tz})`);
  }
}

// 수동 테스트용으로 export
export { runMorningJob, runEveningJob };
