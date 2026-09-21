# MCP 작업 가이드 제공 설계

2026-09-21 · 로컬 구현 완료 · 운영 배포·실제 모델 평가 전

## 목적과 제공 범위

ChatGPT가 사용자의 요청을 적절한 질문·조회·초안·저장으로 연결하도록 작업별 안내를 제공한다. ChatGPT는 인터뷰·조사·해석을 하고 Portfolio는 사용자 데이터·계산·저장을 담당한다. 가이드는 정적 안내이며 실행 엔진이나 사용자별 대화 상태 저장소가 아니다. 필수 설문을 만들지 않는다.

| topic | 사용자 요청 / 안내 내용 | 현재 사용할 도구 / 시나리오 |
| --- | --- | --- |
| policy | 내 투자 기준을 질문하면서 정리해줘. 기존 답을 활용하고 목표·기간·유동성·위험·매매 성향·선호/금지 원칙을 필요한 만큼 묻고 초안을 확인한다. | get_investment_policy, save_investment_policy / W02, S02~S04 |
| holding_thesis | 이 종목을 왜 보유하는지 정리해줘. 종목 공통 이유와 계좌별 예외, 재검토 조건을 구분한다. | find_holdings, get_holding_thesis, save_holding_thesis, get_task, link_task_to_holding_thesis / W02 |
| daily_review | 오늘 점검해줘 / 점검하고 저장해줘. 이전 점검·미확인 범위부터 조사하고 사실·해석·불확실성을 구분한다. | get_daily_context, list_daily_briefings, get_daily_briefing, save_daily_briefing / W01 |
| decision_followup | 유지하기로 한 이유와 다음 실적 확인을 남겨줘. 제안/사용자 채택, 조사 질문/실행 계획을 구분하고 부분 성공을 설명한다. | record_investment_decision, get_investment_decision, transition_investment_decision, list_tasks, get_task, transition_task, save_execution_task / W03~W04 |
| trade_entry | 실제로 산/판 내역을 기록해줘. 필요한 계좌·종목·수량·가격·날짜를 확인하고 preview→기록→선택적 계획 연결을 안내한다. | find_holdings, preview_trade_entry, log_completed_trade, list_transactions, link_trade_to_task / W05 |
| reconciliation | 현재 잔고 맞추기 / 잘못된 기록 취소 / 잔고 확인 표시. 의도에 따라 서로 다른 도구를 선택한다. | get_holding_integrity, get_portfolio_integrity, preview_holding_reconciliation, reconcile_holding, preview_trade_reversal, reverse_trade_entry, verify_holdings / W06 |

공유 설정은 앱으로 안내한다(W07). 실패 복구(W08)는 각 가이드의 해당 단계에 포함한다. 단순 조회용 가이드·범용 CRUD 가이드·독립 복구 topic은 추가하지 않는다. 이 표는 범위이며 실제 단계별 필수/선택 의존 도구 목록은 구현에서 명시한다. 현재 없는 독립 save_task/get_research_history나 MCP 운용 전략 수정 기능을 안내하지 않는다.

## 호출 계약과 발견

- OAuth endpoint에 읽기 전용 get_workflow_guide 하나를 추가했다. 입력은 검증된 여섯 topic 중 하나다.
- 성공은 기존 envelope 안에 topic, guide_id, revision, purpose, steps, boundaries, recovery, related_tools를 반환한다. steps는 순서·조건·참조 도구·사용자에게 필요한 질문/결과를 포함한다. 개인정보·사용자 DB 조회·변경·활동 기록은 없다.
- 알 수 없거나 미공개 topic은 기존 validation_error 계약을 따른다. 구현 누락 도구를 정상 안내로 반환하지 않으며 관련 검증이 빌드/배포를 차단한다.
- 설명과 server instructions에 복합 작업 시작 시 적절한 topic을 읽도록 짧게 안내한다. 관련 get/save 도구 설명에도 필요한 진입 힌트를 둔다. 단순 조회마다 추가 호출하거나 한 대화에서 같은 가이드를 반복 읽게 하지 않는다.
- 가이드 호출이 생략되거나 실패해도 각 도구 설명과 서버 검증으로 기본 경계를 유지한다. 실제 모델이 가이드를 선택하는지는 별도 웹·모바일 평가 대상이며 강제 실행을 보장하지 않는다.
- 기존 daily-review resource/prompt는 유지하되 daily_review 구현 시 같은 원본을 렌더링/참조한다. 클라이언트의 prompt/resource 지원을 필수 조건으로 삼지 않는다.

## policy 인터뷰 상세

현재 기준과 운용 전략을 먼저 읽고 이미 알려진 내용을 반복 질문하지 않는다. 짧은 질문을 한 번에 1~2개씩 하며 사용자가 모르는 항목은 미정으로 둔다. 목표·기간·필요 현금·감내 가능한 손실·매매 빈도/방식·선호/금지 원칙은 질문 후보이며 고정 설문이나 성향 점수 계산은 아니다. 기존 대화에서 명확히 답한 내용도 활용한다.

사용자가 말한 내용과 모델 제안을 구별해 초안을 제시한다. 충돌하는 답은 확인하고 답하지 않은 값을 추론해 채우지 않는다. 구조화 필드는 goal_text/horizon_text/liquidity_need_text/risk_tolerance_text/trading_preference_text/restrictions에 맞추고 상세 서술은 raw_text로 정리한다. 원문 전체 대화나 불필요한 민감정보를 저장하지 않는다.

도출한 초안은 사용자가 확인한 뒤 저장한다. 이미 확정된 문구에 대해 명확히 저장을 요청했다면 같은 승인을 다시 요구하지 않는다. 분석 요청만 있으면 저장하지 않는다. 일부 수정은 나머지 필드를 유지하고 null은 명시적 삭제에만 사용한다. restrictions 배열 교체 시 기존 항목의 의도치 않은 삭제가 없도록 현재값을 반영한다. 투자 기준 저장은 목표 비중·운용 모드·보유 이유를 함께 수정하지 않는다.

저장은 현재 version과 멱등 key를 사용한다. 응답 유실은 같은 key/입력 재시도, 버전 충돌은 재조회하고 충돌 내용을 확인한다. 성공 뒤 get_investment_policy로 확인한다. 재조회만 실패한 경우 저장 실패로 표현하거나 새 저장을 만들지 않는다. 앱의 나의 투자 기준과 같은 값인지 검증한다.

## 변경과 최신화

1. 런타임 가이드 원본은 _shared/mcp 아래 정적 타입 정의/데이터 한 곳에 둔다. 본문·도구 의존성·시나리오 ID를 함께 관리한다. workflows.md는 의도/시나리오 매핑과 원본 링크로 정리하고 런타임 문장을 수동 복제하지 않는다. 사람이 읽는 상세 참고본이 필요하면 같은 원본에서 생성한다.
2. guide revision은 내용 식별용 결정적 해시로 생성한다. DB revision 테이블, API schema_version 추가, 사용자별 가이드 캐시는 만들지 않는다. 배포된 코드와 안내를 같은 Edge 산출물로 제공한다.
3. registry와 가이드의 tool 참조·topic enum·출력 schema를 자동 대조한다. 참조 삭제/이름 변경·중복·미지원 topic·문서 생성 결과 차이는 CI 실패로 잡는다.
4. 도구 정의/handler/RPC 의미가 변경되는 PR은 영향 topic과 수정 또는 영향 없음 사유를 남긴다. 구현 시 실제 CI 구조에 맞춰 작은 변경 영향 manifest/check를 추가한다. DB/app-only 수정도 MCP 의미에 영향이 있는지 검토하며 모든 변경에 가이드 문구 수정을 강요하지 않는다.
5. 변경 영향 검사는 원본의 tool 의존성 및 명시적 소스 경로 매핑으로 수행한다. 의미 변경을 자동 추론한다고 주장하지 않는다. 공통 index 수정은 영향이 넓게 잡힐 수 있으며 검토 사유로 처리한다. 리뷰어는 질문 흐름·저장 범위·오류 복구 사례로 판단한다.
6. 정책/입력/출력/상태 전이가 바뀌면 관련 가이드와 시나리오 fixture를 같은 변경에서 갱신한다. 순수 레이아웃 변경 등은 영향 없음 사유로 충분하다. PR 체크리스트, 개발 지침과 START-HERE에 연결한다.

## 순서와 완료 기준

policy 첫 슬라이스에 최소 원본·발견 경로·등록 검사·실제 OAuth 호출·저장/재조회 검증을 포함한다. 다음 슬라이스에서 나머지 다섯 topic을 추가하고 source를 공유한다. 마지막 티켓에서 변경 영향 CI와 모델 회귀 평가를 강화한다. 자동 계약 테스트와 ChatGPT 웹/모바일 관찰을 구분하고 후자는 실행 증거가 없으면 미완료로 남긴다.

이 결정은 ADR-0004의 최소 공통 기반 원칙을 유지하면서 후순위였던 가이드를 구체적인 인터뷰 소비 사례로 도입한다. 기존 #57의 가이드 미추가 조건은 당시 완료 범위로 보존한다. 구현 원본은 `supabase/functions/_shared/mcp/workflow-guides.ts`, 검토 기록은 `workflow-guide-review.json`이다.
