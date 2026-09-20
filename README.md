# Portfolio

여러 계좌의 자산·투자 기준을 관리하고 점검·판단·실행을 이어가는 앱이다. ChatGPT는 조사·해석·설명, Portfolio는 기억·계산·검증을 담당한다. MCP-first 신규 기능은 설계/개발 중이며 문서에 있는 모든 API가 구현된 것은 아니다.

## 시작점

- 개발 시작/세션 복구: [AGENTS.md](./AGENTS.md) → [START-HERE](./docs/START-HERE.md)
- 코드 위치와 책임: [architecture](./docs/engineering/architecture.md)
- 환경 설정·검증·배포 주의: [development](./docs/engineering/development.md)
- 제품 목적: [PRD](./docs/prd/portfolio.md), 결정 근거: [ADR](./docs/adr/0001-mcp-first-product-boundaries.md)
- 설계 문서 지도: [design](./docs/design/README.md), 작업: [현재 티켓](./docs/tickets/README.md)

## 로컬 화면 실행

CI와 같은 Node.js 22 환경을 기준으로 `npm ci`를 실행한다. 저장소 루트의 git 제외 파일 `.env.local`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 설정한다. 서비스 역할 키/개인 토큰은 VITE 변수에 넣지 않는다. VITE 변수는 브라우저에 공개된다.

연결 대상이 로컬/개발용인지 먼저 확인하고 `npm run dev`로 실행한다. 로컬 프런트엔드라도 원격 URL을 넣으면 원격 데이터가 변경된다. Docker는 로컬 Supabase/E2E 사용 시 필요하며 Vite만 실행하는 데 필수는 아니다.

`npm run test:db`는 현재 **연결된 원격 DB**를 대상으로 한다. `supabase db reset`은 데이터 초기화 명령이며 일반 실행 절차가 아니다. 자세한 안전 절차는 development 문서를 따른다.

## 폴더 요약

| 경로 | 책임 |
| --- | --- |
| src/features, components, lib | 기능 UI/상태/데이터 접근, 공통 UI, 유틸리티 |
| supabase/functions | MCP와 시세 등 Edge Function |
| supabase/migrations, schema, tests | DB 변경 이력, 구조 안내, DB 테스트 |
| e2e, .e2e | 브라우저 테스트 코드와 독립 테스트 DB 환경 |
| docs/prd, adr, tickets, design, engineering | 제품, 결정, 작업, 설계, 개발 방법 |
| tickets | 과거 작업 문서. 현재 작업 명세가 아님 |
| scripts, .github/workflows | 개발 보조 실행기, CI/배포 |

node_modules/dist/test-results는 의존성·생성 산출물이며 편집 원본이 아니다. 비밀 환경변수와 로컬 설정을 커밋하지 않는다.
