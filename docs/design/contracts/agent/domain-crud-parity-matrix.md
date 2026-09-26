# 도메인 HTTP·OAuth MCP 계약표

2026-09-26 · 로컬 구현 기준. `웹 HTTP`는 브라우저가 호출하는 Supabase RPC/Edge 함수이며, 화면의 모든 조작을 실제 브라우저로 검증했다는 뜻은 아니다. 운영 배포와 ChatGPT 웹·모바일 연결 확인은 별도다.

| 사용자 데이터·행위 | 웹 HTTP (RPC/Edge) | OAuth MCP | 로컬 자동 증거 / 남은 범위 |
| --- | --- | --- | --- |
| 계좌 C/R/U/D, 메모 | `app_save_account`, `app_get_portfolio_state`, `app_delete_account` | `save_account`, `get_portfolio_state`, `delete_account`, `update_entity_note` | `app_rpc_test`, `asset_write_boundary_test`, `test-mcp-contract`; 기존 보유 있으면 삭제 거부. 직접 웹 변경과 MCP 교차 조회는 미검증. |
| 종목 C/R/U/D, 메모·대표 태그 | `app_create_instrument`, `app_get_portfolio_state`, `app_save_asset_detail_current`, `app_delete_instrument` | `create_instrument`, `get_portfolio_state`, `save_asset_detail`, `delete_instrument`, `update_entity_note` | `asset_detail_current_test`, `test-mcp-contract`; 가격 직접 쓰기 금지. 직접 웹 변경과 MCP 교차 조회는 미검증. |
| 계좌별 보유 C/R/U/D | `app_save_asset_detail_current`, `app_get_portfolio_state`, `app_delete_holding_checked`; 매매·보정 전용 RPC | `save_asset_detail`, `get_portfolio_state`, `delete_holding`; 매매·보정 전용 도구 | `checked_holding_delete_test`, `test-mcp-contract`; 시장/평가/현금·복수 계좌 MCP 저장→HTTP 조회, 버전·재시도 검증. HTTP 저장→MCP 재조회 전체 필드는 미검증. |
| 자산 태그 C/R/U/D·연결 | `app_save_tag`, `app_get_portfolio_state`, `app_delete_tag`, `app_save_asset_detail_current` | `save_asset_tag`, `get_portfolio_state`, `delete_asset_tag`, `save_asset_detail` | `clear_allocation_targets_test`, `test-mcp-contract`; 목표가 남은 태그 삭제 거부. 모바일/데스크톱 태그 조작 검증은 남음. |
| 목표 배분 C/R/U/D(전체 초기화) | `app_save_allocation_targets`, `app_get_strategy_state`, `app_clear_allocation_targets` | `save_allocation_targets`, `get_strategy_state` | `clear_allocation_targets_test`, `test-mcp-contract`; 빈 목록은 미설정으로 복귀. 화면 조작 검증은 남음. |
| 할 일·반복 C/R/U/D·완료 | `app_save_general_task_detail`, `app_list_general_task_page`, `app_get_general_task`, `app_delete_general_task`, `app_transition_general_task` | `save_general_task`, `list_general_tasks`, `get_general_task`, `delete_general_task`, `transition_general_task` | `general_task_delete_test`, `atomic_tagged_creation_test`, `test-mcp-contract`; 삭제 시 관련 기록 보존. 전체 필드의 양방향 교차는 미검증. |
| 활동 기록 C/R/U/D | `app_create_activity_with_tags`, `app_search_activities`, `app_get_activity`, `app_save_activity_detail`, `app_delete_activity` | `record_manual_activity`, `search_activities`, `get_activity`, `update_activity`, `delete_activity` | `activity_body_delete_test`, `test-mcp-contract`; 금융 상태 비역행. 전체 필드 양방향 교차는 미검증. |
| 활동 태그 C/R/U/D·연결 | `app_save_activity_tag`, `app_list_activity_tags`, `app_delete_activity_tag`, `app_set_activity_tags`, `app_set_general_task_tags` | 동명의 목적별 tag 도구 | `activity_tags_search_test`, `test-mcp-contract`; 삭제는 태그만 제거. |
| 원칙 현재 문서·이력 C/R/U/D | `app_save_principle_checked`, `app_list_principles`, `app_list_principle_changes`, `app_get_principle_row`, `app_correct_principle_row`, `app_delete_principle_row` | `save_principle`, `list_principles`, `list_principle_changes`, `get_principle_row`, `correct_principle_row`, `delete_principle_row` | `principle_history_crud_test`, `test-mcp-contract`; 이력행 삭제/정정은 정책 변경과 구별. |
| 내 피드백 C/R/U/D | `app_submit_product_feedback`, `app_list_my_product_feedback`, `app_get_my_product_feedback`, `app_update_my_product_feedback`, `app_delete_my_product_feedback` | 대응 `submit/list/get/update/delete_my_product_feedback` | `feedback_owner_crud_test`, `test-mcp-contract`; 외부 GitHub 이슈는 삭제하지 않음. |
| 프로필·공유 설정 C/R/U/D, 아이콘 | `app_save_sharing_profile`, `app_get_sharing_profile`, `app_reset_sharing_profile`, `app_set_profile_avatar` | `save_sharing_profile`, `get_sharing_profile`, `reset_sharing_profile`, `set_profile_avatar` | `sharing_profile_safe_crud_test`, `test-mcp-contract`; 해시 비노출, 초기화 후 접근 차단. |
| 친구 연결 C/R/U(재인증)/D, 읽기 공유 | `add_friend`, `list_friends`, `remove_friend`, `app_list_portfolio_viewers`, `app_get_portfolio_state(owner)` | `connect_friend`, `list_friends`, `remove_friend`, `list_portfolio_viewers`, `get_shared_portfolio_state` | `sharing_profile_safe_crud_test`, `test-mcp-contract`; owner 선택은 읽기 전용, 마지막 열람은 웹 성공시에만 기록. |
| 시세·환율 R/공급자 갱신 (명시적 CRUD 예외) | `app_get_portfolio_state`, `sync-prices` Edge | `get_portfolio_state`, `sync_prices` | `price_sync_contract_test`, `test-mcp-contract`; 임의 가격/날짜/환율 입력·삭제 도구 없음. 실제 외부 공급자 성공/실패 fixture는 남음. |

## 판정 및 배포 게이트

- `portfolio-tools.test.ts`가 모든 삭제/초기화 도구의 destructiveHint와 미저장 preview의 readOnlyHint를 검사한다. `test-mcp-contract.mjs`는 실제 OAuth initialize → tools/list → tools/call을 사용한다. 문서/코드의 도구 존재만으로 완료 판정하지 않는다.
- 로컬 `npm run test:db`, `npm run test`, `npm run check:workflow-guides`, Deno check, build, `npm run test:e2e` 결과를 해당 티켓에 적는다. 환경별 호환 증거는 별개다.
- 운영은 DB 마이그레이션 → Edge 함수 → 웹 순으로 적용한다. 사전 백업·적용 목록·RPC 권한을 확인하고, 부분 배포 시 새 클라이언트가 안전한 이전 경로를 쓰는지 검증한다. 운영 DB에서 파괴 CRUD를 시험하지 않는다.
- 운영 OAuth `/functions/v1/portfolio-mcp-oauth`의 initialize/tools/list 및 실제 호출을 배포 버전과 대조한다. ChatGPT에 오래된 도구가 보이면 연결 URL과 배포를 먼저 확인한 뒤 도구 목록 재조회/재연결을 안내한다. 서버 미배포를 캐시 문제라고 단정하지 않는다.
- 운영 DB/Edge/웹 및 ChatGPT 웹·모바일의 실측 결과가 없으므로 이 표는 배포 완료 증거가 아니다. 원격 데이터 삭제나 사용자 데이터 테스트는 별도 승인 없이 하지 않는다.
