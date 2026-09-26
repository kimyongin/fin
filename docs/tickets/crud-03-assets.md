# [CRUD 동등성] 계좌·종목·보유의 OAuth 관리 경로 완성

2026-09-26 · [#153](https://github.com/kimyongin/fin/issues/153) · 첫 수직 슬라이스 로컬 검증, 추가 경계 검증 전.

## 목적
에이전트도 웹처럼 계좌와 종목을 만들고 계좌별 현재 보유값을 수정/삭제한다. 토큰 MCP의 존재를 OAuth 지원으로 간주하지 않는다.

## 현재 구현과 재사용
accountActions.js, instrumentActions.js, AssetDetailModal.jsx와 app_create_instrument/app_save_asset_detail_current/app_delete_*를 기준으로 한다. OAuth는 조회·메모·매매/보정만 제공한다.

## 구현 계약
- 계좌 C/R/U/D, 종목 market/valuation/cash C/R/U/D, 계좌별 보유 C/R/U/D 및 태그/메모 필드를 목적별 OAuth로 제공한다. 공유 중인 타인 데이터는 R만.
- 종목 등록은 보유·시세를 만들지 않는다. lookup은 읽기 전용, 등록은 별도 명시적 작업이다. 0보유 종목도 식별/검색/조회한다.
- 현재 상세 저장 규칙을 양쪽에서 재사용하며 메모, 대표 태그, 복수 계좌 현재값을 원자 저장한다. 구 token save_*를 검증 없이 래핑하지 않는다.
- 금융 현재값 쓰기는 numeric 정밀도, 기존 상태 버전·필요한 idempotency·저장 사유·자동 기록을 보존한다. 오래된 상세/표 편집과 동시 매매를 검증한다.
- 계좌/종목 삭제는 보유가 있으면 차단한다. 보유 0도 행 존재와 구분한다. 종목 삭제의 시세/태그 정리와 활동 참조 해제를 검증하고 과거 기록은 보존한다.
- 계좌/종목/보유 직접 HTTP 경로도 누락 필드와 우회 쓰기를 감사한다. 목록 포함 R만으로 단건 검색/페이지 누락을 방치하지 않는다.
- 수동 현재가 입력은 복원하지 않는다. 시세 범위는 CRUD-07이 담당한다.

## 수용 조건
- [ ] 세 자산 유형, 복수 계좌, 0보유, 대표 태그 없음/변경의 양방향 CRUD.
- [ ] 소유권, 잘못된 참조, 중복 종목, 삭제 차단과 성공, 자동 기록 수.
- [ ] 저장 응답 유실 재시도가 잔고를 중복 변경하지 않음.
- [ ] 웹 저장 결과를 OAuth 재조회하고 반대 방향도 일치.
- [ ] 구 token 신규 발급 없이 OAuth만으로 시나리오 완료.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 웹과 OAuth MCP의 핵심 계좌·종목·보유 경로 연결 및 로컬 검증. 아래 남은 경계 검증 전.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.

## 구현·검증 기록 (2026-09-26)

- OAuth에 `save_account`, `delete_account`, `create_instrument`, `save_asset_detail`, `delete_holding`, `delete_instrument`를 공개했다. 자산 가이드를 추가했다. 등록/조회/삭제와 원자 상세 저장은 기존 웹 RPC를 공유한다. `save_asset_detail`은 수동 시세 필드를 거부한다.
- 보유 삭제에 `app_delete_holding_checked`를 추가하고 웹도 사용한다. 현재 state_version 검사, 동일 키 재시도, 소유자 경계를 DB에서 검증했다. 실제 금융값 변경은 기존 `app_save_asset_detail_current`의 원자 저장·receipt를 사용한다.
- OAuth 계약 테스트에서 계좌·종목 생성 → 시장형 계좌 보유 생성/재시도 → 보유 삭제/재시도 → 종목·계좌 삭제를 통과했다. DB 전체 635개, 단위 110개, 웹 빌드, Deno 타입 검사 및 격리 브라우저 스모크를 통과했다.
- `20260926163000_asset_write_rpc_boundary.sql`에서 계좌·보유·종목·자산 태그의 authenticated 직접 DML 권한을 회수했다. 읽기는 RLS 아래 유지하고 기존 목적별 SECURITY DEFINER RPC 쓰기는 유지한다. `asset_write_boundary_test.sql`은 테이블 4개의 직접 C/U/D 거부와 R 허용을 검사한다. 기존 수동 시세 저장은 #157에서 이미 차단했다.
- 격리 OAuth 계약을 평가형·현금성 및 2개 계좌의 생성→원자 보유 저장→HTTP 조회→개별 보유/종목/계좌 삭제까지 확장했다. 기존 시장형 동일 키 재시도, 자산 태그/목표 설정·초기화, 웹 자산 상세의 반응형 화면 테스트도 함께 실행한다.
- 2026-09-27 전체 격리 재검증: pgtap 696개, Vitest 114개, Chromium E2E 83개 통과. 보유 삭제 화면은 확인 모달 종료 뒤 결과를 조회하도록 검증했다. 웹 상세 모달과 자산 필터의 360/390/768/1024/1440px 화면 테스트를 포함한다.
- 남음: 전체 필드에 걸친 웹→OAuth 반대 방향 교차, 대규모 목록의 대상별 단건/페이지 조회 효율, 실제 모바일 기기 삭제 확인. 운영 배포/실 ChatGPT는 #158에서 확인한다.
