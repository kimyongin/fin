# 활동 API 계약

상태: #80 최소 계약 확정 · 2026-09-23

## 저장 정본

- `portfolio_tasks`: 앞으로 할 일과 반복 설정의 정본이다.
- `activity_events`: 실제로 한 일과 자동 변경의 정본이다. `title`, `note`, `result`, `conclusion`, `occurred_at`, 선택 `instrument_id`/`account_id`를 현재값으로 가진다.
- 별도 결과 테이블이나 일반 편집 이력 테이블을 만들지 않는다. 같은 활동 편집은 `activity_events.version`과 `updated_at`만 갱신한다.
- `before_data`/`after_data`, 대상 참조와 금융 도메인 테이블은 자동 금융 사실의 정본이다. 일반 활동 편집으로 덮어쓰지 않는다.
- `portfolio_tasks.origin_event_id`는 후속 할 일의 직접 계기 하나만 선택적으로 가리킨다. 기존 `activity_events.task_id`는 그 활동이 수행한 기존 태스크를 가리킨다.

## 편집 허용 범위

| 활동 | 허용 필드 | 보호 필드 |
| --- | --- | --- |
| 수동 활동, 일반 할 일 완료 | 제목, 수행 시각, 메모, 결과, 결론, 종목, 계좌 | 소유자, 원본 태스크 참조, 생성 시각 |
| 자동 금융·도메인 변경 | 메모 | action type, 대상, before/after, 수량·금액, 원본 참조, 발생 시각 |
| 기존 투자 판단 이벤트 | 메모 | 기존 판단 본문·상태·당시 원칙·연결·이력 |

서버 RPC가 허용 목록과 소유권을 검사한다. 클라이언트가 이벤트 JSON 전체를 저장할 수 없다.

## 앱·MCP 공통 RPC

| RPC | 의미 |
| --- | --- |
| `app_create_activity` | 이미 한 활동 한 건을 멱등 저장한다. 결과·결론은 선택이다. |
| `app_get_activity` | 현재 내용, 편집 가능 필드, 수행 태스크, 후속 할 일을 읽는다. |
| `app_update_activity` | expected version으로 같은 활동의 허용된 현재값만 수정한다. |
| `app_create_activity_follow_up` | 활동 하나를 계기로 일반 할 일 하나를 원자적으로 만들고 연결한다. |
| `app_save_general_task` / `app_transition_general_task` | 기존 예정·반복·완료·재개 계약을 유지한다. |

MCP는 저장 유형을 사용자에게 묻지 않는다. 미래 의도는 `save_general_task`, 이미 한 일은 `record_manual_activity`, 기존 할 일 수행은 `transition_general_task`, 현재 활동 수정은 `update_activity`를 사용한다. `record_manual_activity`라는 호환 도구 이름은 유지하지만 사용자 설명은 ‘완료한 활동 기록’으로 제공한다.

## 기존 판단 매핑

`investment_decisions`와 상태 이력, 판단-task/브리핑/보유 이유 연결은 삭제하지 않는다. 기존 `record_investment_decision` 이벤트를 활동 목록에서 보여주되 기존 판단 본문과 상태는 기존 테이블이 정본이다. 신규 일반 결론은 활동의 선택 `conclusion`으로 저장할 수 있다. 기존 ID와 링크를 보존하며 판단-task 연결만으로 두 수행을 병합하지 않는다.

## 충돌·재시도

- 생성과 후속 생성은 idempotency key로 재시도한다.
- 현재 내용 수정은 `expected_version`이 다르면 충돌로 실패하고 다시 읽는다.
- 일반 메모 변경마다 별도 활동이나 revision을 만들지 않는다.
- 공유 조회는 기존 `activity`/`tasks` 기능 권한을 각각 적용하고 공유 사용자는 편집할 수 없다.
