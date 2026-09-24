# 개인 브리핑 서버 (아침 증시 / 외출 날씨·경로 / 저녁 뉴스)

챗봇 없이, 정해진 시각에 자동으로 정보를 알려주고 필요할 때만 아이폰 "단축어" 앱으로
정보를 요청하는 개인용 자동화 서버입니다.

## 이게 하는 일

| 시점 | 방식 | 내용 |
|---|---|---|
| 아침 (config.json에서 시각 지정) | 자동(서버 스케줄) → 폰 알림 | 화~토: 전날 미국 증시 마감 요약 / 일: 주간 요약 / 월: 이번 주 실적·경제지표 프리뷰 (Twelve Data/Alpha Vantage/ForexFactory, LLM 없이 템플릿 포맷팅) |
| 저녁 (config.json에서 시각 지정) | 자동(서버 스케줄) → 폰 알림 | config.json에 지정한 언론사 RSS를 모아 정치/사회/경제/스포츠/연예로 요약 |
| 외출 준비 (매번 직접 입력) | 아이폰 단축어 실행 → 즉시 응답 | 입력한 장소까지 대중교통 최단 경로 + 출발시각부터 자정까지 날씨(비/눈 여부 중심), 비/눈 예보 시 기상청 레이더 이미지 URL도 같이 응답. LLM 없이 템플릿 포맷팅, 경로/날씨 중 하나만 조회돼도 부분 응답 |

## 1. 사전 준비물 (API 키) — 전부 무료

`.env.example`을 `.env`로 복사한 뒤 아래 값을 채우세요.

| # | 키 | 용도 | 무료 한도 | 카드 등록 |
|---|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` | 요약 생성(LLM, Claude Haiku 4.5 — 뉴스 브리핑에만 씀) | 무료 아님 — 이 서비스 규모(하루 20건 안팎)엔 월 1달러 안팎 | 필요 |
| 2 | `TWELVE_DATA_API_KEY` | 증시 지수(나스닥/S&P500/다우) | 하루 800회 · 분당 8회 | 불필요 |
| 3 | `ALPHA_VANTAGE_API_KEY` | 월요일 실적 발표 프리뷰 | 하루 25~500회(계정별 상이) | 불필요 |
| 4 | `KMA_SERVICE_KEY` | 기상청 단기예보 | 하루 약 1만 건 | 불필요 |
| 5 | `KMA_RADAR_SERVICE_KEY` | 비/눈 예보 시 레이더 이미지 | 하루 약 1만 건 | 불필요 |
| 6 | `KAKAO_REST_API_KEY` | 장소→좌표 변환 | 하루 10만 건 | 불필요 |
| 7 | `ODSAY_API_KEY` | 대중교통 경로 | **하루 30건** (개인/학생 Basic) | 불필요 |
| 8 | `NTFY_TOPIC` | 폰 알림 발송 | 무제한(공용 서버 예의상 사용) | 가입 자체 불필요 |

1. **ANTHROPIC_API_KEY** — https://console.anthropic.com 에서 발급. 카드 등록이 필요하지만,
   이 서비스 사용량(하루 20건 안팎)이면 소액 크레딧으로 몇 달을 쓸 수 있습니다.
2. **TWELVE_DATA_API_KEY** — https://twelvedata.com 가입 후 발급. 신용카드 불필요.
3. **ALPHA_VANTAGE_API_KEY** — https://www.alphavantage.co/support/#api-key 에서 이메일만
   입력하면 즉시 발급. 월요일 프리뷰(주 1회)에만 쓰므로 무료 한도로 충분합니다.
4. **KMA_SERVICE_KEY** — [공공데이터포털 단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do) "활용신청" 후 발급
5. **KMA_RADAR_SERVICE_KEY** — [공공데이터포털 레이더영상 조회서비스](https://www.data.go.kr/data/15056924/openapi.do)
   "활용신청" 후 발급. `KMA_SERVICE_KEY`와 **별개 키**입니다(같은 포털이지만 API마다 따로 신청).
6. **KAKAO_REST_API_KEY** — https://developers.kakao.com → 애플리케이션 추가 → REST API 키
7. **ODSAY_API_KEY** — https://lab.odsay.com 가입 후 발급. **하루 30건**까지만 무료라 아래
   "무료 한도 주의사항"을 꼭 읽어보세요.
8. **HOME_LAT / HOME_LON** — 기본 출발지(집) 좌표. 카카오맵/구글맵에서 우클릭 → 좌표 복사
9. **NTFY_TOPIC** — 아무 문자열이나 추측하기 어려운 이름으로 정하기 (예: `jgi-briefing-xk92a`).
   가입 불필요. 아이폰에 App Store에서 **ntfy** 앱만 설치하고, 앱에서 같은 이름으로 구독하면 끝.
10. **WEBHOOK_TOKEN** — 아무 긴 임의 문자열. 외부에 서버를 노출할 때 아무나 `/depart`를 호출하지
    못하도록 막는 비밀값입니다. 단축어에서도 같은 값을 같이 보내야 합니다.

### 무료 한도 주의사항

- **ODsay가 병목입니다.** 하루 30건까지만 무료이므로, 테스트하면서 `/depart`를 여러 번 반복
  호출하면 금방 소진됩니다. 실사용(하루 1~3회 외출 조회)에는 넉넉하지만, 개발 중 curl로 반복
  테스트할 때는 특히 주의하세요. 초과하면 그날은 유료 전환하지 않는 한 호출이 막힙니다.
- **Claude Haiku 4.5 비용은 이 서비스 규모(하루 20건 안팎)엔 부담이 거의 없습니다** (대략 월 1달러 안팎).
  카드 등록 없이 쓰고 싶다면 `src/services/llmClient.js`만 다른 LLM API 형식에 맞게 바꾸면
  나머지 코드는 그대로 씁니다. 증시/외출준비 브리핑은 LLM을 아예 쓰지 않아 이 비용과 무관합니다.
- **Twelve Data / Alpha Vantage는 이 서비스 사용량(하루 1~4회)엔 전혀 부담 없는 한도**입니다.
- **`config.json`의 `stock.indices` 심볼(`IXIC`/`GSPC`/`DJI`)이 실제로 안 맞으면** 증시 브리핑이
  에러를 냅니다. 처음 실행 시 `curl -X POST localhost:3000/test/morning`으로 꼭 확인하고,
  안 맞으면 `stock.indices`의 `symbol` 값만 고치면 됩니다.

## 2. 설치 및 실행

```bash
npm install
cp .env.example .env   # 값 채우기
node src/index.js
```

정상 기동 시 콘솔에 다음과 같이 뜹니다.

```
[server] http://localhost:3000 에서 대기 중
[scheduler] 아침 브리핑 등록: 매일 09:00 (Asia/Seoul)
[scheduler] 저녁 브리핑 등록: 매일 19:00 (Asia/Seoul)
```

> 처음 실행할 때 `browserType.launch: Executable doesn't exist ...` 같은 오류가 나면
> Playwright가 쓸 브라우저가 아직 안 받아진 상태입니다. `npx playwright install chromium`
> 한 번 실행한 뒤 다시 시작하세요. (MBC/KBS/연합뉴스/채널A/JTBC 뉴스 스크레이핑이 이 브라우저를 사용합니다)

아침/저녁 시각은 코드가 아니라 **`config.json`의 `morning.time` / `evening.time`**만 고치면 바로 반영됩니다
(서버 재시작 필요).

수동으로 지금 당장 테스트해보고 싶다면:

```bash
curl -X POST localhost:3000/test/morning
curl -X POST localhost:3000/test/evening
```

## 3. 24시간 상시 구동 (중요)

`node src/index.js`를 켜둔 컴퓨터가 꺼지면 스케줄도 멈춥니다. 노트북 대신 다음 중 하나에 올려두는 걸 추천합니다.

- 집에 있는 미니PC/NAS(Synology 등, Docker 지원)
- 저가 VPS (월 몇천 원대, 예: Oracle Cloud 무료 티어, Vultr, 라이트세일 등)
- 라즈베리파이

상시 구동 시에는 `pm2` 같은 프로세스 매니저를 쓰면 편합니다.

```bash
npm install -g pm2
pm2 start src/index.js --name personal-briefing
pm2 save
pm2 startup   # 재부팅 시 자동 시작 설정 (안내되는 명령 그대로 실행)
```

## 4. 외부(아이폰)에서 `/depart`를 호출할 수 있게 열기

집 서버는 기본적으로 외부(예: 밖에서 LTE로)에서 접근이 안 됩니다. 아이폰 단축어가 어디서든
호출할 수 있게 하려면 아래 중 하나가 필요합니다.

- **Cloudflare Tunnel (추천, 무료)** — 공유기 포트포워딩 없이 `https://your-name.trycloudflare.com` 같은
  고정 HTTPS 주소를 받을 수 있습니다.
- **Tailscale Funnel** — 개인 VPN망(Tailscale)에 이미 익숙하다면 간단합니다.
- VPS에 직접 올린 경우 → 그 서버의 공인 IP/도메인 + Nginx로 HTTPS 붙이기

이 중 무엇을 쓰든, 외부에 열리는 주소는 반드시 `WEBHOOK_TOKEN`을 함께 확인하도록 되어 있으니
토큰 없이 `/depart`가 호출되지 않게 하세요.

## 5. 아이폰 "단축어" 설정

### (A) 외출 준비 단축어 — 매번 시간/장소를 직접 입력

1. 단축어 앱 → **+** (새 단축어)
2. **"입력 요청"** 액션 추가 → "몇 시에 나가시나요?" (텍스트, 예: 18:30)
3. **"입력 요청"** 액션 추가 → "어디로 가시나요?" (텍스트, 예: 강남역)
4. **"URL 콘텐츠 가져오기"** 액션 추가
   - URL: `https://<서버주소>/depart?place=입력값2&time=입력값1&token=<WEBHOOK_TOKEN>`
   - (URL 안의 "입력값1/입력값2" 자리는 위에서 받은 변수를 끼워 넣으면 됩니다)
   - 방법: GET
5. **"결과에서 사전 값 가져오기"** → `message` 키 선택
6. **"알림 보내기"**(또는 "결과 보기") 액션 추가 → 5번 값 연결
7. 이 단축어를 홈 화면에 아이콘으로 추가해두면 나가기 직전 탭 한 번으로 끝

### (B) 아침/저녁 브리핑 — 서버가 알아서 보내지만, 폰에서 받으려면

1. App Store에서 **ntfy** 앱 설치
2. 앱 실행 → **구독(Subscribe)** → `.env`에 넣은 `NTFY_TOPIC`과 정확히 같은 이름 입력
3. 이후 서버가 config.json에 지정된 시각에 자동으로 이 앱을 통해 알림을 보냅니다.
   (단축어 앱을 따로 켜둘 필요 없음)

> 참고: 만약 ntfy 앱 설치 없이 오직 "단축어" 앱만으로 아침/저녁도 받고 싶다면, 서버 스케줄
> 대신 **단축어 앱 → 자동화(Automation) → 개인 자동화 → "특정 시각"** 트리거를 만들어
> `/test/morning`, `/test/evening`을 직접 호출하고 결과를 알림으로 띄우는 방식으로 바꿀 수도
> 있습니다. 이 경우 시각은 코드가 아니라 단축어 앱 안에서 관리하게 됩니다.

## 6. 뉴스 언론사 지정 (지금은 MBC/SBS/KBS/연합뉴스/채널A/JTBC/한국경제 7곳 고정)

`config.json`의 `newsOutlets` 배열에 이렇게 들어가 있습니다.

```json
"newsOutlets": [
  { "name": "SBS",     "type": "rss",     "rss": "https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER" },
  { "name": "한국경제", "type": "rss",     "rss": "https://www.hankyung.com/feed/all-news" },
  { "name": "연합뉴스", "type": "rss",     "rss": "https://www.yna.co.kr/rss/news.xml" },
  { "name": "MBC",      "type": "scrape",  "url": "https://imnews.imbc.com" },
  { "name": "KBS",      "type": "scrape",  "url": "https://news.kbs.co.kr" },
  { "name": "채널A",    "type": "scrape",  "url": "https://news.ichannela.com" },
  { "name": "JTBC",     "type": "scrape",  "url": "https://news.jtbc.co.kr" }
]
```

**왜 두 가지 방식(`type`)이 섞여 있나:** SBS·한국경제·연합뉴스는 실제로 살아있는 공식 RSS를
찾아서 검증했지만(직접 요청해서 기사 제목이 나오는 것까지 확인), MBC·KBS·채널A·JTBC는 공개
RSS를 못 찾아서(요즘 방송사들이 흔히 그렇습니다) 홈페이지를 직접 렌더링해서 텍스트를 긁어온 뒤
Claude가 그중 진짜 뉴스 제목만 골라내게 했습니다.

- `type: "rss"` → 빠르고 안정적. `rss` 필드에 실제 RSS XML 주소를 넣습니다.
- `type: "scrape"` → `url` 필드에 언론사 뉴스 홈페이지 주소를 넣으면 브라우저로 열어서 읽어옵니다.
  **사이트 구조가 바뀌면 실패할 수 있습니다.**
- 새 언론사를 추가하고 싶으면: 진짜 RSS가 있으면 `type: "rss"`로, 없으면 `type: "scrape"`로
  뉴스 홈페이지 주소를 넣으면 됩니다.
- 카테고리(정치/사회/경제/스포츠/연예) 분류는 각 기사 제목/원문을 Claude가 읽고 판단하는
  방식이라 100% 정확하지는 않습니다. `config.json`의 `newsCategories`로 카테고리 이름/구성을
  바꿀 수 있습니다.
- **응답 검증**: LLM 응답에 카테고리 헤더 5개가 다 있는지 확인하고, 빠졌으면 강조 문구를 붙여
  1회 재시도합니다. 그래도 형식이 안 맞으면 "⚠️ 형식 확인 필요" 딱지를 붙여서라도 그대로
  발송합니다 (완전히 실패 처리하지 않음 — `src/services/news.js` 참고).

**⚠️ MBC/KBS/채널A/JTBC 스크레이핑은 아직 실제로 못 돌려봤습니다.** 개발 환경(샌드박스)의
네트워크가 이 4개 사이트로 나가는 걸 막고 있어서, 실제로 각 사이트에서 뉴스 텍스트가 잘 뽑히는지는
본인 컴퓨터에서 직접 확인해야 합니다.

```bash
curl -X POST localhost:3000/test/evening
```

이걸 실행했을 때 특정 언론사가 "(참고: OO 수집 실패)"로 빠지면, 그 언론사의 `url`을 실제
브라우저로 열어보고 `src/utils/browserText.js`가 텍스트를 잘 뽑아낼 수 있는 구조인지
(로그인 요구, 심한 봇 차단 등) 확인한 뒤 `url`을 다른 페이지(예: 모바일 버전, 특정 섹션 페이지)로
바꿔보세요.

## 7. 증시 브리핑 관련 참고 사항

- 지수 수치는 SAVE 스크레이핑 대신 **Twelve Data**(공식 API)로 받습니다. 요일별로 소스와 형식이
  다릅니다: 화~토는 지수 시세(`/quote`), 일요일은 주간 시계열(`/time_series`), 월요일은 실적
  발표(Alpha Vantage `EARNINGS_CALENDAR`, S&P100으로 필터) + 경제지표(ForexFactory 캘린더,
  중요도 High만 필터) — 자세한 흐름은 `docs/pipeline-architecture.dc.html` 참고.
- 이 브리핑은 **LLM을 쓰지 않습니다.** 숫자는 이미 API가 확정해서 주므로 `src/services/stock.js`가
  템플릿 문자열로 그대로 포맷팅합니다 — 지어낼 수치 자체가 없는 구조입니다.
- `config.json`의 `stock.indices` 심볼이 Twelve Data와 안 맞으면 증시 브리핑이 에러를 냅니다.
  처음 설치 시 `curl -X POST localhost:3000/test/morning`으로 꼭 확인하세요.
- `stock.sp100` 목록은 실적 발표 프리뷰(월요일)를 대형주로 좁히는 용도입니다. S&P100 구성은
  자주 안 바뀌므로 가끔 수동으로 갱신하면 됩니다.

## 8. 폴더 구조

```
personal-briefing/
├─ config.json          # 시각, 언론사 목록, 카테고리 등 사용자 설정
├─ .env                 # API 키 (직접 생성, git에 올리지 말 것)
├─ src/
│  ├─ index.js          # 진입점 (서버 + 스케줄러 시작)
│  ├─ server.js         # /depart 등 HTTP 엔드포인트
│  ├─ scheduler.js       # 아침/저녁 자동 실행
│  ├─ services/
│  │  ├─ llmClient.js    # Claude Haiku 4.5 요약 래퍼 (뉴스 브리핑에서만 사용)
│  │  ├─ stock.js        # Twelve Data/Alpha Vantage/ForexFactory + 증시 브리핑 포맷팅 (LLM 미사용)
│  │  ├─ weather.js      # 기상청 단기예보 + 날씨 텍스트 포맷팅 (LLM 미사용)
│  │  ├─ route.js        # 카카오 지오코딩 + ODsay 대중교통 경로 (LLM 미사용)
│  │  ├─ radarImage.js   # 비/눈 예보 시 기상청 레이더 이미지 URL 조회 (부가 기능)
│  │  ├─ news.js         # RSS + 스크레이핑 수집 + 카테고리별 요약
│  │  └─ notify.js       # ntfy.sh 푸시
│  └─ utils/
│     ├─ retry.js        # 범용 재시도 헬퍼
│     ├─ validate.js     # 검증 규칙 빌딩블록
│     ├─ runLog.js       # 실행 이력 기록/조회 (logs/runs.jsonl)
│     ├─ kst.js          # 한국 시각 기준 날짜/요일 계산 공용 유틸
│     ├─ grid.js         # 위경도 ↔ 기상청 격자좌표 변환
│     └─ browserText.js  # Playwright 공용 헬퍼 (언론사 스크레이핑에서 사용)
```

## 9. 남은 할 일 / 다음에 손볼 만한 것

파이프라인 3개(증시/뉴스/외출준비) 재작성과 실제 키를 통한 1차 검증까지 끝났습니다
(아침/저녁/외출준비 전부 실제로 정상 발송 확인됨). 검증 중 실제로 발견해서 고친 버그:

- Twelve Data 무료 티어는 원시 지수(IXIC/GSPC/DJI)를 막아놔서 추적 ETF(`SPY`/`QQQ`/`DIA`)로 교체
- data.go.kr 서비스키를 이중 인코딩하던 버그 (기상청/레이더 API 403 원인)
- ODsay `totalWalk` 필드를 "도보 거리(m)"인데 "도보 시간(분)"으로 잘못 표시하던 버그

**ODsay 관련 운영 참고사항**: ODsay는 API 키를 특정 서버 IP에 등록해서 씁니다
(lab.odsay.com → Application → 설정 → Server IP). 개발 중인 컴퓨터의 공인 IP로
등록해뒀는데, **나중에 서버를 다른 곳(VPS 등)으로 옮기면 그 서버의 공인 IP로 다시
등록해야** 합니다 — 안 바꾸면 "ApiKeyAuthFailed" 에러가 납니다.

남은 건 운영 편의 항목들입니다.

- [ ] `config.json`의 아침/저녁 시각, 언론사 목록을 원하는 대로 수정
- [ ] ODsay 캐싱 추가 (현재 무캐싱, 하루 30건 한도라 반복 호출 시 주의)
- [ ] `config.json` 핫리로드 (현재 서버 재시작 필요)
- [ ] 레이더 이미지 URL이 `http`라서 iOS ATS(앱 전송 보안)에 막히는지 실제 단축어로 확인
      (막히면 서버가 이미지를 대신 받아서 https로 넘겨주는 프록시 엔드포인트 추가 필요)
- [ ] 서버를 상시 구동 환경에 올리기 (pm2 등) — 옮기면 위 ODsay Server IP도 같이 갱신
- [ ] Cloudflare Tunnel 등으로 외부 접근 주소 만들기
- [ ] 아이폰 단축어 2개(외출 입력용, 필요시 ntfy 대체용) 만들기
