# [운영 개선] 검증·서버 호환성·프런트 배포 순서 통합

우선순위: P1 · 규모: 중 · 상태: 로컬 구현 완료 · 운영 secret 설정 대기
상위: #40 · 연관: #33/#39/#48 · 금융/조회 수정과 병행 설계 가능

## 근거와 발생 조건
- `.github/workflows/deploy.yml`은 build 뒤 Pages를 배포하고 별도 e2e.yml 성공을 기다리지 않는다.
- DB/Edge 준비 확인이 없어 신규 프런트가 미배포 RPC를 호출할 수 있다. 실제 app_list_daily_briefing_page 누락이 발생했다.
- package.json의 test:db는 --local인데 AGENTS.md와 engineering/development.md는 --linked라고 설명한다.
- scripts/test-e2e.mjs의 migration 목록은 수동이며 중간 process.exit는 환경 정리를 건너뛸 수 있다.

## 최소 변경 범위
- 동일 커밋의 단위·독립 DB·관련 E2E·Edge 타입/계약 검증 성공을 배포 gate로 연결한다.
- DB/Edge 준비 → 호환성 점검 → 프런트 공개 → 인증된 최소 조회 검증 순서를 명시한다. 파괴적 자동 migration 배포를 기본값으로 추가하지 않는다.
- 필요한 RPC/입출력 계약의 존재를 확인한다. 익명 permission denied만으로 인증된 조회 성공을 판정하지 않는다.
- 배포 동시 실행을 제어하고 이전 클라이언트 호환·프런트 복귀·전진 DB 수정 절차를 정리한다.
- 로컬/E2E/원격 명령 대상을 명확히 하고 지침의 오래된 상태를 정정한다.
- E2E migration 누락 탐지와 finally 기반 정리, 실패 로그/artifact 보존을 마련한다. 모든 migration 이력과 테스트 baseline 차이는 보존한다.
- 배포 기록에 앱 commit/DB migration/Edge 상태를 별도로 남긴다.

## 인수 조건
- [x] 실패한 unit/DB/E2E/Edge 검사에서 같은 커밋의 프런트 배포가 차단된다.
- [x] 대상 DB에 필요한 RPC가 없을 때 프런트 공개 전에 탐지된다.
- [x] 성공·부분 배포 실패·이전 앱 복귀 절차와 비파괴 복구 방법이 재현 가능하다.
- [x] 신규 migration의 E2E 반영 누락이 탐지되며 중간 실패에도 독립 환경 정리가 실행된다.
- [x] 테스트 기본 명령이 운영에 쓰지 않고 문서와 실제 명령이 일치한다.
- [x] 로컬 통과/운영 배포/실사용 OAuth·격리 검증을 구분해 기록한다.

## 구현 결과

- `16ef2b6`: master Pages 배포를 unit → Deno Edge check → 독립 DB/E2E → 인증된 운영 RPC readiness 뒤에 배치하고 동시 배포를 제한했다.
- E2E가 migration 002 이후를 자동 동기화·최신 migration 확인하고 성공/실패 모두에서 함수·migration 임시 파일과 Supabase를 정리한다. 전체 27개 E2E로 실제 확인했다.
- 로컬/격리/원격 명령을 문서와 맞추고 [배포·복구 Runbook](../engineering/deployment.md)을 추가했다.
- GitHub에는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`만 있고 smoke 계정 secret 두 개는 아직 없다. `SUPABASE_SMOKE_EMAIL`, `SUPABASE_SMOKE_PASSWORD`를 설정하기 전 실제 Pages 배포는 의도적으로 차단된다.

## 현재 배포 근거
2026-09-21 이전 응답에서 remote migration 020~023 적용과 migration list 일치를 확인했다. 인증 없는 RPC 호출은 permission denied였다. 실제 사용자 조회 성공이나 최신 프런트/Edge 배포까지 검증한 근거로 확대하지 않는다.

## 2026-09-21 후속 정정 (#58)

기존 `test:e2e`는 격리 DB를 reset했지만 pgTAP을 실행하지 않아 “DB 검사가 배포 gate에 연결됐다”는 표현이 과했다. #58에서 reset 직후 DB 278개를 실행하도록 고쳤고, 운영 readiness에 transaction page와 OAuth MCP discovery를 추가했다. 이 후속 로컬 검증도 운영 migration 026/Edge/Pages 배포 또는 실제 ChatGPT 성공을 뜻하지 않는다.
