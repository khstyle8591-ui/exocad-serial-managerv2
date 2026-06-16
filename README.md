# Exocad Serial Number Management Automation

Exocad 시리얼 넘버의 등록, 갱신, 갱신 중단 요청, 주문 수집, 리포트 발송을 자동화하는 Electron 데스크톱 앱입니다.

## 주요 기능

### 완료된 운영 기능

1. **시리얼 / 고객 관리**
   - 고객 테이블과 시리얼 테이블 분리
   - 시리얼 CRUD, 활성화, 갱신, 갱신 중단 요청 플래그 관리
   - 고객 자동 병합 후보 탐색
   - 엑셀 업로드와 레거시 DB 이관 마법사

2. **메일 시스템**
   - POP3/IMAP 수신 메일 분류
   - `inbound_mails` 저장 및 중복 방지
   - 갱신 중단 요청 후보 확인
   - 정보 누락 메일 템플릿 발송
   - SMTP 템플릿 메일 발송

3. **주문 수집 / 승인**
   - URL 폴링 기반 pending order 수집
   - `trade_number` 기준 그룹 승인
   - 신규, 갱신, Add-on, 메모, 버전 업데이트 상품 코드 그룹 처리
   - 승인 전 주문 데이터 편집과 고객 연결 방식 선택

4. **자동화 / 스케줄러**
   - 자동 갱신
   - 갱신 중단 요청 건의 Exocad 사이트 자동 Cancel
   - limbo fallback 처리
   - 일일 리포트 다중 시각 스케줄
   - Notification 화면에서 수동 실행

5. **알림 / 리포트**
   - Slack Webhook 알림
   - SMTP 일일 리포트 및 운영 메일
   - 실패 로그와 Dashboard failure tail

6. **React 운영 UI**
   - Dashboard
   - SerialData / SerialDetail
   - Customers
   - RequestedOrder
   - MailSystem
   - Notification
   - Settings
   - Logs / SystemLogs

## 기술 스택

- **Desktop**: Electron 28
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Electron Main Process, Express loopback/API server
- **Database**: SQLite (`better-sqlite3`)
- **Browser Automation**: Playwright
- **Mail**: POP3 (`node-pop3`), IMAP (`imap`), SMTP (`nodemailer`)
- **Scheduler**: `node-cron`
- **Excel**: `xlsx`

## 설치 및 실행

### 1. 의존성 설치

```bash
cd C:\Users\pf-5y\Desktop\Project\exocad-manager
npm install
npx playwright install chromium
```

### 2. 개발 모드 실행

```bash
npm run dev
```

개별 실행이 필요하면 아래 명령을 나눠 실행합니다.

```bash
npm run dev:main
npm run dev:renderer
npm run dev:electron
```

### 3. 빌드 / 실행

```bash
npm run build
npm start
```

### 4. 패키징

```bash
npm run package
```

## 개발 명령

```bash
npm run build:main
npm run build:renderer
npm run build
npm test
npm run test:db
npm run verify
npm run start
npm run dev
```

`npm run test:db`는 Electron 런타임에서 `better-sqlite3` 스키마 테스트를 실행합니다.
테스트와 `better-sqlite3` 네이티브 런타임 주의사항은 [docs/testing.md](docs/testing.md)를 참고하세요.

네이티브 모듈 mismatch가 발생하면 아래 명령을 먼저 실행합니다.

```bash
npx electron-rebuild -f -w better-sqlite3
```

## 프로젝트 구조

```text
src/
├── main/
│   ├── index.ts
│   ├── database.ts
│   ├── settings.ts
│   ├── ipc-handlers.ts
│   ├── preload.ts
│   ├── scheduler.ts
│   ├── api-server.ts
│   ├── server.ts
│   ├── services/
│   │   ├── serial.service.ts
│   │   ├── customer.service.ts
│   │   ├── activity-log.service.ts
│   │   ├── legacy-import.service.ts
│   │   ├── cancel.service.ts
│   │   ├── order.service.ts
│   │   ├── automation.service.ts
│   │   ├── scheduler-refresh.service.ts
│   │   ├── notification.service.ts
│   │   ├── excel.service.ts
│   │   └── mail/
│   │       ├── inbound.service.ts
│   │       ├── lifecycle-notice.service.ts
│   │       ├── renderer.ts
│   │       ├── smtp.service.ts
│   │       └── template.service.ts
│   └── utils/
├── server/
│   └── routes/
├── renderer/
│   ├── App.tsx
│   ├── client.ts
│   ├── api.ts
│   ├── electronMock.ts
│   ├── i18n.ts
│   ├── components/
│   └── pages/
│       ├── Dashboard.tsx
│       ├── SerialData.tsx
│       ├── SerialDetail.tsx
│       ├── Customers.tsx
│       ├── RequestedOrder.tsx
│       ├── MailSystem.tsx
│       ├── Notification.tsx
│       ├── Settings.tsx
│       ├── Logs.tsx
│       └── SystemLogs.tsx
└── shared/
    ├── constants.ts
    └── types.ts
```

## 설정 요약

Settings 화면에서 아래 운영 설정을 관리합니다.

- 앱 / Slack 표시 언어
- Exocad 자동 Cancel 로그인 정보와 실행 시각
- POP3/IMAP 수신 설정
- 갱신 중단 요청 키워드와 제외 키워드
- SMTP 발신 설정
- Slack Webhook URL
- 주문 폴링 소스
- Product Code 그룹 규칙
- 만료 안내 / 갱신 중단 / Cancel 완료 메일 템플릿 규칙

## 운영 흐름

### 시리얼 등록

1. `SerialData`에서 직접 등록하거나 엑셀로 업로드합니다.
2. 기존 DB가 감지되면 Legacy Import 마법사로 선택 이관합니다.
3. 고객 정보는 `customers` 테이블에 연결됩니다.

### 메일 기반 갱신 중단 요청

1. POP3/IMAP으로 수신 메일을 확인합니다.
2. `inbound.service.ts`가 메일을 분류하고 `inbound_mails`에 저장합니다.
3. 운영자가 MailSystem 화면에서 후보를 확인합니다.
4. 확인된 요청은 시리얼의 `renewal_stop_requested` 플래그로 반영됩니다.

### 주문 수집 / 승인

1. 주문 관리 사이트를 URL 폴링합니다.
2. 수집된 주문은 `pending_orders`로 저장됩니다.
3. RequestedOrder 화면에서 그룹을 편집하고 승인합니다.
4. 승인 시 고객/시리얼/Add-on/갱신 정보가 실제 DB에 반영됩니다.

### 자동화

1. 자동 갱신은 만료된 활성/만료 시리얼 중 갱신 중단 요청이 없는 건을 처리합니다.
2. 자동 Cancel은 갱신 중단 요청이 있는 활성 시리얼을 Exocad 사이트에서 처리합니다.
3. Notification 화면에서 자동화 작업을 수동으로 즉시 실행할 수 있습니다.

## 다음 작업

1. 주요 화면 smoke test
2. 실제 운영 데이터 기준 메일 수신 / 주문 승인 / 자동화 플로우 검증
3. README 외 문서(`memory.md`, `.claude/decisions.md`)의 과거 기록 정리 여부 결정

## 라이선스

Private Use
