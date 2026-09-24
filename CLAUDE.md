# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 매 세션 시작 시 참고하는 규칙이다.

## 프로젝트 개요

개인용 자동화 브리핑 서버. 챗봇 형태가 아니라, 정해진 시각에 스케줄러가 자동으로 정보를 요약해
푸시 알림(ntfy)으로 보내고, 필요할 때만 iOS 단축어로 HTTP 엔드포인트를 호출하는 구조.

- 아침: 미국 증시 요약(화~토) / 주간 요약(일) / 실적·경제지표 프리뷰(월) → 자동 발송
- 저녁: 국내 뉴스 요약(카테고리별) → 자동 발송
- 외출 준비: 장소를 받아 대중교통 경로 + 날씨 요약 → 요청 즉시 응답

> **파이프라인 재설계 + 실키 검증 완료.** 아키텍처는 확정됐고(`docs/pipeline-architecture.dc.html`
> 참고), 3개 파이프라인(증시/뉴스/외출준비) 전부 재작성 후 실제 API 키로 동작 확인까지 끝남 —
> 증시(`stock.js`)와 외출준비(`route.js`/`weather.js`)는 LLM 없이 템플릿 포맷팅, 뉴스(`news.js`)만
> Claude Haiku 4.5로 카테고리 분류/요약 + 검증/재시도. 검증 중 발견해서 고친 버그(Twelve Data
> 무료 티어가 원시 지수를 막아서 ETF로 교체, data.go.kr 키 이중 인코딩, ODsay `totalWalk`
> 단위 오해)는 README "9. 남은 할 일" 상단에 기록돼 있음.

> **서비스 범위가 "개인용" → "가족 공유용"으로 확장 결정됨** (2026-09-24). 가족이 전부 같은 집에
> 살아서 `HOME_LAT`/`HOME_LON` 단일 좌표 구조는 그대로 유지해도 됨 (다인용 출발지 분기 불필요).
> 배포 계획: **Oracle Cloud 무료 티어**(사용자가 예전에 써본 적 있음)에 올려서 24시간 구동,
> 그 위에 Cloudflare Tunnel로 외부 접근 주소 확보 → 그 주소/새 `WEBHOOK_TOKEN`으로 iOS 단축어를
> **새로 만들어서** iCloud 공유 링크로 가족에게 배포. 기존에 갖고 있던 단축어는 재사용 안 하고
> 새로 만들기로 함(이유: 토큰이 바뀌기도 했고, 가족 배포 참에 깔끔하게 새로 시작). **알림은 ntfy 앱 없이** 받기로 함(2026-09-24): 서버가 스케줄 시각에 브리핑을 만들어 `data/briefs/`에
> 저장하고(`src/utils/briefStore.js`), 폰은 단축어 "개인 자동화(특정 시각)"로 `GET /brief/morning|evening`을
> 가져와 알림으로 띄움 — 요청마다 새로 만들면 느리고(뉴스 ~50초) 가족 수만큼 AI 비용이 늘어서 저장본 방식으로 함.
> `NTFY_TOPIC`은 선택(비우면 푸시 없음). 합의된 다음
> 진행 순서: ① Oracle Cloud 배포 ② Cloudflare Tunnel ③ 단축어 2개 신규 제작(외출 준비용 +
> ntfy 대체용) + 레이더 이미지 단계 포함 ④ `config.json` 조정 ⑤ ODsay 캐싱 ⑥ 설정 핫리로드.

## 빌드 / 실행 / 테스트 명령

```bash
npm install
node src/index.js              # 서버 + 스케줄러 시작
node --watch src/index.js      # 개발 중 자동 재시작

curl -X POST localhost:3000/test/morning   # 아침 브리핑 즉시 실행
curl -X POST localhost:3000/test/evening   # 저녁 브리핑 즉시 실행
```

- `npm test`, `npm run test:morning`, `npm run test:evening` 스크립트는 `package.json`에
  등록되어 있지만 대상 파일(`src/scripts/testMorning.js` 등)이 존재하지 않아 **현재 깨져 있음**.
  자동화된 테스트가 생기기 전까지는 위 curl 명령으로 수동 검증한다.
- Playwright 브라우저가 없으면 `npx playwright install chromium`을 먼저 실행한다.

## 아키텍처 원칙 (재설계 시 지킬 것)

- **데이터 수집(fetch) / 프롬프트 조립(build prompt) / LLM 호출(summarize) 을 분리한다.**
  한 함수 안에서 세 가지를 다 하지 않는다 — LLM 없이 raw 데이터만 확인하거나 프롬프트만
  단위 테스트할 수 있어야 한다.
- **스크레이핑보다 공식 API/RSS를 우선한다.** 스크레이핑은 최후의 수단이며, 추가할 때는
  반드시 로컬에서 실제로 실행해 성공을 확인한 뒤 커밋한다. "구조상 동작할 것 같다"는
  이유로 검증 없이 스크레이핑 코드를 추가하지 않는다.
- **LLM 호출은 실패를 전제로 만든다.** 타임아웃/재시도, 응답이 빈 문자열이거나 형식을
  벗어났을 때의 처리를 항상 포함한다. 실패를 사용자에게 조용히 숨기지 말고 알림으로 알린다
  (`scheduler.js`의 catch 패턴 참고). 재시도는 직접 구현하지 말고 `src/utils/retry.js`의
  `withRetry`를 재사용한다 (`llmClient.js`의 사용 예 참고).
- **구조화된 숫자/필드 데이터(지수, 좌표, 날씨 수치 등)는 LLM으로 "요약"하지 않는다.**
  이미 값이 정해져 있으므로 템플릿 문자열로 포맷팅한다 — LLM은 원문이 비정형 텍스트일 때만
  쓴다 (뉴스 기사 분류/요약이 대표 사례). 자세한 기준은 `docs/pipeline-architecture.dc.html`의
  "패턴 A/B" 구분 참고.
- **원문에 없는 수치·사실을 LLM이 지어내지 않도록 프롬프트에 명시한다.** (증시/날씨처럼
  숫자가 중요한 브리핑에서 특히 중요.)

## 코드 스타일

- ES Modules (`"type": "module"`), `import`/`export`만 사용. `require` 금지.
- 비동기 처리는 `async`/`await`만 사용. `.then()` 체이닝 금지.
- 들여쓰기 2칸, 세미콜론 사용, 문자열은 큰따옴표(`"`).
- 함수/변수명은 camelCase, 파일명은 camelCase (`stock.js`, `browserText.js`).
- **사용자 대면 텍스트(알림 제목/본문, 에러 메시지, README, 프롬프트 지시문)는 한국어.**
  코드 식별자(함수명/변수명)는 영어.
- 주석은 "왜"를 설명할 때만 작성한다 (예: 무료 API 한도, 사이트 구조가 바뀌면 깨지는 이유).
  코드를 그대로 옮겨 적는 주석은 쓰지 않는다.
- `console.log`/`console.error`에 `[모듈명]` 접두사를 붙인다 (`[scheduler]`, `[server]` 등
  기존 패턴 유지).

## 파일 구조 규칙

```
src/
├─ index.js        진입점 (서버+스케줄러 시작만, 로직 없음)
├─ server.js       HTTP 엔드포인트 정의만
├─ scheduler.js    cron 등록 + 잡 실행/에러 핸들링
├─ services/       외부 API·수집·LLM 요약 등 도메인 로직. 새 데이터 소스는 여기 새 파일로.
└─ utils/          여러 서비스가 공유하는 순수 유틸
   ├─ retry.js      범용 재시도 헬퍼 (withRetry) — 수집/LLM 호출 어디서든 재사용
   ├─ validate.js   검증 규칙 빌딩블록 (isNonEmpty/hasAllHeaders/hasKeyword)
   ├─ runLog.js     실행 이력 JSONL 기록/조회 (logRun/readRecentRuns)
   ├─ kst.js          한국 시각 기준 날짜/시각/요일 (nowInKST) — weather.js/stock.js가 공유
   ├─ browserText.js  Playwright 공용 헬퍼
   └─ grid.js         좌표 변환
```

- 새로운 브리핑 종류(예: 캘린더, 환율)를 추가할 때는 `services/`에 새 파일을 만들고,
  `scheduler.js`/`server.js`에서 얇게 호출만 한다. 엔드포인트/스케줄러 파일에 수집 로직을
  직접 넣지 않는다.
- 설정값(시각, 언론사 목록, 카테고리 등)은 코드에 하드코딩하지 않고 `config.json`에 둔다.

## 금지 사항

- `.env` 파일을 읽거나 값을 로그로 출력하지 않는다 (API 키 노출 금지).
- `WEBHOOK_TOKEN`, API 키 등 시크릿 값을 커밋, 로그, 커밋 메시지에 남기지 않는다.
- `config.json`의 `newsOutlets`, `stockSource` 등 검증되지 않은 스크레이핑 대상을 추가할 때
  "확인 안 해봤지만 동작할 것"이라고 README/커밋에 쓰지 않는다 — 반드시 로컬 실행 후 커밋.
- 인증 미들웨어(`server.js`의 토큰 체크)를 우회하거나 기본값을 "토큰 없으면 통과"로 완화하지
  않는다. 반대로 더 엄격하게(토큰 필수로) 바꾸는 것은 환영.
- ODsay 등 일일 호출 한도가 낮은 API를 캐싱 없이 반복 호출하는 테스트 코드를 추가하지 않는다.

## 워크플로우

- `config.json`의 시각/언론사 목록만 바꾼 경우도 서버 재시작이 필요하다 (정적 import이므로
  핫리로드 없음) — 이 제약이 아직 유효한지 재설계 시 다시 확인할 것.
- 스크레이핑 대상(언론사 스크레이핑 4곳)의 selector/구조를 바꿀 때는 커밋 전에
  `npx playwright screenshot <url> out.png`로 실제 렌더링을 먼저 확인한다.
- 커밋 전 `curl -X POST localhost:3000/test/morning`과 `/test/evening`을 실행해 실제
  브리핑 텍스트가 정상적으로 생성되는지 확인한다 (자동 테스트가 없으므로 이것이 유일한 검증).
- 재설계 항목(증시 API 확정, 뉴스 RSS 전환, 검증/재시도 로직 등)을 하나 구현할 때마다
  `docs/pipeline-architecture.dc.html`을 그 내용에 맞게 갱신한다 — "미확정" 뱃지를 실제
  선택값으로 바꾸거나, 새로 생긴 단계/분기를 반영하는 식. 단, "구현 완료" 같은 진행 상태
  워딩은 다이어그램에 넣지 않는다 (다이어그램은 항상 "현재 아키텍처가 어떤 모습인지"만
  보여주고, 진행 이력은 커밋 로그/PR에 맡긴다).

## 참고 문서

- `README.md` — API 키 발급, 무료 한도, iOS 단축어 설정 등 사용자용 설치 가이드.
  아키텍처가 바뀌면 README도 함께 갱신할 것 (특히 "9. 남은 할 일" 섹션).
- `docs/pipeline-architecture.dc.html` — 파이프라인 아키텍처 다이어그램 소스. Claude Design
  Canvas 전용 포맷이라 일반 브라우저로는 스타일 없이 보임 — 실제로 보려면
  https://claude.ai/artifact/FCaHkPXXNoLGAhcojURSsa 를 연다. 이 파일은 그 Artifact와 세트로
  관리한다 (Artifact를 갱신하면 이 파일도 같은 내용으로 다시 써서 커밋).
