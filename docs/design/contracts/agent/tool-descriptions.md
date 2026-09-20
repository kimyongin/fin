# 도구 설명 카탈로그

revision 4 · 설명 카탈로그. 스키마/annotations의 코드 원본은 `supabase/functions/_shared/mcp/portfolio-tools.ts`, 동작의 원본은 상위 API 계약이다. 입력 필드 전체를 여기에 복제하지 않는다.

## 설명 작성 형식

각 description은 ‘언제 사용 → 선행 입력/조회 → 하는 일 → 하지 않는 일 → 실패 시 다음 행동’ 순서로 짧게 작성한다. 필드 단위 형식/단위는 schema description에 둔다. 가이드 조회가 실패해도 위험한 오용을 막을 핵심 경계는 생략하지 않는다. read-only/idempotent 등의 메타데이터는 실제 부수 효과와 비교하며 안전성을 보증하는 권한으로 쓰지 않는다.

## 현 OAuth 작업 트리에서 확인한 도구

근거: 공통 도구 정의와 `supabase/functions/portfolio-mcp-oauth/index.ts` handler, 2026-09-21. 로컬 OAuth 종단간 호출을 검증했지만 운영 배포 상태는 아직 검증하지 않았다. prompt/resource 실험 이름은 도구로 세지 않는다. 다른 MCP endpoint 전체 인벤토리를 뜻하지 않는다.

| 이름 / 상태 | description 후보 | 가이드 |
| --- | --- | --- |
| get_profile / observed-local | 인증된 Portfolio 계정 프로필을 읽습니다. 투자 성향이나 투자 원칙 조회가 아닙니다. | W01 |
| get_portfolio_state / observed-local | 본인의 계좌·보유·종목·태그·저장 시세를 읽습니다. 증권사 실시간 잔고나 확인 완료를 뜻하지 않습니다. | W01,W05 |
| find_holdings / observed-local | 티커·종목명·계좌명으로 본인의 보유 후보를 찾습니다. 여러 결과가 나오면 변경 전에 대상을 확인하세요. | W05,W06 |
| get_strategy_state / observed-local | 저장된 운용 전략·목표 버킷·태그 연결을 읽습니다. 운용 모드를 개인 성향으로 추정하지 않습니다. | W01,W02 |
| get_news_state / observed-local | 이미 저장된 뉴스 사실과 의견을 읽습니다. 최신 뉴스를 인터넷에서 검색하는 도구가 아닙니다. | W01,W04 |
| list_recent_activity / observed-local | 본인의 최근 데이터 변경을 조회합니다. 활동 기록을 투자 결정이나 실제 증권사 체결 증명으로 해석하지 않습니다. | W06,W08 |
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
| get_holding_thesis / observed-local | 종목 공통 보유 이유와 선택한 계좌의 재정의, 실제 적용 출처와 version을 읽습니다. 기존 메모나 미입력 이유를 추론하지 않습니다. | W02 |
| save_holding_thesis / observed-local | 사용자가 명시적으로 저장/변경한 종목 공통 또는 계좌별 보유 이유만 현재 version과 함께 수정합니다. 메모·잔고·체결·판단·할 일은 변경하지 않습니다. | W02 |

기존 읽기를 합쳐 문맥을 구성할 수 있어도 새 서버 context/조사 범위와 동등하다고 주장하지 않는다. 쓰기 도구가 없으면 분석만 제공하고 앱에 저장했다고 말하지 않는다.

## 계획 도구 설명

전부 planned. 일일/생애주기 API의 기술 게이트 완료 전 등록하지 않는다. 각 목록/상세 이름은 구현 때 확정하며 slash 표기는 설명상 묶음이지 실제 도구 이름이 아니다.

| 이름 | description 후보 | 가이드 |
| --- | --- | --- |
| save_task | 요청한 조사 질문 또는 실행 계획을 저장합니다. 기존 질문을 수정하면 ID/기대 버전을 지정합니다. 매일 같은 질문을 새로 만들지 않고 계획 저장으로 체결을 생성하지 않습니다. | W03,W04 |
| link_trade_to_task | 이미 기록한 체결을 같은 계좌·종목·방향의 실행 계획에 연결/해제합니다. 잔고는 변경하지 않으며 한 체결을 여러 계획에 중복 집계하지 않습니다. | W05 |
| get_research_history | 저장된 사건·근거·정정 관계를 대상별로 조회합니다. 인터넷 검색이 아니며 URL 일치만으로 같은 사건이라 단정하지 않습니다. | W01,W04 |
| preview_trade_entry | 이미 발생한 매매의 계좌·종목·일자·수량·단가로 잔고 변화를 계산합니다. 모호한 대상/순서를 먼저 확인하세요. 체결 기록이나 주문은 실행하지 않습니다. | W05 |
| log_completed_trade | 명시적으로 입력한 완료 매매를 유효한 preview로 기록하고 수량·평균가 및 선택 계획 진행을 갱신합니다. 주문·자동 현금차감·실제 잔고 확인은 하지 않습니다. stale preview면 새 계산을 확인하세요. | W05 |
| preview_holding_reconciliation | 실제 현재값 또는 오류 수정값으로 잔고를 보정할 영향을 미리 계산합니다. 수량/평균가 또는 해당 자산 유형의 금액을 사용합니다. 보정이나 가상 체결을 아직 기록하지 않습니다. | W06 |
| reconcile_holding | 확인한 preview대로 절대 잔고 기준점을 저장합니다. 과거 이력을 삭제하거나 실행 계획의 체결을 만들지 않습니다. 실제 잔고 확인은 사용자가 명시한 범위만 기록합니다. | W06 |
| preview_trade_reversal | 잘못 기록한 체결 취소의 후속 잔고·계획 영향을 계산합니다. 보정 이전 거래이면 현재 잔고 영향이 없을 수 있습니다. 아직 취소하지 않습니다. | W06 |
| reverse_trade_entry | 확인된 preview로 기존 체결 기록을 무효화하고 필요한 잔고·진행도를 갱신합니다. 증권사 주문 취소나 반대 방향 실제 매매가 아닙니다. 이력은 보존합니다. | W06 |
| list_transactions | 기록된 체결과 취소 및 legacy 이력을 조회합니다. 불완전 과거 기록을 증권사 전체 원장으로 설명하지 않습니다. | W05,W06 |
| verify_holdings | 사용자가 증권사와 비교했다고 명시한 대상·필드·버전의 확인만 기록합니다. 값은 변경하지 않습니다. 일부 수량 확인을 전체 잔고/평균가 확인으로 확대하지 않습니다. | W06 |

## 선택적 가이드 도구 계약안 — 첫 버전 후순위

`get_workflow_guide` / planned / read-only: topic은 daily_review, policy, decision, research_task, trade_entry, reconciliation 중 하나. 출력은 guide_id/revision, 실제 사용 가능한 도구에 한정한 steps, 금지 부수 효과, 오류 후 다음 행동, unavailable_steps다. 사용자별 데이터나 저장 기능이 없다. unknown topic은 validation_error.

설명 후보: ‘여러 단계가 필요한 Portfolio 작업의 사용 순서와 주의점을 읽습니다. 간단한 조회마다 호출할 필요는 없습니다. 가이드는 기능을 실행하거나 사용자 승인을 대신하지 않습니다.’

가이드는 trusted 정적 문서에서 선택하고 사용자의 메모/뉴스로 instructions를 조립하지 않는다. 배포된 기능 registry와 대조하여 미지원 단계는 실행 가능한 것처럼 반환하지 않는다. 가이드 전체에 개인정보를 넣지 않는다. 같은 revision의 같은 topic은 대화에서 재사용할 수 있다.

앱 전용 mark_briefing_viewed, 공유 설정/미리보기, 표 편집 서비스는 MCP 도구 카탈로그에 자동 등록하지 않는다. 기존 저장 뉴스 CRUD와 신규 개인 근거 저장의 공개 범위를 합치지 않는다.
