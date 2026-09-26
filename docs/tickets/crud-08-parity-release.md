# [CRUD 검증] HTTP·OAuth 계약표와 실제 도구 발견·배포 게이트

2026-09-26 · [#158](https://github.com/kimyongin/fin/issues/158) · 로컬 계약·발견 게이트 구현, 운영 검증 전.

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
- [x] `docs/design/contracts/agent/domain-crud-parity-matrix.md`에 도메인별 양쪽 경로·자동 증거·승인된 시세 예외·미검증 범위를 명시.
- [ ] 일부 주요 시나리오의 discover → MCP write → HTTP read → delete는 자동화했으나 모든 도메인·전체 필드·반대 방향을 망라하지 않음.
- [ ] owner/타인/친구/익명 및 재시도 주요 경계는 자동 테스트에 있으나 모든 동시성·실공급자 실패는 미검증.
- [x] 도구 목록·가이드 참조 검증, 모든 `delete_*`와 reset/remove의 destructiveHint, 미저장 preview의 readOnlyHint 검증.
- [ ] 운영 DB·Edge·웹 및 ChatGPT 웹·모바일 결과를 각각 기록; 접근 불가 항목은 미검증으로 유지.
- [ ] 사용자 확정 예외인 시세·환율은 직접 CRUD 대신 조회·갱신의 양쪽 동작으로 판정.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 로컬 매트릭스·OAuth 발견/호출·배포 준비 검사 연결. 운영 배포 및 실제 ChatGPT 웹·모바일 평가는 아직 미수행.
- `scripts/test-mcp-contract.mjs`가 격리 테스트 사용자로 initialize, tools/list, 목적별 호출, 공유/친구 및 자산/피드백/원칙의 교차 조회를 실행한다. `scripts/check-deployment-readiness.mjs`는 OAuth 주소와 핵심 RPC 및 현재 도구 목록을 점검한다. `portfolio-tools.test.ts`는 annotation과 공유 가이드 참조를 확인한다. 2026-09-27 로컬 재검증: pgtap 696개, Vitest 114개, Chromium E2E 83개 모두 통과. 브라우저 테스트의 RPC 시드/조회는 페이지 이동과 독립된 API 요청으로 실행해 불확실한 금융 쓰기 재시도를 피한다.
- 원격 URL 검사와 ChatGPT 연결 목록 비교는 배포 후 테스트 계정으로 수행한다. 현재 사용 중인 연결이 오래된 것처럼 보이더라도 서버 endpoint·배포 버전을 확인하기 전 캐시로 단정하지 않는다. 운영 파괴 CRUD와 사용자 실데이터 테스트는 하지 않는다.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.
