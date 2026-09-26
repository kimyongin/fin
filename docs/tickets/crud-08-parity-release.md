# [CRUD 검증] HTTP·OAuth 계약표와 실제 도구 발견·배포 게이트

2026-09-26 · [#158](https://github.com/kimyongin/fin/issues/158) · 설계 완료, 구현 전.

## 목적
“함수는 있는데 에이전트는 못 찾는다”와 인터페이스 한쪽 누락이 재발하지 않도록 실제 호출로 완료를 판정한다.

## 현재 근거
OAuth 코드에는 delete_activity가 있지만 이 세션의 연결 카탈로그에는 퇴역 도구가 남고 현재 도구가 빠져 있다. 캐시 문제인지 endpoint/배포 문제인지 확인 전 단정하지 않는다.

## 구현 계약
- CRUD-01의 첫 소비 테스트와 함께 작고 명시적인 도메인/작업→HTTP RPC/Edge→OAuth tool→테스트 매핑을 만든다. 범용 API 생성기나 새 레지스트리 엔진은 만들지 않는다.
- CRUD-01~07의 각 slice 완료마다 행을 채운다. 도구 정의/schema/handler, 필요한 DB 함수 시그니처, workflow guide의 참조를 기존 검사에 연결한다.
- annotation 전수 검사: 삭제 destructiveHint=true, 실제 readOnly/idempotent/openWorld 의미 일치. 클라이언트 확인만으로 서버 권한을 대체하지 않는다.
- 실제 배포 URL의 OAuth initialize/tools/list와 도구 실행 결과를 현재 코드 및 연결된 클라이언트 목록과 비교한다. 잘못된 endpoint, 미배포, 클라이언트 갱신 문제를 분리하고 정확한 사용자 재연결 안내를 남긴다.
- 로컬 테스트 사용자로 양방향 CRUD·권한·참조·재시도를 검증한다. 실 ChatGPT 웹/모바일에는 테스트 계정/데이터만 사용한다.
- DB migration → Edge → 웹의 호환 순서, 백업/복구 및 부분 배포 검증을 기록한다. 운영 파괴 테스트/실제 데이터 삭제는 범위 밖이다.
- 과거 #58/#63~65/#67 및 기능 티켓의 실클라이언트 미검증을 새 코드 완료로 닫지 않는다. 겹치는 검증 근거는 링크로 연결하고 별도 남은 요구를 보존한다.

## 수용 조건
- [ ] 매트릭스의 모든 사용자 데이터가 양쪽 작업/증거 또는 명시적 승인 예외에 연결.
- [ ] 도구별 discover → read → write → 반대 인터페이스 read → delete → 미존재 확인.
- [ ] owner/타인/친구/익명 권한, 실패/동시성/재시도 자동 테스트.
- [ ] 폐기 도구를 안내하지 않는 schema/description/workflow guide.
- [ ] 운영 DB·Edge·웹 및 ChatGPT 웹·모바일 결과를 각각 기록; 접근 불가 항목은 미검증으로 유지.
- [ ] 사용자 확정 예외인 시세·환율은 직접 CRUD 대신 조회·갱신의 양쪽 동작으로 판정.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 설계·티켓 작성, 구현 전. 로컬 문서는 아직 원격 Git에 없을 수 있다.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.
