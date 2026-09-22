# [행동 통합] 자동 행동 기록 보완과 일반 태스크 전환
상태: 기획 확정・구현 전 · 2026-09-22
GitHub: https://github.com/kimyongin/fin/issues/75
선행: 없음 (action-timeline 시리즈)
기준: [공통 설계](../design/tasks-and-events.md), [ADR-0006](../adr/0006-tasks-and-action-events.md).
기존 대상: 기존 portfolio_tasks/activity_events 및 mutation RPC, LifecyclePage, MCP 목적별 도구.

## 목적과 범위
A01~A03. 기존 메모 수정의 자동 기록을 기준으로 일반 태스크 생성/완료와 수동 활동 기록까지 DB→MCP→최소 UI로 연결한다. 완료 ToDo 중복 생성을 없앤다.

## 인수 조건
- [ ] 변경 API 전수 목록과 자동 이벤트 유무를 작성
- [ ] verify/execution 전이/체결 연결 및 프런트 후행 로그 누락 보완
- [ ] 일반 task와 task_id 연결 이벤트의 최소 DDL/RPC 계약 확정
- [ ] 변경·이벤트 원자성/멱등성/무변경 처리
- [ ] 수동 이벤트는 출처 구별 및 금융 사실 위조 금지
- [ ] 새 이벤트의 개인정보 공유 허용 목록
- [ ] 완료/재개 이력과 단일 표시 fixture
- [ ] 정확한 API signature/오류/권한/날짜 의미와 필요한 최소 모델 계약을 구현 전에 설계 문서에 기록한다.
- [ ] 실제 DB→RPC/OAuth→앱 시나리오 검증과 미검증 범위를 기록한다. 문서/가이드 변경 영향과 encoding check를 포함한다.

## 진행 기준
최소 기반+수직 슬라이스로 구현하며 기존 금융/판단/메모/운영 규칙을 재사용한다. 신규 범용 CRUD나 이벤트 소싱 엔진을 만들지 않는다. 개인 로컬 설정은 보존한다. 운영 배포는 별도 요청 시 진행하며 실제 ChatGPT 사람 평가를 자동 테스트로 대체하지 않는다.
