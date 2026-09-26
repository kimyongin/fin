# [CRUD 동등성] 시세·환율 조회와 가격 갱신 기능을 OAuth에 제공

2026-09-26 · [#157](https://github.com/kimyongin/fin/issues/157) · 로컬 수직 슬라이스 구현·검증.

## 목적
시세·환율을 전수 검토에서 빠뜨리지 않고, 웹에서 가능한 가격 갱신을 OAuth에서도 실행한다.

## 현재 구현과 확정 정책
holding_prices_daily, sync-prices, app_get_price_sync_targets/app_upsert_price_rows가 웹 갱신 경로다. OAuth는 읽기만 제공한다.
#139 및 현재 PRD는 사용자의 직접 현재가 입력을 명시적으로 금지했다. 2026-09-26 사용자가 이 정책 유지를 재확정했다. MCP에서도 웹과 같은 가격 갱신 기능을 호출한다.

## 직접 CRUD 제외
- 시세·환율은 사용자가 관리하는 자유 입력 데이터가 아니라 공급자 데이터다. 양쪽에 조회와 가격 갱신만 제공한다.
- 자산 상세는 읽기 전용을 유지한다. 별도 수동 시세 관리 화면/쓰기/삭제 도구를 만들지 않는다.
- 에이전트가 추정한 가격·환율을 넣거나 우회적인 app_upsert_price_rows 노출로 직접 편집하게 하지 않는다. 저장은 기존 가격 갱신 내부에서만 처리한다.

## 즉시 구현 가능한 범위
- OAuth sync_prices 목적별 도구가 웹과 동일 인증/대상/저장 규칙을 사용한다.
- 등록된 0보유 market 및 필요한 외화 환율, 평가형/현금성 제외 정책을 유지한다.
- 읽기에 통화/환율 방향/기준일/출처·누락/오래됨을 제공하며 부분 실패를 전체 성공처럼 표현하지 않는다.
- 소유자 격리와 sync_runs 운영 로그를 유지한다. 별도 가격 ledger/버전 엔진은 만들지 않는다.

## 수용 조건
- [x] 직접 CRUD 금지와 동일 갱신 호출 정책을 schema/description/가이드에 반영.
- [x] 웹과 OAuth가 같은 `sync-prices` Edge 경로를 실행하며 대상별 성공/실패·부분 실패를 그대로 반환.
- [x] 환율 누락과 비시장 자산의 품질 경고 DB 회귀.
- [x] OAuth는 임의 가격/날짜/환율 입력을 받지 않으며, 기존 직접 가격 RPC·토큰 가격 upsert·종목 저장의 수동 가격 우회를 차단.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 로컬 구현 완료. 운영 배포·실제 ChatGPT 클라이언트 및 외부 공급자 장애 주입 검증 전.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.

## 구현·검증 기록

- OAuth `sync_prices`는 사용자의 명시적 요청에 웹과 동일한 `sync-prices` 함수를 호출한다. 입력은 `schema_version`뿐이다. `get_portfolio_state`가 최신 시세의 출처·기준일, 통화와 평가 품질을 읽으며 도구 설명에 FX 방향을 명시했다.
- Edge는 인증된 사용자로 적격 대상만 읽고, 검증된 사용자 ID를 가진 서버 전용 클라이언트로 공급자 행과 실행 결과를 쓴다. 일반 authenticated와 예전 토큰의 가격 upsert 실행 권한을 회수하고, `app_save_instrument`의 수동 가격 입력을 거부한다. 예전 토큰 MCP는 더 이상 작동하지 않는 가격 동기화 도구를 광고하지 않는다.
- `npm run test:db` 660/660, `npm test` 112/112, `npm run build`, `npx deno check`, `npm run check:encoding` 통과. 격리 E2E에서도 DB 가격 계약, OAuth 도구 발견·무대상 갱신 실행, Chromium 1/1이 통과했다. 첫 격리 실패는 차단 RPC의 권한 오류를 pgTAP에서 직접 실행한 테스트 방식이 DB 연결을 끊은 것이었고, 권한 검사로 바꿔 재검증했다.
- 실제 Yahoo 공급자의 부분 실패 주입, 등록 market/FX의 새 시세 반영, 운영 배포·ChatGPT 클라이언트는 아직 검증하지 않았다. 실패를 성공으로 보고하지 않도록 반환된 `status`, `failed`, `run_error`를 유지한다.
