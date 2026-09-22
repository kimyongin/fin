# [ToDo·원칙] 원칙 화면 데이터 관리 규칙과 세션 간 재사용

GitHub: https://github.com/kimyongin/fin/issues/70

상태: 로컬 구현·검증 완료, 운영 배포 전 · 2026-09-22
선행: 01 (기존 메모 계약) (동일 todo-principles 시리즈)

## 기준과 기존 구현
공통 설계: https://github.com/kimyongin/fin/blob/master/docs/design/todo-principles-integration.md
ADR: https://github.com/kimyongin/fin/blob/master/docs/adr/0005-todo-bundles-and-operating-rules.md
실제 변경 대상: src/features/strategy/{StrategyPage.jsx,data.js}, supabase/functions/_shared/mcp/{workflow-guides,portfolio-tools}.ts
기존 원본을 재사용하고 아래 차이만 구현한다. 명칭은 공통 계약을 따르고 새 RPC는 구현 전 정확한 SQL signature・입출력・오류・권한을 설계 문서에 확정한다.

## 범위
공통 설계의 operating_rules와 목록/저장/보관 RPC・OAuth 도구를 구현한다. 원칙 화면에 데이터 관리 영역을 추가하고 reconciliation workflow_key와 적용 조건을 저장한다. 잔고 대조 가이드에서 규칙과 대상 메모를 먼저 읽는다. 규칙 수정/보관・버전 충돌을 다룬다.

## 인수 조건
- [x] T03: 앱 저장→OAuth 재조회, 규칙 없음/조회 실패 구별, XLS의 매입금액과 평가금액 혼동/0수량/통화 모호성/규칙 충돌 사례, 타인/공유 비노출, 앱 관리 기능을 검증한다. 실제 새 ChatGPT 세션 검증은 06에 연결한다.
- [x] DB→RPC/OAuth→앱의 해당 사용자 시나리오를 연결하고 실제 검증 결과를 기록한다.
- [x] 문서/도구 설명/가이드 변경 영향, 증분 migration 및 schema/OVERVIEW.md를 갱신한다.
- [x] npm run check:encoding 및 변경 위험에 맞는 검증을 통과하고 미검증 범위를 기록한다.

## 구현·검증 결과
- `operating_rules` 현재값과 이력·멱등 영수증, 목록/저장/보관 RPC를 owner-only로 추가했다. 규칙은 workflow, 적용 조건, 본문을 분리하고 보관 시 이력을 유지한다.
- OAuth에 `list/save/archive_operating_rule`을 추가하고 잔고 대조 가이드의 첫 단계가 규칙을 조회하도록 바꿨다. 빈 목록과 조회 실패, 적용 조건 불일치, 현재 지시·금융 검증과의 충돌을 구분한다.
- 원칙 화면에서 잔고 대조 규칙을 추가·편집·보관할 수 있고 개인 투자 기준과 별도 영역으로 표시한다.
- 격리 Supabase 기준 DB 358개, MCP 계약, 브라우저 E2E 31개(신규 앱 규칙 생명주기 포함), 프런트 단위 테스트 98개를 통과했다.
- 실제 새 ChatGPT 웹·모바일 세션에서 규칙 적용 품질을 평가하는 일은 운영 배포 후 06 티켓에서 수행한다.

## 제외・진행 규칙
계좌/보유별 신규 note, 자동 실행 엔진, 모든 분석에 규칙 전체 주입은 제외한다.
최소 기반+수직 슬라이스로 진행하고 완료 슬라이스 단위로 커밋한다. 개인 로컬 설정을 섞지 않는다. 기존 금융 검증・공개 범위・미완료 평가를 유지한다.
