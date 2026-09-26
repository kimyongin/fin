# 개발·검증·배포 방법

현재 설계/리뷰는 [단순성 원칙](./SIMPLICITY.md)과 ADR-0008이 우선한다. 일반 편집에 의무 이력·변경 사유를 요구하지 않는다. 각 슬라이스는 축소할 기능과 구 테이블/API 종료 조건을 명시한다. 아래 과거 첫 슬라이스 순서는 현재 티켓 목록으로 대체한다.

2026-09-21 · 현재 명령/CI 기준. 이 문서 작성으로 테스트나 배포를 수행한 것은 아니다.

## 작업 순서

### 모델과 작업 단계 — 사용자 지정 규칙 (2026-09-24)

| 담당 모델 | 작업 범위 |
| --- | --- |
| GPT-6 Astra | 요구사항 정리, 기획·설계, 설계/구현 결과의 독립 검토, PRD·ADR·가이드·티켓 작성과 보완 |
| GPT-6 Sol | 확정 티켓의 코드 구현·버그 수정·리팩토링, 테스트 작성·실행, 구현에 따른 문서/MCP 설명 갱신과 완료 기록 |

- 설계 단계에서는 문서와 티켓, API/데이터 계약 설명, 검증 조건을 작성한다. 앱 코드·실행 스크립트·migration·테스트 코드·동작을 바꾸는 설정 파일을 수정하지 않는다. 문서 안의 설명용 예시와 의사 코드는 허용한다.
- 구현 단계에서는 Sol이 기존 계약 안의 함수 배치·명명 등 일상적인 구현 판단과 자체 검증을 수행한다. 제품 동작·권한·저장/API 계약을 새로 결정하거나 설계를 크게 바꿔야 하면 쟁점과 대안을 티켓에 남겨 Astra 설계 단계로 인계한다. 확정 계약의 구현 결과를 문서에 반영하는 일마다 모델을 바꾸지는 않는다.
- 작업 시작 시 단계와 모델을 확인한다. 신뢰할 수 있는 세션 메타데이터 또는 사용자의 명시적인 선택 안내를 근거로 삼는다. 현재 모델을 알 수 없으면 추측하지 않고, 읽기 전용 조사와 인계 준비까지 진행한 후 해당 단계의 편집 전에 선택 모델을 확인한다. 한 번 확인된 선택은 전환 안내가 있을 때까지 유효하다.
- Astra에서 설계/티켓이 끝나면 구현 범위·완료 조건·시작 티켓·미해결 결정을 남기고 종료한다. 사용자가 Sol로 전환하고 구현을 명시적으로 요청하면 시작한다. 설계 대화 중 ‘진행해’는 현재 설계 작업을 이어가라는 의미이며 코드 적용으로 확대하지 않는다.
- 에이전트가 스스로 모델을 바꿨다고 주장하거나 다른 모델의 하위 에이전트로 우회하지 않는다. 예외는 사용자가 명시적으로 허용한 경우에만 적용한다.

이 규칙은 `AGENTS.md`와 시작 문서에서 연결하는 작업 지침이다. 앱의 모델 선택을 강제로 잠그는 설정이나 자동 모델 전환 기능은 아니다.

### 기본 개발 방식: 최소 공통 기반 + 수직 분할

레이어별 최소 기반을 첫 사용자 기능과 함께 만들고, 기능마다 DB·API/MCP·필요한 화면·테스트를 연결해 완성한다. 전체 DB → 전체 API → 전체 UI 순으로 모든 기능을 수평 개발하지 않는다. 공통 라이브러리 전체 완성도 선행 조건으로 삼지 않는다.

- DB: 첫 기능에 필요한 소유권·참조·버전·원자 저장 규칙부터 구현한다.
- 백엔드/MCP: 해당 기능의 인증 adapter·입출력 검증·오류 처리·도구 등록을 연결한다.
- 프런트엔드: 해당 사용자 흐름의 데이터 접근·상태 표시·필요한 공통 모달/상세만 보완한다.
- 기존 기반은 재사용한다. 두 번째 소비자에서 실제 공통성이 확인되면 추출/확장하며, 필요하지 않은 범용 계층을 미리 만들지 않는다.

첫 수직 기능은 문맥 조회 → 사용자 요청에 따른 분석 저장 → 재조회 → 앱에서 읽기다. 외부 조사는 ChatGPT 책임으로 유지한다. 이어 판단/질문 연속성, 실제 체결/보정을 완성한다. 각 단계의 미정 기술 계약은 관련 fixture·작은 기술 검증으로 먼저 해결한다.

### 작업 분할과 완료 기준

- [ADR-0004](../adr/0004-domain-storage-and-minimal-mutation-contract.md)의 단순화를 적용한다. 도메인별 저장+공통 변경 규약, 필요한 대상의 충돌 버전, 중요한 변경 이력/당시 snapshot을 구분한다. 새 버전 테이블·공통 모듈·추상 엔진을 추가할 때 현재 소비 시나리오와 더 단순한 대안이 부족한 이유를 기록한다.

- 각 작업 계획/티켓 하위 단계에 사용자 시나리오 S ID, 사용할 API, 변경/불변 데이터, 필요한 화면, 검증 기준을 적는다.
- 공통 기반 작업에는 이를 바로 사용할 기능과 최소 범위·종료 조건을 명시한다. 독립 PR로 나눌 수 있지만 소비자 없이 기반만 계속 확장하지 않는다.
- 계층별 하위 작업 완료와 사용자 기능 완료를 구분한다. 가상 데이터 화면/API 단독 성공만으로 수직 기능 완료를 선언하지 않는다.
- 수직 기능 완료는 실제 저장·재조회·필요 UI 연결, 관련 소유권/실패/재시도 테스트, 기존 기능 회귀, 문서/도구 설명 갱신을 확인해야 한다. 운영 배포와 실제 클라이언트 검증 여부는 별도 기록한다.
- 다음 단계의 설계나 독립 작업은 병행할 수 있으나 미완성 연동을 숨긴 채 여러 기능을 벌리지 않는다. 필수 이관·보안 공통 작업을 먼저 해야 한다면 이유/소비 기능/후속 통합 게이트를 기록한다.

이 규칙은 개발 에이전트의 기본 작업 방식이다. 티켓 번호는 책임 단위이며 여러 티켓의 하위 작업을 하나의 사용자 기능으로 연결할 수 있다. 기존 티켓 전체를 순서대로 닫는 것이 수직 분할의 뜻은 아니다.

### 실행 절차

1. AGENTS → START-HERE → PRD/ADR → 관련 티켓/계약을 읽는다. git status와 원격 티켓 최신 본문을 확인하고 무관한 사용자 변경을 보존한다.
2. 시나리오와 불변 조건을 선택한다. 미정 계약은 해당 티켓에서 먼저 정리하며 정책을 조용히 변경하지 않는다.
3. 정상/실패/권한/경쟁 사례를 정의한 뒤 작은 기능 단위로 구현한다. 안전한 로컬·테스트 환경에서 검증한다.
4. 모델/API가 바뀌면 시나리오·설명·스키마·서버 테스트를 함께 갱신한다. MCP 관련 의미가 바뀌면 영향받는 작업 가이드도 수정하거나 영향 없음 사유를 review manifest에 기록하고 `npm run check:workflow-guides`를 통과시킨다. DB 구조 변경은 OVERVIEW도 갱신한다.
5. 실행 환경/명령/결과·미검증 항목·다음 작업을 남기고 로컬/GitHub 티켓을 맞춘다. 커밋·푸시·배포는 별도 단계이며 무관한 변경을 포함하지 않는다.

## 환경 구분

| 환경 | 실행/특징 | 주의 |
| --- | --- | --- |
| Vite 프런트엔드 | npm ci, npm run dev; CI Node22 기준 | VITE_SUPABASE_URL이 실제 데이터 대상을 결정. 로컬 화면도 원격에 쓸 수 있음 |
| 일반 로컬 Supabase | Docker + Supabase CLI, supabase start | db reset은 일상 실행 아님. 사용 데이터가 있으면 보존·복구 방법과 명시적 초기화 의도 확인 |
| 독립 E2E | npm run test:e2e:install 후 npm run test:e2e | 실행기가 .e2e DB를 시작/reset/종료한다. 해당 환경의 기존 데이터는 지워짐 |

E2E는 `e2e/app.spec.js`, `activity.spec.js`, `assets-access.spec.js`, `navigation.spec.js`, `integrations.spec.js`의 사용자 흐름별 파일로 나뉜다. 같은 격리 DB의 쓰기 테스트를 사용하므로 Playwright worker는 1개다. 특정 흐름은 `npm run test:e2e -- e2e/activity.spec.js`처럼 선택한다. 선택 실행도 독립 `.e2e` 인스턴스의 초기화·DB/MCP 검사를 수행하며 일반 로컬 및 원격 DB를 대상으로 하지 않는다.
| 연결 원격 | 명시적인 `supabase db push`/함수 배포/인증 smoke만 사용 | 로컬 test 명령은 원격을 대상으로 하지 않음. 대상과 쓰기·복구 영향을 확인하고 별도 승인 범위에서 실행 |

설정 이름은 `src/lib/config.js` 기준 VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY다. `.env.local`에 개발용 값을 두고 비밀값을 출력/커밋하지 않는다. VITE 변수에 service role/개인 토큰을 넣지 않는다. 로컬 Supabase 로그인/redirect 설정은 대상 환경에 맞춰 확인한다. E2E용 가상 인증은 실제 Google/OAuth end-to-end 성공을 증명하지 않는다.

일반 로컬 Supabase를 사용할 때는 `VITE_SUPABASE_URL=http://127.0.0.1:54321`과 `supabase status -o env`의 공개 ANON_KEY를 `.env.local`에 둔다. 로컬 Google 로그인은 `supabase/config.toml`의 provider 설정이 `GOOGLE_OAUTH_CLIENT_ID`와 `GOOGLE_OAUTH_CLIENT_SECRET`을 요구하므로, `supabase start` 프로세스 환경 또는 CLI가 읽는 git 제외 `.env`에 제공한다. Google OAuth 클라이언트에는 `http://127.0.0.1:54321/auth/v1/callback`을 승인된 redirect URI로 등록해야 한다. 운영 키나 service role은 사용하지 않는다.

원격과 일반 로컬 및 E2E baseline이 같은 스키마라고 가정하지 않는다. [실제 대조](../design/schema-audit-20260921.md)에서 차이를 확인했다. 새 migration은 관련 E2E baseline에도 반영하고 데이터 없는 재현 가능성을 검증하되 기존 migration 이력을 수정하지 않는다.

## 변경별 검증

| 변경 | 필요한 검사 |
| --- | --- |
| 문서 | npm run check:encoding, git diff --check, 링크/정책/티켓 일치 |
| 프런트엔드/계산 | 위 검사 + npm test + npm run build + 관련 E2E/수치 fixture |
| UI | 관련 E2E + 디자인 원칙의 화면 폭·빈값·긴값·공유 상태 수동 확인 |
| DB/RPC | 대상 한정 DDL/RLS 조사, migration 재현, 소유권·경쟁·원자성·이관/복구 테스트 |
| MCP/Edge Function | 독립 타입 검사, initialize/tools/list/call 오류·인증·schema/handler 일치, 실제 웹/모바일 확인 |

MCP 작업 가이드 변경은 `npm run check:workflow-guides`로 참조 도구·source·검토 digest를 확인한다. 실제 의미를 자동 판정하는 검사는 아니므로 계약 변경을 검토한 뒤 `WORKFLOW_GUIDE_REVIEW_REASON`을 지정해 `npm run update:workflow-guide-review`로 검토 기록을 갱신한다.

Edge Function 타입 검사는 Deno 2 환경의 `npm run check:edge`로 실행한다. MCP 정의·오류 fixture는 `npm test`에 포함된다. `npm run test:e2e`는 격리 환경에 실제 Edge Function을 복사해 initialize, tools/list, 인증된 tools/call, 인증 거부, 입력 오류 계약도 호출한다. Vite build 통과를 Edge Function 검증으로 대신하지 않는다. 스키마 fixture 검사만으로 DB 보안을 검증했다고 하지 않는다.

## 배포 현황과 안전 경계

- `.github/workflows/deploy.yml`: master의 관련 경로 변경 또는 수동 실행 시 unit → guide → Edge type → 독립 DB/E2E → 인증된 원격 RPC 호환성을 같은 commit에서 확인하고 성공한 경우에만 dist를 빌드·gh-pages로 배포한다. build의 prebuild가 인코딩을 확인한다.
- `.github/workflows/e2e.yml`: PR 또는 수동 실행에서 unit → guide → Edge type → build/encoding → 독립 DB/MCP/브라우저 E2E를 실행한다. 운영 secret/readiness는 PR에 요구하지 않는다. master에서는 deploy workflow의 필수 gate가 같은 테스트를 수행해 중복 실행하지 않는다.
- 브랜치 보호/필수 체크 설정은 별도 확인해야 한다. 이 안내가 배포 gate를 자동 추가하지 않는다.
- DB migration/Edge Function은 위 Pages 배포로 배포되지 않는다. 대상 프로젝트·순서·호환성·복구안을 확인하고 별도 승인된 작업으로 수행한다. 범용 push/reset 명령을 개발 기본 절차에 넣지 않는다.
- 신규 서버 변경은 기존 클라이언트 호환과 데이터 보존을 먼저 확보하고, 새 화면/MCP 공개 후 대상 환경 검증을 기록한다. DB 실패를 과거 migration 삭제로 복구하지 않는다.

상세 배포 순서, 부분 실패와 비파괴 복구, 배포 기록 형식은 [배포·복구 Runbook](./deployment.md)을 따른다.
