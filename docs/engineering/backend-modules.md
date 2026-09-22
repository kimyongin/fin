# 백엔드 공통 모듈과 트랜잭션 경계

2026-09-23: ADR-0008과 SIMPLICITY.md에 따라 원장 재생·도메인별 의무 이력·모든 저장의 receipt 요구를 축소한다. 아래 사례는 이전 구조의 책임 지도이며 신규 구조 유지 근거가 아니다. 소유권·정밀 계산·금융 중복 방지·원자 저장은 유지한다.

2026-09-21 · 설계안. 현재는 Supabase Postgres/RPC와 Deno Edge Functions이며 별도 범용 백엔드 서버를 추가하지 않는다. 아래 _shared 모듈은 제안 위치이며 아직 생성하지 않았다.

## 코드 확인과 목표

### 적용 기준: 공통 데이터 모델이 아닌 공통 변경 규약

[ADR-0004](../adr/0004-domain-storage-and-minimal-mutation-contract.md)를 따른다. 도메인별 테이블·목적별 API를 유지한다. 공통 요청 요소는 operation/key/target/필요한 expected_version/payload이며 owner는 인증에서 얻는다. 모든 항목이 모든 작업의 필수 필드는 아니다. 범용 records(type,payload) 테이블이나 execute-command 엔진을 도입하지 않는다.

공통 절차는 인증·입력 검증 → 동일 요청 성공 확인 → 소유권/필요한 대상 버전 검사 → 도메인 규칙 → 데이터·감사·성공 결과의 DB 원자 저장이다. 읽기에 쓰기 receipt를 만들거나 추가 전용 기록에 수정 충돌 검사를 강제하지 않는다. 소유권 검사는 모든 접근에 유지한다.

아래 7개 모듈은 책임 지도이지 첫 단계에서 만들어야 할 폴더/패키지 목록이 아니다. 기존 helper와 첫 slice가 필요한 만큼만 구현한다. 상태 변경 이력·원칙 이력·당시 snapshot은 목적별로 남기고 일반 head/revision framework는 만들지 않는다.

OAuth MCP index.ts에 도구 정의·응답 포맷·RPC 호출이 함께 있고, 기존 토큰 MCP에도 별도 JSON-RPC/RPC helper가 있다. 두 인증을 하나로 대체하지 않고 업무 의미와 프로토콜의 공통 부분부터 공유한다.

| 제안 모듈 | 책임 | 경계/주요 검증 |
| --- | --- | --- |
| functions/_shared/mcp | registry, tools/list/call, JSON-RPC 및 도구 결과 변환 | 정의·스키마·handler 이름 일치. 알림/프로토콜 오류와 업무 오류 구분 |
| functions/_shared/contracts | 검증된 input/output schemas, DTO, error codes | 프런트엔드 내부 데이터나 DB 전체 행을 그대로 공개하지 않음 |
| functions/_shared/auth | 검증된 OAuth/기존 토큰 context adapter | 인증 user/client/channel 고정. 인자 owner/actor로 가장 금지 |
| functions/_shared/services | 목적별 RPC 호출·응답 투영·외부 호출 조립 | DB 원자 변경을 Edge의 여러 rpc로 쪼개지 않음 |
| functions/_shared/errors | validation/conflict/auth/transient 오류 분류 | SQL·토큰·민감 본문 제거. 무차별 retry 금지 |
| functions/_shared/observability | request ID, operation, code, duration, 제한된 지표 | 전체 요청/문맥 증명/개인 분석/인증정보 로그 금지 |
| functions/_shared/http | 허용 origin/method, body 크기, timeout/응답 helper | CORS는 인증이 아님. endpoint별 transport 차이 유지 |

인증/HTTP/MCP adapter → 검증된 계약 → 업무 service → DB RPC 방향이다. 하위 공통 모듈이 특정 endpoint index.ts를 import하지 않는다. 프런트엔드 src에서 Deno 서버 코드를 import하지 않는다. 타입/스키마 공유가 필요하면 비밀/런타임 의존 없는 계약 산출물만 제공한다.

## 업무 원본은 DB transaction

- 소유권·기능 공유 권한·복합 참조·expected_version·idempotency·원가 계산·audit를 업무 RPC 한 transaction에서 검사/저장한다. SQL 내부 helper는 private 경계 및 명시적 EXECUTE 권한으로 제한한다.
- 앱과 OAuth/기존 토큰 MCP는 동일한 업무 규칙에 도달해야 한다. app_* 직접 호출에서도 권한과 스키마 검증을 우회할 수 없어야 한다. Edge에서만 검사하는 것으로 끝내지 않는다.
- 브리핑+근거+질문 변경, 체결+잔고+계획 진행도, 결정+후속 할 일은 각각 하나의 원자 단위다. 외부 네트워크 호출은 DB lock/transaction 밖에서 수행한다.
- 성공 receipt와 업무 변경은 함께 commit한다. timeout 후 같은 key 재시도; 입력 변경/버전 충돌은 재조회. 메모리 cache만으로 중복 방지를 구현하지 않는다.
- 인증 adapter가 service role로 소유권 검사를 생략하는 설계를 하지 않는다. 기존 토큰 RPC의 인증 전달 방식은 실제 구현을 유지·검증하며 인자 user_id를 신뢰하는 우회 함수를 만들지 않는다.
- 숫자 계산은 PostgreSQL numeric와 #32 계약이 원본. Edge/React의 Number로 두 번째 원가 엔진을 만들지 않는다. 표시용 변환과 저장 계산을 분리한다.

## 안정성 계약

모든 handler는 입력 크기/배열 상한, 필수필드/unknown 필드, 인증, 소유권, 응답 DTO를 검증한다. 외부 fetch는 timeout·응답 크기 제한을 두고 임의 기사 URL을 서버가 자동 가져오지 않는다. 재시도는 일시 장애의 읽기 또는 멱등성이 보장된 쓰기만 제한 횟수로 수행한다.

RLS/보안 RPC의 고정 search_path·명시적 grant·복합 FK를 검사한다. 공유 allowlist는 UI가 아닌 서버에서 처리한다. 사용자/기능 권한이 다른 응답을 같은 캐시에 섞지 않는다. 인증 철회와 다음 요청 차단의 의미를 보존한다.

클라이언트 오류 응답에는 추적 ID와 안전한 code/message만 제공한다. 운영 진단은 성공률/충돌/실패코드/지연으로 먼저 수행하고 실제 기록 내용 로깅에 의존하지 않는다. 구체적인 timeout·payload·보존기간은 대표 데이터 측정 후 계약에 고정한다.

## 구현 순서와 담당

1. #33: 기존 응답·프로토콜의 characterization tests 후 registry/error/adapter 최소 추출. OAuth 실험을 덮어쓰지 않는다.
2. #35-A/#43: DB transaction/권한/버전 기반. 서비스 공통화가 RLS 검증을 대체하지 않음.
3. #34/#35-B: 첫 점검 조회→저장에 공통 DTO/errors를 적용하고 실제 두 소비자에서 검증.
4. #37/#38: 정밀 원장/preview/commit을 같은 서버 원본으로 통합. 기존 트리거 전환은 별도 이관 테스트.

범용 repository/DI framework/워크플로 엔진/플러그인 로더를 먼저 만들지 않는다. 두 endpoint의 실제 중복과 첫 수직 기능에 필요한 공통성만 추출한다. 문서 설계 완료와 코드/운영 검증 완료는 별개다.

인수: adapter별 인증 실패·타인 접근·누락/초과 입력·schema/handler 불일치·동시 CAS·응답 유실·부분 실패 rollback·안전한 오류 노출을 검증한다. Edge 독립 타입 검사와 SQL/RLS 테스트, 실제 MCP 호환성을 각각 기록한다.
