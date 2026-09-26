# 코드 구조와 책임

2026-09-23 · 현재 구조 설명 + 새 코드 배치 원칙. 대규모 폴더 이동을 요구하지 않는다. 저장 모델은 ADR-0008과 [현재 인계](../design/storage-release-readiness-20260923.md)를 따른다.

컴포넌트 상세: [React 공통 UI](../design/component-system.md). 서버 책임과 공통화 기준: [backend-modules](./backend-modules.md). 문서에 언급된 공통화가 모두 별도 라이브러리로 구현됐다는 뜻은 아니다.

## 현재 코드 지도

| 경로 | 현재 역할 / 새 코드 배치 기준 |
| --- | --- |
| src/main.jsx, App.jsx | 앱 진입과 인증/화면/기능 조립. 신규 업무 규칙을 계속 App.jsx에 집중시키지 않음 |
| src/features/assets | 자산 보기와 표 편집. 기존 입력 흐름 유지 |
| src/features/portfolio | 자산 CRUD·시세 동기화 actions/hooks와 파생 계산. 공유·게스트 접근 액션은 auth 기능에 둔다. |
| src/features/strategy, activity, review, lifecycle | 원칙/전략, 통합 활동·할 일, 요청형 점검 화면과 기능별 데이터 처리. 전략 표시 계산은 strategy/calculations.js에서 독립 테스트한다. 별도 자료 화면은 퇴역 |
| src/features/auth, agent, settings | 로그인/동의, 앱의 에이전트 토큰 관리, 설정. agent 폴더는 MCP 서버 구현 위치가 아님 |
| src/components | 여러 기능이 재사용하는 표현 컴포넌트 |
| src/lib, constants | Supabase 연결/설정, 포맷, 계산 등 공통 유틸리티와 상수 |
| supabase/functions/portfolio-mcp-oauth, _shared/mcp | OAuth MCP 진입점과 실제 도구 schema/description/guide 정의. 새 기능의 기준 endpoint |
| supabase/functions/portfolio-mcp | 기존 토큰 MCP. 새 토큰 발급은 제거했고, 과거 운영 토큰의 사용 여부를 확인할 때까지 호환 유지 |
| supabase/functions/sync-prices, lookup-ticker | 외부 시세·종목 조회 |
| supabase/migrations | 적용 DB 이력. 과거 파일을 바꾸는 대신 incremental migration |
| supabase/schema/OVERVIEW.md | DB 탐색 시작점. 실제 DDL의 대체물이 아님 |

## 의존성과 저장 책임

- 화면은 사용자 의도/입력/표시를 담당한다. 기능의 data 계층이 RPC/응답 오류를 다루고 actions/hooks가 상태 흐름을 조립한다. 현재 모든 파일이 완벽히 이 규칙으로 분리됐다는 뜻은 아니다.
- 공통 components/lib가 특정 기능 화면을 역으로 import하지 않도록 한다. 한 기능에서만 쓰는 유틸은 우선 그 기능에 둔다. 공통화만을 위한 범용 프레임워크를 만들지 않는다.
- 최종 원가/잔고, 소유권, 상태 전이, CAS, idempotency, 원자성은 서버 책임이다. 프런트엔드 계산은 표시/미리보기이며 저장 원본을 확정하지 않는다.
- 앱과 MCP는 같은 업무 저장 서비스를 사용한다. 인증 adapter의 차이 때문에 계산/권한 검증을 복제하거나 우회하지 않는다.
- 오늘/활동/원칙/자산의 새 흐름은 관련 features 하위에 배치하고 기존 자산을 전면 재작성하지 않는다. 금융 계산·권한·원자성은 목적별 DB RPC에, MCP 공개 계약은 `_shared/mcp/portfolio-tools.ts`에 둔다.

## 시나리오·API 문서·코드 관계

사용자 시나리오 원본은 `docs/design/contracts/scenario-api-model-matrix.md`의 S ID를 참고하되, 저장 축소와 충돌하는 과거 API 계약은 ADR-0008 및 `docs/design/storage-contract-20260923.md`가 대체한다. 에이전트 사용 흐름은 agent/workflows의 W ID를 참조한다.

실제 OAuth MCP의 description/schema/annotations 원본은 `supabase/functions/_shared/mcp/portfolio-tools.ts`, 핸들러는 `portfolio-mcp-oauth/index.ts`다. `docs/design/contracts/agent/tool-descriptions.md`는 제품 의도 검토 카탈로그이며 런타임 계약이 아니다. 작업 가이드는 `_shared/mcp/workflow-guides.ts`와 review manifest로 함께 검사한다. 함수 주석에 시나리오 전문을 복사하지 않고 S/W ID와 필요한 설계 링크를 남긴다.

개발 에이전트 지침(AGENTS/engineering)은 코드를 고치는 규칙, 제품 에이전트 지침(design/contracts/agent)은 Portfolio 도구를 사용하는 규칙이다. 서로 런타임 지침으로 혼합하지 않는다.
