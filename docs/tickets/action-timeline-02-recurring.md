# [행동 통합] 매일 반복 태스크와 회차별 완료
상태: 구현 완료・운영 미배포 · 2026-09-22
GitHub: https://github.com/kimyongin/fin/issues/76
선행: 01 (action-timeline 시리즈)
기준: [공통 설계](../design/tasks-and-events.md), [ADR-0006](../adr/0006-tasks-and-action-events.md).
기존 대상: portfolio_tasks/portfolio_task_history/activity_events, task UI와 MCP.

## 목적과 범위
A04. 일반 할 일을 매일 반복으로 설정하고 해당 날짜의 유효 완료 이벤트로 당일 완료를 판단한다.

## 인수 조건
- [x] 회차 키·시간대·시작일·완료일/저장일 계약
- [x] 동일 회차 동시 완료와 재시도 유일성
- [x] 어제 회차 지연 입력/완료 취소 후 재완료
- [x] 일시정지/종료/일정 변경 적용일 보존
- [x] 오늘 완료 후 내일 회차 재등장
- [x] 과거 미실행 행 무한 생성 금지
- [x] 앱 설정/완료와 MCP 저장/재조회 E2E. 주간/월간 반복과 금융 실행 반복은 후속
- [x] 정확한 API signature/오류/권한/날짜 의미와 필요한 최소 모델 계약을 구현 전에 설계 문서에 기록한다.
- [x] 실제 DB→RPC/OAuth→앱 시나리오 검증과 미검증 범위를 기록한다. 문서/가이드 변경 영향과 encoding check를 포함한다.

## 구현 계약과 결과
- `portfolio_tasks.recurrence_kind`는 `none|daily`, `recurrence_start_on`은 첫 유효 현지 날짜다. 시간대는 기존 task `timezone`을 사용하고, 이 값들의 변경 이력은 `portfolio_task_history.content_snapshot`에 남는다.
- 회차 키는 daily일 때 `(task_id, occurrence_on)`, 일회성일 때 task 전체다. `occurrence_on`은 사용자 시간대의 대상 날짜, `occurred_at`은 실제 저장/수행 시각이다. 미래 회차와 시작일 이전 회차 완료는 거부한다.
- 완료/재개 이벤트가 원본 이력이며 `general_task_occurrence_states`는 같은 트랜잭션에서 갱신하는 현재 상태 projection이다. 완료/재개가 있었던 날짜만 행이 생기므로 미실행 과거・미래 날짜를 생성하지 않는다. task 행도 한 개만 유지한다.
- 동일 task 행 잠금, 기대 버전, 회차 projection PK, 멱등 receipt가 중복 완료와 재시도를 막는다. 재개 후 재완료는 이전 이벤트를 지우지 않는다. 일시정지/재개는 회차 완료를 바꾸지 않는다.
- 기존 `save_general_task` MCP에 `recurrence_kind`, `recurrence_start_on`을 추가했다. 앱 할 일 추가 모달에서 ‘매일 반복’과 시작일을 선택하며 목록은 ‘오늘 회차’를 명시하고 해당 날짜를 완료한다.
- 검증: 반복 전용 pgTAP 18건을 포함한 DB 425건, MCP 도구 계약, Vitest 102건, 프로덕션 빌드, Playwright 33건 통과. 로컬 PostgreSQL에서 이벤트 재스캔 helper가 세그멘테이션 폴트를 일으켜 현재 상태 projection으로 대체했고 전체 재검증했다. 운영 배포와 실제 ChatGPT 웹・모바일 평가는 미실행이다.

## 진행 기준
최소 기반+수직 슬라이스로 구현하며 기존 금융/판단/메모/운영 규칙을 재사용한다. 신규 범용 CRUD나 이벤트 소싱 엔진을 만들지 않는다. 개인 로컬 설정은 보존한다. 운영 배포는 별도 요청 시 진행하며 실제 ChatGPT 사람 평가를 자동 테스트로 대체하지 않는다.
