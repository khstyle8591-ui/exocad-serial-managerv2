# 코드 리뷰 인수인계 문서 — feature/credit-system

| 항목 | 값 |
|------|-----|
| 리뷰 일자 | 2026-07-22 |
| 대상 브랜치 | `feature/credit-system` |
| 대상 커밋 | `cccc5f0` (refactor: dedup mail/cancel paths, add idempotency + global Playwright slot) |
| 리뷰 방식 | 정적 리뷰 (코드 정독 + 타입체크 + 데드코드 스캔). **런타임 실행 없음.** |
| 리뷰 범위 | 부작용·실패경로·동시성이 몰린 7개 리스크 핫스팟 |

> **🔧 진행 상태 (2026-07-23 업데이트):** **F-1 ✅ / F-2 ✅ / F-3 ✅ / F-4 ✅ / F-5 ✅ / F-6 ✅** (각 항목 상세의 "✅ 처리 결과" 참고). 남은 항목: **F-7**(ESLint 최소 구성 도입 예정 + 데드코드는 `no-unused-vars`로 자동 정리 pass). 모든 수정은 타입체크 통과, 브랜치 `feature/credit-system`.

> **이 문서를 받는 개발자에게:** 각 항목은 `파일:라인`, 증상, 재현 시나리오, 수정 방향, 예상 공수(S/M/L)를 포함합니다. 우선순위는 [실행 순서](#7-권장-실행-순서)를 참고하세요. **"의도 확인 필요"** 표시가 있는 항목은 코드를 고치기 전에 기획자와 의도부터 합의해야 합니다.

---

## 1. 요약 (Executive Summary)

- **전반 품질은 상급.** 방어적으로 작성된 코드이며, 타입 정합성은 두 프로젝트 모두 **0 에러**. 자동 양산 수준이 아니라 실무 senior 수준의 패턴이 다수 확인됨(원자적 선점, verified-only 전이, 전역 브라우저 슬롯, 회귀버그 문서화 등 — [4. 강점](#4-강점-유지할-것) 참고).
- **발견된 갭은 전부 "예외 경로"에 집중.** 정상 흐름과 대부분의 실패 처리는 통제되어 있고, 남은 결함은 **비정상 종료 복구(reconciliation)·놓친 검증 신호·동시 제출·경로 간 알림 일관성**에 몰려 있음.
- **총 7건 발견**: 🟠 MED-HIGH 1건, 🟠 MED 3건, 🟡 LOW~LOW-MED 3건. 치명적(데이터 파괴·보안) 결함은 없음.
- **가장 임팩트 큰 3건**은 [F-1](#f-1-크레딧-배분-중-좌초--복구-경로-없음), [F-2](#f-2-수동-크레딧-승인이-크레딧을-실제-지급하지-않음), [F-3](#f-3-주문-승인-중복-처리-가드-부재). 돈·구독처럼 **비가역 부작용**에 걸려 있어 우선 처리 권장.

### 측정된 것 / 측정 안 된 것 (범위 명확화)

| 축 | 상태 | 설명 |
|----|------|------|
| **품질 축** (제대로 짰나) | ✅ 측정 완료 | 이 문서의 내용 |
| **기능 축** (실제로 맞게 동작하나) | ❌ **미측정** | 크레딧이 partner.exocad.com에서 정확한 수량으로 배분되는지, Playwright 취소가 실사이트에서 성공하는지 등은 **실행 검증이 별도로 필요**. 이 리뷰는 코드만 읽음. |

---

## 2. 리뷰한 범위 (7개 핫스팟)

| # | 핫스팟 | 결과 |
|---|--------|------|
| 1 | 크레딧 자동분배 (매분 cron) | 갭 3건 (F-1, F-2, F-4) |
| 2 | 취소 자동화 (Playwright) | 갭 1건 (F-5) — 그 외 상급 |
| 3 | auto-renew ↔ stop-flag ↔ limbo 폴백 | 갭 없음 — 모범적 |
| 4 | 동시성 (전역 Playwright 슬롯) | 갭 없음 — 완결 |
| 5 | 메일 인바운드 멱등성/dedup | 갭 1건 (F-6) — 그 외 견고 |
| 6 | 주문 폴링 + 승인 | 갭 1건 (F-3) |
| 7 | 엑셀 벌크 upsert (신규) | 갭 없음 — 신규 코드 중 최강 |

**범위 밖(별도 리뷰 권장):** 포탈 인증(가입/로그인/리셋/CSRF/세션)은 보안 성격이라 별도 보안 리뷰(`/security-review`)로 다루는 것을 권장. 이 리뷰에 포함하지 않음.

---

## 3. 발견 목록 (우선순위순)

| ID | 상태 | 심각도 | 요약 | 위치 | 공수 |
|----|:---:|:---:|------|------|:---:|
| F-1 | ✅ 완료 | 🟠 MED-HIGH | 크레딧 배분 중 프로세스 종료 시 `'distributing'` 영구 좌초 | `automation.service.ts:567` | M |
| F-2 | ✅ 완료 | 🟠 MED | 수동 크레딧 승인이 실제 크레딧을 지급하지 않음 (**의도 확정** — 이중발급 방지 가드로 대응) | `admin.ts:401` | S~M |
| F-3 | ✅ 완료 | 🟠 MED | 주문 승인에 중복 처리 가드 없음 | `order.service.ts:208` | S |
| F-4 | ✅ 완료 | 🟡 MED | 크레딧 배분 결과 토스트 놓치면 성공으로 간주 (false-success) | `cancel.service.ts:324` | M |
| F-5 | ✅ 완료 | 🟡 LOW-MED | failsafe 취소 실패 알림 비대칭 (인바운드 vs 포털) | `automation.service.ts:185` | S |
| F-6 | ✅ 완료 | 🟡 LOW | message-id 없는 메일은 중복 제거 안 됨 (`keep_copy=true`일 때) | `inbound.service.ts:281` | S |
| F-7 | 🔄 진행 | 🟡 LOW | 정적 린트 계층 부재 + 데드코드 (ts-prune 오탐 2건 확인 — 아래 참고) | 전역 | M |

---

## 4. 강점 (유지할 것)

리팩터/재작성 시 아래는 **깨뜨리지 말 것**. 완성도를 지탱하는 검증된 패턴들:

- **크레딧 원자적 선점** — `UPDATE ... WHERE alloc_status IS NULL` + `changes>0`으로 중복 크론 틱의 이중 배분을 원천 차단 (`portal/db.ts:320`).
- **verified-only DB 전이** — Playwright 취소가 실사이트에서 검증된 경우에만 DB를 `cancelled`로 바꿈. 미검증 시 DB 미변경 → 안전한 재시도 (`automation.service.ts:48`, `cancel.service.ts:954`).
- **전역 브라우저 슬롯** — 모든 Playwright 작업(취소·크레딧·주문폴링)을 프로세스 전역 단일 큐로 직렬화해 e2-micro(1GB) OOM 방지. 5개 진입점 전부 통과 확인, 재진입 데드락 없음 (`playwright-browser.ts:31`).
- **limbo 폴백의 회귀버그 방어** — 과거 버그(stop 플래그 해제 → auto-renew가 만료건을 오인해 부활)를 코드 주석에 문서화하고, 플래그를 건드리지 않고 `wasLastForcedExpired()` 마커로 재시도를 멈추도록 우회 (`automation.service.ts:499`). 7일 컷·알림 억제(suppress)까지 포함.
- **벌크 upsert 안전장치** — 백업 → 단일 트랜잭션 → **반영 직전 재분류(TOCTOU 방어)** → 포탈 연결(customer_id/serial_number) 보존 (`serial-bulk-update.service.ts:355`).
- **인바운드 메일 이중 dedup** — `message_id` DB 조회 + `message_id` UNIQUE 인덱스 백스톱 (`inbound.service.ts:280`, `database.ts:209`).

---

## 5. 상세 — 발견 항목

### F-1. 크레딧 배분 중 좌초 — 복구 경로 없음
- **심각도:** 🟠 MED-HIGH
- **위치:** `src/main/services/automation.service.ts:567` (claim) ~ `:635`
- **증상:** 자동배분은 `claimCreditForDistribution()`로 신청을 `alloc_status='distributing'`으로 선점한 뒤 실제 배분을 수행한다. 배분 도중 **프로세스가 죽거나**(코드 주석이 인정하는 e2-micro OOM 위험, `playwright-browser.ts:24`), `_doDistributeCredits`의 `finally` 블록(`cancel.service.ts:332`, `page.close()`)이 예외를 던지면, 신청이 `distributed`/`failed` 어느 쪽으로도 전이하지 못한다.
- **재현 시나리오:**
  1. 크레딧 신청 접수 → 5분 후 자동배분 크론이 claim (`alloc_status='distributing'`).
  2. `distributeCredits` 실행 중(수 초) VM이 OOM으로 프로세스를 강제 종료.
  3. 재시작 후: `findCreditRequestsReadyForAutoDistribution()`는 `alloc_status IS NULL`만 조회(`portal/db.ts:312`) → 이 신청은 **영구히 후보에서 제외**.
  4. stale `'distributing'`을 되살리는 워치독 없음. 프로세스 킬은 크리티컬 알림 경로도 우회.
  5. **결과:** 고객 신청이 조용히 멈춤. partner.exocad.com에 크레딧이 실제로 지급됐다면 그 사실이 DB 어디에도 기록되지 않음.
- **근본 원인:** claim(선점)과 mark(완료/실패) 사이 구간에 복구 메커니즘이 없음. 배분 루프 본문이 per-request try/catch로 감싸여 있지 않음.
- **수정 방향 (2단계):**
  1. **루프 본문 try/catch** — claim→distribute→mark 시퀀스를 요청 단위로 감싸고, 예외 시 `markCreditDistributionFailed` + 크리티컬 알림. (공수 S)
  2. **stale `distributing` 재조정** — 기존 일간 워치독 크론(`scheduler.ts:222`)에서 `alloc_status='distributing' AND alloc_at`(또는 claim 시각)이 N분(예: 15분, 단일 배분 최대시간보다 김) 초과인 행을 찾아 **`failed`로 전이 + 크리티컬 알림**. 돈성 작업이므로 자동 재시도(NULL로 되돌리기)는 **금지** — 실제 지급 여부를 알 수 없으므로 항상 사람이 확인. (공수 M)
- **확인 필요 사항:** claim 시각을 기록하는 컬럼이 있는지 (`alloc_at`은 완료/실패 시각). 없다면 claim 시 timestamp 컬럼 추가 필요.
- **✅ 처리 결과 (2026-07-23):** 2중 방어로 구현.
  - `claimCreditForDistribution`이 claim 시점에 `alloc_at`을 기록하도록 변경(경과시간 측정용).
  - 신규 `findStaleDistributingCredits(cutoff)`(`portal/db.ts`) + `runCreditAutoDistributionNow` 최상단 **좌초 복구 블록** — `'distributing'` 상태로 `CREDIT_DISTRIBUTING_STALE_MINUTES`(15분) 초과 정체된 건을 `failed` 전이 + "좌초 복구" 크리티컬 알림. **자동 재배분은 안 함**(돈 — 사람이 exocad 확인).
  - 배분 루프 본문 **per-request try/catch** — 예외 시 `failed` 전이(단 `distributed=true`면 되돌리지 않아 실제 지급건 보호), 한 건 예외가 배치 전체를 중단시키지 않음.

---

### F-2. 수동 크레딧 승인이 크레딧을 실제 지급하지 않음
- **심각도:** 🟠 MED · **의도 확정됨 → 이중발급 방지 가드로 대응 완료**
- **위치:** `src/server/portal/routes/admin.ts:401-404`
- **증상:** 매니저가 크레딧 신청을 수동 승인하면 발주서(청구용) 메일 발송 + `status='approved'`만 수행하고, **`distributeCredits`를 호출하지 않는다**. 반면 자동배분 경로(`automation.service.ts:576`)는 exocad에 크레딧을 실제로 밀어넣는다.
- **재현 시나리오:** 자동배분 토글(`credit_auto_alloc_enabled`)을 끈 상태에서는 **모든** 크레딧 신청이 수동 승인으로 흐름 → 어떤 코드도 exocad에 크레딧을 지급하지 않음 → 매니저가 partner.exocad.com에서 수동으로 밀어야 함. "승인 = 지급 완료"로 오해하면 **고객은 청구는 받고 크레딧은 못 받음.**
- **의도 확인 (수정 전 필수):**
  - **만약 "수동 승인 시 매니저가 exocad에서 직접 지급"이 의도된 운영이라면** → 코드 결함 아님. 대신 승인 UI에 "크레딧은 partner.exocad.com에서 직접 지급해야 합니다" 안내/확인 단계 추가 권장. (공수 S)
  - **만약 "승인하면 시스템이 지급"이 기대라면** → 수동 승인 분기에서도 `distributeCredits`를 호출하도록 자동 경로와 동일하게 배선(claim/mark/알림 포함). (공수 M)
- **왜 애매한가:** 발주서 메일은 내부 청구용 주소(`credit_notification_email`)로 가는 것으로 보임. 두 경로가 같은 `approved` 종료 상태를 공유하지만 부작용이 다름 — 설계 의도가 코드만으로는 확정 불가.
- **✅ 처리 결과 (2026-07-23, 기획자 의도 확정):** 수동 승인이 크레딧을 밀지 않는 것은 **의도된 동작** — 수동 처리는 exocad 발급까지 매니저가 손으로 하고 승인은 확인용. 자동 배선 시 오히려 **이중 발급**(손 발급 + 크론 발급) 위험. 따라서 자동 배선은 **하지 않음.**
  - **단, 실제 이중발급 위험이 코드에 존재했음:** 자동 토글 ON 상태에서 매니저가 특정 건을 손으로 발급하는 동안(5분 유예 경과 시) 크론이 같은 건을 **또** 발급할 수 있었다(신청이 여전히 `pending` & `alloc_status IS NULL`).
  - **대응:** 크레딧 신청에 **"수동 처리로 전환"(manual-hold)** 액션 추가 — `holdCreditForManual(id)`(`portal/db.ts`, 원자적 `UPDATE ... alloc_status='manual_hold' WHERE ... alloc_status IS NULL`), 라우트 `PATCH /portal/admin/requests/:id/manual-hold`(크론이 이미 배분 시작했으면 409 `ERR_CREDIT_HOLD_ALREADY_STARTED`), `Portal.tsx` 버튼+배지, i18n 3개국어. 매니저가 exocad 가기 **전에** 이 버튼을 누르면 자동배분 큐에서 원자적으로 제외 → 이중발급 구조적 불가(한쪽만 claim 성공). 자동배분 쿼리는 무변경(기존 `alloc_status IS NULL` 필터가 hold를 자동 제외).

---

### F-3. 주문 승인 중복 처리 가드 부재
- **심각도:** 🟠 MED
- **위치:** `src/main/services/order.service.ts:203-209` (`approvePendingOrder`)
- **증상:** 함수 진입 시 주문을 로드하지만 `order.status`를 검사하지 않음. 이미 `approved`된 주문에 대해 승인이 다시 호출되면 승인 로직 전체가 재실행됨.
- **재현 시나리오:** 매니저가 승인 버튼을 더블클릭하거나 두 개의 관리자 탭에서 같은 주문을 승인 → 두 번째 호출이 재실행. 현재는 하위 단계의 "이미 존재/이미 커버됨" 검사(`order.service.ts:371`, `getBySerialNumber`)에 **우연히** 의존해 이중 시리얼/이중 갱신을 피하고 있음 — 방어가 아니라 부수효과.
- **대조:** 포탈 관리자 `decide` 라우트는 이미 처리된 신청을 409로 명시적으로 차단함(`admin.ts:322`, "이미 처리된 신청입니다"). 주문 승인만 이 가드가 없음 — 일관성 결여.
- **수정 방향:** `approvePendingOrder` 진입부에 가드 추가 — `if (order.status !== 'pending') return { success: false, error: ORDER_ALREADY_PROCESSED }`. 포탈 `decide`의 409 패턴을 따를 것. (공수 S)
- **✅ 처리 결과 (2026-07-23):** `approvePendingOrder` 진입부에 `status !== 'pending'` 가드 추가 → `SERVER_ERRORS.ORDER_ALREADY_PROCESSED` 토큰 반환. `serverError.ts` 매핑 + `err_order_already_processed` i18n(3개국어) 추가. **덤:** `Orders.tsx`의 승인 실패 alert가 서버 토큰(`ERR_...`)을 날것으로 노출하던 것을 `translateServerError`로 번역하도록 수정(규칙 [[feedback-no-hardcoded-language-errors]] 준수). **미처리 형제 이슈:** `Orders.tsx:86`의 "데이터 수정" 경로도 동일하게 토큰을 날것 노출 — F-3 스코프 밖이라 남겨둠.

---

### F-4. 크레딧 배분 토스트 놓침 시 성공 간주 (false-success)
- **심각도:** 🟡 MED
- **위치:** `src/main/services/cancel.service.ts:300-325`
- **증상:** 배분 제출 후 성공/실패는 우상단에 ~1초간 뜨는 토스트로 판정한다(코드가 "best-effort"라 명시). 토스트를 놓치고 modal이 닫혀 있으면 **성공으로 간주**(`:324`).
- **재현 시나리오:** 느린 VM에서 토스트 캡처 타이밍을 놓침 + modal이 (성공이든 다른 이유든) 닫힘 → 배분이 실제로 안 됐어도 `success:true` 반환 → 상위에서 `markCreditDistributed` + 자동승인 + 청구 메일 발송.
- **왜 중요한가:** 돈성 작업에서 **false-success는 false-failure보다 위험**하다. false-failure는 크리티컬 알림 → 사람이 확인하지만, false-success는 감지 수단이 없어 "지급됨"으로 굳어짐.
- **수정 방향:** "토스트 없음 + modal 닫힘"을 성공이 아니라 **미검증(unverified)**으로 처리하고, 취소 흐름의 `verified` 플래그처럼 별도 상태로 남겨 알림. 가능하면 배분 후 크레딧 페이지/잔액을 재조회해 실제 반영을 확인. (공수 M)
- **확인 필요:** 배분 성공 후 페이지에 남는 신뢰할 수 있는 확인 요소(잔액 변화 등)가 있는지 실사이트에서 확인 필요.
- **✅ 처리 결과 (2026-07-23):** `CreditDistributeResult`에 `verified?: boolean` 추가. `_doDistributeCredits`가 **성공 토스트로 확인된 성공만 `verified:true`**, "토스트 없음 + modal 닫힘"의 추정 성공은 `verified:false` 반환. `runCreditAutoDistributionNow`에 미확인 분기 추가 — `success && verified===false`이면 재분배 방지를 위해 `distributed`로는 마킹하되 **자동 승인/발주서는 보류**하고 "미확인" 크리티컬 알림 발송(사람이 exocad에서 확인 후 수동 승인). false-success가 청구까지 이어지는 것을 차단. **미완(후속 권장):** 배분 후 잔액 재조회로 실제 반영을 확인하는 능동 검증은 실사이트 요소 파악이 필요해 이번엔 미구현 — 현재는 "확정 성공 신호 부재 → 사람 확인"으로 안전측 처리.

---

### F-5. failsafe 취소 실패 알림 비대칭
- **심각도:** 🟡 LOW-MED
- **위치:** `src/main/services/automation.service.ts:185-198` (인바운드) vs `:266-277` (포털)
- **증상:** failsafe 취소가 실패할 때, **인바운드 메일 발** 경로는 활동 로그만 남기고(크리티컬 Slack 알림 없음), **포털 발** 경로는 `sendCriticalAutomationAlert`까지 보낸다. 또한 인바운드 경로는 취소 시도 **전에** 메일을 `processed=1`로 마킹(`:152`)해 재선정에서 제외.
- **완화 요인:** 인바운드 경로도 stop 플래그를 세우므로(`:151`), limbo 폴백이 D0~D+7 윈도우에서 재시도+알림으로 결국 포착함. 즉 **완전 무음이 아니라 지연·불일치**.
- **수정 방향:** 인바운드 failsafe 실패 분기에도 포털 경로와 동일하게 `sendCriticalAutomationAlert` 추가해 알림 정책 통일. (공수 S)
- **✅ 처리 결과 (2026-07-23):** 인바운드 failsafe의 **미검증·실패 두 분기 모두**에 `sendCriticalAutomationAlert` 추가(포털 경로와 동일 정책). 인바운드는 취소 전 `processed=1`로 재선정 안 되므로 알림 스팸 없이 1회만 발송.

---

### F-6. message-id 없는 메일은 중복 제거 안 됨
- **심각도:** 🟡 LOW
- **위치:** `src/main/services/mail/inbound.service.ts:280-285` (`isDuplicate`)
- **증상:** `if (!messageId) return false` — Message-ID 헤더가 없는 메일은 중복으로 인식되지 않음. `pop3_keep_copy=true`(서버에서 메일 미삭제)이면 이런 메일이 매 크론 틱마다 재처리되어 `inbound_mails` 중복 행 + 자동응답 중복 발송 가능.
- **완화 요인:** 실무 메일은 대부분 Message-ID를 가지며, `keep_copy=false`이면 처리 후 DELE되어 재출현 없음. 발생 조건이 좁음.
- **수정 방향:** message_id가 null일 때 대체 dedup 키(from+subject+date+본문 해시) 사용, 또는 분류된 메일은 `keep_copy`와 무관하게 처리 후 DELE. (공수 S)
- **✅ 처리 결과 (2026-07-23):** `parseEmail`에서 Message-ID 헤더도 없고 호출부 fallback도 없을 때(주로 IMAP 경로) **내용 해시**(`sha1(from|date|subject|body[:1000])`)로 안정적 합성 dedup 키를 생성 → `isDuplicate` + `message_id` UNIQUE 인덱스가 정상 작동. POP3는 기존 `pop3-${uid}` fallback 유지.

---

### F-7. 정적 린트 계층 부재 + 데드코드
- **심각도:** 🟡 LOW (위생)
- **위치:** 전역
- **증상:** ESLint 설정·lint npm 스크립트가 전혀 없음 → 타입 외 코드 규칙을 기계가 강제하지 못함(일관성이 사람 리뷰에만 의존).
- **⚠️ 데드코드 재검증 결과 (2026-07-23):** ts-prune 목록을 실제 참조로 재확인한 결과 **2건은 오탐**이었음 — `OrderApproveInput`(4곳 사용), `RenewalDryRunResult`(11곳 사용)은 **살아있음, 삭제 금지**. 실제 미사용 확인: `parseSerialExportQuery`, `ExcelSerialRow`, `ServerErrorCode`, `CODE_TO_PRODUCT_NAME`. 단 `CODE_TO_PRODUCT_NAME`은 40여 개 제품코드→제품명 매핑 **큐레이팅 데이터**라 기계적 삭제 대상이 아님(보존 판단). **교훈: ts-prune 목록을 그대로 지우면 안 됨 — 반드시 참조 재확인.**
- **수정 방향:** ESLint + typescript-eslint **최소 구성**(버그 검출 룰 위주: `no-floating-promises`·`no-unused-vars`·`no-misused-promises` 등, 스타일 룰 배제, 비차단) 도입 + `npm run lint` 스크립트. 데드코드는 `no-unused-vars`로 자동 검출해 별도 정리 pass에서 🟢(기계적)·🟡(동작변경) 분류 후 처리. (공수 M, 셋업 위주)

---

## 6. 기계 검증 결과 (전수)

| 검사 | 명령 | 결과 |
|------|------|------|
| 타입체크 (renderer/portal) | `tsc --noEmit` | ✅ 0 에러 |
| 타입체크 (main/server) | `tsc --noEmit -p tsconfig.main.json` | ✅ 0 에러 |
| 미사용 export 스캔 | `ts-prune` (양쪽 tsconfig 교차검증) | 실제 데드코드 6개 (→ F-7) |
| 린트 | — | ❌ 도구 없음 (→ F-7) |

---

## 7. 권장 실행 순서

- ~~**F-2 의도 확인**~~ → ✅ 확정 + 이중발급 방지 가드 완료
- ~~**F-3**~~ → ✅ 완료
- ~~**F-1**~~ → ✅ 완료
- ~~**F-4**~~ → ✅ 완료 (verified 플래그 + 미확인 시 자동승인 보류)
- ~~**F-5**~~ → ✅ 완료 (인바운드 failsafe 알림 통일)
- ~~**F-6**~~ → ✅ 완료 (합성 dedup 키)
- **F-7** (공수 M) — ESLint 최소 구성 도입 + 데드코드 자동 정리 pass. **← 진행 중**

> **참고:** 본 리뷰는 정적 분석입니다. F-1·F-4 수정 후에는 **기능 축 검증**(실제 배분/취소를 dry-run 또는 스테이징에서 실행)을 별도로 수행할 것을 권장합니다. 완료된 F-1(좌초 복구)·F-2(manual-hold)는 백그라운드 로직이라 화면에 안 보이며, 실동작은 런타임 재현 테스트가 필요합니다.

---

## 8. 부록 — 참조한 핵심 파일

- `src/main/services/automation.service.ts` — 자동화 오케스트레이션 (auto-renew, failsafe, limbo, 크레딧 배분)
- `src/main/services/cancel.service.ts` — Playwright 취소·크레딧 배분 실행
- `src/main/services/order.service.ts` — 주문 폴링·승인
- `src/main/services/mail/inbound.service.ts` — 인바운드 메일 분류·멱등성
- `src/main/services/serial-bulk-update.service.ts` — 엑셀 벌크 upsert
- `src/main/services/playwright-browser.ts` — 전역 브라우저 슬롯
- `src/main/scheduler.ts` — cron 정의
- `src/server/portal/db.ts` — 크레딧 claim/mark, 포탈 요청
- `src/server/portal/routes/admin.ts` — 포탈 관리자 승인/결정
