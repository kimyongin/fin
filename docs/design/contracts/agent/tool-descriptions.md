# 도구 설명 카탈로그

> 실행 가능한 description/inputSchema/outputSchema/annotations의 단일 원본은 `supabase/functions/_shared/mcp/portfolio-tools.ts`다. 이 문서는 제품 의도와 과거 문구의 검토 카탈로그이며, 문구를 런타임 계약으로 복사하거나 현재 제공 기능으로 간주하지 않는다. 실제 제공 상태는 OAuth `tools/list`와 공통 정의의 자동 테스트에서 확인한다.

revision 11 · 설명 카탈로그. 스키마/annotations의 코드 원본은 `supabase/functions/_shared/mcp/portfolio-tools.ts`, 동작의 원본은 상위 API 계약이다. 입력 필드 전체를 여기에 복제하지 않는다.

## 설명 작성 형식

각 description은 ‘언제 사용 → 선행 입력/조회 → 하는 일 → 하지 않는 일 → 실패 시 다음 행동’ 순서로 짧게 작성한다. 필드 단위 형식/단위는 schema description에 둔다. 가이드 조회가 실패해도 위험한 오용을 막을 핵심 경계는 생략하지 않는다. read-only/idempotent 등의 메타데이터는 실제 부수 효과와 비교하며 안전성을 보증하는 권한으로 쓰지 않는다.

## 현 OAuth 작업 트리에서 확인한 도구

근거: 공통 도구 정의와 `supabase/functions/portfolio-mcp-oauth/index.ts` handler, 2026-09-22. 로컬 OAuth 종단간 호출을 검증했지만 운영 배포 상태는 아직 검증하지 않았다. prompt/resource 실험 이름은 도구로 세지 않는다. 다른 MCP endpoint 전체 인벤토리를 뜻하지 않는다.

| 이름 / 상태 | description 후보 | 가이드 |
| --- | --- | --- |
| get_workflow_guide / observed-local | 복합 Portfolio 작업 전에 현재 단계·질문·경계·복구 규칙을 topic별로 읽습니다. 사용자 데이터를 조회하거나 작업을 실행하지 않습니다. | W01~W09 |
| get_profile / observed-local | 인증된 Portfolio 계정 프로필을 읽습니다. 투자 성향이나 투자 원칙 조회가 아닙니다. | W01 |
| get_portfolio_state / observed-local | 본인의 계좌·보유·종목·태그·저장 시세를 읽습니다. 증권사 실시간 잔고나 확인 완료를 뜻하지 않습니다. | W01,W05 |
| find_holdings / observed-local | 티커·종목명·계좌명으로 본인의 보유 후보를 찾습니다. 여러 결과가 나오면 변경 전에 대상을 확인하세요. | W05,W06 |
| update_entity_note / local | 현재 메모를 먼저 읽고 계좌·종목·보유 항목의 기존 메모만 충돌 방지 방식으로 수정합니다. 수량·원가·검증 상태는 바꾸지 않습니다. 여러 세션에 공통 적용할 데이터 관리 규칙 저장에는 사용하지 않습니다. | 대상별 메모 |
| get_strategy_state / observed-local | 저장된 운용 전략·목표 버킷·태그 연결을 읽습니다. 운용 모드를 개인 성향으로 추정하지 않습니다. | W01,W02 |
| get_news_state / observed-local | 이미 저장된 뉴스 사실과 의견을 읽습니다. 최신 뉴스를 인터넷에서 검색하는 도구가 아닙니다. | W01,W04 |
| list_recent_activity / observed-local | 본인의 최근 데이터 변경을 조회합니다. 활동 기록을 투자 결정이나 실제 증권사 체결 증명으로 해석하지 않습니다. | W06,W08 |
| submit_product_feedback / observed-local | 사용자가 명시적으로 요청했거나 에이전트의 한 번의 요약 제안에 동의한 Portfolio 제품 피드백을 비공개로 저장합니다. 대화 전문·투자 데이터·인증정보·추정 원인을 첨부하거나 GitHub에 공개하지 않습니다. | W09 |
| list_my_product_feedback / observed-local | 본인이 남긴 제품 피드백의 상태·운영자 답변·연결 이슈만 조회합니다. 타인의 접수나 관리자 큐를 노출하지 않습니다. | W09 |
| get_daily_context / observed-local | 요청한 점검에 필요한 보유·원칙·이전 분석·과거 조사 범위를 서버 임시 문맥으로 준비합니다. 분석 저장·열람·잔고 확인은 기록하지 않으며 인터넷 뉴스도 검색하지 않습니다. | W01 |
| save_daily_briefing / observed-local | 명시적 저장 요청에 따라 context_id와 조사 근거·범위·브리핑을 저장합니다. 원칙 수정·사용자 판단 채택·실제 매매는 하지 않으며 실패를 저장 완료로 설명하면 안 됩니다. | W01,W04,W08 |
| list_daily_briefings / observed-local | 본인의 저장 분석 요약을 분석 시각 역순으로 읽습니다. 조회로 열람이나 잔고 확인을 기록하지 않습니다. | W08 |
| get_daily_briefing / observed-local | 본인의 브리핑과 당시 문맥·근거·확인 출처·조사 범위를 읽습니다. 현재 데이터와 당시 snapshot을 혼동하지 않습니다. | W08 |
| record_investment_decision / observed-local | 사용자가 명시적으로 기록을 요청한 제안 또는 채택 판단을 구분해 저장하고 조사할 일 최대 3개를 함께 만듭니다. 실행 계획·체결·주문·잔고 변경은 하지 않습니다. | W03 |
| list_investment_decisions / observed-local | 본인의 판단을 최근 갱신 순서로 읽고 proposed와 adopted를 구분합니다. | W03,W08 |
| get_investment_decision / observed-local | 본인의 판단 상세·초기 상태 이력·연결된 조사 할 일을 읽습니다. 조회로 판단 상태를 변경하지 않습니다. | W03,W08 |
| list_tasks / observed-local | 본인의 조사·점검할 일을 상태별로 읽습니다. 주문이나 체결 목록이 아닙니다. | W04,W08 |
| get_task / observed-local | 본인의 할 일 상세·이력·연결 판단 ID를 읽습니다. 조회로 완료·보류·종료하지 않습니다. | W04,W08 |
| transition_investment_decision / observed-local | 현재 version을 읽은 뒤 사용자의 명시적 의도로 proposed 판단을 채택하거나 거절합니다. 기존 선택지와 이유를 요구하며 주문·체결·원칙을 변경하지 않습니다. | W03 |
| transition_task / observed-local | 현재 version을 읽고 조사 질문을 대기·해결·재개하거나 사용자의 요청으로 보류·재개·종료합니다. 해결은 답과 출처, 재개는 새 근거가 필요하며 매매 진행도를 변경하지 않습니다. | W04,W08 |
| get_investment_policy / observed-local | 본인이 명시적으로 저장한 개인 투자 기준과 기존 운용 전략을 함께 읽습니다. 미입력을 보유 종목이나 운용 모드에서 추론하지 않습니다. | W02 |
| save_investment_policy / observed-local | 사용자가 명시적으로 저장/변경한 개인 기준 필드만 현재 version과 함께 수정합니다. null은 명시적 삭제이며 목표 비중·운용 모드·보유·판단은 변경하지 않습니다. | W02 |
| list_operating_rules / observed-local | 특정 workflow에 저장된 활성 데이터 관리 규칙을 읽습니다. 빈 목록과 조회 실패를 구분하고 applicability를 실제 입력과 대조합니다. | W06 |
| save_operating_rule / observed-local | 사용자가 기억하라고 요청한 적용 조건과 처리 규칙을 CAS·멱등 방식으로 저장합니다. 규칙은 금융 검증이나 현재 지시를 우회하지 않습니다. | W06 |
| archive_operating_rule / observed-local | 더 이상 적용하지 않을 규칙을 이력은 보존한 채 보관합니다. 과거 대조 결과나 보유값은 바꾸지 않습니다. | W06 |
| list_general_tasks / observed-local | 본인의 일반 할 일을 상태별로 읽습니다. 조사・실행 과제나 이미 수행한 이벤트 목록을 대신하지 않습니다. | A02,A04 |
| get_general_task / observed-local | 일반 할 일의 현재 상태와 보존된 이력을 읽습니다. 조회로 회차를 완료하거나 재개하지 않습니다. | A02,A04 |
| save_general_task / observed-local | 사용자가 기억해 달라고 한 일회성 또는 매일 반복 미래 행동을 저장합니다. 활동에서 직접 이어진 할 일은 origin_activity_id로 선택 연결합니다. | A02,A04 |
| transition_general_task / observed-local | 현재 version과 회차 날짜를 확인해 일반 할 일을 완료・재개・보류・종료하고 연결 이벤트를 한 번만 남깁니다. 같은 일을 manual activity로 중복 기록하지 않습니다. | A02,A04 |
| get_activity / observed-local | 활동의 현재 제목·메모·결과·결론, 편집 허용 필드, 원본 대상 ID, 수행 태스크와 후속 할 일을 조회합니다. 판단 활동의 target ID는 기존 판단 정본을 상세 조회하는 데 사용합니다. | A03 |
| record_manual_activity / observed-local | 이미 수행한 일을 일반·조사·점검·판단·회고 중 하나의 활동으로 기록합니다. 분류는 생략하면 일반이며, 조사 출처·범위는 선택적 context에 넣습니다. 분류만으로 잔고·체결·검증 사실을 만들 수 없습니다. 민감한 조사·점검·판단·회고 본문은 소유자만 봅니다. | A03 |
| update_activity / observed-local | 같은 수행의 현재 활동을 수정합니다. 수동 기록은 비금융 분류와 출처/범위도 정정할 수 있지만, 할 일 완료·금융 자동 기록의 분류와 원본 사실은 보호합니다. | A03 |
| search_activities / observed-local | 할 일과 한 일을 기간·상태·결론·종목·계좌·활동 태그·키워드로 함께 검색합니다. 첫 완료 활동 페이지는 가능한 경우 의미 유사도를 보완하고 `semantic_status`로 실행 여부를 알리며, 불가능하면 정상 키워드 결과를 유지합니다. | A03,A06 |
| list_activity_tags, save_activity_tag, delete_activity_tag / observed-local | 자산 배분과 분리된 사용자 활동 태그 사전을 조회·추가·이름 변경·삭제합니다. | A03 |
| set_activity_tags, set_general_task_tags / observed-local | 활동 또는 일반 할 일의 태그 집합을 교체합니다. 완료 시 현재 태그만 복사되고 과거 회차는 바뀌지 않습니다. | A03 |
| get_activity_report_context / observed-local | 지정 기간 활동의 최신 현재 내용과 태그를 안정 커서로 끝까지 조회합니다. 현재 미완료 과제는 과거 시점 복원이 아니라 요청 당시 snapshot임을 명시합니다. | A06 |
| list_activity_reports / observed-local | 저장된 일간·주간·월간 활동 리포트와 포함 활동 수정·기간 이동·새 원본에 따른 재생성 필요 상태를 조회합니다. 자동 재작성하지 않습니다. | A06 |
| save_activity_report / observed-local | 사용자가 요청한 기간 회고를 원본 event/task/decision ID와 함께 버전 저장합니다. 자동 생성이나 투자 행동 기록은 만들지 않습니다. | A06 |
| get_holding_thesis / observed-local | 종목 공통 보유 이유와 선택한 계좌의 재정의, 실제 적용 출처와 version을 읽습니다. 기존 메모나 미입력 이유를 추론하지 않습니다. | W02 |
| save_holding_thesis / observed-local | 사용자가 명시적으로 저장/변경한 종목 공통 또는 계좌별 보유 이유만 현재 version과 함께 수정합니다. 메모·잔고·체결·판단·할 일은 변경하지 않습니다. | W02 |
| link_task_to_holding_thesis / observed-local | 현재 version을 읽은 보유 이유와 할 일을 연결만 합니다. 이유·할 일 상태·잔고·체결은 변경하지 않습니다. | W02,W04 |
| preview_trade_entry / observed-local | 이미 체결된 시장형 매매 입력이 현재 수량·평균가를 어떻게 바꾸는지 서버에서 미리 계산합니다. 저장·주문·현금 이동·잔고 확인은 하지 않습니다. | W05 |
| log_completed_trade / observed-local | 사용자가 기록을 요청한 완료 매매의 유효한 preview를 멱등 확정해 로컬 수량·평균가를 갱신합니다. 증권사 주문이나 잔고 확인은 하지 않습니다. | W05 |
| list_transactions / observed-local | Portfolio 새 원장에 기록한 완료 체결을 읽습니다. 증권사 전체 거래내역이나 legacy/미입력 거래까지 완전하다고 설명하지 않습니다. | W05,W06 |
| get_holding_integrity / observed-local | 한 보유의 마지막 절대 보정과 명시적 증권사 확인 범위, 확인 뒤 값 변경 여부를 읽습니다. 미확인을 불일치로 해석하지 않습니다. | W06 |
| get_portfolio_integrity / observed-local | 전체·계좌별로 확인됨, 확인 뒤 변경됨, 미확인 보유 수를 요약합니다. 오래된 상태만으로 오류를 단정하거나 값을 변경하지 않습니다. | W06 |
| preview_holding_reconciliation / observed-local | 사용자가 제시한 실제 현재값으로 시장형/평가형/현금성 잔고를 바꿀 영향을 미리 계산합니다. 아직 값을 바꾸거나 확인 완료로 기록하지 않습니다. | W06 |
| reconcile_holding / observed-local | 사용자가 확인한 최신 preview를 절대 기준점으로 저장합니다. 거래를 만들지 않고 명시한 필드만 선택적으로 실제 확인 기록에 포함합니다. | W06 |
| verify_holdings / observed-local | 현재 version에서 사용자가 증권사와 비교했다고 명시한 필드와 선택적 확인 메모를 기록합니다. 저장 결과와 최신 integrity 조회에서 메모·작성 경로를 다시 읽습니다. 잔고·원가·시세·브리핑은 변경하지 않습니다. | W06 |
| preview_trade_reversal / observed-local | 잘못 기록한 체결 취소의 후속 잔고 영향을 계산합니다. 보정 이전 거래이면 현재 잔고 영향이 없을 수 있습니다. 아직 취소하지 않습니다. | W06 |
| reverse_trade_entry / observed-local | 확인된 preview로 기존 체결 기록을 무효화하고 필요한 잔고를 갱신합니다. 증권사 주문 취소나 반대 방향 실제 매매가 아니며 원본 이력은 보존합니다. | W06 |
| save_execution_task / observed-local | 사용자가 명시적으로 기억해 달라는 시장형 수량 매수·매도 계획을 저장합니다. 계획만 기록하며 주문·체결·잔고를 만들지 않습니다. | W03,W05 |
| link_trade_to_task / observed-local | 이미 기록한 체결을 계좌·종목·방향이 같은 실행 계획 하나에 연결해 진행도를 계산합니다. 체결이나 잔고는 변경하지 않습니다. | W05 |
| transition_execution_task / observed-local | 사용자 요청으로 실행 계획만 보류·재개·취소합니다. 기존 체결과 잔고는 유지하며 계획 취소는 체결 취소가 아닙니다. | W03,W05 |

기존 읽기를 합쳐 문맥을 구성할 수 있어도 새 서버 context/조사 범위와 동등하다고 주장하지 않는다. 쓰기 도구가 없으면 분석만 제공하고 앱에 저장했다고 말하지 않는다.

## 계획 도구 설명

전부 planned. 일일/생애주기 API의 기술 게이트 완료 전 등록하지 않는다. 각 목록/상세 이름은 구현 때 확정하며 slash 표기는 설명상 묶음이지 실제 도구 이름이 아니다.

| 이름 | description 후보 | 가이드 |
| --- | --- | --- |
| save_task | 요청한 조사 질문을 독립 저장합니다. 현재 조사 질문은 판단 기록의 후속 항목으로 만들 수 있고, 독립 생성은 후속입니다. | W03,W04 |
| get_research_history | 저장된 사건·근거·정정 관계를 대상별로 조회합니다. 인터넷 검색이 아니며 URL 일치만으로 같은 사건이라 단정하지 않습니다. | W01,W04 |

## 선택적 가이드 도구 계약안 — 구현 이력

2026-09-21: 아래 최초 계약안은 [현재 설계](./workflow-guide-design.md)와 #63~#65로 구체화했다. 2026-09-22 로컬 registry에는 product_feedback과 activity_report를 포함한 아홉 topic이 등록되어 있다. 운영 배포와 모델 평가는 남아 있으며 아래 문구는 과거 검토 기록이다.

`get_workflow_guide` / observed-local / read-only: topic은 daily_review, policy, holding_thesis, decision_followup, trade_entry, reconciliation, todo, activity_report, product_feedback 중 하나. 출력은 guide_id/revision, 실제 사용 가능한 도구에 한정한 steps, 금지 부수 효과, 오류 후 다음 행동, unavailable_steps다. 사용자별 데이터나 저장 기능이 없다. unknown topic은 validation_error.

설명 후보: ‘여러 단계가 필요한 Portfolio 작업의 사용 순서와 주의점을 읽습니다. 간단한 조회마다 호출할 필요는 없습니다. 가이드는 기능을 실행하거나 사용자 승인을 대신하지 않습니다.’

가이드는 trusted 정적 문서에서 선택하고 사용자의 메모/뉴스로 instructions를 조립하지 않는다. 배포된 기능 registry와 대조하여 미지원 단계는 실행 가능한 것처럼 반환하지 않는다. 가이드 전체에 개인정보를 넣지 않는다. 같은 revision의 같은 topic은 대화에서 재사용할 수 있다.

앱 전용 mark_briefing_viewed, 공유 설정/미리보기, 표 편집 서비스는 MCP 도구 카탈로그에 자동 등록하지 않는다. 기존 저장 뉴스 CRUD와 신규 개인 근거 저장의 공개 범위를 합치지 않는다.
