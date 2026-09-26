# 배포·복구 Runbook

2026-09-21 기준. GitHub Pages 공개는 검증된 앱 commit을 배포하는 단계이며 DB migration과 Edge Function을 대신 배포하지 않는다.

현재 배포 상태는 이 문서의 가장 최근 날짜별 배포 기록과 해당 workflow/commit을 확인한다. [2026-09-23 운영 인계](../design/storage-release-readiness-20260923.md)와 아래 2026-09-22 ToDo·원칙 번들 배포는 당시의 역사 기록이며 새 릴리스 계획이나 최신 상태가 아니다. 로컬 후속 커밋은 별도 배포 증거 없이는 운영 반영으로 간주하지 않는다.

## 배포 순서

1. 로컬에서 `npm test`, `npm run build`, `npm run test:db`를 실행한다. Edge 변경은 Deno가 있는 환경에서 `npm run check:edge`도 실행한다.
2. 새 DB migration은 대상 프로젝트와 적용 목록을 확인한 뒤 별도 승인 범위에서 적용한다. 과거 migration을 수정하거나 운영 DB를 reset하지 않는다.
3. 새 Edge Function은 DB와 이전 클라이언트 양쪽에 호환되는 상태에서 별도로 배포하고 실제 endpoint 계약을 확인한다.
4. GitHub의 `SUPABASE_SMOKE_EMAIL`·`SUPABASE_SMOKE_PASSWORD`에는 테스트 전용 인증 사용자를 설정한다. `check:deployment`가 새 프런트가 요구하는 RPC를 실제 로그인 후 호출해야 한다.
   운영 PostgREST의 `/rest/v1/` OpenAPI 루트는 비밀 API 키가 필요하므로 공개 키로 조회하지 않는다. 운영 검사는 인증된 읽기 RPC와 OAuth MCP를 호출하고, 변경 RPC 입력 서명은 격리 DB 계약 테스트에서 확인한다.
5. `master` 배포 workflow가 같은 commit에서 unit, Edge type check, 독립 DB/E2E, 인증된 원격 호환성 검사를 모두 통과한 뒤에만 Pages를 공개한다.
6. 공개 후 본인 계정과 별도 친구 계정으로 로그인·사용자 격리·핵심 조회를 확인한다. 이 실사용 확인은 CI 성공과 별도로 기록한다.

## 실패와 복구

| 실패 지점 | 대응 |
| --- | --- |
| 로컬/CI 검증 | Pages는 공개되지 않는다. 실패한 계층만 수정하고 같은 commit 검증을 다시 실행한다. |
| DB/Edge 적용 | 프런트를 공개하지 않는다. 이미 적용된 additive migration은 유지하고 전진 migration으로 보정한다. |
| 인증된 원격 호환성 | 누락 RPC·인자·권한을 서버에서 먼저 복구한다. 익명 `permission denied`를 성공 증거로 사용하지 않는다. |
| Pages 공개 | 마지막 정상 앱 commit을 새 commit으로 되돌려 재배포한다. 이미 적용된 DB migration은 삭제하지 않고 이전 앱과 호환되게 유지한다. |
| 공개 후 실사용 | 영향 범위를 기록하고 프런트 복귀 또는 전진 수정 중 더 작은 비파괴 경로를 선택한다. |

배포 동시 실행은 branch별 한 건으로 제한하며 새 실행이 이전 실행을 취소한다. 자동 workflow는 운영 DB migration이나 Edge 배포를 실행하지 않는다.

## 피드백 운영자 지정

피드백 관리자 권한은 포트폴리오 공유 권한과 분리한다. 운영 DB에서 서비스 역할 또는 SQL editor로 인증 사용자 UUID를 확인한 뒤 다음처럼 지정한다. 이메일이나 UUID를 앱 코드·migration에 고정하지 않는다.

```sql
insert into public.product_feedback_admins (user_id)
values ('<auth.users의 사용자 UUID>')
on conflict (user_id) do nothing;
```

해제는 해당 UUID 한 행만 삭제한다. 관리자 역할은 피드백 전체 목록과 처리 RPC에만 효력이 있고 타인의 투자 데이터 접근을 허용하지 않는다. 역할 변경 뒤에는 피드백 화면을 새로고침해 권한을 다시 조회한다.

```sql
delete from public.product_feedback_admins
where user_id = '<auth.users의 사용자 UUID>';
```

## 배포 기록

매 배포 기록에는 다음을 서로 분리해 남긴다.

- 앱 commit과 Pages workflow URL/결과
- 대상 Supabase project와 최종 migration 번호
- 배포한 Edge Function 이름·버전/시각
- 인증된 readiness 사용자와 확인 RPC(비밀번호·토큰 제외)
- 본인/친구 실사용 확인 결과와 미검증 항목
- 복귀가 필요할 때 사용할 마지막 정상 앱 commit

### 2026-09-26 포트폴리오·공유 UI 릴리스

- 앱 코드 commit: `9dd16d1` (변경 모음 `6e60451`, 운영 migration 보정 `0d153da`, 후속 CI 보정 포함). [Pages workflow](https://github.com/kimyongin/fin/actions/runs/36229110158)의 검증·배포가 모두 성공했다.
- 운영 Supabase 프로젝트: `ubmtflglqudrvumepzij`. 미적용 migration을 순서대로 적용해 최종 번호 `20260926064607`을 확인했다. 적용 중 `20260922191112`의 한 vector 타입 선언이 운영 search path에서 실패하여 `extensions.vector`로 명시한 뒤 이어서 적용했다. 운영 DB reset은 하지 않았다.
- Edge Function: `portfolio-mcp-oauth` v7, `portfolio-mcp` v17, `activity-search` v1, `sync-prices` v10, `lookup-ticker` v7. 기존 `chatgpt-mcp-probe`는 이번 릴리스에서 변경·삭제하지 않았다.
- 로컬 격리 검증: DB 50파일·604건, Chromium 79건, MCP 계약·인증된 로컬 준비도 검사 통과. GitHub workflow에서 unit, 가이드, Edge 타입, 격리 DB/브라우저, 운영 테스트 계정의 읽기 RPC 5개와 OAuth MCP 발견 검사가 통과했다. 테스트 계정의 비밀번호와 토큰은 기록하지 않는다.
- 공개 URL: <https://kimyongin.github.io/fin/> HTTP 200. 공개 번들 `index-C70fHM3A.js` HTTP 200에서 새 프로필 배지를 확인했다.
- 새 전체 포트폴리오 공유 migration은 기존 공유를 한 번 껐다. 공유가 필요하면 설정에서 범위를 확인하고 다시 저장해야 한다. 실제 본인·친구 Google 로그인과 ChatGPT 웹·모바일 사용은 이 배포에서 수동 검증하지 않았다.
- 이전 정상 공개 앱 commit은 `9b479e7`이나 새 DB와의 역호환은 검증하지 않았다. 장애 시 DB 이력을 되돌리지 말고 영향 범위에 맞는 전진 수정 또는 호환성을 확인한 프런트 복구를 선택한다.

### 2026-09-22 제품 피드백

- 앱 commit: `9b479e7` (`e2321ba` 기능 + 원격 readiness 보강)
- 운영 DB: `202609210028`, `202609210029` 적용 확인
- Edge Function: `portfolio-mcp-oauth` version 6, MCP server 0.6.0
- GitHub Actions: verify/Pages 배포 성공, 원격 인증 RPC와 OAuth MCP discovery 통과
- 공개 번들: `index-Dnf_tD9D.js`에서 피드백 화면과 `app_submit_product_feedback` 포함 확인
- 피드백 운영자: 개발자 본인 계정을 운영 DB에서 UUID 기준으로 지정
- 미검증: 실제 ChatGPT 웹·모바일의 명시적 접수 및 능동 제안 행동 평가
- 마지막 이전 정상 앱 commit: `f7d5ec0`

## ToDo・원칙 통합 배포 순서

> 2026-09-22 설계 변경: 아래는 번들 구현 당시 순서다. 신규 배포 기준은 ADR-0006과 #79의 태스크・이벤트 전환 계획으로 다시 검증한다. 미배포 번들 UI를 이 절만 보고 공개하지 않는다. 기존 migration 이력은 보존한다.

#69~#74는 additive migration과 이전 URL/RPC 호환을 전제로 한다. 운영 적용 시 다음 순서를 바꾸지 않는다.

1. migration `20260922040431`(메모) → `20260922042127`(운영 규칙) → `20260922044008`(ToDo 묶음) → `20260922051216`(탐색 호환) → `20260922051908`(daily context)을 적용한다.
2. 기존 앱의 자산・task RPC가 정상인 상태에서 OAuth MCP Edge Function을 배포하고 tools/list, 여덟 workflow guide topic, 규칙・묶음 read/write 계약을 확인한다.
3. 인증된 원격 readiness가 새 RPC와 기존 client 계약을 모두 통과한 뒤 앱을 공개한다. ChatGPT에서는 액션을 새로 고치고 새 세션을 사용한다.
4. 공개 뒤 `docs/design/contracts/todo-principles-validation.md`의 운영 항목과 agent evaluation E21~E24를 웹・모바일에서 기록한다.

문제가 생기면 적용된 migration을 삭제하거나 과거 migration을 고치지 않는다. Edge 배포 전이면 앱을 공개하지 않고, Edge 배포 뒤 앱 공개 전이면 호환 가능한 전진 수정으로 복구한다. 앱 공개 뒤 UI 문제는 마지막 정상 앱 commit으로 되돌릴 수 있지만 DB・Edge는 이전 앱과 호환되는 상태를 유지한다.
