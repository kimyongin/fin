# [CRUD 동등성] 작성자 피드백 수정·삭제와 단건 조회 보완

2026-09-26 · [#155](https://github.com/kimyongin/fin/issues/155) · 설계 완료, 구현 전.

## 목적
잘못 등록한 내 피드백을 웹과 에이전트에서 찾아 정정하거나 삭제한다.

## 현재 구현과 재사용
app_submit_product_feedback/app_list_my_product_feedback와 관리자 전용 triage API가 있다. 작성자 U/D는 없다. 기존 product_feedback.version을 사용한다.

## 구현 계약
- 내 피드백 단건 R, 본문 U, 제출 D를 목적별 owner RPC와 OAuth 및 기존 피드백 UI에 제공한다.
- 작성자 U는 본문만 허용한다. status/response/github_issue_url/admin role은 수정할 수 없다. 관리자 처리 중에도 작성자 권한은 유지하되 version 충돌을 명확히 반환한다.
- D는 앱의 제출 제거이며 GitHub 이슈를 닫거나 삭제하지 않는다. 연결 이슈가 있으면 확인에 이를 알린다.
- 연결된 내부 admin event 및 receipt의 현재 제약을 확인한다. 원문을 감사/receipt에 잔존시키는 무의미한 복제는 지우되, 기존 submit 재시도에 의한 부활은 금지한다. 최소 중복 방지 키/결과만 유지하는 정리 계약을 이 티켓에서 구현 전 확정한다.
- 피드백은 친구/게스트/일일 문맥/CSV에 공유하지 않는다.
- 관리자 상태/답변/이슈 링크 관리는 관리자 역할에 한해 동일 HTTP/OAuth 동작을 제공한다. 일반 사용자 도구 호출에서 서버 역할 검사로 거부한다. 관리자 allowlist CRUD는 포함하지 않는다.

## 수용 조건
- [ ] 제출→웹/MCP 조회·본문 정정·삭제와 마지막 페이지/단건 탐색.
- [ ] 작성자·다른 사용자·친구·관리자의 권한 매트릭스.
- [ ] 관리자 처리와 본문 정정 충돌, 삭제 후 submit 재시도, 민감 본문 잔존 검사.
- [ ] GitHub 외부 상태 변경 없음, 관리자 업무 권한 확대 없음.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 설계·티켓 작성, 구현 전. 로컬 문서는 아직 원격 Git에 없을 수 있다.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.
