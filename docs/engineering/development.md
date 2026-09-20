# 개발·검증·배포 방법

2026-09-21 · 현재 명령/CI 기준. 이 문서 작성으로 테스트나 배포를 수행한 것은 아니다.

## 작업 순서

1. AGENTS → START-HERE → PRD/ADR → 관련 티켓/계약을 읽는다. git status와 원격 티켓 최신 본문을 확인하고 무관한 사용자 변경을 보존한다.
2. 시나리오와 불변 조건을 선택한다. 미정 계약은 해당 티켓에서 먼저 정리하며 정책을 조용히 변경하지 않는다.
3. 정상/실패/권한/경쟁 사례를 정의한 뒤 작은 기능 단위로 구현한다. 안전한 로컬·테스트 환경에서 검증한다.
4. 모델/API가 바뀌면 시나리오·설명·스키마·서버 테스트를 함께 갱신한다. DB 구조 변경은 OVERVIEW도 갱신한다.
5. 실행 환경/명령/결과·미검증 항목·다음 작업을 남기고 로컬/GitHub 티켓을 맞춘다. 커밋·푸시·배포는 별도 단계이며 무관한 변경을 포함하지 않는다.

## 환경 구분

| 환경 | 실행/특징 | 주의 |
| --- | --- | --- |
| Vite 프런트엔드 | npm ci, npm run dev; CI Node22 기준 | VITE_SUPABASE_URL이 실제 데이터 대상을 결정. 로컬 화면도 원격에 쓸 수 있음 |
| 일반 로컬 Supabase | Docker + Supabase CLI, supabase start | db reset은 일상 실행 아님. 사용 데이터가 있으면 보존·복구 방법과 명시적 초기화 의도 확인 |
| 독립 E2E | npm run test:e2e:install 후 npm run test:e2e | 실행기가 .e2e DB를 시작/reset/종료한다. 해당 환경의 기존 데이터는 지워짐 |
| 연결 원격 | 현재 npm run test:db는 --linked 사용 | 테스트명만 보고 실행 금지. 대상과 SQL의 쓰기·rollback·외부 영향 확인 후 해당 환경 권한 범위에서 실행 |

설정 이름은 `src/lib/config.js` 기준 VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY다. `.env.local`에 개발용 값을 두고 비밀값을 출력/커밋하지 않는다. VITE 변수에 service role/개인 토큰을 넣지 않는다. 로컬 Supabase 로그인/redirect 설정은 대상 환경에 맞춰 확인한다. E2E용 가상 인증은 실제 Google/OAuth end-to-end 성공을 증명하지 않는다.

원격과 일반 로컬 및 E2E baseline이 같은 스키마라고 가정하지 않는다. [실제 대조](../design/schema-audit-20260921.md)에서 차이를 확인했다. 새 migration은 관련 E2E baseline에도 반영하고 데이터 없는 재현 가능성을 검증하되 기존 migration 이력을 수정하지 않는다.

## 변경별 검증

| 변경 | 필요한 검사 |
| --- | --- |
| 문서 | npm run check:encoding, git diff --check, 링크/정책/티켓 일치 |
| 프런트엔드/계산 | 위 검사 + npm test + npm run build + 관련 E2E/수치 fixture |
| UI | 관련 E2E + 디자인 원칙의 화면 폭·빈값·긴값·공유 상태 수동 확인 |
| DB/RPC | 대상 한정 DDL/RLS 조사, migration 재현, 소유권·경쟁·원자성·이관/복구 테스트 |
| MCP/Edge Function | 독립 타입 검사, initialize/tools/list/call 오류·인증·schema/handler 일치, 실제 웹/모바일 확인 |

Edge Function 타입 검사/MCP 계약 검사의 표준 npm 명령은 아직 없다. 구현 #33에서 재현 가능한 명령을 추가하고 기록한다. Vite build 통과를 Edge Function 검증으로 대신하지 않는다. 스키마 fixture 검사만으로 DB 보안을 검증했다고 하지 않는다.

## 배포 현황과 안전 경계

- `.github/workflows/deploy.yml`: master의 지정 프런트엔드 경로 변경 또는 수동 실행 시 build 후 dist를 gh-pages로 배포한다. 단순 문서 변경은 지정 경로에 포함되지 않는다.
- `.github/workflows/e2e.yml`: PR/master push에서 독립 E2E 실행. deploy는 이 workflow 성공에 직접 의존하지 않는다. 단위 테스트를 별도 실행하는 단계도 현재 두 workflow에는 없다.
- 브랜치 보호/필수 체크 설정은 별도 확인해야 한다. 이 안내가 배포 gate를 자동 추가하지 않는다.
- DB migration/Edge Function은 위 Pages 배포로 배포되지 않는다. 대상 프로젝트·순서·호환성·복구안을 확인하고 별도 승인된 작업으로 수행한다. 범용 push/reset 명령을 개발 기본 절차에 넣지 않는다.
- 신규 서버 변경은 기존 클라이언트 호환과 데이터 보존을 먼저 확보하고, 새 화면/MCP 공개 후 대상 환경 검증을 기록한다. DB 실패를 과거 migration 삭제로 복구하지 않는다.

후속 인프라 개선: 안전한 로컬 DB test 명령, Edge/MCP 검사 명령, unit/E2E 배포 gate, 환경 설정 템플릿을 실제 검증 후 추가한다. 이번 문서 작업에는 명령/CI 변경이 포함되지 않는다.
