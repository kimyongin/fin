# 원칙·판단·할 일·실행의 모델/API 계약

> 역사 문서 (2026-09-21): 아래 원장·저장 preview·판단/실행 전용 모델은 ADR-0008과 [현재 저장 계약](../storage-contract-20260923.md)에 의해 대체되었다. 신규 구현 명세로 사용하지 않는다. 현재 물리 구조는 [schema overview](../../../supabase/schema/OVERVIEW.md)를 따른다.

적용 기준: [ADR-0004](../../adr/0004-domain-storage-and-minimal-mutation-contract.md). 범용 저장 모델 대신 도메인 테이블+공통 변경 규약을 사용하며, 문맥은 서버 임시 보관, 당시 내용은 snapshot으로 보존한다.

2026-09-21 · 로컬 구현 대조 완료. migration 002~019, 목적 중심 RPC/MCP, 앱 흐름과 자동 테스트에 반영했다. 논리 이름과 실제 물리 이름이 다르면 [schema overview](../../../supabase/schema/OVERVIEW.md)가 구현 원본이다. 운영 배포·legacy 이관·실사용 검증은 별도다.

공통: 인증에서 owner/호출 채널 결정, 동일 소유자 복합 FK, 당시 snapshot/중요 변경 이력, 충돌 위험이 있는 현재 행의 expected_version, 쓰기의 idempotency_key, 감사와 원자적 저장은 daily-review 계약을 따른다. 새 기록 expected_version은 null(존재하지 않아야 함), 기존 기록은 현재 문자열 버전 필수. 성공 응답은 id/version/변경 요약, 실패는 업무 오류다.

## 1. 추가 모델

| 모델 | 필수 필드/관계와 제약 |
| --- | --- |
| decisions + decision_state_history | id, user_id, version, status, subject, question/options/선택/이유, 불확실성, 재검토 조건, policy/thesis snapshot, replaces_id?, authored_via; 상태 전후 이력 |
| decision_evidence | decision_id, evidence_id; 동일 소유자 FK |
| tasks | id, user_id, kind(research/execution), version, title, subject, due_date?, timezone, trigger_text?, current_history_id |
| task_history | task_id, version, control_state, content_snapshot, answer?, change_reason, authored_via; UNIQUE(user_id,task_id,version) |
| task_evidence / task_decisions | task_history_id와 근거/판단 ID와 당시 snapshot 참조. 과거 답과 당시 근거 보존 |
| execution_plans | task_id PK, account_id, instrument_id, side, target_quantity; 첫 자동 진행 계산은 시장형 수량 계획만 |
| task_fill_links | user_id, task_id, fill_id; UNIQUE(user_id,fill_id). 한 체결의 중복 진행 집계 금지 |
| holding_theses + thesis_change_history | 종목, 선택 계좌 범위, version/중요 변경 이력, 원문 이유, 기간?, 재검토 조건?, 날짜?, 관련 decision_id?, active 상태. 범위별 현재값 하나 |
| position_streams | id, user_id, account_id, instrument_id, version; UNIQUE(user_id,account_id,instrument_id) |
| position_checkpoints | stream_id, effective_date, effective_order, quantity/cost_pool 또는 유형별 금액, reason, provenance(initial/migrated/reconciliation), created_at |
| trade_entries | stream_id, trade_date, effective_order, side, quantity, unit_price, currency_snapshot, recorded_at. append-only |
| trade_reversals | entry_id UNIQUE, reason, recorded_at. 실제 반대 매매와 구별 |
| holding_verifications/items | 확인 시각·범위, stream_id, version, fields, 값 snapshot. 확인 안 한 필드는 포함하지 않음 |
| mutation_previews | owner, operation, canonical_input, input_hash, expected_versions, expires_at, before/after, warnings. 업무 잔고/원장은 변경하지 않음 |
| research_evidence | 불변 출처/요약, supersedes_id?, 정정 이유. 관련 판단/task 연결. 독립 사건/revision 엔진은 후순위 |

subject는 portfolio / instrument / position의 tagged union이다. instrument에는 instrument_id, position에는 account_id+instrument_id가 필수이며 다른 조합은 거부한다. task scope를 쓰는 조사 범위는 task_id로 따로 참조한다. 삭제된 종목/계좌의 과거 이름·통화는 snapshot에서 읽는다. 참조된 원본의 물리 삭제는 이력 cascade 대신 archive/명시적 이관으로 처리한다.

position_checkpoints/trade_entries는 신규 정밀 원장 후보이며 기존 transactions는 legacy history로 보존한다. holdings는 현재 투영값 하나만 둔다. 이중 원본을 만들지 않고 과거 데이터 이관/기존 트리거 전환은 별도 migration 설계에서 검증한다.

## 2. 원칙·보유 이유

| API | 주요 입력 | 변경 / 출력 |
| --- | --- | --- |
| get_investment_policy | 없음 | 현재 strategy/profile와 버전. 읽기만 |
| save_investment_policy | profile patch, expected_version, key | 개인 기준 현재값/version+중요 변경 이력만 변경. 기존 strategy는 별도 기존 API 유지 |
| save_holding_thesis | 범위, 이유/조건/날짜 patch, expected_version, key | 해당 범위 현재값/version+중요 변경 이력을 저장. 기존 holding note/개인 전체 기준/조사 task 상태는 변경하지 않음 |
| get_holding_thesis | instrument_id, account_id? | 종목 기본과 계좌별 재정의를 구분하고 실제 적용 출처 반환 |
| link_task_to_holding_thesis | thesis_id/version, task_id/version, key | 기존 두 레코드의 관계만 저장. 본문·상태·잔고 불변 |

patch의 필드 생략은 유지, nullable 필드의 명시적 null은 삭제다. 목표/버킷 목록을 교체하면 별도 replace 의미를 명시하고 태그 중복·목표 합계를 검증한다. 전체 버킷 ID를 매 저장마다 재발급하지 않는다.
개인 기준은 raw_text와 선택 structured 필드(goal_text, horizon_text, liquidity_need_text, risk_tolerance_text, trading_preference_text, restrictions[])로 시작한다. 불명 값을 숫자 손절선으로 변환하지 않는다. 각 restriction은 text와 kind(preference/prohibition)를 구분한다. 상세 정량 운용 한도는 기존 전략에 유지한다.

모델이 추론한 기준/이유는 현재값에 쓰지 않는다. 명시적 저장 의도 없으면 대화의 제안으로 둔다. 전량 매도 후 재매수 시 옛 이유 자동 재활성화 금지: 계좌 범위는 해당 포지션, 종목 기본은 전체 계좌 합계가 0이 된 보유 구간 종료로 취급한다. 기존 질문은 자동 종료하지 않고 대상 미보유를 표시한다. 과거 거래 정정으로 적용 여부가 불명확하면 재확인 필요로 표시한다. 전체 보유 구간/가설 자동 복원 엔진은 후순위다.

## 3. 판단과 할 일

| API | 주요 입력 | 변경 / 출력 |
| --- | --- | --- |
| record_investment_decision | proposed/adopted, subject, question/options/선택/이유, policy/evidence refs, predecessor?, expected predecessor version?, follow_up_tasks[], key | 새 판단 및 선택한 후속 할 일을 원자 저장. 유지 결정은 task 0개 가능 |
| transition_investment_decision | decision_id, expected_version, action(adopt/dismiss), reason, key | 상태/version과 이력. adopted 본문 변경은 새 대체 판단 |
| record_investment_decision(follow_up_tasks) | 판단과 선택 조사 task | 새 판단과 조사 task를 원자 생성. 독립 조사 task 생성은 첫 버전에서 제외 |
| transition_task | task_id, expected_version, action, answer?, evidence_ids[], reason, key | 허용된 전이와 history만 변경 |
| save_execution_task | task_id?, expected_version, 계좌/종목/방향/목표 수량, key | 실행 계획 현재값/history. 거래·잔고 불변 |
| link_trade_to_task | trade_id, task_id, expected_task_version, key | 기존 체결 연결 및 계산 진행도 갱신. 원장/잔고 값은 불변 |
| transition_execution_task | task_id, expected_version, pause/resume/cancel, key | control state만 변경. 체결·잔고 불변 |
| list/get_investment_decisions, list/get_tasks | ID 또는 필터/cursor | 현재 상태와 중요한 변경 이력 조회. 목록 기본20/최대50, 안정 cursor |

명시적인 ‘유지하고 다음 실적 때 다시 보자, 기록해줘’는 record_investment_decision 한 번으로 adopted 유지 판단+research task를 저장한다. 기존 proposed 채택도 해당 현재값의 version을 기대 버전으로 지정하고 후속 task 원자 생성이 가능하도록 transition API에 동일 옵션을 둔다.

판단 전이: proposed→adopted/dismissed. adopted→superseded는 후속 adopted 생성과 이전 상태 및 이력 갱신을 한 트랜잭션으로 수행한다. 새 proposed만으로 기존 adopted를 대체하지 않는다. successor 중복 채택 경쟁은 이전 결정 version 검사로 한 건만 성공한다. 현재 adopted가 서로 다른 질문/대상에 여러 개 존재하는 것은 허용한다.

adopted에는 options 안의 selected_option과 채택 이유가 필수다. proposed의 추천 선택은 사용자 채택과 구분한다. predecessor와 scope/질문이 다른 결정을 대체하려는 요청은 명시적인 연결 사유를 검증하고 무관한 결정을 자동 종료하지 않는다.

조사 전이: open↔waiting, open/waiting→resolved(답+근거 필수), resolved→open(새 근거/정정 사유 필수). paused/closed와 그 해제는 사용자 의도 필요. 모델 조사 결과는 사용자 paused/closed를 덮지 않는다. 결정 변경/기한 도래/체결만으로 질문이 해결되지는 않는다.

실행 상태는 두 축이다. control_state=active/paused/cancelled, progress=planned/partial/completed는 유효 체결 합계에서 계산한다. cancelled 뒤에도 이미 수행한 체결을 보존한다. 10주 계획에 12주 체결은 completed+overfilled_quantity=2이며 10주로 잘라 숨기지 않는다. 금액/조건 기반 계획은 research/관찰 과제로 남기거나 별도 완료정책 설계 전 수량 실행계획으로 입력하지 않는다.

계획 내용 수정은 task version/history를 남기고 이미 연결된 체결과 계좌/종목/방향 불일치가 생기면 거부한다. 연결 변경은 양쪽 task 버전을 잠근 뒤 원자 처리한다. cancelled/paused 계획에 과거 체결을 명시적으로 연결해도 control_state는 자동 active가 되지 않는다.

OAuth/MCP 인증은 사용자를 식별할 뿐 실제 발화의 채택 의도를 증명하지 않는다. 채택 도구 분리·명시적 의도 지침·기록된 호출 경로로 오동작을 줄이되 모델이 보낸 boolean/인용문을 보안 증거로 간주하지 않는다. 플랫폼의 사용자 승인은 우회하지 않는다.

## 4. 점검 저장과 목적별 변경

첫 버전은 save_daily_briefing에 판단·task 변경 batch를 추가하지 않았다. 브리핑은 근거/scope와 원자 저장하고, 판단·task 변경은 각각 목적별 RPC에서 idempotency와 expected_version으로 보호한다. 대화 중 일부 저장이 실패하면 성공한 범위와 실패한 범위를 구분해 설명한다.

이 API에서는 adopted 결정, execution 계획, 개인 원칙 변경, 매매를 금지한다. ‘점검하고 저장’은 새 조사 질문과 근거 있는 조사 답을 저장할 수 있지만 사용자 투자 의사결정을 대신하지 않는다.

각 목적별 변경은 대상 version 충돌 시 해당 명령 전체를 저장하지 않는다. 클라이언트는 실패를 숨기지 않고 재조회·재검토한다. 가격이나 무관한 메모 갱신만으로 질문 답 저장을 거부하지 않는다. 성공 응답을 받은 명령만 저장됐다고 설명한다.

정정 자료는 과거 briefing 근거를 덮어쓰지 않고 새 briefing/evidence로 보존하며 관련 판단/질문은 목록·상세 조회로 찾는다. 별도 `get_research_history` MCP는 만들지 않았다. 이는 인터넷 검색 API가 아니며 관련 판단은 자동 채택·보유 이유 변경하지 않는다.

## 5. 체결·보정·취소

| API | 필수 핵심 입력 | 변경 / 출력 |
| --- | --- | --- |
| preview_trade_entry | 계좌/종목, buy/sell, quantity, unit_price, trade_date, timezone, 순서 필요 시 before/after anchor, task_id? | 계산 before/after, warnings, preview_id, expiry. 잔고 변경 없음 |
| log_completed_trade | preview_id, key | entry+holdings 투영+stream version+audit+선택 task 연결/진행도 원자 갱신 |
| preview_holding_reconciliation | 대상, 절대 수량/평균가 또는 타입별 금액, 날짜/순서, reason, 선택 실제 확인 필드 | 새 checkpoint 영향과 preview |
| reconcile_holding | preview_id, key | checkpoint+투영+버전+감사, 명시한 실제 확인만 함께 기록 |
| preview_trade_reversal | entry_id, reason | 후속 거래 재계산/현재 영향/연결 task 영향 preview |
| reverse_trade_entry | preview_id, key | reversal+필요 투영+버전+진행도+감사. 역방향 거래 생성 아님 |
| list_transactions | 계좌/종목/기간/cursor | 체결·취소 표시 및 legacy 구분. 초기/보정은 별도 종류로 조회 |
| verify_holdings | 확인 대상/필드와 expected stream versions, key | verification+items만 생성; 수량·원가 불변 |

preview는 전체 canonical 입력과 owner/관련 stream·task 버전/만료에 결합한다. commit에 다른 수량을 덧붙여 변경하지 못한다. 성공 key 재시도는 preview 만료 검사보다 먼저 기존 성공 결과를 반환한다. 동일 preview를 다른 key로 재사용하면 이미 적용된 결과를 안내하고 이중 체결은 만들지 않는다. 실제 별도 동일 거래는 새 preview로 가능하다.

매도 초과·미지원 타입·모호한 계좌·동일일 순서 미확정은 오류다. 미래 실제 거래일은 거부한다. 날짜만 입력한 거래의 기록 시각을 체결시각으로 꾸미지 않는다. 스트림의 유효 순서를 서버가 관리하고 중간 삽입은 같은 날 anchor로 지정한다. 기준점 당일 포함 여부가 결과에 영향을 주면 사용자에게 확인한다.

재생은 해당 시점의 최신 절대 checkpoint부터 그 뒤 유효 체결을 순서대로 적용한다. 이전 거래 취소는 이력/계획 실적에 영향을 줄 수 있으나 checkpoint 잔고는 유지한다. 초기 기준점 이전 불완전 이력은 현재 계산/수익률 근거로 승격하지 않는다. 최신 기준점 이후 후속 초과매도가 생기면 전체 거부한다.

계산 예제: 초기20주×65,000 → 10주×71,000 매수 → 30주/원가2,010,000/평균67,000 → 12주 매도 → 18주/원가1,206,000/평균67,000. 25주/평균68,000 절대 보정 뒤 앞의 매수 취소는 현재25주/68,000을 유지한다. 수수료/세금·자동 현금차감 없음. 소수 수량/단가와 전량 매도·재매수는 numeric DB fixture로 검증했다.

기존 app_save_holding/valuation/cash 및 app_bulk_save_portfolio_rows는 이 checkpoint 서비스를 사용하도록 통합한다. 표 전체 전송이 아니라 변경 필드만 판별하고, 200행 배치는 모든 예상 버전/참조 검증 후 원자 저장한다. 메모 변경은 해당 레코드, 잔고 변경은 해당 stream 버전을 갱신한다. 전역 metadata/prices 카운터는 도입하지 않는다. 행 삭제가 거래/과거 기준을 cascade 삭제하지 않도록 별도 archive 의미를 적용한다.

## 6. 공유·열람·조회 누락 보완

앱 전용 get_sharing_policy / preview_sharing_policy / update_sharing_policy: 기능 grant patch+expected policy version, 미리보기는 실제 공개 DTO, 변경은 grant/head 원자 저장. 전역 boolean이 아니라 기존 audience 공통 기능 권한을 사용한다. MCP 공유 관리 도구는 첫 버전 필수 아님.

공유 DTO: 브리핑은 기존 allowlist, 판단은 상태/질문/선택지/이유/불확실성/재검토조건, task는 유형/제목/기한/상태/답 또는 계획·진행값만 기본 후보. 계좌/종목 이름과 수량 같은 자산 관계는 assets 권한도 확인한다. 모든 관계/이력은 각각 원래 기능 권한을 재검사한다. 본문 자체의 민감 내용은 자동 제거 보장 없이 실제 공개 미리보기를 제공한다. 신규 민감 audit는 activity 단독 grant로 공개하지 않는다.

열람 marker는 첫 버전에서 제외했다. 브리핑 조회·ChatGPT 답변이 분석 생성일이나 잔고 확인일을 바꾸지 않는다.

물리 스키마, MCP 입력 Schema, 공개 DTO, context 생명주기와 핵심 동시성은 로컬 검증했다. 운영 legacy 데이터 이관과 배포된 OAuth/실사용 검증은 [구현 현황 감사](../../tickets/implementation-audit-20260921.md)의 외부 게이트다.
