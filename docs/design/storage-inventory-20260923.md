# #86 저장 구조 전수 대조 — 2026-09-23

## 조사 사실

- 로컬 public 기본 테이블 78개, 운영 public 기본 테이블 62개. 사용자 데이터 내용은 읽지 않았고 테이블별 행 수만 조회했다.
- 로컬 public 함수 169개, 운영 129개. 로컬 새 활동/반복/검색 구조가 운영보다 앞서 있다. 운영 앱/Edge의 실제 배포 상태는 별도 확인이 필요하다.
- 운영의 실제 사용 데이터: accounts 7, holdings 43, instruments 20, holding_prices_daily 1213, activity_events 133, news_facts 2, feedback 1. 보정/검증 내역도 각각 47/63건 있으므로 과거 구조를 빈 것으로 가정할 수 없다.
- 아래 '행 수'는 조사 시점 read-only count다. '방향'은 새 설계의 후보이며 삭제 승인이나 이관 완료 판정이 아니다. 코드 소비자는 영역별 요약이고, 정확한 DB 함수/FK/트리거 목록과 배포된 외부 소비자는 #91에서 폐기 직전 재검증한다.

## 영역별 주요 소비자

- 기반 유지: 자산/공유/피드백 화면과 app_* RPC.
- 활동 통합: 오늘·활동·자료/판단 화면, 점검·검색 MCP와 app_* RPC.
- 할 일 통합: 활동 목록·반복 UI와 task RPC/MCP.
- 원칙 통합: 원칙 UI, 기준/규칙 RPC/MCP.
- 메모 통합: 자산 보유 이유 UI·thesis RPC/MCP.
- 현재 보유값 통합: 자산 매매·보정 UI와 financial RPC/MCP.
- 보조 재검토: 검색·문맥·재시도·구 ToDo 또는 토큰 MCP.

## 모든 기본 테이블의 처분 후보

| 테이블 | 로컬 행 | 운영 행 | 방향 |
| --- | ---: | ---: | --- |
| `accounts` | 0 | 7 | 기반 유지 |
| `activity_embeddings` | 0 | 없음 | 보조 재검토 |
| `activity_event_tags` | 0 | 없음 | 보조 재검토 |
| `activity_events` | 6 | 133 | 활동 통합 |
| `activity_mutation_receipts` | 0 | 없음 | 보조 재검토 |
| `activity_report_mutation_receipts` | 0 | 없음 | 보조 재검토 |
| `activity_report_revisions` | 0 | 없음 | 보조 재검토 |
| `activity_reports` | 0 | 없음 | 활동 통합 |
| `activity_tags` | 0 | 없음 | 보조 재검토 |
| `agent_tokens` | 0 | 2 | 보조 재검토 |
| `daily_briefing_evidence` | 0 | 0 | 활동 통합 |
| `daily_briefing_scope_evidence` | 0 | 0 | 활동 통합 |
| `daily_briefing_scope_sources` | 0 | 0 | 활동 통합 |
| `daily_briefing_scopes` | 0 | 0 | 활동 통합 |
| `daily_briefings` | 0 | 0 | 활동 통합 |
| `daily_reports` | 없음 | 0 | 활동 통합 |
| `daily_review_contexts` | 0 | 0 | 보조 재검토 |
| `daily_review_mutation_receipts` | 0 | 0 | 보조 재검토 |
| `decision_task_mutation_receipts` | 0 | 0 | 할 일 통합 |
| `entity_note_mutation_receipts` | 0 | 없음 | 현재 보유값 통합 |
| `execution_plans` | 0 | 0 | 할 일 통합 |
| `feature_sharing_grants` | 0 | 0 | 기반 유지 |
| `feature_sharing_policies` | 0 | 0 | 기반 유지 |
| `friendships` | 0 | 1 | 기반 유지 |
| `general_task_mutation_receipts` | 6 | 없음 | 할 일 통합 |
| `general_task_occurrence_states` | 2 | 없음 | 할 일 통합 |
| `holding_integrity_mutation_receipts` | 0 | 63 | 현재 보유값 통합 |
| `holding_prices_daily` | 0 | 1213 | 기반 유지 |
| `holding_reconciliation_previews` | 0 | 47 | 현재 보유값 통합 |
| `holding_reconciliations` | 0 | 47 | 현재 보유값 통합 |
| `holding_theses` | 0 | 0 | 메모 통합 |
| `holding_thesis_history` | 0 | 0 | 메모 통합 |
| `holding_thesis_mutation_receipts` | 0 | 0 | 메모 통합 |
| `holding_thesis_task_receipts` | 0 | 0 | 메모 통합 |
| `holding_thesis_tasks` | 0 | 0 | 메모 통합 |
| `holding_verifications` | 0 | 63 | 현재 보유값 통합 |
| `holdings` | 0 | 43 | 기반 유지 |
| `instrument_tags` | 0 | 18 | 기반 유지 |
| `instruments` | 0 | 20 | 기반 유지 |
| `investment_decision_state_history` | 0 | 0 | 활동 통합 |
| `investment_decision_tasks` | 0 | 0 | 활동 통합 |
| `investment_decisions` | 0 | 0 | 활동 통합 |
| `investment_policy_history` | 0 | 1 | 원칙 통합 |
| `investment_policy_mutation_receipts` | 0 | 1 | 원칙 통합 |
| `investment_policy_profiles` | 0 | 1 | 원칙 통합 |
| `news_fact_annotations` | 0 | 2 | 활동 통합 |
| `news_facts` | 0 | 2 | 활동 통합 |
| `operating_rule_history` | 0 | 없음 | 원칙 통합 |
| `operating_rule_mutation_receipts` | 0 | 없음 | 원칙 통합 |
| `operating_rules` | 0 | 없음 | 원칙 통합 |
| `portfolio_snapshots` | 없음 | 0 | 활동 통합 |
| `portfolio_task_activity_tags` | 0 | 없음 | 할 일 통합 |
| `portfolio_task_evidence` | 0 | 0 | 활동 통합 |
| `portfolio_task_history` | 4 | 0 | 할 일 통합 |
| `portfolio_tasks` | 2 | 0 | 할 일 통합 |
| `product_feedback` | 0 | 1 | 기반 유지 |
| `product_feedback_admin_events` | 0 | 0 | 기반 유지 |
| `product_feedback_admins` | 0 | 1 | 기반 유지 |
| `product_feedback_mutation_receipts` | 0 | 1 | 기반 유지 |
| `profiles` | 0 | 1 | 기반 유지 |
| `rebalance_suggestions` | 없음 | 0 | 활동 통합 |
| `strategies` | 0 | 1 | 기반 유지 |
| `strategy_bucket_mode_targets` | 0 | 18 | 기반 유지 |
| `strategy_bucket_tags` | 0 | 9 | 기반 유지 |
| `strategy_buckets` | 0 | 6 | 기반 유지 |
| `sync_runs` | 없음 | 8 | 보조 재검토 |
| `tags` | 0 | 9 | 기반 유지 |
| `task_fill_links` | 0 | 0 | 할 일 통합 |
| `todo_bundle_decision_links` | 0 | 없음 | 보조 재검토 |
| `todo_bundle_mutation_receipts` | 0 | 없음 | 보조 재검토 |
| `todo_bundle_rule_links` | 0 | 없음 | 보조 재검토 |
| `todo_bundle_verification_links` | 0 | 없음 | 보조 재검토 |
| `todo_bundles` | 0 | 없음 | 보조 재검토 |
| `todo_item_action_migrations` | 0 | 없음 | 보조 재검토 |
| `todo_items` | 0 | 없음 | 보조 재검토 |
| `trade_entries` | 0 | 0 | 현재 보유값 통합 |
| `trade_entry_mutation_receipts` | 0 | 0 | 현재 보유값 통합 |
| `trade_previews` | 0 | 0 | 현재 보유값 통합 |
| `trade_reversal_mutation_receipts` | 0 | 0 | 현재 보유값 통합 |
| `trade_reversal_previews` | 0 | 0 | 현재 보유값 통합 |
| `trade_reversals` | 0 | 0 | 현재 보유값 통합 |
| `transactions` | 없음 | 0 | 현재 보유값 통합 |
| `viewer_sessions` | 0 | 5 | 기반 유지 |

## 처리 규칙

- '기반 유지'는 현재 필요성을 인정한 기능군이다. 변경되는 공유 DTO/메모 공개 범위는 별도 검증한다.
- '활동/할 일/원칙/메모/현재 보유값 통합'은 원본 데이터의 목적지다. 새 쓰기/조회 경로가 검증되기 전 원본 테이블을 삭제하지 않는다.
- '보조 재검토' 중 검색 임베딩·태그 관계, 중복 방지 기록, 반복 회차 상태는 실제 소비자가 있으면 유지할 수 있다. 구 ToDo는 종료 대상이고 토큰 MCP는 실제 이용 여부를 조사한다. sync_runs는 가격 동기화 운영 기록이므로 자동 삭제하지 않는다.
- 운영에는 로컬의 activity_tags/embeddings/reports, general_task_occurrence_states 등이 아직 없다. 로컬 성공을 운영 완료로 보고 테이블을 지우거나 운영 마이그레이션을 적용하지 않는다.
