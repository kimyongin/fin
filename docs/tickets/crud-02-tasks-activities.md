# [CRUD 동등성] 할 일 삭제와 활동·태그 원자 편집 통합

2026-09-26 · [#152](https://github.com/kimyongin/fin/issues/152) · 로컬 구현·검증 중.

## 목적
할 일/기록/활동 태그를 양쪽에서 같은 규칙으로 관리한다. 이미 있는 delete_activity를 중복 개발하지 않는다.

## 현재 구현과 재사용
src/features/lifecycle/data.js에는 원자 상세 저장이 있으나 OAuth update_activity/save_general_task의 수정은 태그와 분리된다. 할 일은 완료/재열기/중단만 있고 삭제가 없다.

## 구현 계약
- 목적별 app_delete_general_task와 OAuth 도구, 웹 상세 삭제 행동을 추가한다. 기존 expected_version을 사용한다.
- 연결 기록의 task_id를 원자적으로 null 처리 후 할 일을 제거한다. owner/task 복합 FK에 SET NULL을 무작정 적용해 user_id까지 null이 되는 변경은 금지한다.
- 반복 상태/태그 연결만 정리하고 과거 기록 본문·종목·태그는 보존한다. 중단은 정의 보존, 삭제는 정의 제거, 이번 완료는 회차 처리다.
- 기록/할 일의 필드+태그 수정은 기존 app_save_activity_detail/app_save_general_task_detail로 원자화한다. 태그 미지정=유지, 빈 배열=해제, 잘못된 태그=전체 실패.
- 활동/태그 기존 CRUD는 소유권·검색·페이지·단건 조회를 재검증한다. 삭제 annotation을 올바르게 바꾼다.
- 기록 삭제가 완료/보유값을 되돌리지 않음을 양쪽에 설명한다. 기존 금융/태스크 성공 receipt를 제거하거나 오래된 재시도로 삭제 데이터를 부활시키지 않는다.
- 기존 단일 속성 태그 도구를 유지할지 중복 축소할지는 현재 사용처 기준으로 기록하되 동작을 조용히 변경하지 않는다.

## 수용 조건
- [x] 일반/반복/완료/중단 할 일 삭제, 연결 기록 보존, 삭제 후 due queue 제외 — DB 삭제·FK 회귀, 웹/MCP 동선.
- [x] 기록만 삭제해도 반복 회차 완료가 유지됨 — 기존 삭제 계약·DB 회귀 유지.
- [x] 필드+태그 저장의 rollback, 충돌, 재시도 및 cross-tenant 참조 거부 — 기존 원자 RPC 재사용, 통합 DB/MCP 테스트.
- [x] 기록/할 일/태그 각각 웹↔MCP 교차 CRUD — 공통 목적별 RPC 및 교차 호출.
- [x] workflow guide, 호출 예제와 운영 tools/list 검증 항목 갱신. 실제 운영 tools/list는 배포 후 #158에서 검증.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 로컬 구현·검증 완료. 운영 배포·실제 ChatGPT 클라이언트는 미검증.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.

## 구현 기록 (2026-09-26)

- `app_delete_general_task`는 버전·소유자를 검사하고 과거 기록의 선택적 연결만 해제한다. 반복 상태·태그 연결은 기존 FK로 정리되고, 과거 생성/수정 receipt의 재시도 결과는 삭제됨으로 봉인한다. 같은 삭제 키의 재시도는 성공 결과를 재전달한다.
- 웹 할 일 상세에서 확인창을 거쳐 삭제한다. 미저장 초안은 삭제 시 함께 버려짐을 확인창에 명시한다. 취소하면 그대로 돌아간다.
- OAuth `save_general_task`·`update_activity`에 선택적 `tag_ids`를 추가했다. 미지정은 기존 태그 유지, 빈 배열은 전체 해제, 제공하면 필드와 태그가 기존 목적별 RPC에서 한 트랜잭션으로 저장된다. 기존 독립 태그 도구는 현재 클라이언트 호환을 위해 유지한다.
- 기록 삭제는 기존 계약을 재사용하며 금융/완료 상태를 되돌리지 않는 설명과 삭제 annotation을 확인했다.
- 일반 로컬 DB 627개 DB 테스트, 110개 단위 테스트, Deno 타입 검사, 빌드 및 MCP 계약을 통과했다. 새 웹 삭제 동선은 390px 격리 E2E에서 통과했다. 다른 폭의 새 삭제 동선, 운영 배포와 실제 ChatGPT 클라이언트는 미검증이다.
