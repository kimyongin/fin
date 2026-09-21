# 배포·복구 Runbook

2026-09-21 기준. GitHub Pages 공개는 검증된 앱 commit을 배포하는 단계이며 DB migration과 Edge Function을 대신 배포하지 않는다.

## 배포 순서

1. 로컬에서 `npm test`, `npm run build`, `npm run test:db`를 실행한다. Edge 변경은 Deno가 있는 환경에서 `npm run check:edge`도 실행한다.
2. 새 DB migration은 대상 프로젝트와 적용 목록을 확인한 뒤 별도 승인 범위에서 적용한다. 과거 migration을 수정하거나 운영 DB를 reset하지 않는다.
3. 새 Edge Function은 DB와 이전 클라이언트 양쪽에 호환되는 상태에서 별도로 배포하고 실제 endpoint 계약을 확인한다.
4. GitHub의 `SUPABASE_SMOKE_EMAIL`·`SUPABASE_SMOKE_PASSWORD`에는 테스트 전용 인증 사용자를 설정한다. `check:deployment`가 새 프런트가 요구하는 RPC를 실제 로그인 후 호출해야 한다.
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
