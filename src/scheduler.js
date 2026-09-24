import cron from "node-cron";
import config from "../config.json" with { type: "json" };
import { getMorningStockBrief } from "./services/stock.js";
import { getEveningNewsBrief } from "./services/news.js";
import { pushNotification } from "./services/notify.js";
import { logRun } from "./utils/runLog.js";
import { saveBrief } from "./utils/briefStore.js";

function hhmmToCron(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${m} ${h} * * *`; // 매일 h시 m분
}

// 브리핑을 만들어 (1) 폰이 가져갈 수 있게 저장하고 (2) NTFY_TOPIC이 있으면 푸시도 보낸다.
// 저장을 푸시보다 먼저 하는 이유: 푸시(ntfy) 장애 때문에 잘 만든 브리핑까지 실패로 처리하면 안 됨.
async function runBriefJob({ key, label, title, generate }) {
  console.log(`[scheduler] ${label} 시작`);
  const startedAt = Date.now();

  let brief;
  try {
    brief = await generate();
  } catch (err) {
    const message = String(err.message ?? err);
    console.error(`[scheduler] ${label} 실패:`, err);
    saveBrief(key, { ok: false, title: `⚠️ ${label} 실패`, message });
    await pushNotification(`⚠️ ${label} 실패`, message).catch(() => {});
    logRun({ pipeline: key, trigger: "schedule", status: "failed", durationMs: Date.now() - startedAt, error: message });
    return;
  }

  saveBrief(key, { ok: true, title, message: brief });
  let pushFailed = false;
  try {
    await pushNotification(title, brief);
  } catch (err) {
    pushFailed = true;
    console.error(`[scheduler] ${label} 푸시 실패 (브리핑은 저장됨):`, err);
  }
  console.log(`[scheduler] ${label} 완료`);
  logRun({
    pipeline: key,
    trigger: "schedule",
    status: pushFailed ? "degraded" : "success",
    durationMs: Date.now() - startedAt,
    note: pushFailed ? "ntfy 푸시 실패(브리핑은 저장됨)" : undefined,
  });
}

const runMorningJob = () =>
  runBriefJob({ key: "morning", label: "아침 증시 브리핑", title: "오늘의 미국 증시 브리핑", generate: getMorningStockBrief });

const runEveningJob = () =>
  runBriefJob({ key: "evening", label: "저녁 뉴스 브리핑", title: "오늘의 뉴스 브리핑", generate: getEveningNewsBrief });

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
