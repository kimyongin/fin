# 사용자 시나리오 → API → 데이터 변경 점검표

2026-09-21 · 문서 기반 설계 점검. 예상 결과이며 실행 테스트 통과를 뜻하지 않는다.
API 상세: [일일 점검](./daily-review-api.md), [원칙·판단·실행](./lifecycle-model-api.md). 기존 API는 유지/통합, 신규 이름은 설계안이다. 내부 서비스마다 MCP 도구를 하나씩 만드는 계획은 아니다.

공통 쓰기에는 성공 receipt/감사가 따라간다. 아래 표는 사용자 데이터 변화를 중심으로 표기한다. 사용자의 지시가 없으면 ‘읽기/제안’을 ‘저장/채택’으로 승격하지 않는다.

| ID | 사용자 경험/요청 | 필요한 API 흐름 | 생성·변경 모델 | 변경하면 안 되는 것 | 담당 |
| --- | --- | --- | --- | --- | --- |
| S01 | 처음 시작. 기존 보유값부터 사용 | 기존 portfolio 읽기 → 등록/표 저장 서비스 | 기존 holdings + initial checkpoint/stream | 과거 가상 BUY, 허구의 잔고확인일 | #38 |
| S02 | 장기 투자하고 자주 매매하지 않는 것을 내 기준으로 저장 | get/save_investment_policy | profile 현재값/version+변경 이력 | 목표 비중/상세 전략, 기존 브리핑 기준 | #43 |
| S03 | 카테고리 목표·적립금·모드 변경 | get/save_investment_policy(strategy patch) | 현재 strategies + 전략 변경 이력, 안정 버킷 키 | 개인 성향, 과거 결정/체결 | #43 |
| S04 | 이 종목은 장기 적립용. 실적 뒤 다시 확인 | save_holding_thesis(follow_up_tasks) | 보유 이유 현재값/변경 이력+research task/history 원자 저장 | 기존 메모 덮어쓰기, 자동 adopted 판단/매매 | #41/#35 |
| S05 | 오늘 점검해줘 | get_daily_context → ChatGPT 외부 조사 | 업무 데이터 변경 없음 | run/열람/실제확인 생성 | #34 |
| S06 | 오늘 점검하고 저장해줘 | get_daily_context → ChatGPT 조사 → save_daily_briefing | briefing/scopes/근거, 선택 proposed/조사task | 원칙 수정/채택/체결 | #34/#35 |
| S07 | 새 소식 없고 확인 결과 추가 행동 불필요 | 문맥 조회 → 확인 출처 포함 save_daily_briefing | 충분 scope+checked source+no_action 브리핑 | 가짜 기사·억지 할 일 생성 | #35 |
| S08 | 일부 종목 검색 실패 | save_daily_briefing(partial) | 성공/실패 scope 분리, partial 브리핑 | 실패 종목 조사 완료, 전체 no_action | #34/#35 |
| S09 | 며칠 쉬었다가 복귀 | get_daily_context, 필요 get_research_history | 조회만; 저장 요청하면 새 브리핑 | 마지막 저장일로 모든 대상 조사 기준 갱신 | #34/#44 |
| S10 | 유지하고 다음 실적 때 다시 보자. 기록해줘 | record_investment_decision(follow_up_tasks) | adopted 유지 결정+기준 snapshot + research task 원자 생성 | 실행 계획/체결 생성, 이유 자동 수정 | #35 |
| S11 | 기존 질문의 답을 찾음 | save_daily_briefing(task_changes) 또는 transition_task(resolve) | 근거+answer+task history/version | 사용자 paused/closed 강제 해제, 자동 매매 판단 | #35 |
| S12 | 정정 기사로 예전 판단 다시 검토 | get_research_history → save_daily_briefing(evidence/task reopen) | 이전 근거를 참조하는 새 근거, 재개 history | 옛 기사/판단 덮어쓰기, 자동 대체 채택 | #35/#44 |
| S13 | 제안은 봤지만 채택 안 함 / 거절 | 조회만 또는 transition_investment_decision(dismiss) | 무변경 또는 dismissed 상태 이력 | adopted 결정, 실행 task/거래 | #35 |
| S14 | 유지 대신 일부 축소하기로 결정 | record_investment_decision(adopted, predecessor, follow_up_tasks) | 후속 결정+이전 superseded+선택 실행task | 선행 proposed만으로 기존 채택 대체, 체결 생성 | #35 |
| S15 | 계획 없이 10주를 7만원에 실제 매수 | preview_trade_entry → log_completed_trade | entry+holdings+stream version+audit | 필수 판단/일지, 자동 현금차감/잔고확인 | #37 |
| S16 | 10주 계획 중 6주, 나중에 4주 체결 | preview/log 두 번, 선택 link_trade_to_task | 두 체결+투영, task links, progress 6/10→10/10 | planned/completed 버튼으로 가상 체결 | #37/#35 |
| S17 | 6주 체결 뒤 남은 계획 취소 | transition_task(cancel) | control_state cancelled/history, 진행6주 보존 | 실제 6주 체결 취소/잔고 복구 | #35 |
| S18 | 거래를 잘못 적었으니 기록 취소 | preview_trade_reversal → reverse_trade_entry | reversal+필요 투영/진행도+audit | 역방향 실제 거래 생성, 이력 삭제 | #38 |
| S19 | 증권사 실제값은 25주/평균68,000 | preview_holding_reconciliation → reconcile_holding | checkpoint+투영; 명시한 경우 verification | 과거 원장 재입력 강제, 실행 task 완료 | #38/#42 |
| S20 | 보정 전 과거 매수를 취소 | preview/reverse_trade_entry | 과거 reversal, 관련 계획 진행도 | 최신 절대 checkpoint 잔고 덮어쓰기 | #38 |
| S21 | 증권사와 수량만 비교했는데 맞음 | verify_holdings(fields=[quantity]) | verification item+해당 version/value | 평균가까지 확인, 수량/원가 변경 | #42 |
| S22 | 표에서 메모만 수정 / 일부 잔고 수정 | 기존 app_bulk_save_portfolio_rows 통합 서비스 | 메모만→metadata, 잔고→checkpoint/stream, 공통audit | 무변경행 checkpoint, 필터 밖 삭제 | #38 |
| S23 | 친구에게 점검 기록도 공유 / 철회 | 앱 preview/update_sharing_policy → 공유 조회 | feature grants+policy version | 개인 기준/근거 자동 공개, 공유자의 편집 | #43/#39 |
| S24 | 앱에서 지난 판단/할 일/브리핑 다시 확인 | list/get_*; 실제 열람만 mark_briefing_viewed | read marker 외 무변경 | 생성일을 열람/잔고확인일로 사용 | #36/#35 |

## 연결된 장기 사례

1. 원칙 P1(장기·저빈도)을 저장하고 20주 보유로 시작한다(S01~02).
2. 첫 점검 R1은 유지 제안 D1(proposed)과 실적 확인 질문 T1(open)을 남긴다(S06). 잔고는 20주다.
3. 사용자가 유지 의견을 채택한다(S10/13). D1 adopted와 기존 T1 연결을 저장한다. 이미 있는 질문을 매번 새로 만들지 않는다.
4. 다음 실적 근거 E2로 T1의 답을 기록한다(S11). T1 resolved지만 D1은 아직 adopted다.
5. 사용자가 새로운 근거를 보고 축소를 선택한다(S14). D2 adopted, D1 superseded, 10주 매도 계획 T2가 함께 저장된다.
6. 실제 6주 매도 후 4주 매도를 기록한다(S16). 보유14→10주, T2 진행6/10→10/10. 평균가는 체결가 원가 정책으로 계산한다.
7. 두 번째 체결 기록이 잘못되어 취소하면(S18) 보유14주, 진행6/10으로 돌아간다. D2 결정과 T1 답은 보존한다.
8. 그 뒤 실제 잔고25주/68,000으로 보정하면(S19) 기준점만 바뀌며 T2 체결량은 증가하지 않는다. 기준점 전 체결 취소(S20)는 과거 실행 실적에 영향을 줄 수 있어도 현재25주/68,000을 바꾸지 않는다.

## 이번 대조로 찾은 빈틈과 보완

| 발견한 문제 | 설계 보완 | 아직 남은 검증 |
| --- | --- | --- |
| 질문·판단 참조만 가능해서 첫 기록을 만들 API가 없었음 | record/transition/save_task, batch 내 local key 정의 | 요청/응답 스키마와 FK 테스트 |
| 브리핑 저장과 질문 해결을 따로 하면 반쪽 성공 가능 | 조사 변경을 동일 transaction에 포함, CAS 실패 시 전체 rollback | 충돌 후 분석만 보존하는 재시도 fixture |
| 체결 취소 영향 미리보기 API 누락 | preview_trade_reversal 추가 | 후속 초과매도와 기준점 전 취소 계산 |
| 질문 수정 후 과거 브리핑의 연결 내용이 달라질 수 있음 | briefing_tasks에 task ID뿐 아니라 당시 내용/version snapshot 고정 | 현재상태와 당시내용을 구분하는 DTO |
| 일부 종목만 보내도 모두 조사 완료처럼 보일 수 있음 | 문맥의 요청 대상 manifest와 반환 completeness 검증, 누락 scope 자동 unverified | 페이지·대규모 포트폴리오 계약 |
| 계획 취소와 체결 진행이 같은 status에 섞임 | control_state와 계산 progress 분리 | 취소 후 정정, 초과체결 사례 |
| 종목 이유가 재매수 때 자동 적용될 위험 | 보유 구간 종료 후 적용 해제, 기존 질문 자동 종료 금지 | 여러 계좌·과거 거래 정정 |
| 공유 판단 관계를 따라 비공개 자산·기준 노출 가능 | 관계별 권한과 공개 DTO 필터, 본문 공개 미리보기 | SQL/RLS·검색·CSV·직접 접근 검증 |

## 통과 기준과 판정

문서 점검: 위 24개 시나리오에 요청 경로·변경 모델·불변 조건·담당을 배정했다. 범용 CRUD/워크플로 엔진/자동 주문을 추가하지 않았다.

미통과: 전체 JSON Schema와 샘플 자동 검증, 서버 context 생명주기 및 pagination 기술 검증, decimal scale/반올림·이관 데이터 확인, 물리 DDL/RLS·동시성 테스트. 사용자에게 새로운 큰 제품 선택을 요구할 사안은 현재 발견하지 않았지만 이 기술 게이트 전 구현 준비 완료로 선언하지 않는다.
