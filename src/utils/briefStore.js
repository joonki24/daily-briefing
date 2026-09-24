import fs from "fs";
import path from "path";

// 스케줄 잡이 만든 "가장 최근 브리핑"을 저장해두는 곳. 폰(단축어)이 GET /brief/:name으로 가져간다.
// 파일에 저장하므로 서버가 재시작돼도 남는다.
const DIR = path.resolve("data", "briefs");

export const BRIEF_NAMES = ["morning", "evening"];

/**
 * @param {string} name - "morning" | "evening"
 * @param {{ ok: boolean, title: string, message: string }} brief
 */
export function saveBrief(name, brief) {
  fs.mkdirSync(DIR, { recursive: true });
  const entry = { ...brief, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(entry), "utf-8");
}

/**
 * @returns {{ ok: boolean, title: string, message: string, generatedAt: string } | undefined}
 */
export function loadBrief(name) {
  const file = path.join(DIR, `${name}.json`);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
