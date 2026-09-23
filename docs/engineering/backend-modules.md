# 백엔드 경계와 공통화 기준

2026-09-23 현재 지침. 이전의 7개 모듈 청사진과 폐기된 원장/브리핑 원자 단위는 [설계 이력](../history/backend-modules-before-stability-20260923.md)에 보존한다. 구현 기준은 [단순성 원칙](./SIMPLICITY.md), [ADR-0008](../adr/0008-minimal-portfolio-storage.md), [ADR-0004](../adr/0004-domain-storage-and-minimal-mutation-contract.md) 순으로 확인한다.

## 실제 배치와 책임

- Supabase Postgres와 목적별 `app_*` RPC가 업무 저장·소유권·공유 권한·금융 계산의 원본이다. 적용된 migration을 재작성하지 않는다.
- Edge Functions는 MCP/OAuth·검색 등의 전송과 도구 계약을 담당한다. 인증된 사용자 문맥을 전달하고, 사용자 ID를 인자로 받아 소유권을 우회하지 않는다.
- 웹 `src/features/`는 화면과 목적별 데이터 호출을 둔다. 공통 UI는 기존 `src/components/`를 먼저 사용한다. 브라우저에서 금융 계산의 두 번째 원본을 만들지 않는다.
- 실제 코드 위치와 테스트 명령은 [아키텍처](./architecture.md), [개발 방법](./development.md), [스키마 개요](../../supabase/schema/OVERVIEW.md)에서 확인한다.

## 공통화해야 할 것과 하지 말 것

실제 여러 수직 슬라이스가 공유하는 인증 확인, 안전한 오류 형식, 도구 계약 검사, 요청 무효화와 금융 멱등성 검증만 필요한 위치에 추출한다. `records(type,payload)` 같은 범용 테이블, 실행 명령 엔진, 범용 repository/DI 프레임워크, 모든 도메인에 강제하는 receipt·revision은 만들지 않는다.

한 사용 시나리오에 필요한 DB 변경, 웹/API/MCP 노출, 소유권 검증, 실패·재시도 테스트를 함께 끝낸다. DB 트랜잭션에서 원자적이어야 할 금융 쓰기를 Edge의 여러 RPC 호출로 나누지 않는다. 일반 편집은 목적에 맞게 단순하게 유지하고, 쓰기 결과 유실 후 중복 위험이 있는 경우에만 안정적인 요청 키를 보존한다.

변경 시 DB/RLS·앱·MCP 설명/가이드·E2E 중 실제 소비자를 확인한다. 새 공통 모듈 제안에는 이를 쓰는 첫 수직 슬라이스와 제거할 중복을 명시한다.
