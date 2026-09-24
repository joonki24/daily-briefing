import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve("logs");
const LOG_FILE = path.join(LOG_DIR, "runs.jsonl");

/**
 * 파이프라인 실행 결과를 한 줄(JSON)로 logs/runs.jsonl에 append한다.
 * @param {object} entry
 * @param {string} entry.pipeline - "morning" | "evening" | ...
 * @param {"schedule"|"request"} entry.trigger
 * @param {"success"|"degraded"|"failed"} entry.status
 * @param {number} entry.durationMs
 * @param {number} [entry.retries]
 * @param {string} [entry.error]
 * @param {string} [entry.note]
 */
export function logRun(entry) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

/**
 * 최근 실행 기록 N개를 최신순으로 반환.
 * @param {number} limit
 */
export function readRecentRuns(limit = 20) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, raw: line };
      }
    });
}
