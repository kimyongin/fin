# [MCP 개선] 도구 선택 설명과 대상별 연속 조회 정비

우선순위: P1 · 상태: 구현·계약 검증·운영 배포 완료 · 작성: 2026-09-21
상위: #40 · 시나리오/연관: S05~S17/S24 · W01~W05/W08 · #52 후속
선행/통합: 01-contracts 결과 계약에 맞춰 통합

## 목적

ChatGPT가 추측 없이 Portfolio 도구를 선택·사용·복구하고, 운영자가 계약 변경을 안전하게 유지할 수 있게 한다. ChatGPT는 조사·해석·설명, Portfolio는 기억·계산·검증을 담당한다.

## 검토 근거

- list_tasks는 조사 질문만 설명하지만 실행 계획도 반환하며 조사 상태 필터만 노출한다.
- MCP 목록은 timestamp-only before RPC를 계속 사용하여 같은 시각의 페이지 경계에서 누락 가능성이 있다.
- 거래 조회의 계좌/종목 필터와 context/strategy/policy 도구 선택 기준이 부족하다.

## 작업 범위

- 일일 점검의 기본 시작 도구, 개별 조회의 용도, 조사 task/실행 계획의 조회와 변경 경로를 명시한다.
- description에 사용 시점·비사용 시점·선행 조회·결과/부수 효과·필수 확인을 간결하게 작성한다.
- 기존 웹의 목적별 커서 RPC를 재사용할 수 있는지 확인하고 owner-only MCP 경계를 유지한다. 계좌/종목·task 종류/상태 조건을 조회 전에 적용한다.
- 기존 before 호출과 새 cursor 호출의 우선순위/충돌/폐기 정책을 명시한다. 도구명 변경·삭제나 일괄 신규 버전은 기본 해결책이 아니다.

## 인수 조건

- [x] 같은 timestamp의 50개 초과 기록에서 페이지 누락·중복 없이 순회한다.
- [x] 특정 계좌/종목 거래와 조사 질문/실행 계획을 각각 조회하고 적절한 변경 도구에 연결한다.
- [x] 과거 MCP 입력 호환과 타 사용자 접근 거부를 확인한다.
- [x] get_daily_context/get_portfolio_state/get_strategy_state/get_investment_policy 선택 사례와 중복 호출을 줄이는 기준이 문서·description에 일치한다.

## 구현 결과

- 기존 before 입력은 유지하고 cursor를 명시한 호출만 owner-only keyset page RPC를 사용한다. 첫 페이지는 cursor:null, 후속은 next_cursor 그대로다.
- 판단/할 일 필터, 거래 account_id/instrument_id 필터와 안정 커서를 노출했다. list_tasks가 조사 질문과 실행 계획을 함께 반환한다는 경계를 명시했다.
- daily context와 개별 상태/strategy/policy 조회의 선택 기준을 description에 반영하고 실제 MCP cursor page를 호출했다.

## 진행 규칙

- docs/START-HERE.md, 관련 계약과 ADR-0004를 읽고 기존 구현을 먼저 확인한다. 과거 티켓의 구현을 재작성하지 말고 위 후속 차이만 처리한다.
- 최소 공통 기반 + 수직 슬라이스로 구현·검증한다. 기존 migration을 고치지 말고 필요한 증분 migration과 schema/OVERVIEW.md를 갱신한다.
- 실제 실행한 검증과 미검증 항목을 구분하고 npm run check:encoding을 수행한다. 운영 배포·push·실사용 검증을 자동 완료 처리하지 않는다.
