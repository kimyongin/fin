# [ToDo·원칙] 기존 메모 OAuth 편집과 확인 메모 재조회

2026-09-23 후속: [ADR-0008](../adr/0008-minimal-portfolio-storage.md)과 저장 단순화 #86~#91이 충돌하는 저장/이력/기능 유지 요구를 대체한다. 기존 구현·검증 증거와 미검증 외부 게이트는 보존하며 새 구현은 docs/START-HERE.md에서 시작한다.

GitHub: https://github.com/kimyongin/fin/issues/69

상태: 로컬 구현·검증 완료, 운영 배포 전 · 2026-09-22
선행: 없음 (동일 todo-principles 시리즈)

## 기준과 기존 구현
공통 설계: https://github.com/kimyongin/fin/blob/master/docs/design/todo-principles-integration.md
ADR: https://github.com/kimyongin/fin/blob/master/docs/adr/0005-todo-bundles-and-operating-rules.md
실제 변경 대상: src/features/portfolio/{accountActions,holdingActions,instrumentActions}.js, src/features/modals/PortfolioEditorModals.jsx, src/features/assets/{SpreadsheetEditor,HoldingIntegrityModal}.jsx, supabase/functions/_shared/mcp/portfolio-tools.ts, portfolio-mcp-oauth/index.ts, migration 011/026
기존 원본을 재사용하고 아래 차이만 구현한다. 명칭은 공통 계약을 따르고 새 RPC는 구현 전 정확한 SQL signature・입출력・오류・권한을 설계 문서에 확정한다.

## 범위
기존 accounts/instruments/holdings.note의 소유자 전용 변경 RPC와 OAuth 도구를 추가한다. 메모만 수정할 때 잔고를 재저장하지 않는다. 앱 메모 편집/표 저장 경쟁은 expected_note로 검증한다. verify 저장 응답과 최신 integrity 조회에서 note/source를 반환하고 최근 확인 메모를 앱에 표시한다.

## 인수 조건
- [x] T01/T02: 기존 메모 보존, 타인 거부, 동시 편집 충돌, 동일 응답 재시도, 수량/원가/state_version/changed_since 불변, 과거 receipt 호환을 실제 RPC로 검증한다.
- [x] DB→RPC/OAuth→앱의 해당 사용자 시나리오를 연결하고 실제 검증 결과를 기록한다.
- [x] 문서/도구 설명/가이드 변경 영향, 증분 migration 및 schema/OVERVIEW.md를 갱신한다.
- [x] npm run check:encoding 및 변경 위험에 맞는 검증을 통과하고 미검증 범위를 기록한다.

## 구현·검증 결과
- `app_update_entity_note`와 OAuth `update_entity_note` 도구를 추가했다. 계좌·종목·보유 메모를 `expected_note` CAS와 idempotency receipt로 안전하게 변경한다.
- 보유 확인 저장·조회가 `note`와 `source`를 반환하고 자산 무결성 모달이 최근 확인 메모를 다시 보여준다.
- 격리된 Supabase 초기화 기준 DB 341개, MCP 계약, 브라우저 E2E 30개 및 프런트 단위 테스트 95개를 통과했다.
- 로컬에 Deno가 없어 독립 `check:edge`는 실행하지 못했으나, 동일 Edge Function은 격리 E2E의 MCP 초기화·인증·도구 호출 계약으로 검증했다.
- 운영 migration/Edge 배포와 실제 ChatGPT 재연결 평가는 후속 릴리스 티켓에서 수행한다.

## 제외・진행 규칙
신규 범용 메모 테이블과 기존 내용 자동 이동은 제외한다.
최소 기반+수직 슬라이스로 진행하고 완료 슬라이스 단위로 커밋한다. 개인 로컬 설정을 섞지 않는다. 기존 금융 검증・공개 범위・미완료 평가를 유지한다.
