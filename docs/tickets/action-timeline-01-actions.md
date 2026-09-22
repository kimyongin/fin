# [행동 통합] 자동 행동 기록 보완과 일반 태스크 전환
상태: 구현 완료・운영 미배포 · 2026-09-22
GitHub: https://github.com/kimyongin/fin/issues/75
선행: 없음 (action-timeline 시리즈)
기준: [공통 설계](../design/tasks-and-events.md), [ADR-0006](../adr/0006-tasks-and-action-events.md).
기존 대상: 기존 portfolio_tasks/activity_events 및 mutation RPC, LifecyclePage, MCP 목적별 도구.

## 목적과 범위
A01~A03. 기존 메모 수정의 자동 기록을 기준으로 일반 태스크 생성/완료와 수동 활동 기록까지 DB→MCP→최소 UI로 연결한다. 완료 ToDo 중복 생성을 없앤다.

## 인수 조건
- [x] 변경 API 전수 목록과 자동 이벤트 유무를 작성
- [x] verify/execution 전이/체결 연결 및 프런트 후행 로그 누락 보완
- [x] 일반 task와 task_id 연결 이벤트의 최소 DDL/RPC 계약 확정
- [x] 변경·이벤트 원자성/멱등성/무변경 처리
- [x] 수동 이벤트는 출처 구별 및 금융 사실 위조 금지
- [x] 새 이벤트의 개인정보 공유 허용 목록
- [x] 완료/재개 이력과 단일 표시 fixture
- [x] 정확한 API signature/오류/권한/날짜 의미와 필요한 최소 모델 계약을 구현 전에 설계 문서에 기록한다.
- [x] 실제 DB→RPC/OAuth→앱 시나리오 검증과 미검증 범위를 기록한다. 문서/가이드 변경 영향과 encoding check를 포함한다.

## 구현 계약과 결과
- `portfolio_tasks.kind=general`이 앞으로 할 의도를 저장한다. `activity_events.task_id`, `occurred_at`, `occurrence_on`이 실제 행동과 대상/수행일을 연결하며 금융 원본은 대체하지 않는다.
- 읽기: `app_list_general_task_page(filter,limit,cursor)`, `app_get_general_task(task_id)`. 쓰기: `app_save_general_task(task_id,expected_version,idempotency_key,payload)`, `app_transition_general_task(task_id,expected_version,action,result,reason,occurrence_on,idempotency_key,authored_via)`, `app_record_manual_activity(title,result,occurred_at,timezone,idempotency_key,authored_via)`.
- 쓰기는 소유권, 기대 버전, 작업별 멱등 키를 검사한다. 주요 오류는 인증 필요, 찾을 수 없음, 버전 충돌, 멱등 키 요청 불일치, 유효하지 않은 전이/시간대/미래 수행 시각이다.
- 일반 태스크 생성・수정・완료・재개・보류・재개・취소는 같은 트랜잭션에서 이벤트를 남긴다. `verify_holding`, `link_trade_to_task`, 실행 계획 제어 전이의 누락 이벤트도 서버 트리거로 보완했다. 메모 무변경 저장은 성공하되 이벤트를 만들지 않는다.
- 수동 기록은 `reported=true`와 사용자/agent 출처를 보존하며 태스크・체결・잔고를 만들거나 바꾸지 않는다. 새 이벤트는 기존 `activity` 공유 범위를 따르며 일반 태스크 상세/이력은 그 권한으로 노출하지 않는다.
- 앱은 최소 UI로 일반 할 일 추가/완료와 앱 밖 한 일 기록을 제공한다. 기존 ToDo 묶음은 전환 티켓 전까지 호환 표시한다.
- 검증: DB pgTAP 407건, MCP 계약, Vitest 102건, 프로덕션 빌드, 새 일반 할 일 UI 시나리오를 포함한 Playwright 33건 통과. `deno check`는 로컬 PATH에 Deno가 없어 실행하지 못했지만 동일 Edge 경로의 TypeScript는 MCP 계약 테스트에서 로드됐다. 운영 배포와 실제 ChatGPT 웹・모바일 평가는 미실행이다.

## 진행 기준
최소 기반+수직 슬라이스로 구현하며 기존 금융/판단/메모/운영 규칙을 재사용한다. 신규 범용 CRUD나 이벤트 소싱 엔진을 만들지 않는다. 개인 로컬 설정은 보존한다. 운영 배포는 별도 요청 시 진행하며 실제 ChatGPT 사람 평가를 자동 테스트로 대체하지 않는다.
