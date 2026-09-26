# [CRUD 동등성] 자산 태그 관리와 목표 배분 초기화 제공

2026-09-26 · [#154](https://github.com/kimyongin/fin/issues/154) · 로컬 수직 슬라이스 구현·검증.

## 목적
에이전트에서 태그 사전을 관리하고 목표 배분을 설정·수정·지울 수 있게 한다.

## 현재 구현과 재사용
웹 app_save_tag/app_delete_tag와 app_save_allocation_targets를 재사용한다. OAuth는 배분 조회만 있고, 기존 목표 저장은 빈 배열을 거부한다.

## 구현 계약
- 자산 태그 사전 CRUD, 종목 태그 연결/해제의 웹/OAuth 동등성을 제공한다. 활동 태그와 사전/선택 개수를 합치지 않는다.
- 목표는 전체 집합으로 C/R/U/D한다. 부분 row 삭제로 합계 불일치를 만들지 않는다.
- 비어 있지 않은 목표는 합계 100.00 및 owned tag/중복 ID 검증. D는 명시적 목표 전체 초기화이며 미설정 상태를 반환한다.
- 기존 expected_targets 비교를 초기화에도 적용한다. 같은 목표/빈 상태 재저장은 no-op.
- 양수 목표 태그 삭제는 차단하고 해당 목표 수정/전체 초기화 동선을 안내한다. 0 목표 연결 정리, 종목 태그 해제는 원자적으로 처리한다.
- 초기화가 태그·종목·현재 평가액을 삭제하거나 임의 비중을 생성하지 않는다.
- 기존 배분 화면의 직접 편집/관리 모달을 유지하며 새 범용 설정 화면을 만들지 않는다.

## 수용 조건
- [x] 기존 웹 태그 관리/종목 연결과 새 OAuth 태그 CRUD, OAuth 목표 저장·초기화 교차 계약.
- [x] 양수 목표 태그 삭제 차단, 저장 실패와 초기화 CAS, 목표 100% 검증은 기존 RPC 재사용.
- [x] 미설정과 0% 목표 구분; 초기화는 자산 태그와 종목을 보존.
- [x] 공개 MCP 설명·가이드와 웹 UI가 같은 초기화 의미를 전달.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 로컬 구현 완료. 운영 배포·실제 ChatGPT 클라이언트 검증 전.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.

## 구현·검증 기록

- `app_clear_allocation_targets`는 소유자의 전체 목표만 expected set으로 비교하고 원자적으로 지운다. 이미 비어 있으면 no-op이다. 웹은 단일 확인 대화상자를 거쳐 호출하고, OAuth `save_allocation_targets`는 빈 `targets`로 같은 RPC를 호출한다. 태그 관리 RPC는 웹과 OAuth가 공유한다.
- `npm run test:db`: 644/644, `npm test`: 111/111, `npm run build`, `npm run check:workflow-guides`, `npm run check:encoding` 통과.
- 격리 `npm run test:e2e -- e2e/app.spec.js --grep "loads the owner portfolio"`: DB 644/644, 실제 OAuth MCP 태그 생성→목표 저장→태그 삭제 차단→목표 초기화→태그 삭제, 배포 준비 검사, Chromium 스모크 1/1 통과.
- `npm run check:edge`는 이 호스트의 PATH에 `deno`가 없어 실행 불가. 실제 배분 화면의 모바일/데스크톱 상호작용, 태그 삭제 동시성 및 재설정 전체 경로는 추가 검증이 필요하다. GitHub 이슈는 운영 검증까지 열어둔다.
