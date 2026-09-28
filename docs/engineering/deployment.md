# 배포·복구 Runbook

2026-09-21 기준. GitHub Pages 공개는 검증된 앱 commit을 배포하는 단계이며 DB migration과 Edge Function을 대신 배포하지 않는다.

현재 배포 상태는 이 문서의 가장 최근 날짜별 배포 기록과 해당 workflow/commit을 확인한다. [2026-09-23 운영 인계](../design/storage-release-readiness-20260923.md)와 아래 2026-09-22 ToDo·원칙 번들 배포는 당시의 역사 기록이며 새 릴리스 계획이나 최신 상태가 아니다. 로컬 후속 커밋은 별도 배포 증거 없이는 운영 반영으로 간주하지 않는다.

ChatGPT 개인용 Portfolio 플러그인은 이 문서의 DB·Edge·Pages 배포와 별도다. ZIP 버전 갱신, 앱 연결 확인, 웹·모바일 행동 검증과 복구는 [ChatGPT 플러그인 배포 절차](./chatgpt-plugin-deployment.md)를 따른다.

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

## #161 활동 검색 색인 배포

`activity-search-index` Edge Function을 먼저 배포하고, `20260927095839_activity_search_async_index.sql`을 대상 DB에 적용한다. 이 migration은 기존 활동·할 일을 전용 pgmq 큐에 백필로 넣지만 기존 원본 행은 바꾸지 않는다. 이어 대상 프로젝트의 Vault에 다음 두 이름을 지정한다. 같은 키를 Edge 비밀 `ACTIVITY_SEARCH_WORKER_KEY`에도 설정해 호출자와 작업 함수가 일치하도록 한다. 키는 비밀 관리에서만 입력하고 웹 환경변수나 Git에 넣지 않는다.

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'activity_search_api_url');
select vault.create_secret('<service-role-key>', 'activity_search_service_role_key');
```

`20260927114341_activity_search_secret_auth.sql`은 백필 작업 호출을 `apikey` 헤더만 사용하도록 보정한다. 운영에서 첫 배포 후 레거시 서비스 키와 Edge 기본 환경 키가 일치하지 않아 401이 발생했기 때문이다. Edge 비밀과 Vault는 같은 유효한 키를 보유해야 한다. 다음 배포에서는 두 migration을 순서대로 적용하고 인증된 검색에서 `semantic_status=active` 또는 `indexing`을 확인한다. 단어 fallback만 성공한 것을 의미 검색 정상으로 간주하지 않는다.

그 뒤 `activity-search`와 `portfolio-mcp-oauth`를 배포하고 인증된 소유자·공유자 검색을 확인한다. 마지막에 웹을 공개한다. 새 기록 저장 후 큐 개수가 줄고 `activity_search_vectors`가 늘어나는지, 보관 큐의 실패 건과 Edge 546이 없는지 본다. `semantic_status=indexing`이 오래 지속되면 Vault 이름·cron 실행·Edge 로그와 `pgmq.a_activity_search_index`를 확인한다. 모델 차원을 바꾸는 배포는 새 벡터 스키마와 재색인이 필요하다.

문제가 생기면 새 검색 함수의 배포를 직전 버전으로 돌리고 `cron.unschedule('activity-search-index')`로 색인 호출을 멈춘다. 기존 할 일·기록은 유지하고 새 벡터/큐는 파생 데이터로 둔다. DB migration을 되돌리기 위해 원본 데이터를 삭제하지 않는다.

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

### 2026-09-29 Portfolio OAuth 가이드 제거 (#169)

- 사용자 지시에 따라 웹·모바일 행동 검증보다 먼저 운영 프로젝트 `ubmtflglqudrvumepzij`의 `portfolio-mcp-oauth`만 배포했다. 배포 소스는 `codex/portfolio-skill-migration`의 `87180de`다. DB migration, 다른 Edge Function, Pages 배포는 없었다. 플러그인 1.1.0은 이미 설치돼 있었다.
- 배포 전 v20 (`verify_jwt=false`, SHA-256 `fd870b746d4651ce4b9591c47e7cb9504c417cd9452ce4e83aa6f4f994ce813e`)을 확인했다. 2026-09-29 01:47 KST 배포 후 v21 (`verify_jwt=false`, SHA-256 `545c7ac737e54ec3f0bf8b1bf986dd6954c96d421b174e425861625f8031f51d`)이 ACTIVE였다.
- 인증된 Portfolio 연결에서 퇴역 `get_workflow_guide`는 `Unknown tool` / `-32602`, 기존 `get_portfolio_state`는 정상 응답했다. prompt/resource의 운영 응답과 ChatGPT 웹·모바일의 자동 사용 및 기록 제안은 미검증이다. 로컬 단위 136건·격리 DB 809건·MCP 계약·인증된 준비 검사·관련 브라우저 흐름·빌드·Edge 타입 검사는 배포 전 통과했다.
- 문제가 생기면 배포 전 v20 소스로 `portfolio-mcp-oauth`만 재배포하고 같은 인증 읽기 계약을 확인한다. 실제 복구는 아직 수행하지 않았다. 상세 인수 상태는 [agent-01](../tickets/agent-01-workflow-guide-to-skill.md)을 따른다.

### 2026-09-28 목록 읽기·편집 UX (#167)

- 앱 commit `dab5cd4` (#167 구현·검증 및 MCP 가이드 검토 기록). [동일 commit 검증·gh-pages 배포](https://github.com/kimyongin/fin/actions/runs/36426676746)와 [Pages 게시](https://github.com/kimyongin/fin/actions/runs/36427543955)가 성공했다. 공개 <https://kimyongin.github.io/fin/>와 새 번들 `/fin/assets/index-Bl1NTkXH.js`는 HTTP 200이며, 번들에서 할 일·기록 읽기 및 편집 라벨을 확인했다.
- 첫 배포 실행은 피드백·공유 화면의 목록 액션 변경에 따른 MCP workflow guide 검토 기록 누락으로 게시 전에 중단됐다. 화면 액션만 바뀌고 도구 동작·동의 경계는 유지됨을 검토해 manifest에 기록한 뒤 전체 검증을 다시 실행했다.
- CI의 단위·가이드·Edge 타입·인증된 운영 RPC 호환성·격리 DB 783건·Chromium 87건·빌드가 통과했다. 운영 Supabase DB migration과 Edge Function 변경·재배포는 없다.
- 실제 휴대폰 손가락 드래그, 200% 확대, 화면낭독기, 본인·친구 실사용은 아직 수동 확인하지 않았다. #167은 이 검증을 위해 열어 둔다. 직전 정상 공개 앱 비교 기준은 `5c3deec`다.

### 2026-09-28 활동 목록 모바일 폭 보정 (#167)

- 앱 commit `cfc580a` (활동 목록의 그리드 축소·줄바꿈, 실제 카드/버튼 경계 검사, 피드백 관리자 초안 갱신 보정과 MCP 가이드 검토 기록). [전체 검증·gh-pages 배포](https://github.com/kimyongin/fin/actions/runs/36431445180)와 [Pages 게시](https://github.com/kimyongin/fin/actions/runs/36432295079)가 성공했다. 공개 <https://kimyongin.github.io/fin/>와 새 번들 `/fin/assets/index-BttnpHyy.js`는 HTTP 200이다.
- 격리 브라우저에서 목록 데이터가 표시된 후 320/360/390/414/768px의 상단 카드·행·읽기/편집 버튼 실제 경계를 확인했다. 전체 CI에서 단위 133건, DB 783건, 브라우저 87건, MCP 가이드·Edge 타입·인증된 운영 호환성·빌드가 통과했다. 운영 Supabase DB migration·Edge Function 변경 없음.
- 첫 재배포 실행은 별도 피드백 관리자 상태 초안의 재조회 경합을 발견해 게시 전에 중단됐고, 다음 실행은 가이드 검토 기록 누락으로 게시 전에 중단됐다. 두 항목을 보정한 뒤 전체 게이트를 다시 통과했다. 실기기 손가락 조작·200% 확대·화면낭독기·본인/친구 실사용은 수동 확인 전이다. 직전 정상 앱 비교 기준은 `dab5cd4`다.

### 2026-09-28 Pinecone 활동 의미 검색 (#161)

- 사용자 요청으로 실모델 품질 게이트 미달 상태에서 의미 검색을 활성화했다. 합성 검증은 24문항 중 23문항 적중, 지정 후반부 3/4, 무관 질문 오탐 1/6이다. 배포 성공을 검색 품질 인수 완료로 표시하지 않는다.
- 앱 commit `5c3deec`. [동일 commit 검증·gh-pages 배포](https://github.com/kimyongin/fin/actions/runs/36330375757)와 [Pages 게시](https://github.com/kimyongin/fin/actions/runs/36330784463)가 성공했다. 공개 <https://kimyongin.github.io/fin/>와 `/fin/assets/index-B_eVIyPZ.js`는 HTTP 200이다. CI에서 단위 131건, 격리 DB 783건, 브라우저 86건, 인증된 운영 읽기 RPC 11개와 HTTP/OAuth MCP 의미 검색 계약을 통과했다.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`에 `20260927160000_activity_search_pinecone_context.sql` 한 건을 적용했다. 적용 전 `public` 스키마·데이터는 `%TEMP%/fin-prod-backup-20260928-161/`에 보관했다. 색인 cron을 멈추고 진행 작업 0건을 확인한 뒤 검색/OAuth/색인 함수를 교체했다. 현재 Edge 버전은 `activity-search` v9 (`verify_jwt=true`), `portfolio-mcp-oauth` v19 및 `activity-search-index` v8 (둘 다 `verify_jwt=false`)이다.
- Pinecone 무료 조직의 `Default` 프로젝트에서 별도 키로 `multilingual-e5-large` 1024차원 호출을 확인했다. 무료 플랜은 `DataPlaneEditor` 키를 허용하지 않아 별도 `ProjectEditor` 키를 사용했다. `PINECONE_API_KEY`는 운영 Edge 비밀에만 설정했고 값을 코드·배포 기록에 남기지 않았다. `ACTIVITY_SEARCH_SEMANTIC_ENABLED=true`로 질의 기능을 켰다.
- 적용 전후 활동 172건·할 일 1건을 유지했다. 검색 가능한 원본 38건의 예상 청크 75개와 현재 1024차원 벡터 75개가 일치하고, 미완료 원본·구 모델/차원 벡터·대기열·실패 보관·최근 cron 실패는 모두 0건이다. 원격 migration dry-run에서도 미적용 항목이 없다.
- 실제 본인·친구 Google 로그인, ChatGPT 웹·모바일 사용, 200% 확대, 운영 지연 p50/p95, 실제 사용 질문의 관련성은 아직 수동 확인하지 않았다. 문제가 생기면 먼저 `ACTIVITY_SEARCH_SEMANTIC_ENABLED=false`로 질의 임베딩을 끄고 키워드 검색을 유지한다. 색인 오류에는 `cron.alter_job(1, active := false)`로 작업을 멈춘다. 384차원 worker나 구 migration만 되돌리지 않는다. 직전 공개 앱 비교 기준은 `fa7a20c`다.

### 2026-09-27 활동 시장 종목 티커 참조 (#166)

- 앱 commit `fa7a20c`. [검증·gh-pages 배포](https://github.com/kimyongin/fin/actions/runs/36324852263)와 [Pages 게시](https://github.com/kimyongin/fin/actions/runs/36325252457)가 성공했다. <https://kimyongin.github.io/fin/>와 새 번들 `/fin/assets/index-Cf4Eb6Pl.js`가 HTTP 200이고 새 티커 RPC 호출을 포함한다.
- 운영 프로젝트 `ubmtflglqudrvumepzij`의 `public` 스키마·데이터를 적용 전에 로컬 임시 경로 `fin-prod-backup-20260927-166`에 백업했다. `20260927130802_activity_market_ticker_reference.sql` 한 건을 적용하고 원격 dry-run에서 미적용 migration이 없음을 확인했다. 적용 전 ID 참조 10건 중 시장 기록 6건이었고, 적용 후 시장 기록 6건의 티커와 구 ID 호환 참조가 함께 존재함을 확인했다. 원본 데이터 삭제·DB reset은 하지 않았다.
- Edge `activity-search` v5 (`verify_jwt=true`)와 `portfolio-mcp-oauth` v15 (`verify_jwt=false`)를 배포했다. 운영 보안 advisor의 error 수준 지적은 없었다.
- 로컬 단위 127건, 빌드·인코딩·가이드·6개 Edge 진입점 Deno 검사가 통과했다. 격리 E2E는 DB 61파일/768건, MCP 계약과 인증된 준비 검사, 브라우저 86건을 통과했다. 티커 저장의 OAuth MCP→웹 HTTP 재조회도 격리 환경에서 검증했고, CI의 운영 인증 HTTP/OAuth 준비 검사와 전체 회귀도 통과했다.
- 실제 본인·친구 Google 로그인 및 ChatGPT 웹·모바일의 티커 기록 사용, 360~1440px·200% 확대 수동 확인은 아직 하지 않았다. #166은 이 항목과 구 ID 호환 계약 종료가 남아 열어 둔다. 문제가 생기면 기존 ID 참조와 호환 RPC를 유지한 채 서버를 전진 수정하고, 웹은 직전 정상 앱 `ef401e0`을 비교 기준으로 사용한다.

### 2026-09-27 활동 검색 근거 표시 (#165)

- 앱 구현 `7c89358`, 인증된 운영 검색 근거 검사 `ef401e0`. [동일 commit의 검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36319945424)와 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36320313559)가 성공했다. <https://kimyongin.github.io/fin/> 및 새 `/fin/assets/index-BsoqWsyI.js`가 HTTP 200이고 새 검색 안내 문구가 번들에 있음을 확인했다.
- 운영 프로젝트 `ubmtflglqudrvumepzij`에 `20260927121702_activity_search_evidence.sql` 한 건을 적용했다. 기존 ranked RPC의 응답 필드를 늘리는 변경이며 저장된 할 일·기록·벡터 원본은 수정하지 않았다. 원격 migration 목록에서 적용을 확인했다.
- Edge `activity-search` v4 (`verify_jwt=true`)와 `portfolio-mcp-oauth` v14 (`verify_jwt=false`)를 배포했다. 색인 함수와 다른 도메인 함수는 이번에 변경하지 않았다.
- 로컬 단위 127건·빌드·인코딩·가이드·Edge 타입 검사, 격리 DB/MCP 및 활동 브라우저 25건이 통과했다. CI는 운영 테스트 계정의 인증된 HTTP·OAuth MCP 검색에서 `search_mode=hybrid`, 점수 기준·색인 상태·항목별 근거 계약을 검증했고 격리 DB/브라우저 전체 회귀 검사를 통과했다.
- 실제 본인·친구 Google 로그인, ChatGPT 웹·모바일에서 근거/점수 표시, 200% 확대는 아직 수동 확인하지 않았다. `gte-small` 한국어 의미 검색 품질 제한도 그대로다. 직전 정상 공개 앱 비교 기준은 `bbdcccb`이며 적용된 additive 응답 필드는 이전 앱과 호환되게 유지한다.

### 2026-09-27 활동 검색 비동기 색인 (#161)

- 앱 commit: `bbdcccb` (`28544b7` 구현, `bbdcccb` 운영 내부 인증 보정). [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36317038981)와 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36317363854) 성공. <https://kimyongin.github.io/fin/> HTTP 200, 새 번들 `/fin/assets/index-NhtsbsDr.js` HTTP 200을 확인했다.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`: `20260927095839` 비동기 색인과 `20260927114341` 내부 `apikey` 인증 보정을 순서대로 적용했다. 원본 활동·할 일은 수정/삭제하지 않고 파생 벡터를 백필했다. 적용 후 대기열 0건·실패 보관 0건·벡터 62건을 확인했다.
- Edge Function: `activity-search-index` v4 (`verify_jwt=false`, 내부 키 직접 검사), `activity-search` v3, `portfolio-mcp-oauth` v13. Vault URL/키와 Edge 비밀 `ACTIVITY_SEARCH_WORKER_KEY`를 설정했고 키 값은 코드·기록에 남기지 않았다. 첫 내부 호출의 401은 공개 전에 발견해 동일 키·`apikey` 호출로 보정했다.
- 로컬 단위 124건·빌드·가이드·Edge 타입·인코딩 및 격리 검색 화면 검사가 통과했다. CI에서 단위 124건, DB 742건, 브라우저 85건, 운영 테스트 계정의 인증된 읽기 RPC 10개와 웹 HTTP/OAuth MCP 검색 경로가 통과했다. 실제 본인·친구 Google 로그인, ChatGPT 웹·모바일 사용, 운영 검색 지연 p50/p95는 아직 확인하지 않았다.
- `gte-small`의 한국어 의미 검색 품질은 합성 평가에서 실효 기준에 미달한다. 배포 성공을 유사 표현 검색의 품질 완료로 해석하지 않는다. 직전 정상 공개 앱 비교 기준은 `ddc26f5`; 서버 migration은 파생 색인 추가로 남기고, 문제 시 웹/검색 함수 호환성을 확인해 전진 수정한다.

### 2026-09-27 배분 제외 목록·자산 태그순 정렬

- 앱 commit: `ddc26f5`. [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36307286524)와 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36307604437) 성공. <https://kimyongin.github.io/fin/> HTTP 200, 번들 `/fin/assets/index-Bin8yfIx.js` HTTP 200 및 `배분 제외 보유`·`태그 없음` 문구 포함 확인.
- CI에서 단위 테스트, 가이드·Edge 타입 검사, 인증된 운영 RPC 호환성, 격리 DB·브라우저 테스트와 빌드가 통과했다. 로컬에서도 단위 119건, 빌드·인코딩·가이드 검사와 관련 브라우저 2건을 통과했다. 실제 본인·친구 화면 및 모바일 실기기 시각 확인은 아직 수행하지 않았다.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`의 DB migration·Edge Function 변경 없음. 직전 정상 공개 앱 비교 기준은 `78cae5b` 릴리스다.

### 2026-09-27 계좌별 보유의 배분 제외 (#160)

- 앱 commit: `78cae5b` (기능 `83a0777`, CSV 왕복 `ea9a273`, 기본 포함 UI `fb279fe`, Edge 타입 보정 `5b9cd2b`, 가이드 검토 기록 `78cae5b`). [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36304646723)와 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36304966790) 성공. <https://kimyongin.github.io/fin/> HTTP 200, 번들 `/fin/assets/index-B_qEFJPA.js` HTTP 200 및 `배분에서 제외` 문구 확인.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`: 적용 전 `public` 스키마·데이터를 로컬 임시 경로 `fin-prod-backup-20260927-160`에 덤프했다. `20260927062326_holding_allocation_inclusion.sql` 한 개만 적용했고 원격 dry-run에서 미적용 migration 없음. seed·DB reset·기존 데이터 삭제 없음.
- Edge Function `portfolio-mcp-oauth` v11 배포. `verify_jwt=false` 유지. 기존 토큰 MCP·시세 함수는 변경하지 않았다. 운영 security advisor의 error 수준 지적 없음.
- 로컬 단위 118건·빌드·인코딩·가이드 검사를 통과했다. CI에서 단위·가이드·Edge 타입·인증된 운영 RPC 호환성·격리 DB/브라우저·빌드가 통과했다. 첫 두 실행은 Edge 타입 선언과 가이드 검토 manifest 누락으로 웹 게시 전에 실패했고 수정 후 전체 재검증했다.
- 실제 본인·친구 Google 로그인, ChatGPT 웹·모바일의 제외/재포함, 모바일 실기기 조작은 수동 확인하지 않았다. 직전 정상 공개 앱 비교 기준은 `2cf700c`이며, 새 DB 컬럼은 기존 앱에서 생략해도 기본 포함으로 호환된다.

### 2026-09-27 배분 태그 비중 파이 차트

- 앱 commit: `2cf700c` (`2643e20` 차트와 문서, `2cf700c` 날짜 고정 브라우저 테스트 보정). [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36293839875)와 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36294146980) 성공. <https://kimyongin.github.io/fin/> HTTP 200, 번들 `/fin/assets/index-yyxT89LN.js` HTTP 200 및 차트 코드·범례 문구 포함 확인.
- 검증: 로컬 단위 114건, 빌드·인코딩·가이드 검사 통과. CI에서 격리 DB/MCP·Chromium 84건, Edge 타입·운영 인증 호환성·빌드 통과. 첫 CI 실행의 실패는 날짜가 바뀌어 환율 기준일의 고정 기대값과 충돌한 테스트였고, 날짜 형식 검증으로 보정한 뒤 전체 재검증했다.
- 운영 Supabase에 새 migration이나 Edge Function 변경 없음. 실제 본인/친구 계정의 차트 시각 확인과 실기기 검증은 남아 있다. 직전 정상 공개 앱 비교 기준은 `0d6a0db`다.

### 2026-09-27 저장 확인에서 활동 태그 지정 (#159)

- 앱 commit: `0d6a0db` (`946d703` 기능, `0d6a0db` 전체 브라우저 검사 보정). [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36261743665)와 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36262093209) 성공. <https://kimyongin.github.io/fin/> HTTP 200, 번들 `/fin/assets/index-Crnp0iif.js` HTTP 200 및 새 `app_save_principle_with_activity` 호출 포함 확인.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`: 추가 migration `20260926171459_activity_tags_on_domain_save.sql` 한 개 적용. 적용 후 원격 dry-run에서 미적용 migration 없음. seed·DB reset·기존 migration 수정은 하지 않았다.
- Edge Function: `portfolio-mcp-oauth` v9 배포, `verify_jwt=false` 설정 유지. 기존 토큰 MCP 함수와 시세 함수는 이번에 변경하지 않았다. 인증된 운영 RPC 호환성 검사와 Edge 타입 검사가 CI에서 통과했다.
- 로컬 DB 713건, 단위 114건, OAuth MCP 저장·조회 계약과 자산·배분·원칙의 임시 계정 Chromium 저장 확인을 통과했다. CI에서는 격리 DB/MCP·Chromium 84건, 가이드·Edge 타입·빌드·운영 인증 호환성이 통과했다. 보안 advisor에서 이번 새 함수의 익명 실행 허용 항목은 없었다.
- 실제 본인/친구 Google 로그인, ChatGPT 웹·모바일 저장 호출, 모바일 실기기 및 0/30개·긴 활동 태그 상태는 아직 수동 확인하지 않았다. 직전 정상 공개 앱 비교 기준은 `d1c8103`이며, 서버 migration은 additive로 유지한다.

### 2026-09-27 도메인 CRUD 동등성 배포

- 앱 commit: `d1c8103` (#151~#158의 로컬 수직 슬라이스와 검증 게이트). [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36253675690)와 후속 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36254028217) 성공. 공개 <https://kimyongin.github.io/fin/> HTTP 200, 번들 `/fin/assets/index-CGCApIbh.js` HTTP 200 및 원칙 이력 삭제·피드백 삭제·공유 설정 초기화 문구 확인.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`: 9개 migration을 순서대로 적용했고 최종 번호는 `20260926163000`이다. `--include-seed`나 DB reset은 실행하지 않았다. 적용 전 `public` 스키마와 데이터를 로컬 임시 경로에 별도 덤프했다.
- Edge Function: `portfolio-mcp-oauth` v8, `portfolio-mcp` v18, `sync-prices` v11. 나머지 함수는 이번 배포에서 변경하지 않았다. 인증된 원격 readiness가 읽기 RPC 10개와 OAuth MCP 도구 발견을 통과했고, 운영 DB security advisor의 error 수준 지적은 없었다.
- 검증: 로컬 pgtap 696개·Vitest 114개·Chromium E2E 83개 통과. CI의 unit·가이드·Edge 타입·원격 인증 호환성·격리 DB/MCP/브라우저·빌드 단계도 성공했다. 이는 실사용 본인·친구 Google 로그인과 ChatGPT 웹/모바일 도구 호출 검증을 대신하지 않는다.
- 승인된 예외: 시세·환율 직접 CRUD는 제공하지 않는다. 웹과 MCP 모두 가격 갱신 경로를 사용한다. 자산 전체 필드의 완전한 양방향 교차와 대규모 목록 조회 효율도 해당 티켓의 미검증 항목으로 유지한다.
- 직전 정상 공개 앱 비교 기준은 `480a2db`. DB 권한·RPC가 바뀌었으므로 앱만 되돌리기 전 현행 서버와의 호환성을 확인한다. migration 이력을 삭제해 복구하지 않는다.

### 2026-09-26 자산 목록 환율 기준 표시

- 앱 commit: `480a2db`. 자산 목록 하단에 현재 목록의 외화 보유에 필요한 최신 저장 환율·각 기준일을 표시한다. 누락·오래된 환율은 구분하며 DB/API 계약은 변경하지 않았다.
- [검증·gh-pages 게시](https://github.com/kimyongin/fin/actions/runs/36242060303)와 후속 [Pages 공개](https://github.com/kimyongin/fin/actions/runs/36242345788) 성공. <https://kimyongin.github.io/fin/> HTTP 200, 새 번들 `/fin/assets/index-DgDziE-t.js` HTTP 200 및 `환율 기준` 문구 확인.
- 로컬 단위 테스트 22파일/109건, 빌드·인코딩·diff 검사, 격리 자산 목록 E2E 통과. CI의 unit·가이드·Edge 타입·인증된 운영 읽기 RPC·격리 DB/브라우저 검사도 통과했다. 실제 사용자 계정·친구 보기·모바일 실기기 확인은 별도로 남아 있다.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`: 새 migration·Edge Function 변경 없음. 마지막 정상 공개 앱 비교 기준은 `41a8ef7`이며 복귀 전 현행 DB와의 호환성을 확인한다.

### 2026-09-26 직접평가·현금성 경고 수정

- 앱 commit: `41a8ef7`. 평가형·현금성에 남은 과거 종목 가격이 `stale_price`로 표시되던 화면 계산을 서버 판정과 일치시켰다. 실제 환산에 필요한 오래된 외화 환율 경고는 유지한다.
- [검증·Pages 배포](https://github.com/kimyongin/fin/actions/runs/36240338697)와 후속 [Pages 게시](https://github.com/kimyongin/fin/actions/runs/36240584588) 성공. 공개 <https://kimyongin.github.io/fin/> HTTP 200, 새 번들 `/fin/assets/index-BqcMFgZZ.js` HTTP 200 확인.
- 로컬 전체 단위 테스트 21파일/107건과 빌드·인코딩·diff 검사 통과. CI의 unit·가이드·Edge 타입·인증된 운영 RPC 호환성·격리 DB/브라우저 및 빌드도 통과했다. 실제 사용자 자산의 경고 해제와 Google/ChatGPT 웹·모바일 수동 사용은 별도로 확인해야 한다.
- 운영 Supabase 프로젝트 `ubmtflglqudrvumepzij`: 새 migration·Edge 변경 없음. 아래 9dd16d1 릴리스의 DB·Edge 적용 상태를 유지하며 재배포하지 않았다. 이전 공개 앱 비교 기준은 `05c156f`; DB와 함께 되돌릴 호환성은 별도 확인 대상이다.

### 2026-09-26 리팩토링·문서 릴리스

- 앱 commit: `05c156f` (#147/#148/#150 로컬 리팩토링과 #149 문서 정리 포함). [검증·Pages 배포](https://github.com/kimyongin/fin/actions/runs/36237408755)가 같은 commit에서 성공했고, 뒤따른 [Pages build/deployment](https://github.com/kimyongin/fin/actions/runs/36237693835)도 성공했다.
- 공개 URL: <https://kimyongin.github.io/fin/> HTTP 200. 새 번들 `/fin/assets/index-Ca6B67Hj.js`가 HTTP 200으로 제공됨을 확인했다.
- 검증 gate: unit, MCP workflow guide, Edge 타입, 운영 테스트 계정의 인증된 읽기 RPC 호환성, 격리 DB·브라우저 테스트와 빌드 통과. 이는 CI 결과이며 실제 본인·친구 로그인 또는 ChatGPT 웹·모바일 사용 확인은 별도다.
- 운영 Supabase: 이번 commit 범위에 새 migration·Edge Function 변경 없음. DB/Edge는 아래 9dd16d1 릴리스의 적용 상태를 유지하며 다시 배포하지 않았다.
- #148/#150 티켓에 남은 수동 viewport·초점·실패 경로 검증은 배포 성공으로 완료 처리하지 않았다. 이전 공개 앱 commit 9dd16d1을 이 기록의 비교 기준으로 보되, 현재 DB와 함께 되돌리는 호환성은 따로 확인해야 한다.

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
