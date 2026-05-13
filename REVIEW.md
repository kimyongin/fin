# PRD 리뷰: 재테크 시스템

## Context

`C:\Users\yongin\projects\fin` 폴더의 5개 PRD(`PRD.md`, `PRD_API_SERVER.md`, `PRD_PORTFOLIO_WEB_APP.md`, `PRD_MARKET_ANALYSIS_SKILL.md`, `PRD_REBALANCING_SKILL.md`)를 다음 세 가지 기준으로 검토했다.

1. RnR(역할/책임) 분리가 적절한가
2. 설계가 컴포넌트 간 일관적인가
3. 즉시 개발에 착수할 수 있을 만큼 명세가 충분한가

전반적으로 **경계 원칙(API Server 단독 DB 접근, 공유 API 키, JSONB 사용)** 등 큰 골격은 깔끔하지만, **계산 로직 스펙·응답 스키마·일부 RnR 충돌·누락 API**가 남아 있어 그대로 개발에 들어가면 도중에 결정이 필요한 항목이 다수 발생한다.

---

## 종합 평가

| 항목 | 평가 | 코멘트 |
|---|---|---|
| RnR 분리 | B+ | 큰 경계는 명확하나 holdings/가격 입력에서 충돌 또는 공백 |
| 설계 일관성 | B | 환경 변수·인증 일관. 그러나 read API 누락, JSONB 미명세 |
| 즉시 개발 가능성 | C+ | 인터페이스 골격은 있으나 응답 스키마·계산 알고리즘 부재 |

---

## 1. RnR 분리

### 1.1 잘 정리된 부분
- DB 접근 단일화: `SUPABASE_SERVICE_ROLE_KEY`는 API Server에만, 모든 read/write는 Edge Functions를 경유 — 마스터 PRD §3.1과 각 PRD 책임 섹션이 일관된다.
- Skill 두 개의 사용 API 목록이 마스터 PRD §6 체크리스트와 정확히 일치한다.
- Web App의 "비책임" 섹션이 명시되어 백엔드 로직을 끌어들이지 않는다.

### 1.2 RnR 충돌·공백

**[Critical] holdings 직접 CRUD vs 거래 기반 재계산 — 진실 소스 미결정**
- API Server PRD §6.2: `save-holding`, `delete-holding` (직접 수정)
- API Server PRD §6.3: `add/update/delete-transaction` 후 holdings 재계산
- Web App PRD §F-W4도 보유 종목 직접 CRUD 화면 제공
- 사용자가 holdings를 직접 편집한 뒤 거래를 추가하면 평균단가가 어떻게 재계산되어야 하는지 정의되지 않음.
- 결정 필요: (a) 초기 적재만 직접 CRUD, 이후는 transactions가 진실 소스 (b) 두 경로 모두 허용하되 마지막 액션이 우선 (c) holdings 직접 수정은 admin 전용

**[Critical] 가격/환율 데이터 입력 책임자 미지정**
- 마스터 PRD §5: "수동 입력/갱신을 기본"
- API Server `save-price` API는 누가 호출하는가? Web App F-W6은 "수동 가격 입력"을 명시. Market Analysis Skill은 yfinance로 지표를 수집하나 `save-price` 호출 여부는 책임 목록에 없음.
- USD/KRW 환율 갱신 책임자도 동일하게 공백.
- 결정 필요: Web App가 단독 입력자인지, Market Analysis Skill이 yfinance로 자동 저장하는지.

**[Major] 리밸런싱 히스토리 read API 누락**
- Web App PRD §F-W8은 "리밸런싱 제안 목록 표시"를 요구하나 사용 API 목록에 read API가 없다.
- API Server PRD §6.7에는 `save-rebalance-suggestion`, `update-rebalance-decision`만 있고 `list-rebalance-suggestions` 또는 `get-rebalance-suggestions`가 없음.
- Web App이 어떤 API로 데이터를 가져오는지 미정 → 즉시 누락 보완 필요.

**[Minor] delete-account 시 cascade 정책의 모호한 표현**
- DDL은 `ON DELETE CASCADE`로 결정되어 있으나, API §6.1의 "DB 제약 또는 함수 내부 검증으로 결정한다"라는 문구는 미결정처럼 읽힌다 → 본문을 DDL과 동기화.

---

## 2. 설계 일관성

### 2.1 일관된 부분
- 환경 변수 명명(`PORTFOLIO_API_KEY`, `PORTFOLIO_FUNCTIONS_BASE_URL`) 4개 PRD 공통.
- 인증 헤더 형식 일관(`Authorization: Bearer ...`).
- 카테고리 enum(`core/theme/individual/bond`) Web App만 정의 — 그러나 API Server DDL `category TEXT`와 충돌 없음(자유 입력 허용).

### 2.2 불일치·모호한 지점

**[Major] JSONB 필드 권장 스키마 부재**
- 권장 구조가 있는 것은 Rebalancing Skill PRD의 `actions`뿐.
- 미정 필드: `daily_reports.trade_suggestions`, `risk_warnings`, `indicators`, `rebalance_suggestions.based_on_reports`, `user_decision`.
- 특히 `user_decision`은 `update-rebalance-decision`이 직접 받는 페이로드인데 구조가 없으면 클라이언트/서버 양쪽 구현 불가.

**[Major] API 응답 스키마 부족**
- `get-portfolio` 응답은 빈 배열 예시만 있고 holding 객체 구조가 없음.
- `list-accounts`, `list-holdings`, `list-transactions`, `get-reports` 응답 스키마 전부 없음.
- "통화 환산 규칙"에 따라 응답 시 계산되는 `market_value_native/krw`, `unrealized_pnl_krw`, `weight_pct` 필드명이 본문에 있지만 어느 응답에 들어가는지 표가 없음.

**[Major] holdings 재계산 알고리즘 미명세**
- 매수 평균단가 공식, 매도 시 평균단가 정책, 수량 0 도달 시 행 삭제 vs 유지, 수수료를 평단에 포함할지 여부 — 모두 미정.
- `add-transaction`의 입력 필드 명세도 누락(다른 트랜잭션 API와 달리 필드 목록이 없음).

**[Major] Edge Functions의 트랜잭션 보장 패턴 미정**
- "거래 저장과 holdings 갱신은 하나의 함수 안에서 처리한다" — 함수 레벨이지 DB 트랜잭션 레벨 보장이 아님.
- 부분 실패(거래는 저장됐는데 holdings 갱신 실패) 처리 정책 없음.

**[Minor] `holding_prices_daily.currency` 컬럼의 용도 불명**
- 통화 환산 규칙은 `holdings.currency`만 참조한다. 가격 테이블 `currency`가 보조용인지, 다른 통화의 동일 ticker 가격을 별도 저장하는지 미정.

**[Minor] timezone 정책 부재**
- `report_date`, `suggestion_date`, `trade_date`, `price_date` 모두 `DATE` 타입. KR 기준인지 UTC 기준인지 명시 필요(매일 07:00 KR 트리거를 보면 KR이 자연스러움).

**[Minor] 인증·접근 보호 미결정**
- Web App F-W1: "Vercel 보호 기능 또는 단순 접근 보호로 시작" — 둘 중 하나 결정 필요.

**[Minor] 카테고리 enum 위치**
- enum은 Web App PRD에만 있음. API/DB 레이어에 이식하지 않으면 입력값 불일치가 발생할 수 있음. CHECK 제약 또는 응답 검증 위치 결정 필요.

**[Minor] 차트 라이브러리 미결정**
- Web App: "Recharts 또는 Tremor" — 결정 필요.

---

## 3. 즉시 개발 가능성

### 3.1 즉시 개발 차단 요인
1. holdings 재계산 알고리즘 (수식, 매도 정책, 수수료 처리)
2. API 응답 스키마 (특히 `get-portfolio`, `list-*`, `get-reports`)
3. JSONB 필드 권장 스키마 (`user_decision` 등)
4. `add-transaction` 입력 필드 목록
5. 리밸런싱 read API 정의 (`list-rebalance-suggestions`)
6. 에러 응답 공통 포맷 (HTTP status + body shape)
7. holdings 직접 CRUD vs transactions의 진실 소스 결정

### 3.2 개발 중 후속 결정 가능
1. RSS 피드 목록·키워드 매칭 규칙 (Market Analysis Skill 구현 단계에서 결정 가능)
2. 시장 지표 확정 목록
3. Google Drive 폴더 자동 생성 정책, OAuth scope
4. Vercel 접근 보호 방식 (배포 직전 결정 가능)
5. 차트 라이브러리 선택 (대시보드 작업 시점)
6. 단위/통합 테스트 정책

### 3.3 보완하면 좋을 부수 항목
- `transactions` 중복 입력 방지(예: `(account_id, trade_date, ticker, trade_type, quantity, price)` natural key 또는 사용자 확인 UX).
- `accounts.name UNIQUE` 제약을 Web App F-W3 화면 동작에 반영 (중복 이름 입력 시 에러 처리).
- 마이그레이션 전략(initial schema + 후속 변경 추적 정책).
- `save-report.report_date` UNIQUE 제약 — 중복 저장 시 upsert인지 reject인지 명시.
- Skill 트리거 실패 알림 채널(이메일? Slack? 사용자 통지?).

---

## 권장 후속 조치

다음 순서로 PRD를 갱신하면 즉시 개발에 착수 가능하다.

1. **API Server PRD 갱신** (가장 큰 작업)
   - `add-transaction` 입력 필드 명세
   - holdings 재계산 알고리즘 의사코드
   - `get-portfolio`, `list-*`, `get-reports` 응답 스키마
   - 에러 응답 공통 포맷
   - JSONB 권장 스키마 (`user_decision`, `trade_suggestions`, `risk_warnings`, `indicators`, `based_on_reports`)
   - `list-rebalance-suggestions` (또는 동급) 추가
   - holdings 직접 CRUD vs transactions의 정책 명시 (예: "직접 CRUD는 초기 적재 전용, 이후 거래 기반 갱신")
   - timezone 정책

2. **마스터 PRD 갱신**
   - 가격/환율 입력 책임자 결정 후 §3 또는 §5 반영
   - 검증 체크리스트에 read API 누락 방지 항목 추가

3. **Web App PRD 갱신**
   - 사용 API 목록에 리밸런싱 read API 추가
   - 인증 방식·차트 라이브러리 결정
   - 카테고리 enum이 서버에서도 공유되는지 표시

4. **Market Analysis Skill PRD 갱신**
   - yfinance로 수집한 가격을 `save-price`로 저장할지, 시점만 사용할지 결정
   - RSS 피드 후보·키워드 규칙 (별도 부록 가능)

5. **Rebalancing Skill PRD**
   - 큰 변경은 없음. `actions` 권장 구조와 동일한 방식으로 다른 JSONB도 명세할 것을 권장.

---

## 검증 방법

갱신 완료 후, 각 PRD 본문만 읽고 다음을 식별 가능해야 한다.

- 모든 API의 요청/응답 스키마
- holdings 갱신 시 사용되는 정확한 수식
- 진실 소스(holdings vs transactions)
- 가격/환율 입력 주체
- 모든 JSONB 컬럼의 형태

마스터 PRD §6 체크리스트에 "API 응답 스키마 정의 완료", "holdings 재계산 알고리즘 정의 완료", "리밸런싱 read API 존재" 등을 추가하여 회귀 방지.
