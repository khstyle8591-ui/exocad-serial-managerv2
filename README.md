# Exocad Serial Number Management Automation

Exocad 시리얼 넘버의 판매/관리를 자동화하는 Electron 데스크톱 앱입니다.

## 주요 기능

### ✅ 완성된 기능

1. **시리얼 넘버 관리**
   - 시리얼 CRUD (생성/수정/삭제/조회)
   - 엑셀 파일을 통한 벌크 업로드
   - Add-on 관리 (추가/제거)
   - 검색 및 필터링

2. **Subscription Cancel 자동화** (Playwright)
   - Align Tech SSO 로그인 자동화
   - 시리얼 검색 → 옵션 → Cancel → 확인 자동 클릭
   - 만료일 기준 자동 cancel 스케줄링
   - Settings에서 버튼 텍스트 커스터마이징 가능

3. **알림 & 리포트**
   - Slack + 이메일로 일일 작업 리포트
   - 매월 10일 만료 예정 시리얼 리포트
   - node-cron 스케줄러로 자동화

4. **React Dashboard UI**
   - Dashboard: 통계 & 오늘의 활동
   - Serials: 시리얼 목록/검색/등록/수정/갱신/Cancel
   - Settings: 모든 설정 관리
   - Logs: 활동 로그 조회

### 🚧 진행 중인 기능

5. **메일 기반 갱신 요청 처리** (POP3/IMAP 지원)
   - ✅ POP3 구현 완료
   - 🔄 IMAP 구현 중
   - 갱신 키워드 감지하여 자동 만료일 연장

6. **주문 연동** (Webhook 서버)
   - 🔄 order.service.ts 생성 중
   - Express 서버로 Webhook 수신
   - Secret key 검증
   - 신규/갱신/Add-on 주문 자동 처리

## 기술 스택

- **Frontend**: Electron + React + TypeScript + Vite
- **Backend**: Electron Main Process (Node.js)
- **Database**: SQLite (better-sqlite3)
- **Browser Automation**: Playwright
- **Mail**: POP3 (node-pop3) + IMAP (imap) + SMTP (nodemailer)
- **Scheduler**: node-cron
- **Excel**: xlsx (SheetJS)
- **Webhook**: Express

## 설치 및 실행

### 1. 의존성 설치

```bash
cd C:\Users\pf-5y\OneDrive\Desktop\Project\exocad-manager
npm install
npx playwright install chromium
```

### 2. 개발 모드 실행

```bash
npm run dev
```

별도 터미널 2개에서 각각 실행:
- Terminal 1: `npm run dev:main` (Electron Main Process)
- Terminal 2: `npm run dev:renderer` (React Vite Dev Server)

또는 `npm run dev`로 한번에 실행 (concurrently 사용)

### 3. 프로덕션 빌드

```bash
npm run build
npm start
```

### 4. 설치 파일 생성

```bash
npm run dist
```

## 프로젝트 구조

```
exocad-manager/
├── src/
│   ├── main/                          # Electron Main Process
│   │   ├── index.ts                   # 앱 엔트리
│   │   ├── database.ts                # SQLite 초기화
│   │   ├── settings.ts                # 설정 CRUD
│   │   ├── ipc-handlers.ts            # IPC 핸들러
│   │   ├── scheduler.ts               # Cron 스케줄러
│   │   ├── services/
│   │   │   ├── serial.service.ts      # 시리얼 CRUD
│   │   │   ├── cancel.service.ts      # Playwright 자동화
│   │   │   ├── email-monitor.service.ts  # POP3/IMAP 메일 감시
│   │   │   ├── notification.service.ts   # Slack + SMTP 알림
│   │   │   ├── excel.service.ts       # 엑셀 파싱
│   │   │   └── order.service.ts       # Webhook 서버 (생성 중)
│   │   └── utils/
│   │       └── logger.ts              # 파일 로거
│   ├── renderer/                      # React UI
│   │   ├── App.tsx                    # 메인 앱
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Serials.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── Logs.tsx
│   │   ├── components/
│   │   │   ├── SerialForm.tsx
│   │   │   ├── AddOnManager.tsx
│   │   │   └── ExcelUpload.tsx
│   │   └── styles/
│   │       └── global.css
│   └── shared/
│       └── types.ts                   # 공유 타입 정의
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── vite.config.ts
└── electron-builder.json
```

## 설정

앱을 처음 실행하면 Settings 페이지에서 다음 정보를 입력해야 합니다:

### 1. 메일 설정 (POP3 또는 IMAP)
- 프로토콜 선택 (POP3 / IMAP)
- Host, Port, Username, Password
- TLS 사용 여부

### 2. SMTP 설정 (리포트 발신용)
- Host, Port, Username, Password
- 리포트 수신 이메일 주소

### 3. Slack Webhook (선택사항)
- Webhook URL

### 4. Exocad 사이트 설정
- 라이선스 관리 페이지 URL
- 로그인 페이지 URL
- 로그인 이메일/비밀번호
- Cancel 버튼 텍스트
- 확인 팝업 버튼 텍스트

### 5. Webhook 설정 (주문 연동)
- Webhook 활성화 여부
- Webhook 포트 (기본: 3000)
- Webhook Secret Key

### 6. 기타
- 갱신 요청 키워드 (쉼표로 구분)
- 메일 체크 간격 (분)

## 사용 방법

### 시리얼 등록

1. **수동 등록**: Serials 페이지에서 "+ 신규 등록" 버튼
2. **엑셀 업로드**: "엑셀 업로드" 버튼으로 벌크 임포트

### Subscription Cancel

1. **개별 Cancel**: Serials 목록에서 "Cancel" 버튼 클릭
2. **자동 Cancel**: 매일 자정에 만료된 시리얼 자동 cancel

### 갱신 처리

1. **메일 기반**: 갱신 요청 이메일이 오면 자동 감지 및 만료일 연장
2. **수동 갱신**: Serials 목록에서 "갱신" 버튼 클릭

### 주문 연동 (Webhook)

주문 사이트에서 아래 형식으로 POST 요청:

```bash
curl -X POST http://localhost:3000/webhook/order \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-secret-key",
    "order_id": "ORD-12345",
    "type": "new",
    "serial_number": "EXO-001",
    "customer": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "purchase_date": "2024-01-15",
    "expiry_date": "2025-01-15",
    "add_ons": ["DentalCAD", "ChairsideCAD"]
  }'
```

## 다음 작업

1. email-monitor.service.ts에 IMAP 로직 완성
2. order.service.ts 생성 (Webhook 서버)
3. Settings.tsx에 메일 프로토콜 선택 UI 추가
4. Settings.tsx에 Webhook 설정 UI 추가
5. index.ts에 Webhook 서버 자동 시작 코드 추가
6. Dashboard.tsx에 Webhook 서버 상태 표시

## 라이선스

Private Use
