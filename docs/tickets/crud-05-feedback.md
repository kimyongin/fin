# [CRUD 동등성] 작성자 피드백 수정·삭제와 단건 조회 보완

2026-09-26 · [#155](https://github.com/kimyongin/fin/issues/155) · 로컬 수직 슬라이스 구현·검증.

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
- [x] 제출→웹/MCP 조회·본문 정정·삭제와 단건 탐색. 기존 커서 페이지 유지.
- [x] 소유자 단건/수정/삭제, 타인 차단, 별도 관리자 allowlist 검사.
- [x] 관리자 처리와 본문 정정은 같은 version 검사; 삭제 후 submit 재시도 및 영수증 원문 제거 검증.
- [x] GitHub 외부 상태 변경 없음, 관리자 업무 권한 확대 없음.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 로컬 구현 완료. 운영 배포·실제 ChatGPT 클라이언트 검증 전.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.

## 구현·검증 기록

- `app_get/update/delete_my_product_feedback`는 신고자 소유와 버전을 검사한다. 수정은 본문만 변경하고, 삭제는 내부 관리자 이벤트를 cascade로 없앤다. 연결된 GitHub 이슈는 별개여서 UI·MCP가 삭제 전에 고지한다.
- 제출 영수증은 수정·삭제 시 이전 본문을 제거하고 재사용 키를 봉인한다. 과거 제출 요청을 같은 키로 재시도해도 원문으로 되돌아오거나 삭제 건이 부활하지 않는다. 관리자 allowlist 관리는 추가하지 않았다.
- 웹 카드에서 인라인 본문 수정·삭제 확인을 제공하고 OAuth에는 작성자 CRUD 및 별도 관리자 조회/처리 도구를 제공한다.
- `npm run test:db` 657/657, `npm test` 112/112, `npm run build`, `npx deno check`, `npm run check:encoding` 통과. 격리 E2E의 실제 OAuth 제출→조회→수정→관리자 권한 거부/허용→삭제→재시도 차단, 390px/1280px 웹 등록·관리자 답변·수정·삭제, Chromium 1/1 통과.
- 운영 배포/실제 ChatGPT 웹·모바일은 검증 전이다.
