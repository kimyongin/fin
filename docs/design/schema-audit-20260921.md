# 기존 DB 대조 — 2026-09-21

## 조사 범위와 한계

- 연결된 원격 Supabase의 `public` 스키마를 `supabase db dump --linked --schema public`으로 읽었다. 데이터 행은 덤프하지 않았다. 운영 스키마 변경·마이그레이션 실행은 하지 않았다.
- 원본 덤프는 OS 임시 디렉터리에만 두고 저장소에는 포함하지 않는다. 이 문서는 설계에 필요한 구조만 기록한다.
- 로컬 `supabase_db_fin`의 information_schema도 조회했다. 원격과 같지 않다. 로컬에는 `transactions`, `daily_reports`, `rebalance_suggestions`가 없고 strategies에도 원격의 후속 필드 일부가 없다.
- 저장 데이터 건수·값·외부 클라이언트 사용 여부는 조사하지 않았다. 소스 검색에서 사용처가 없다고 빈 테이블이나 삭제 가능한 테이블로 판정하지 않는다.

## 확인한 구조와 설계 영향

| 대상 | 원격에서 확인한 사실 | 조치 / 담당 |
| --- | --- | --- |
| holdings | quantity/avg_price는 real, 직접 평가 금액은 numeric; account_id nullable | decimal 계산 전환은 기존 값 대조가 선행. 캐스팅만으로 과거 정밀도를 복구했다고 주장하지 않음 / #32, #38 |
| transactions | BUY/SELL/INITIAL, 거래일, quantity/price/amount/fee real; 취소·기준점·버전 필드 없음 | 그대로 새 체결 API를 연결하지 않음 / #37, #38 |
| transactions_recalc | INSERT/UPDATE/DELETE 후 security definer 트리거가 3인자 recalc_holding 호출 | 이관에서 기존 트리거와 신규 투영이 동시에 작동하지 않게 전환 / #38 |
| recalc_holding(user,account,ticker) | 거래를 trade_date,created_at 순서로 0부터 재생. INITIAL도 가산. 마지막에 holdings upsert | 절대 보정 정책과 불일치. 동일 시각 정렬도 안정 순번 아님. 새 기준점 알고리즘으로 대체 필요 / #32 |
| recalc_holding(account,ticker) | 사용자 인자 없는 이전 overload도 남아 있고 실행 grant가 있음 | 실제 호출·권한 영향 조사 후 폐기/제한 여부 결정. 이번 조사만으로 악용 가능성 확정 안 함 / #33, #38 |
| daily_reports | headline/market_impact_summary, 여러 JSON, 날짜, storage_path; 조사 범위·원칙 revision·안정 질문 관계 없음 | 기존 원문/파일 참조 유지. 신규 구조화 점검의 원본으로 재사용하지 않음 / #35, #44 |
| rebalance_suggestions | reasoning/actions/based_on_reports/user_decision JSON; pending/accepted/rejected/partial | accepted를 신규 사용자 채택 증거로 자동 변환하지 않음. 역사 자료 유지 / #35, #44 |
| 전략 | 현행 app_get_strategy_state / app_save_strategy 및 공유 읽기 경로 존재 | 기존 현재값 호환 + 독립 revision. 기존 상세 조사 내용과 대조 / #43 |
| 뉴스 | owner 테이블 정책과 공유용 RPC의 공개 경계가 별도 | 개인 연구 근거는 별도 테이블; 기존 뉴스로 자동 복사 금지 / #35 |

transactions의 account FK는 account_id 단독이며 종목은 (user_id,ticker) FK다. 새 관계에는 동일 소유자 복합 FK를 적용한다. 과거 레코드의 계좌/소유자 일치 여부는 데이터 이관 전 별도 점검한다.
daily_reports/rebalance_suggestions/transactions에는 auth.uid()=user_id owner 정책이 있다. 권한 전체와 RPC 우회 가능성을 검증한 보안 감사는 아니다.

## 이관 게이트

1. 재현용 로컬 환경에 누락 legacy 구조를 보완하는 별도 incremental migration/테스트 fixture를 검토한다. 적용된 기존 migration history는 수정하지 않는다. 실행 중 로컬 DB를 임의 reset하지 않는다.
2. 실제 데이터 읽기 점검에서는 개인정보 출력 없이 null 계좌, 소유자 불일치, 음수/비정상 수량, real 변환 오차, 직접 편집 잔고와 거래 재생 결과 차이의 집계만 확인한다.
3. 보유값을 새 초기 기준점으로 보존하고 과거 거래는 이력으로 유지한다. 전환 순간의 동시 쓰기를 제어하고 전체 보유 전후 대조 후 전환한다.
4. 새 API를 쓰는 동안 기존 RPC/직접 쓰기로 기준점·버전 검사가 우회되지 않도록 DB 권한과 경로를 함께 변경한다.
5. 별도 복제/테스트 환경에서 정방향 이관·실패 복구·기존 편집 회귀를 통과하기 전 거래 기능을 운영에 연결하지 않는다.

현재 완료: 원격 구조 확인 및 충돌 식별. 미완료: 행 수준 이관 조사, 실제 마이그레이션 설계/실행, 보안·동시성 테스트.
