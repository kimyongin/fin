# 공통 모델과 일일 점검 계약

적용 기준: [ADR-0004](../../adr/0004-domain-storage-and-minimal-mutation-contract.md). 범용 저장 모델 대신 도메인 테이블+공통 변경 규약을 사용하며, 문맥은 서버 임시 보관, 당시 내용은 snapshot으로 보존한다.

대상 #43/#44 → #35-A/#34. 논리 모델은 migration 001~019의 도메인 테이블과 RPC로 구현됐다. 실제 물리 이름과 최신 컬럼의 원본은 [schema overview](../../../supabase/schema/OVERVIEW.md)와 관련 migration이며, 제품 정책은 PRD/ADR이 우선한다.

## 공통 규칙

- 신규 ID는 서버 발급 UUID. 기존 bigint ID는 API에서 decimal 문자열로 표현한다. 기존 테이블 PK를 UUID로 전면 교체하지 않는다.
- 신규 소유 레코드: user_id UUID NOT NULL, id UUID PK, UNIQUE(user_id,id). 참조는 (user_id,parent_id) 복합 FK로 동일 소유자를 강제한다. user_id는 인증에서 파생하며 사용자 입력으로 받지 않는다.
- 생성 시각은 서버 timestamptz. 분석 기준시각/발행시각/확인시각은 구별한다. 사용자가 말한 날짜는 date와 IANA timezone으로 보존한다. 발행일 불명은 null이다.
- 충돌 검사가 필요한 현재 행에는 version bigint NOT NULL DEFAULT 1 CHECK(version>0). API에서는 문자열. 변경은 expected_version 비교와 잠금 뒤 version+1. 변경 없는 요청은 버전을 올리지 않는다.
- 분석/판단 snapshot과 중요한 변경 이력은 보존한다. 현재 행 수정마다 별도 head/revision 쌍을 만들지 않는다. 부모 삭제로 역사 자료가 cascade 삭제되지 않게 한다. 계정 삭제 절차는 별도 개인정보 삭제 정책을 따른다.
- 숫자 원본은 decimal 문자열/numeric. 기존 real 정밀도 전환과 수량/금액 scale은 #32에서 검증한 뒤 고정한다. 현재 문자열 계약만으로 기존 실수 오차가 해결되지는 않는다.
- 자유 본문은 JSON 관계의 대체물이 아니다. 모델 작성 본문/URL을 코드·도구 지침으로 실행하지 않는다.

## 모델 대응과 필드

아래 이름은 설계 당시의 논리 모델명이다. `?`는 nullable, `[]`는 API 표현이며 실제 이름(예: `daily_review_contexts`, `daily_briefings`, `portfolio_tasks`)은 schema overview를 따른다. 소유권 참조 목록은 연결 테이블로 저장한다.

| 테이블 | 주요 필드와 제약 | 원본 책임 |
| --- | --- | --- |
| review_contexts | id, user_id, created_at, expires_at, snapshot jsonb, 대상 범위 | 서버 임시 불변 문맥. 소유권/TTL/생성 제한, 저장 시 브리핑으로 복사 |
| strategies + strategy_change_history | 기존 현재값+version, 중요한 변경의 전후값/사유/시각 | 기존 전략 호환과 사용자 변경 이력. 분석 당시 내용은 별도 snapshot |
| investment_profiles + profile_change_history | user_id, version, raw_text, structured_fields, 변경 이력 | 새 개인 기준은 공유 strategy와 분리, 당시 기준 snapshot 보존 |
| sharing_policies | user_id PK, version | 묶음 권한 변경의 CAS 및 캐시 버전 |
| feature_read_grants | user_id, audience_key, feature_key, action; 복합 PK | audience=existing_viewers, action=read만 허용. row 없음=deny |
| briefings | id, user_id, analyzed_at, local_date, timezone, coverage_status, headline, status, changes, uncertainties, context_snapshot, supersedes_id?, created_at | 분석 입력과 결과의 단일 원본. 날짜별 UNIQUE 없음. 정정은 새 기록 |
| review_scopes | id, user_id, briefing_id, subject_kind, instrument_id?, task_id?, window_from, window_to, coverage, reason?, checked_at | 대상별 실제 조사 범위. [from,to), from<to; portfolio/instrument/task 대상에 맞는 ID 조합 CHECK |
| research_evidence | id, user_id, source_url, source_title, published_at?, checked_at, fact_summary, excerpt?, supersedes_id?, correction_reason? | 개인 근거 snapshot. 전체 기사 복사는 필수 아님. 기존 news_facts 변경/삭제와 독립 |
| review_scope_evidence | user_id, scope_id, evidence_id; 복합 PK/FK | 조사와 근거 연결. 같은 URL에도 정정 기록 추가 가능 |
| review_scope_sources | id, user_id, scope_id, source_url, checked_at, outcome, note? | 검색/공시 조회했으나 새 사건이 없었던 확인도 기록. outcome=checked/failed |
| briefing_evidence / briefing_decisions / briefing_tasks | user_id, briefing_id, evidence/decision ID 또는 task_id+당시 snapshot; 복합 PK/FK | 당시 내용은 snapshot으로 복원하고 현재 상태는 현재 행으로 별도 조회. 대상 권한 각각 검사 |
| mutation_receipts | user_id, operation, idempotency_key, request_hash, response jsonb, created_at; 복합 UNIQUE | 성공한 쓰기와 같은 트랜잭션으로 저장; 응답 유실 재시도 |

현재 전략/개인 기준과 그 변경 이력을 분리하되 head 포인터 체계를 공통으로 강제하지 않는다. strategy snapshot의 세부 JSON Schema와 profile structured_fields의 필드/단위는 #43 후속 계약에서 고정한다. 범용 무검증 JSON 저장을 뜻하지 않는다.

## 수직 슬라이스 구현 경계

후속 관계의 서비스/필드 설계는 [lifecycle-model-api](./lifecycle-model-api.md)로 확장했고 각 수직 슬라이스로 구현했다.

- 판단/상태 이력, 조사 task/이력, 수량 실행 계획과 체결 관계를 분리해 구현했다.
- 근거 scope, 보유 이유 현재값/변경 이력과 task 관계, 실제 잔고 확인, task-fill 연결을 구현했다.
- 일일 briefing 저장은 독립 aggregate로 유지하고 판단·task의 상태 변경을 한 거대한 batch 명령으로 합치지 않았다.

## 조사 상태

- scope.coverage = sufficient / partial / unverified. partial/unverified에는 reason 필수.
- sufficient는 해당 기간·대상·명시한 출처의 확인 완료일 뿐 모든 웹 정보 확인 보장이 아니다.
- 새 사건 없음도 checked source가 있으면 sufficient 가능하다. 출처 조회 실패만 있는 scope는 sufficient 불가. 기사 1건이 존재한다는 것만으로 충분함을 서버가 보증하지 않는다.
- briefing.coverage_status는 서버가 scope에서 산출: 모두 sufficient → complete, 일부 확인됨 → partial, 모두 unverified → failed. 빈 scope는 거부한다. draft 저장은 후속이며 완료 구간에 반영하지 않는다.
- briefing.status = no_action / attention / insufficient_data. 전체 partial/failed를 no_action으로 저장할 수 없다. complete는 자동 no_action이 아니다.
- 첫 버전은 대상별 조사 기록과 미해결 구간을 보존하고 재조사를 허용한다. 일반 구간 합집합 엔진은 후순위다. partial은 해당 전체 구간을 완료 처리하지 않는다. 일부만 완료했다면 구간을 나눠 저장한다. max(to) 하나로 구멍을 메우지 않는다.
- 다음 문맥: 이전 미확인 구간 + 마지막 완료 구간 말단의 겹침 + 새 기간. 겹침 기본 3일은 검증 후보이며 버전 있는 서버 설정으로 반환한다. 첫 사용자에게 과거 전체 조사를 강요하지 않는다.

## 공유와 직접 접근

- 기존 공유는 현재 공개 기능을 명시적으로 grant 이관한다. 새 briefings/decisions/tasks/investment_profile/holding_theses/research_evidence는 기본 grant 없음.
- 공유 조회는 기존 친구/뷰어 관계가 유효하고 기능 read grant가 있어야 한다. OAuth MCP는 본인 문맥만 접근한다.
- 원본 context_snapshot, 임시 context, request/response receipt, private 변경 이력 테이블은 공유에 직접 SELECT 허용하지 않는다. 보안 RPC가 공개 DTO만 투영한다.
- 브리핑 공유 허용 필드 후보: id, analyzed_at, local_date, timezone, headline, status, 공개 본문 changes/uncertainties, 조사 품질 요약, 허용된 관계. owner 인증 식별자·private 기준/스냅샷·receipt는 제외한다.
- 숨긴 관계는 ID/제목/개수/배열 placeholder를 반환하지 않는다. 공유 화면에 공통 ‘일부 근거는 공개 범위에 따라 생략될 수 있음’ 안내만 둘 수 있다. 특정 비공개 관계의 존재를 추론시키지 않는다.
- 본문에 이미 들어간 사적인 설명은 FK 숨김으로 지워지지 않는다. 실제 공개 본문 미리보기와 사용자의 영역 공개 선택이 필요하다.
- 원본 테이블 직접 쓰기는 새 API 검증을 우회하지 못하게 제한한다. RPC는 인증·소유권·허용 필드·트랜잭션을 검증하고 security definer의 search_path/EXECUTE grant를 명시한다.

## 검증 상태

물리 DDL/인덱스, 도구 JSON Schema, 공유 DTO/권한 SQL, 충돌·멱등 테스트는 로컬 구현과 자동 테스트를 통과했다. 운영 migration 전 legacy 행 대조와 배포 후 직접 접근 보안 검증은 남았다. 전역 최신성 감지를 완성했다고 주장하지 않으며 대상별 version과 당시 snapshot만 보장한다.
