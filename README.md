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
| 8 | `NTFY_TOPIC` | (선택) ntfy 앱 푸시. 비우면 푸시 없음 — 폰은 단축어 자동화로 `/brief/*`를 가져감 | 무제한(공용 서버 예의상 사용) | 가입 자체 불필요 |

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
[scheduler] 아침 브리핑 등록: 매일 08:55 (Asia/Seoul)
[scheduler] 저녁 브리핑 등록: 매일 18:55 (Asia/Seoul)
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

상시 구동에는 `pm2`를 씁니다 (`ecosystem.config.cjs`에 설정이 들어 있음).

### Oracle Cloud 무료 티어에 올리기 (이 프로젝트의 배포 계획)

1. **인스턴스 만들기** — Compute → Instances → Create instance
   - 이미지: **Ubuntu 22.04** / Shape: **VM.Standard.A1.Flex**(Always Free ARM), 2 OCPU · 12GB 정도
     (Chromium을 돌려야 해서 1GB짜리 AMD Micro는 메모리가 빠듯합니다. 이미 있는 Micro를 쓰는
     경우 `deploy/setup-ubuntu.sh`가 스왑 2GB를 자동으로 만들어주지만, 뉴스 스크레이핑 중
     프로세스가 OOM으로 죽으면 A1로 옮기세요)
   - 리전은 가능하면 **서울/춘천** — 기상청·언론사 사이트가 해외 IP를 막는 경우가 있음
   - SSH 키를 내려받아 보관
2. **공인 IP를 ODsay에 등록** — 인스턴스의 Public IP를 lab.odsay.com → Application → 설정 →
   Server IP에 넣기 (안 하면 `ApiKeyAuthFailed`)
3. **서버에 코드 올리기**
   ```bash
   ssh -i <키파일> ubuntu@<공인IP>
   git clone https://github.com/joonki24/daily_briefing.git && cd daily_briefing
   ```
4. **`.env`는 git이 아니라 로컬 PC에서 scp로** (비밀키라 저장소에 없음)
   ```bash
   scp -i <키파일> .env ubuntu@<공인IP>:~/daily_briefing/.env
   ```
5. **세팅 스크립트 실행** — Node 20, pm2, Playwright(Chromium)까지 설치하고 pm2로 기동
   ```bash
   bash deploy/setup-ubuntu.sh
   ```
   마지막에 `pm2 startup`이 출력하는 `sudo ...` 명령을 그대로 복사해서 실행해야 재부팅 후에도 자동 시작됩니다.
6. **확인** — `pm2 status`, `curl "localhost:3000/health?token=<WEBHOOK_TOKEN>"`

외부 접근은 Cloudflare Tunnel(다음 섹션)이 서버에서 바깥으로 연결을 여는 방식이라
**인바운드 포트(3000)를 열 필요가 없습니다.**

코드를 갱신할 때는 서버에서 `git pull && npm ci && pm2 restart daily-briefing`.

## 4. 외부(아이폰)에서 서버를 호출할 수 있게 열기 (HTTPS 주소)

서버가 Oracle 클라우드에 있어 공인 IP는 이미 있지만, 단축어가 보내는 `WEBHOOK_TOKEN`이 암호화 없이
인터넷을 지나가지 않도록 **HTTPS 주소**가 필요합니다. 도메인을 사지 않고 이렇게 했습니다.

- **sslip.io**: `150-230-211-135.sslip.io`처럼 "IP를 하이픈으로 쓴 이름"이 자동으로 그 IP를 가리키는
  무료 서비스 (가입/결제 없음)
- **Caddy**: 그 이름으로 Let's Encrypt 인증서를 자동 발급·갱신하고 `localhost:3000`(Node 서버)으로 전달.
  설정은 `deploy/Caddyfile` 한 덩어리 (서버의 `/etc/caddy/Caddyfile`)

**한 번만 하는 설정 (이미 완료)**
1. Oracle 콘솔: VCN → Security → Default Security List → **Ingress 규칙에 TCP 80, 443 추가**
   (Source `0.0.0.0/0`) — 이걸 안 열면 인증서 발급도 접속도 안 됩니다.
2. 서버 방화벽(iptables): Oracle 우분투 이미지는 기본으로 22번만 열려 있어서 80/443을 REJECT 규칙
   앞에 추가하고 `sudo netfilter-persistent save`로 저장.
   `sudo iptables -I INPUT 5 -p tcp -m state --state NEW --dport 80 -j ACCEPT` (443도 동일, 6번 위치)
3. Caddy 설치(공식 apt 저장소) 후 `deploy/Caddyfile`을 `/etc/caddy/Caddyfile`에 넣고 `sudo systemctl restart caddy`

**현재 주소**: `https://150-230-211-135.sslip.io`
- 3000번 포트는 밖에서 직접 못 들어오고 반드시 Caddy(HTTPS)를 거칩니다. http로 접속하면 https로 자동 이동합니다.
- 토큰은 `?token=` 쿼리 대신 **`Authorization: Bearer <토큰>` 헤더**로 보내는 걸 권장합니다(주소창/기록에 안 남음).
  둘 다 동작합니다.
- **주소가 바뀌는 경우**: 이 이름은 서버 공인 IP에 묶여 있어서, 인스턴스를 지우고 새로 만들면 IP와 함께
  주소가 바뀌고 가족 단축어도 전부 고쳐야 합니다. 그게 걱정되면 Oracle에서 공인 IP를 **Reserved IP**로 고정하세요.
- 서버 IP가 바뀌면 함께 바꿔야 할 것: `deploy/Caddyfile`의 이름, ODsay Server IP.

## 5. 아이폰 "단축어" 설정

> 단축어는 아이폰에서만 만들 수 있습니다(Windows에서는 불가). 한국어 iOS의 액션 이름은
> "입력 요청", "URL 콘텐츠 가져오기", "사전에서 값 가져오기", "콘텐츠 보기"입니다.
> **긴 브리핑은 "알림 보기/표시"로 띄우면 중간에 잘리고 스크롤도 안 되므로 반드시 "콘텐츠 보기"를 쓰세요.**
> 토큰은 URL이 아니라 헤더 `Authorization: Bearer <WEBHOOK_TOKEN>`으로 보냅니다(주소창·로그에 안 남음).

### (A) 외출 준비 단축어 — 갈 때마다 장소를 입력

1. 단축어 앱 → **+** (새 단축어)
2. **"입력 요청"** 액션 → 질문 "어디로 가세요?", 유형 텍스트
3. **"URL 콘텐츠 가져오기"** 액션
   - URL: `https://<서버주소>/depart`
   - 메소드: **POST**
   - 헤더: `Authorization` = `Bearer <WEBHOOK_TOKEN>`
   - 요청 본문: **JSON** → 필드 추가(텍스트) → 키 `place`, 값은 2번 "입력 요청" 결과
4. **"사전에서 값 가져오기"** → 키 `message`
5. **"콘텐츠 보기"** → 4번 결과
6. 홈 화면에 추가해 두면 나가기 직전 탭 한 번으로 끝

(선택) 출발 시각도 받으려면 "입력 요청"을 하나 더 넣고 JSON에 `time` 키(`18:30` 형식)를 추가합니다.
경로 조회(ODsay)는 하루 30건이 한도라 반복해서 누르지 마세요. 비/눈이 예보되면 응답에
`radarImageUrl`이 오지만, 이 주소가 `http`라 iOS에서 막힐 수 있어 단축어에서 이미지를 띄우는 단계는
아직 넣지 않았습니다(비 오는 날 확인 필요).

### (B) 아침/저녁 브리핑 — ntfy 앱 없이 단축어로 받기 (가족 배포용 기본 방식)

서버는 config.json에 정한 시각(아침 08:55 / 저녁 18:55 — 폰이 09:00·19:00에 받아볼 수 있게 5분 일찍)에
브리핑을 **만들어서 저장**해둡니다. 폰은 저장본을 **가져와서 보여주기만** 하므로 응답이 즉시 오고,
가족이 몇 명이 써도 AI 호출 비용이 늘지 않습니다. 아무 때나 단축어를 눌러도 마지막으로 만든 브리핑을
바로 볼 수 있습니다.

- 주소: `GET https://<서버주소>/brief/morning` (저녁은 `/brief/evening`), 헤더는 위와 같음
- 응답: `{ ok, title, message, generatedAt, stale }` — `message`가 본문입니다.
  오늘 만든 게 아니면(`stale: true`) `message` 맨 앞에 경고가 붙어서 옵니다.
  아직 한 번도 만들어지지 않았으면 `message` 없이 오류가 와서 화면에 아무것도 안 뜹니다
  (`POST /test/morning` 또는 `/test/evening`으로 한 번 만들어 두면 됩니다).

**1) 일반 단축어 만들기 (아침용, 저녁용은 주소만 다르게 하나 더)**

1. **"URL 콘텐츠 가져오기"**: 위 주소, 메소드 GET, 헤더에 Authorization
2. **"사전에서 값 가져오기"**: 키 `message`
3. **"콘텐츠 보기"**: 2번 결과

**2) 시간 자동화가 그 단축어를 실행하게 하기**

1. 단축어 앱 → **자동화** → **+** → **시간** → 아침 **오전 9:00**, 저녁 **오후 7:00**, 반복 **매일**
2. **"즉시 실행"** 선택(실행 전 확인 끄기)
3. 실행할 단축어로 위에서 만든 아침/저녁 단축어를 선택

**가족에게 배포**: 단축어는 공유 → **링크 복사**(iCloud 링크)로 보내면 각자 "단축어 추가"만 하면 됩니다.
단축어에 토큰이 들어 있으니 링크는 가족에게만 주세요. **자동화는 공유가 안 되므로** 각자 폰에서 위 2)의
시간 자동화를 한 번씩 만들어야 합니다(동작을 자동화 안에 직접 넣지 말고, 일반 단축어를 실행하게 하세요).

> **ntfy 푸시는 선택 사항입니다.** `.env`의 `NTFY_TOPIC`을 비워두면 서버가 푸시를 보내지
> 않습니다(기본 동작). ntfy 앱을 쓰고 싶은 사람이 있으면 `NTFY_TOPIC`을 채우고 앱에서 구독하면
> 됩니다 — 이 경우에도 위 저장/조회 방식은 그대로 동작합니다.

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
- 지수 숫자는 **LLM을 쓰지 않습니다.** 숫자는 이미 API가 확정해서 주므로 `src/services/stock.js`가 템플릿으로
  그대로 포맷팅합니다 — 지어낼 수치 자체가 없는 구조입니다.
- **예외: 화~토 브리핑 밑의 "📌 시장 이슈"(3~4줄)만 Claude를 씁니다.** 연합뉴스 증시·국제 / 한국경제 증권 RSS에서
  "뉴욕증시" 등이 제목에 든 최근 기사를 고르고, 가장 관련 있는 1~2개의 본문을 읽어 핵심 원인·수치를 짧게 재정리합니다.
  기사에 없는 수치는 쓰지 못하게 하고, "예정:" 줄은 기사에 앞으로의 일정 표현이 있을 때만 통과시킵니다.
  기사를 못 구하거나 요약이 형식에 안 맞으면 **이 줄만 빠지고 지수 브리핑은 그대로 나갑니다.**
  피드 주소와 키워드는 `config.json`의 `stock.issueFeeds` / `stock.issueKeywords`.
- **내 보유 종목**: 서버 `.env`의 `HOLDINGS=ORCL,RKLB,SMR,PDYN`(쉼표 구분)에 적은 티커가 화~토는 전일 대비 등락률, 일요일은
  주간 등락률(지난 금요일 종가 대비)로 지수 밑에 붙습니다. 종목을 바꾸려면 **`.env`만 고치고 `pm2 restart`** 하면 됩니다.
  공개 저장소에 개인 포트폴리오가 올라가지 않도록 `config.json`에는 넣지 않습니다. 비워 두면 섹션이 빠집니다.
  Twelve Data 무료 티어는 분당 8크레딧(심볼당 1)이라 지수 3개 + 종목 5개까지 한 번에 되고, 넘으면 1분 쉬고 이어서 받습니다.
- **보유 종목 실적 발표**: 월요일 프리뷰의 실적 목록에 ⭐로 포함되고, 발표 **전날 아침 브리핑**에 "⏰ 보유 종목 실적 발표
  임박"이 따로 붙습니다 (미국 현지 날짜 기준 내일 발표 = 한국 시각 오늘 아침).
- 주간 등락은 지난 금요일 종가 대비입니다 (월요일 종가 기준이 아님 — 월요일 하루치가 빠지던 버그 수정).
- ⚠️ **개인/가족용으로만 쓰세요.** 연합뉴스 기사 하단에 "무단 전재·재배포, AI 학습 및 활용 금지" 문구가 있습니다.
  이 서비스는 하루 한 번 기사 1~2개만 읽고, 본문은 저장·전달하지 않으며, 결과에 출처를 표기하지만,
  앱이나 공개 서비스로 확장하면 안 됩니다.
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
