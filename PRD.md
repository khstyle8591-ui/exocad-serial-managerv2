# Exocad Manager — Product Requirements Document

**버전**: 2.0 (대규모 리팩토링)  
**기준일**: 2026-05-13
**대상 환경**: GCP VM Instance e2-micro (2 vCPUs, 1 GB Memory)  (일본 딜러 사내용)  
**스택**: Electron + React + TypeScript + better-sqlite3

---

## 1. 제품 개요

Exocad 치과 CAD 소프트웨어 시리얼 라이선스를 관리하는 데스크탑 앱.  
일본 딜러가 고객사(치과의원·기공소)의 구독 갱신·취소·메일 대응을 관리한다.

### 1.1 핵심 설계 원칙

| 원칙 | 내용 |
|---|---|
| 고객 단위 | **업체(회사)** 단위. 동명이인 리스크 없음 |
| 자동 갱신 방향 | `renewal_stop_requested = 0` & 만료 → **+1년 자동 갱신** |
| 자동 캔슬 방향 | `renewal_stop_requested = 1` & 만료 D-1 → **Playwright 자동 캔슬** (기존 로직 완전 반전) |
| 메일 언어 | 발송 템플릿 **일본어 고정** |
| 타임존 | **Asia/Tokyo** (UTC+9, DST 없음) |
| 레거시 보존 | 첫 실행 시 구 DB → `exocad-legacy.db` 로 이름 변경, 신규 빈 DB 생성 |
| 실행 모드 | **Electron 데스크탑 + Web/GCP 서버 이중 모드** |
| Renderer 통신 | Electron 주요 신규 화면은 `window.electronAPI`를 사용하고, Web/GCP 서버 모드는 `/api/*` REST fetch를 사용 |

---

## 2. 아키텍처

### 2.1 프로세스 경계

```
Electron Renderer (React/Vite)
  └─ window.electronAPI (preload 브리지)
       └─ ipcMain.handle() → ipc-handlers.ts
            └─ services/ (비즈니스 로직)
                 └─ database.ts (better-sqlite3)

Web/GCP Server Mode
  └─ renderer/api.ts fetch('/api/*')
       └─ Express routes (src/server/routes/*)
            └─ services/ (비즈니스 로직)
                 └─ database.ts (better-sqlite3)
```

**Preload 제약**: 외부 모듈 import 불가 — 모든 IPC 채널 문자열은 inline literal.

**이중 모드 원칙**:
- Electron production은 `BrowserWindow.loadFile()` + preload IPC 브리지를 기본 경로로 사용한다.
- Vite/browser preview 및 GCP 서버 배포는 `src/renderer/electronMock.ts`가 `window.electronAPI`를 REST 기반 `api.ts`로 매핑한다.
- 서버 모드는 `src/main/server.ts`가 정적 renderer 빌드와 `/api/*` 라우터를 함께 서빙한다.
- Electron 앱도 `src/main/api-server.ts`를 통해 로컬 loopback API 서버(`127.0.0.1`, 기본 3001)를 시작할 수 있다.

### 2.2 디렉터리 구조

```
src/
  main/
    index.ts                   진입점 (DB init, IPC 등록, 스케줄러 시작)
    api-server.ts              Electron 내장 loopback REST API 서버
    server.ts                  GCP/Web 서버 모드 진입점
    database.ts                스키마 생성 + 레거시 감지/리네임
    ipc-handlers.ts            모든 ipcMain.handle 등록
    preload.ts                 window.electronAPI 노출
    scheduler.ts               node-cron 기반 자동화
    settings.ts                key-value 설정 CRUD
    webhook-server.ts          내부 HTTP 웹훅 서버
    services/
      customer.service.ts      고객 CRUD + 병합 후보
      serial.service.ts        시리얼 CRUD + 도메인 액션
      activity-log.service.ts  타입 안전 로깅 + logs:push emit
      legacy-import.service.ts 레거시 DB 읽기·이관
      automation.service.ts    auto-renew / auto-cancel / limbo-fallback
      cancel.service.ts        Playwright 캔슬 자동화
      order.service.ts         ERP 폴링 + pending_orders CRUD
      email-monitor.service.ts POP3/IMAP 수신 (레거시 — 신규는 mail/inbound)
      notification.service.ts
          Slack webhook + SMTP 리포트/긴급 알림 전송
          (daily reports, automation failures, limbo escalation)
      scheduler-refresh.service.ts
          설정 저장 전/후 비교 → 필요한 스케줄러만 선택 재시작
      excel.service.ts         엑셀 템플릿 생성·파싱
      mail/
        renderer.ts            {{VAR}} 치환 엔진
        template.service.ts    메일 템플릿 CRUD + 일본어 기본 시딩
        smtp.service.ts        nodemailer 발송 래퍼
        inbound.service.ts     POP3/IMAP 수신 → 분류 → stop flag
  shared/
    types.ts                   IPC_CHANNELS + 공통 타입
  renderer/
    App.tsx                    사이드바 쉘 + 라우터 + 컨텍스트
    electron.d.ts              window.electronAPI 타입 선언
    i18n.ts                    ko/en/ja 번역 테이블
    components/
      Sidebar.tsx              7개 메뉴 + 접힘/펼침
      ConfirmModal.tsx         범용 확인 다이얼로그
      CustomerAutocomplete.tsx 디바운스 250ms 고객 검색 드롭다운
      ModuleListEditor.tsx     string[] 모듈 태그 에디터
      SerialForm.tsx           Create/Edit 모달
      LegacyImportWizard.tsx   4단계 레거시 이관 마법사
    pages/
      Dashboard.tsx            KPI + recharts 시계열 + 실패 tail
      SerialData.tsx           시리얼 목록 + 상태 탭 + Legacy 버튼
      SerialDetail.tsx         상세보기 + 모든 도메인 액션
      Logs.tsx                 활동 로그 3단 섹션
      Customers.tsx            고객별 보유 시리얼 조회
      Products.tsx             제품/모듈별 시리얼 집계
      SystemLogs.tsx           시스템 로그 및 수신 메일 원문 조회
      RequestedOrder.tsx       trade_number 그룹 카드 + 승인 플로우
      MailSystem.tsx           템플릿/수신/SMTP 3탭
      Notification.tsx         스케줄·채널·수동 실행·설정 백업
      Settings.tsx             앱 설정 전체
  server/
    routes/                    Web/GCP 서버 모드 REST API 라우터
```

---

## 3. DB 스키마 (v2)

### 3.1 customers (신설)

```sql
CREATE TABLE customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  dealer        TEXT NOT NULL DEFAULT '',
  sales_manager TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

**병합 우선순위** (빈 문자열 제외):

| 조건 | score |
|---|---|
| email 일치 | 1.0 |
| name + phone 둘 다 일치 | 0.9 |
| name + dealer 둘 다 일치 | 0.8 |
| name 부분 일치 | 0.4 |

### 3.2 serials (재설계)

```sql
CREATE TABLE serials (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_number          TEXT NOT NULL UNIQUE,
  customer_id            INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  purchase_date          TEXT,
  expiry_date            TEXT,
  status                 TEXT NOT NULL DEFAULT 'not-activated'
    CHECK(status IN ('active','cancelled','expired','not-activated','broken')),
  engine_build           TEXT NOT NULL DEFAULT '',
  version                TEXT NOT NULL DEFAULT '',
  main_product           TEXT NOT NULL DEFAULT '',
  modules                TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  notes                  TEXT NOT NULL DEFAULT '',
  renewal_stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(renewal_stop_requested IN (0,1)),
  stop_requested_at      TEXT,
  activated_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

**제거/개명**:
- `customer_name/email/phone/address/manager` 컬럼 → `customer_id` FK로 통합
- `add_ons` JSON → `modules` (이름만 변경)
- `renewal_requests` 테이블 → `renewal_stop_requested` 플래그로 의미 이동

### 3.3 activity_logs (재설계)

```sql
CREATE TABLE activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_id  INTEGER REFERENCES serials(id) ON DELETE SET NULL,
  action     TEXT NOT NULL CHECK(action IN (
    'registered','renewed','cancelled','addon_added',
    'activated','stop_requested','stop_cleared',
    'status_forced_expired','bulk_imported','customer_merged',
    'legacy_imported','mail_sent','mail_failed','cron_ran','system')),
  actor      TEXT NOT NULL CHECK(actor IN ('manual','auto','email','polling','system')),
  diff       TEXT NOT NULL DEFAULT '{}',   -- JSON {field:[old,new]}
  details    TEXT NOT NULL DEFAULT '',
  trigger_id TEXT,                          -- ex. "mail:42", "cron:auto-cancel:2026-04-21"
  severity   TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warn','error','critical')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
critical:
- 고객 영향 가능성이 있는 운영 실패
- limbo forced expired
- repeated automation failure
- ERP polling prolonged outage
```

### 3.4 mail_templates (신설)

```sql
CREATE TABLE mail_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,     -- {{VARIABLE}} plaintext
  is_builtin INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

**기본 내장 템플릿 6종 (일본어)**:

| code | name |
|---|---|
| `renewal_reminder` | 更新のご案内 |
| `expiry_notice` | 有効期限のお知らせ |
| `stop_expiry_reminder` | 更新停止ライセンス有効期限のご案内 |
| `stop_request_received` | 更新停止リクエスト受付 |
| `missing_info_request` | 更新停止リクエスト情報確認 |
| `cancel_confirmation` | キャンセル確認 |

**템플릿 변수**:
`{{CUSTOMER_NAME}}`, `{{CUSTOMER_EMAIL}}`, `{{SERIAL_NUMBER}}`, `{{EXPIRY_DATE}}`,  
`{{PURCHASE_DATE}}`, `{{MAIN_PRODUCT}}`, `{{MODULES}}`, `{{TODAY}}`,  
`{{DEALER}}`, `{{SALES_MANAGER}}`

### 3.5 inbound_mails (신설)

```sql
CREATE TABLE inbound_mails (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id       TEXT,                          -- RFC Message-ID (dedup)
  mail_from        TEXT NOT NULL,
  mail_to          TEXT NOT NULL DEFAULT '',
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  received_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  classification   TEXT NOT NULL DEFAULT 'unclassified'
    CHECK(classification IN (
      'unclassified','renewal_request','stop_request_candidate',
      'stop_request','missing_info','unrelated','error'
    )),
  matched_template TEXT,
  matched_keywords TEXT NOT NULL DEFAULT '[]',
  extracted_serial TEXT,
  linked_serial_id INTEGER REFERENCES serials(id) ON DELETE SET NULL,
  processed        INTEGER NOT NULL DEFAULT 0,
  missing_fields   TEXT NOT NULL DEFAULT '[]',
  template_sent_at TEXT,
  error            TEXT
);
CREATE UNIQUE INDEX idx_inbound_msgid ON inbound_mails(message_id) WHERE message_id IS NOT NULL;
```

### 3.6 pending_orders (업데이트)

기존 테이블에 추가된 필드:

| 필드 | 설명 |
|---|---|
| `trade_number` | 商品コード 그룹핑 키 |
| `dealer` | 딜러명 |
| `sales_manager` | 담당자 |
| `main_product` | C행 제품명 |
| `modules` | B행 머지 JSON[] |

### 3.7 settings (기존 유지, key-value)

신규 키:

| 키 | 기본값 | 설명 |
|---|---|---|
| `smtp_test_address` | `''` | SMTP 테스트 수신 주소 |
| `daily_report_times` | `['10:00']` | 일일 리포트 발송 시각 목록 |
| critical_alert_emails | [] | 긴급 알림 수신 이메일 목록 |
| slack_alert_enabled | true | automation failure Slack alert 활성화 여부 |
| alert_suppress_minutes | 360 | 동일 이벤트 알림 suppress 시간 |

현재 구현에서 함께 사용하는 설정 키:

| 키 | 기본값 | 설명 |
|---|---|---|
| `slack_webhook_url_related` | `''` | 관련 메일(`unrelated`) 수신 알림 전용 Slack 웹훅 |
| `mail_protocol` | `'pop3'` | 수신 메일 체크 프로토콜 (`pop3` 또는 `imap`) |
| `pop3_keep_copy` | `false` | POP3 처리 후 원본 메일 서버 보존 여부 |
| `mail_check_times` | `['12:00','17:00']` | 수신 메일 체크 시각 목록 |
| `auto_cancel_time` | `'09:00'` | 설정 기반 만료 전 자동 cancel 실행 시각 |
| `auto_cancel_days_before` | `1` | 만료 몇 일 전 자동 cancel 대상인지 결정 |
| `missing_info_auto_reply_enabled` | `false` | 정보 부족 메일 자동 회신 여부 |
| `missing_info_template` | `'missing_info_request'` | 정보 부족 회신 템플릿 |
| `expiry_notice_enabled` | `true` | 만료 예고 메일 스케줄 활성화 |
| `expiry_notice_time` | `'05:00'` | 만료 예고 메일 발송 시각 |
| `expiry_notice_rules` | D-90/D-30/D-10 | 만료 예고 규칙별 템플릿 |
| `expiry_notice_stop_template` | `'stop_expiry_reminder'` | stop 요청 시리얼용 만료 예고 템플릿 |
| `stop_request_notice_enabled` | `true` | 갱신 중단 요청 접수 메일 발송 여부 |
| `stop_request_notice_template` | `'stop_request_received'` | 갱신 중단 요청 접수 템플릿 |
| `cancel_complete_notice_enabled` | `true` | 캔슬 완료 메일 발송 여부 |
| `cancel_complete_notice_template` | `'cancel_confirmation'` | 캔슬 완료 템플릿 |
| `poll_sources` | `[]` | ERP 폴링 소스 목록 |
| `custom_product_code_rules` | `[]` | ERP 상품코드 분류 사용자 규칙 |
| `legacy_import_available` | `'true'` | 레거시 DB 감지/리네임 후 이관 가능 상태 표시 |

---

## 4. IPC 채널 전체 목록

`src/shared/types.ts` `IPC_CHANNELS` 정의 기준.

### Serial

| 채널 | 방향 | 설명 |
|---|---|---|
| `serial:getAll` | R→M | 전체 목록 (customer JOIN) |
| `serial:getById` | R→M | ID로 조회 |
| `serial:create` | R→M | 생성 (customer_id 또는 flat fields) |
| `serial:update` | R→M | 수정 |
| `serial:delete` | R→M | 삭제 |
| `serial:search` | R→M | 전문 검색 |
| `serial:addAddon` | R→M | 모듈 추가 |
| `serial:activate` | R→M | not-activated → active, expiry=today+1y |
| `serial:setStopRequested` | R→M | renewal_stop_requested 플래그 설정 |
| `serial:renew` | R→M | 수동 갱신 +1년 |
| `serial:cancelDb` | R→M | DB only 취소 |
| `serial:removeModule` | R→M | 모듈 제거 |

### Customer

| 채널 | 방향 | 설명 |
|---|---|---|
| `customer:list` | R→M | 전체 목록 |
| `customer:getById` | R→M | ID 조회 |
| `customer:create` | R→M | 생성 |
| `customer:update` | R→M | 수정 |
| `customer:delete` | R→M | 삭제 |
| `customer:search` | R→M | 자동완성 검색 |
| `customer:mergeCandidates` | R→M | 병합 후보 조회 |

### Cancel (Playwright)

| 채널 | 방향 | 설명 |
|---|---|---|
| `cancel:subscription` | R→M | 특정 시리얼 Playwright 캔슬 |
| `cancel:checkExpiring` | R→M | 만료된 stop 요청 시리얼 캔슬 처리 |
| `cancel:preExpiryAutoCancel` | R→M | 만료 N일 전 stop 요청 시리얼 자동 캔슬 |
| `cancel:dryRun` | R→M | 캔슬 대상 미리보기 |
| `cancel:restartScheduler` | R→M | 자동 캔슬 스케줄러 재시작 |

### Automation

| 채널 | 방향 | 설명 |
|---|---|---|
| `automation:runAutoRenewNow` | R→M | 자동 갱신 수동 트리거 |
| `automation:runAutoCancelNow` | R→M | 자동 캔슬 수동 트리거 |
| `automation:runLimboFallbackNow` | R→M | Limbo 보정 수동 트리거 |

### Mail — Templates

| 채널 | 방향 | 설명 |
|---|---|---|
| `mailTemplate:list` | R→M | 템플릿 목록 |
| `mailTemplate:get` | R→M | 코드로 조회 |
| `mailTemplate:upsert` | R→M | 생성/수정 |
| `mailTemplate:delete` | R→M | 삭제 (내장 템플릿 불가) |
| `mailTemplate:preview` | R→M | serialId 기반 렌더링 미리보기 |

### Mail — Outbound

| 채널 | 방향 | 설명 |
|---|---|---|
| `mail:sendTemplate` | R→M | 템플릿 발송 |
| `mail:testSmtp` | R→M | SMTP 연결 테스트 |
| `mail:sendTestDryRun` | R→M | 테스트 주소로 확인 메일 발송 |

### Mail — Inbound

| 채널 | 방향 | 설명 |
|---|---|---|
| `mail:checkInboundNow` | R→M | 즉시 수신 체크 |
| `mail:inboundDryRun` | R→M | 수신 드라이런 |
| `mail:testConnection` | R→M | POP3/IMAP 연결 테스트 |
| `mail:listInbound` | R→M | 수신 메일 목록 |
| `mail:confirmStopRequest` | R→M | 수신 메일 후보를 운영자가 확인해 `renewal_stop_requested=1` 처리 |
| `mail:sendMissingInfoTemplate` | R→M | 정보 부족 메일에 확인 요청 템플릿 발송 |

### Stats (Dashboard)

| 채널 | 방향 | 설명 |
|---|---|---|
| `stats:counts` | R→M | KPI 카운트 (total/active/expired/cancelled/not-activated/expiring) |
| `stats:series` | R→M | 시계열 버킷 (granularity, range) |
| `stats:failures` | R→M | 실패 로그 tail |

### Logs

| 채널 | 방향 | 설명 |
|---|---|---|
| `logs:list` | R→M | 필터 조회 (LogFilter) |
| `logs:push` | M→R | 신규 로그 발생 시 push (one-way) |

### Notification

| 채널 | 방향 | 설명 |
|---|---|---|
| `notification:testSlack` | R→M | Slack 웹훅 테스트 |
| `notification:sendDailyReportNow` | R→M | 일일 리포트 즉시 발송 |
| `notification:listReportTimes` | R→M | 리포트 발송 시간 목록 조회 |
| `notification:setReportTimes` | R→M | 리포트 발송 시간 목록 저장 |
| `expiryNotice:dryRun` | R→M | 만료 예고 메일 샘플 발송/대상 확인 |
| `stopLifecycleNotice:dryRun` | R→M | stop 요청/캔슬 완료 라이프사이클 메일 dry-run |

### Settings

| 채널 | 방향 | 설명 |
|---|---|---|
| `settings:get` | R→M | 설정 전체 조회 |
| `settings:save` | R→M | 설정 저장 |
| `settings:export` | R→M | JSON 파일 내보내기 (dialog) |
| `settings:import` | R→M | JSON 파일 가져오기 (dialog) |

### Excel

| 채널 | 방향 | 설명 |
|---|---|---|
| `excel:downloadTemplate` | R→M | 시리얼 대량 등록용 Excel 템플릿 저장 |
| `excel:exportSerials` | R→M | 현재 시리얼 목록을 Excel 파일로 내보내기 |
| `serial:bulkImport` | R→M | Excel/CSV 파일 선택 후 시리얼 대량 등록 |

### Legacy Import

| 채널 | 방향 | 설명 |
|---|---|---|
| `legacy:detect` | R→M | 레거시 DB 존재 여부 |
| `legacy:listSerials` | R→M | 레거시 시리얼 목록 |
| `legacy:suggestMerge` | R→M | 병합 후보 제안 |
| `legacy:import` | R→M | 단건 이관 |

### Orders (ERP)

| 채널 | 방향 | 설명 |
|---|---|---|
| `order:getPending` | R→M | 전체 주문 목록 (`getAllOrders()` 반환; 현재 이름과 동작이 다름) |
| `order:listGrouped` | R→M | trade_number 그룹 목록 |
| `order:update` | R→M | 주문 수정 |
| `order:approve` | R→M | 주문 승인 (customer 병합 포함) |
| `order:reject` | R→M | 주문 거절 |
| `order:delete` | R→M | 주문 삭제 |
| `order:pollNow` | R→M | ERP 즉시 폴링 |
| `order:pollDryRun` | R→M | 폴링 드라이런 |
| `order:getPollStatus` | R→M | 폴링 상태 조회 |
| `order:restartScheduler` | R→M | 폴링 스케줄러 재시작 |

### Webhook

| 채널 | 방향 | 설명 |
|---|---|---|
| `webhook:getStatus` | R→M | 내부 웹훅 서버 실행 상태 조회 |
| `webhook:start` | R→M | 내부 웹훅 서버 시작 |
| `webhook:stop` | R→M | 내부 웹훅 서버 중지 |

### Web/GCP REST 구현 메모

`src/renderer/api.ts`와 `src/renderer/electronMock.ts`가 브라우저 모드에서 `window.electronAPI` 호환 브리지를 제공한다. 현재 Express 라우터 기준으로 대부분의 주요 CRUD/자동화/메일/레거시 기능은 REST로 연결되어 있으나, 아래 항목은 클라이언트에 호출 함수가 있으면서 서버 라우트 구현이 없거나 Electron IPC와 동작이 다르다.

| 클라이언트 호출 | 현재 상태 |
|---|---|
| `GET /api/orders/grouped` | `api.ts`에는 있으나 `src/server/routes/orders.ts`에 라우트 없음 |
| `POST /api/settings/export`, `POST /api/settings/import` | Electron dialog 기반 기능만 구현됨. REST 라우트 없음 |
| `GET /api/settings/report-times`, `POST /api/settings/report-times` | `api.ts`에는 있으나 REST 라우트 없음 |
| `POST /api/serials/export` | `api.ts` 호출은 있으나 REST 라우트 없음 |
| `order:getPending` IPC | 이름은 pending이지만 현재 핸들러는 `getAllOrders()`를 반환 |

---

## 5. 비즈니스 로직

### 5.1 자동 갱신 (`automation.service.runAutoRenewNow`)

```
대상: renewal_stop_requested=0 AND (status='active' OR status='expired') AND expiry_date < today
실행: serialService.renewManual(id) → expiry_date += 1년
멱등성: BEGIN IMMEDIATE 트랜잭션 + 오늘자 'renewed' 로그 존재 시 skip
cron: 10 0 * * * (00:10 JST)
```

### 5.2 자동 캔슬 (`automation.service.runAutoCancelNow`) — 기존 로직 반전

```
대상: renewal_stop_requested=1 AND status='active' AND expiry_date = today+{daysBefore}
실행: cancel.service.cancelSubscription() (Playwright)
     성공 시 serialService.cancelManual(id)
cron: settings.auto_cancel_time (기본 09:00 JST)
재시도: settings.auto_cancel_time + 2시간
```

> ⚠️ **구 로직과 완전 반전**: 구 버전은 renewal_requests 없으면 캔슬, 신 버전은 stop_requested=1 이어야 캔슬.

### 5.3 Limbo 보정 (`automation.service.runLimboFallbackNow`)

```
대상: renewal_stop_requested=1 AND (status='active' OR status='expired') AND expiry_date <= today AND expiry_date > today-7일
실행: Playwright 캔슬 시도 → 실패 시 status='expired' 강제 전환
cron: 0 3 * * * (03:00 JST)
실패 처리:
- 첫 Playwright cancel 실패 시
  activity_logs(severity='warn') 기록 후 Slack 즉시 알림 전송
- Limbo fallback 재시도 실패 후 forced expired 수행 시
  activity_logs(severity='critical') 기록 후
  Slack 및 SMTP 긴급 알림 전송
- 동일 serial_number + action 조합 기준
  6시간 내 중복 critical 알림은 suppress
```

> 오래된 limbo 건의 Playwright 폭주를 막기 위해 현재 구현은 만료 후 7일 이내 대상만 자동 보정한다.

### 5.4 메일 수신 분류

```
POP3/IMAP 수신 → parseEmail → analyzeEmail:
  1. exclude_keywords 포함 → product 매칭 시 unrelated, 아니면 unclassified
  2. serial + stop/action keyword → stop_request_candidate
  3. dedicated_email / product / serial / intent 중 일부 신호는 있으나 serial 또는 stop 의사가 부족 → missing_info
  4. product_keywords만 → unrelated (저장 + Slack 알림)
  5. 해당 없음 → unclassified

stop_request_candidate → inbound_mails 저장, 운영자 확인 대기
missing_info → inbound_mails 저장, 설정에 따라 missing_info_request 자동/수동 발송
renewal_request → 과거 stop_request 분류 마이그레이션 호환용/참조 저장
unrelated → inbound_mails 저장 + Slack 알림
```

> 현재 구현 기준: 수신 메일은 **즉시 캔슬하지 않음**. `stop_request_candidate`는 `inbound_mails`에 저장되고, 운영자가 Mail System 화면에서 확인하면 `confirmStopRequestFromMail()`이 `renewal_stop_requested=1`로 세팅한다. 즉, 자동 세팅이 아니라 **운영자 확인 후 세팅**이다.

### 5.5 시리얼 상태 전이

```
생성 → not-activated
  └─ Activate → active (activated_at=now, expiry=today+1y)
       ├─ setStopRequested(true) → [stop flag, stop_requested_at 기록]
       │    └─ auto-cancel D-1 → cancelled
       └─ Manual Renew → expiry+=1y (renewed log)
            └─ Manual Cancel (DB) → cancelled
```

### 5.6 고객 자동 병합 (`customer.service.findOrCreateCustomer`)

```
1. email 있고 일치하는 고객 → merge (score 1.0)
2. name+phone 둘 다 일치 → merge (score 0.9)
3. name+dealer 둘 다 일치 → merge (score 0.8)
4. 없으면 새 고객 INSERT
※ 빈 문자열 필드는 매칭에서 제외
```

### 5.7 `logs:push` 동작

`activity-log.service.logActivity()` 내부에서 INSERT 후:
```ts
BrowserWindow.getAllWindows().forEach(win =>
  win.webContents.send('logs:push', { id: lastInsertRowid })
);
```
Renderer는 `onLogsPush(callback)` 로 구독 → 관련 쿼리 재실행.

---

## 6. 스케줄러 (scheduler.ts)

모든 cron **Asia/Tokyo** 타임존 고정.

| Job | Cron | 함수 |
|---|---|---|
| 수신 메일 체크 | `settings.mail_check_times` (기본 12:00, 17:00) | `checkInboundNow()` |
| 자동 갱신 | `10 0 * * *` | `runAutoRenewNow()` |
| 자동 캔슬 | `settings.auto_cancel_time` (기본 09:00) | `cancelService.processPreExpiryAutoCancel()` |
| 자동 캔슬 재시도 | `settings.auto_cancel_time + 2시간` | 당일 실패 건 재시도 |
| Limbo 보정 | `0 3 * * *` | `runLimboFallbackNow()` |
| 만료 예고 메일 | `0 5 * * *` | 90/30/10일 전 매칭 → `sendTemplate()` |
| 일일 리포트 | `settings.daily_report_times` (기본 10:00) | `sendDailyReportNow()` |
| 월간 만료 리포트 | `0 9 10 * *` | `sendMonthlyExpiryReport()` |
| ERP 폴링 | `poll_source.schedule_times` | `pollNow(sourceId)` |

현재 구현에 포함된 추가 운영 작업:

| Job | Cron | 함수/동작 |
|---|---|---|
| 만료 상태 동기화 | 앱 시작 즉시 + `5 0 * * *` | `serialService.syncExpired()` |
| Playwright 스크린샷 정리 | `10 0 * * *` | `cleanOldScreenshots(30)` |
| 일일 요약 Slack 알림 | `30 8 * * *` | cancel 예정, pending renewal, 전일 작업 요약 전송 |
| 스케줄러 시작 알림 | 앱 시작 시 | `sendSchedulerStartupSlack(buildScheduleSummary(...))` |

### 6.1 설정 저장 시 스케줄러 갱신 정책

설정 저장은 `src/main/services/scheduler-refresh.service.ts`를 통해 저장 전/후 설정을 비교한 뒤, 변경된 스케줄 그룹만 재시작한다. SMTP, Slack, 언어, 템플릿처럼 예약 시각이나 대상 목록을 바꾸지 않는 설정은 스케줄러 재시작을 유발하지 않는다.

| 변경 감지 키 | 재시작 대상 |
|---|---|
| `mail_check_times` | 수신 메일 체크 |
| `auto_cancel_enabled`, `auto_cancel_days_before`, `auto_cancel_time` | 만료 전 자동 cancel + 실패 재시도 |
| `daily_report_times` | 일일 리포트 |
| `expiry_notice_enabled`, `expiry_notice_time`, `expiry_notice_rules`, `expiry_notice_days`, `expiry_notice_renewal_template`, `expiry_notice_stop_template` | 만료 예고 메일 |
| `poll_sources[].id/name/enabled/schedule_times` | ERP 주문 폴링 |

적용 경로:
- Electron IPC: `settings:save`, `settings:import`
- Web/GCP REST: `POST /api/settings`

각 스케줄러 재시작은 개별 `try/catch`로 처리한다. 하나의 스케줄러 갱신 실패가 다른 스케줄러 갱신을 막지 않아야 한다. 변경된 스케줄이 없으면 `설정 저장: 스케줄 변경 없음` 로그만 남긴다.

---

## 7. 레거시 데이터 이관

### 7.1 첫 실행 감지 (`database.ts detectAndRenameLegacy`)

```
1. exocad.db 존재 & customers 테이블 미존재 → 구 스키마 판단
2. fs.renameSync: exocad.db → exocad-legacy.db
   (+ -wal, -shm 동반 처리)
3. 신규 createTables() 실행
4. seedBuiltinTemplates() — 일본어 기본 6종
5. settings.legacy_import_available = 'true'
```

### 7.2 Legacy Import 마법사 (4단계)

**Step 1 — 소스 미리보기**
- `legacy:listSerials` → 전체 레거시 시리얼 (체크박스 + 상태/기간 필터)

**Step 2 — 고객 병합 해결**
- 행마다 `legacy:suggestMerge` 호출
- score≥0.8 → 기존 고객 기본 선택
- 여러 후보 → 순위 리스트에서 선택 또는 "신규 생성"
- `has_unprocessed_stop_request` 체크박스 (기본: 꺼짐, 의미 반전 주의)

**Step 3 — 필드 오버라이드**
- status, engine_build/version, notes 편집

**Step 4 — 실행 & 리포트**
- `legacy:import` 트랜잭션 단건 실행
- 성공: `activity_logs(action='legacy_imported', actor='manual', trigger_id='legacy:<id>')`
- 실패 행: "재시도" 버튼

**컬럼 매핑**:

| 레거시 | 신규 |
|---|---|
| `serials.customer_name/email/phone/address` | `customers.*` (병합) |
| `serials.customer_manager` | `customers.sales_manager` |
| `serials.add_ons` JSON | `serials.modules` string[] |
| `renewal_requests` 미처리 | `renewal_stop_requested=1` (선택 옵션, 기본 꺼짐) |

---

## 8. 페이지 상세

### 8.1 Dashboard

**컴포넌트**: `Dashboard.tsx`

| 섹션 | 데이터 소스 | 기능 |
|---|---|---|
| KPI 카드 6개 | `getStatsCounts()` | 클릭 시 Serial Data 필터로 이동 |
| Activity 차트 | `getStatsSeries(granularity, range)` | 일/월/년 전환, recharts AreaChart |
| 실패 로그 tail | `getStatsFailures()` | 최근 error/warn 10건 |
| 리포트 버튼 | `sendDailyReportNow()` | 즉시 발송 |

KPI 항목: 전체 / 활성 / 미활성 / 만료됨 / 취소됨 / 이번달 만료 예정

### 8.2 Serial Data

**컴포넌트**: `SerialData.tsx` + `SerialDetail.tsx`

**목록 기능**:
- 상태 탭: all / active / not-activated / expired / cancelled / broken
- 전문 검색 (serial_number, customer.name, email, phone, sales_manager)
- Legacy Import 버튼 (레거시 DB 감지 시 노출)
- 행 클릭 → `SerialDetail` 인라인 표시

**SerialDetail 액션**:
- **Activate**: not-activated 상태에서만 노출. activated_at=now, expiry=today+1y
- **Renew**: +1년, activity_log 기록
- **Cancel (DB)**: DB 상태만 변경
- **Run Playwright Cancel**: 이중 확인 후 Playwright 실행
- **Set/Clear Stop**: renewal_stop_requested 토글
- **Edit**: SerialForm 모달
- **Delete**: ConfirmModal 후 삭제

### 8.3 Logs

**컴포넌트**: `Logs.tsx`

3섹션 구성:
- 상단 45%: Serial 도메인 액션 (registered/renewed/cancelled 등)
- 중단 30%: 시스템/자동화 (cron_ran/mail_sent 등)
- 하단 25%: Failures (severity=error/warn)

공통 날짜 필터 + `logs:push` 구독 → 디바운스 재쿼리

### 8.4 RequestedOrder

**컴포넌트**: `RequestedOrder.tsx`

- trade_number 그룹 카드 (C=메인, B=모듈 attach)
- 필터: all / grouped / single / duplicate
- 고객 연결 3모드: 자동 병합 / 기존 지정 / 신규 생성
- `getCustomerMergeCandidates()` 후보 목록 표시
- 그룹 승인: customer 한 번 resolve → 그룹 내 모든 주문에 재사용
- 그룹 수정, 거절, 드라이런 폴링

### 8.5 Mail System

**컴포넌트**: `MailSystem.tsx` (3탭)

**Templates 탭**:
- 내장/커스텀 템플릿 목록
- 활성/비활성 토글
- 편집 (TemplateEditor + VariableChips)
- 실제 serial 선택 → preview
- 관리자 테스트 발송

**Inbound 탭**:
- 수신 설정 (프로토콜/호스트/포트/사용자) 요약 표시
- Check Now / Dry-Run / 연결 테스트
- 수신 메일 목록 (분류별 필터: stop_request_candidate / missing_info / renewal_request / unrelated / error)
- stop_request_candidate 상세에서 운영자 확인 → `renewal_stop_requested=1`
- missing_info 상세에서 정보 요청 템플릿 수동 발송

**SMTP 탭**:
- 현재 SMTP 설정 요약
- 연결 테스트 (sendMail 없음)
- 테스트 메일 발송

### 8.6 Notification

**컴포넌트**: `Notification.tsx`

| 섹션 | 기능 |
|---|---|
| 일일 리포트 스케줄 | 시간 추가/제거/저장 (`setReportTimes`) |
| 채널 상태 확인 | Slack 테스트, SMTP 테스트 |
| 수동 실행 | 일일 리포트 즉시 발송 |
| 설정 백업 | JSON 내보내기/가져오기 |
| 자동화 수동 트리거 | autoRenew / autoCancel / limboFallback |

### 8.7 Customers

**컴포넌트**: `Customers.tsx`

- 고객 목록을 기반으로 고객별 보유 시리얼을 그룹핑해 표시
- 고객명, 이메일, 전화, 딜러, 담당자 등 고객 정보 확인
- 고객 행에서 연결된 시리얼 수와 상태 요약 확인

### 8.8 Products

**컴포넌트**: `Products.tsx`

- `main_product` 및 `modules` 기준으로 시리얼을 집계
- 제품/모듈별 활성, 만료, 취소 상태 분포 확인
- 제품별 보유 고객/시리얼 현황을 운영자가 빠르게 파악하는 보조 화면

### 8.9 System Logs

**컴포넌트**: `SystemLogs.tsx`

- 서버/시스템 로그 조회
- 수신 메일 원문 및 관련 로그 확인
- Playwright 스크린샷 등 운영 디버깅 리소스 접근

---

## 9. 공통 컴포넌트

### CustomerAutocomplete

```tsx
props: { value, onChange(choice: CustomerChoice), placeholder? }
type CustomerChoice =
  | { kind: 'existing'; customer: Customer }
  | { kind: 'new'; name: string }

동작:
- 250ms 디바운스 → electronAPI.searchCustomers(query)
- 드롭다운: 후보 목록 + "신규 생성: {query}"
- 선택 시 onChange emit
```

### ModuleListEditor

```tsx
props: { modules: string[], onChange(modules: string[]) }
동작: 태그 표시 + X 제거 버튼, input으로 추가
```

### LegacyImportWizard

```tsx
props: { onClose(), onDone() }
4단계 step indicator
Step2에서 행당 mergeCandidates 실시간 조회
Step4에서 legacy:import 순차 실행 + 성공/실패 행별 표시
```

### ConfirmModal

```tsx
props: { title, message, confirmLabel, danger?, onConfirm(), onCancel() }
danger=true → 확인 버튼 빨간색
```

---

## 10. i18n

파일: `src/renderer/i18n.ts`  
지원 언어: `ko` / `en` / `ja`

신규 키 (2.0에서 추가):

```
page_title_serial_data, tab_all, status_broken, no_data, load_failed
serial_delete_title, serial_stop_requested
dash_gran_day, dash_gran_month, dash_gran_year
dash_activity_trend, dash_no_activity_data
dash_recent_issues, dash_view_all_logs, dash_no_errors, dash_report_sent
mail_tab_templates, mail_tab_inbound, mail_tab_smtp
mail_classif_stop_candidate, mail_classif_renewal_request, mail_classif_missing_info,
mail_classif_unrelated, mail_classif_unclassified, mail_classif_error
mail_inbound_*, mail_smtp_*
notification_title, notification_*, 
requested_order_*
```

---

## 11. Playwright 캔슬 플로우 (cancel.service.ts 보존)

Exocad SSO 자동화 순서 (셀렉터 검증 완료):

1. SSO 로그인: email → Continue → password
2. `settings.exocad_site_url` 로 이동
3. `[data-testid="search-input"]` 으로 시리얼 검색
4. 결과 행에서 제품명 추출
5. `[data-testid="menu-button"]` 클릭 (3-tier fallback)
6. 제품 키워드로 캔슬 버튼 레이블 결정:
   - chairside/exoplan → "Cancel subscription"
   - dentalcad → "Opt out upgrade"
7. `button.bg-red-55:has-text("Confirm cancellation")` 확인

단계별 결과를 `severity='error'` 로그로 기록 → Dashboard failure tail 노출.

---

## 12. 보안 및 엣지 케이스

| # | 케이스 | 대응 |
|---|---|---|
| 1 | 자동 갱신 멱등성 | `BEGIN IMMEDIATE` + 오늘자 renewed 로그 존재 시 skip |
| 2 | Playwright selector drift | 단계별 error 로그 → failure tail → 같은 날 재시도 cron |
| 3 | 중복 stop 메일 | `inbound_mails.message_id` UNIQUE + 운영자 확인 전 후보 상태로 보관 |
| 4 | trade_number 누락 | synthetic key = `serial_number || hash(row._raw)` |
| 5 | 병합 false positive (빈 필드) | email/phone/dealer 빈 문자열 매칭 제외 |
| 6 | future-dated purchase_date | Activate 시 `if purchase_date > today → purchase_date = today` 자동 보정 |
| 7 | 다중 리포트 시각 경합 | `reportInFlight` 플래그로 동시 실행 방지 |
| 8 | SQLite WAL/SHM rename | close 확인 → main → wal → shm 순 rename |
| 9 | Limbo forced expired unnoticed | critical Slack/SMTP alert + Dashboard failure tail |
| 10 | 설정 JSON import 오염 | `settings:import`에서 `AppSettings` allowlist만 저장 |
| 11 | Renderer CSP | 개발 모드와 프로덕션 모드의 CSP를 분리 적용 |
| 12 | POP3 UIDL 번호 불일치 | UIDL `[msgNum, uid]` 중 `msgNum`을 RETR/DELE에 사용 |
| 13 | IMAP 처리 중 누락 | `markSeen: false`로 fetch 후 처리 완료 시점에 일괄 Seen 처리 |
| 14 | Playwright 스크린샷 누적 | 30일 초과 스크린샷 자동 정리 |

---

## 13. 구현 완료 현황

### 완료 ✅

| 단계 | 내용 |
|---|---|
| Phase 1 | database.ts 스키마 전면 교체 + legacy rename |
| Phase 2 | customer.service.ts + serial.service.ts 재작성 |
| Phase 3 | activity-log.service.ts + logs:push |
| Phase 4 | legacy-import.service.ts + LegacyImportWizard.tsx |
| Phase 5 | App.tsx 사이드바 쉘 + Sidebar.tsx + 라우터 |
| Phase 6 | SerialData + SerialDetail + CustomerAutocomplete + ModuleListEditor + SerialForm + ConfirmModal |
| Phase 7 | Dashboard + recharts (KPI + 시계열 + 실패 tail) |
| Phase 8 | mail/template.service + mail/smtp.service + mail/renderer |
| Phase 9 | mail/inbound.service (POP3/IMAP + 분류) + MailSystem.tsx 3탭 |
| Phase 10 | order.service 그룹핑 + RequestedOrder.tsx 그룹 카드 |
| Phase 11 | automation.service (auto-renew/cancel/limbo) + scheduler.ts 재작성 |
| Phase 12 | Notification.tsx + i18n 신규 키 + webhook-server.ts |

### 백엔드 전체

- `src/main/services/customer.service.ts` ✅
- `src/main/services/serial.service.ts` ✅
- `src/main/services/activity-log.service.ts` ✅
- `src/main/services/legacy-import.service.ts` ✅
- `src/main/services/automation.service.ts` ✅
- `src/main/services/mail/renderer.ts` ✅
- `src/main/services/mail/template.service.ts` ✅
- `src/main/services/mail/smtp.service.ts` ✅
- `src/main/services/mail/inbound.service.ts` ✅
- `src/main/api-server.ts` ✅ (Electron 내장 loopback REST API)
- `src/main/server.ts` ✅ (GCP/Web 서버 모드)
- `src/server/routes/*` ✅ (REST API 라우터, 일부 browser-mode 클라이언트 호출은 미구현 라우트 존재)
- `src/main/webhook-server.ts` ✅
- `src/main/ipc-handlers.ts` ✅ (모든 채널 등록)
- `src/main/preload.ts` ✅ (모든 채널 인라인 literal)

### 렌더러 전체

- `src/renderer/App.tsx` ✅ (사이드바 + 9개 메인 라우트 + Settings)
- `src/renderer/electron.d.ts` ✅
- `src/renderer/api.ts` ✅ (Web/GCP 서버 모드 REST 클라이언트)
- `src/renderer/electronMock.ts` ✅ (browser mode electronAPI compatibility bridge)
- `src/renderer/i18n.ts` ✅ (ko/en/ja, 2.0 신규 키 포함)
- `src/renderer/components/Sidebar.tsx` ✅
- `src/renderer/components/ConfirmModal.tsx` ✅
- `src/renderer/components/CustomerAutocomplete.tsx` ✅
- `src/renderer/components/ModuleListEditor.tsx` ✅
- `src/renderer/components/SerialForm.tsx` ✅
- `src/renderer/components/LegacyImportWizard.tsx` ✅
- `src/renderer/pages/Dashboard.tsx` ✅
- `src/renderer/pages/SerialData.tsx` ✅
- `src/renderer/pages/SerialDetail.tsx` ✅
- `src/renderer/pages/RequestedOrder.tsx` ✅
- `src/renderer/pages/MailSystem.tsx` ✅
- `src/renderer/pages/Notification.tsx` ✅
- `src/renderer/pages/Customers.tsx` ✅
- `src/renderer/pages/Products.tsx` ✅
- `src/renderer/pages/SystemLogs.tsx` ✅

### 잔여 확인 항목

- Web/GCP REST 모드에서 `api.ts`가 호출하는 일부 라우트 구현 확인 필요: `/api/orders/grouped`, `/api/settings/report-times`, `/api/settings/export`, `/api/settings/import`, `/api/serials/export`
- `en` / `ja` i18n 신규 키 (2.0 추가분) 번역 완성 여부

### 최근 코드 반영 메모

- Limbo fallback 실패 시 `forceExpired()` + `sendCriticalAutomationAlert()` 경로는 현재 구현되어 있다.
- 수신 메일 stop 요청은 자동 처리하지 않고 `stop_request_candidate`로 저장한 뒤 운영자 확인 시 `renewal_stop_requested=1`로 변경한다.
- 정보 부족 메일(`missing_info`) 및 stop/cancel 라이프사이클 알림 템플릿이 추가되어 내장 템플릿은 6종이다.

---

## 14. 빌드 & 실행

```bash
# 개발
npm run dev

# Web/GCP 서버 모드
npm run build
npm run dev:server     # dist/main/server.js 실행, 기본 HTTP_PORT=3001
npm run dev:web        # 서버 모드 + Vite renderer 병행

# PM2 서버 운영
npm run pm2:start
npm run pm2:stop
npm run pm2:restart
npm run pm2:logs

# 타입 체크
# 전역 tsc가 PATH에 없을 수 있으므로 프로젝트 로컬 TypeScript를 사용한다.
npx tsc --noEmit -p tsconfig.main.json   # main
npx tsc --noEmit                          # renderer

# 빌드
npm run build

# 실행 (빌드 후)
npm start

# 패키징 (Windows x64 exe)
npm run package

# Playwright 크롬 설치 (최초 1회)
npx playwright install chromium

# native 의존성 재빌드 (better-sqlite3 변경 후)
npx electron-rebuild -f -w better-sqlite3
```

### 14.1 현재 빌드 검증 결과

2026-05-12 기준 현재 워크스페이스에서 아래 검증이 통과한다.

```bash
npx tsc --noEmit -p tsconfig.main.json
npx tsc --noEmit
npm run build
```

`npm run build` 결과:
- main process: `tsc -p tsconfig.main.json` 성공
- renderer: `vite build --config vite.config.mts` 성공
- renderer 산출물: `dist/renderer/index.html`, `dist/renderer/assets/index-*.css`, `dist/renderer/assets/index-*.js`

---

## 15. 용어 정리

| 용어 | 설명 |
|---|---|
| serial / 시리얼 | Exocad 소프트웨어 라이선스 키 |
| customer / 고객 | 업체(회사) 단위. 개인 아님 |
| module | 시리얼에 연결된 추가 기능 (구: add-on) |
| main_product | C그룹 product code에서 파생된 제품명 |
| trade_number | ERP 상품코드. 같은 trade_number → 한 그룹 |
| stop_requested | 갱신을 원하지 않는다는 의사 표시. `1` = 만료 D-1 자동 캔슬 대상 |
| renewal_stop_requested | `serials` 테이블 플래그명 |
| limbo | stop_requested=1인데 캔슬이 실패해서 active 상태가 된 경우 |
| actor | 액션 주체: manual/auto/email/polling/system |
| trigger_id | 로그의 원인 추적 키. ex) `mail:42`, `cron:auto-cancel:2026-04-21` |
