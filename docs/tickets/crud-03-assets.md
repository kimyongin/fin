# [CRUD 동등성] 계좌·종목·보유의 OAuth 관리 경로 완성

2026-09-26 · [#153](https://github.com/kimyongin/fin/issues/153) · 설계 완료, 구현 전.

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
- 상태: 설계·티켓 작성, 구현 전. 로컬 문서는 아직 원격 Git에 없을 수 있다.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.
