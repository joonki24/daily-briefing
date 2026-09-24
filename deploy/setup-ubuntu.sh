#!/usr/bin/env bash
# Ubuntu 22.04/24.04 서버(x86_64/ARM 모두 가능) 초기 세팅.
# 사용: 저장소를 clone한 폴더에서, .env를 미리 올려둔 뒤 `bash deploy/setup-ubuntu.sh`
set -euo pipefail

if [ ! -f .env ]; then
  echo "[deploy] .env가 없습니다. 로컬 PC에서 scp로 올린 뒤 다시 실행하세요." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y curl git

# Node.js 20 이상 (package.json engines 기준)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

sudo npm install -g pm2
npm ci
# 언론사 스크레이핑(MBC/KBS/채널A/JTBC)용 브라우저 + 시스템 의존 라이브러리
npx playwright install --with-deps chromium

pm2 start ecosystem.config.cjs
pm2 save

echo
echo "[deploy] 재부팅 후에도 자동 시작되게 하려면 아래 pm2가 출력하는 sudo 명령을 그대로 실행하세요."
pm2 startup
