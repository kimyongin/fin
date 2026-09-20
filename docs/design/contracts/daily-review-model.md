# 공통 모델과 일일 점검 — 1차 계약안

대상 #43/#44 → #35-A/#34. 아직 SQL migration이 아니다. 제품 정책은 PRD/ADR 우선, 이 문서에 없는 체결/결정 쓰기 API는 후속 계약이다.

## 공통 규칙

- 신규 ID는 서버 발급 UUID. 기존 bigint ID는 API에서 decimal 문자열로 표현한다. 기존 테이블 PK를 UUID로 전면 교체하지 않는다.
- 신규 소유 레코드: user_id UUID NOT NULL, id UUID PK, UNIQUE(user_id,id). 참조는 (user_id,parent_id) 복합 FK로 동일 소유자를 강제한다. user_id는 인증에서 파생하며 사용자 입력으로 받지 않는다.
- 생성 시각은 서버 timestamptz. 분석 기준시각/발행시각/확인시각은 구별한다. 사용자가 말한 날짜는 date와 IANA timezone으로 보존한다. 발행일 불명은 null이다.
- 변경 가능한 head에는 version bigint NOT NULL DEFAULT 1 CHECK(version>0). API에서는 문자열. 변경은 expected_version 비교와 잠금 뒤 version+1. 변경 없는 요청은 버전을 올리지 않는다.
- revision/snapshot은 생성 이후 불변. head 수정은 새 revision을 만들며 기존 revision을 UPDATE하지 않는다. 부모 삭제로 역사 자료가 cascade 삭제되지 않게 한다. 계정 삭제 절차는 별도 개인정보 삭제 정책을 따른다.
- 숫자 원본은 decimal 문자열/numeric. 기존 real 정밀도 전환과 수량/금액 scale은 #32에서 검증한 뒤 고정한다. 현재 문자열 계약만으로 기존 실수 오차가 해결되지는 않는다.
- 자유 본문은 JSON 관계의 대체물이 아니다. 모델 작성 본문/URL을 코드·도구 지침으로 실행하지 않는다.

## 모델 대응과 필드

아래 신규 테이블명은 1차안이다. `?`는 nullable, `[]`는 API 표현이며 소유권 참조 목록은 연결 테이블로 저장한다.

| 테이블 | 주요 필드와 제약 | 원본 책임 |
| --- | --- | --- |
| portfolio_state_versions | user_id PK, holdings_version, metadata_version, prices_version | 잔고·분류·시세 등 분석 입력 변경 감지. 기존 모든 쓰기 경로에서도 갱신 |
| strategy_revisions | id, user_id, strategy_id, revision_no, snapshot jsonb, provenance, created_at; UNIQUE(user_id,strategy_id,revision_no) | 당시 버킷 논리 키·태그·모드·목표·원칙/한도 보존. 기존 strategies는 current 호환 |
| investment_profile_revisions | id, user_id, revision_no, raw_text, structured_fields jsonb, provenance | 새 개인 기준. 기존 공유 strategy JSON과 물리적으로 분리 |
| investment_profile_heads | user_id PK, current_revision_id?, version | 미입력과 사용자 확정을 구분. 없음은 null이지 기본 성향 아님 |
| sharing_policy_heads | user_id PK, version | 묶음 권한 변경의 CAS 및 캐시 버전 |
| feature_read_grants | user_id, audience_key, feature_key, action; 복합 PK | audience=existing_viewers, action=read만 허용. row 없음=deny |
| review_runs | id, user_id, analyzed_at, local_date, timezone, status, previous_run_id?, context_snapshot jsonb, context_hash, input_versions jsonb, stale_at_save bool, created_at | 분석 실행과 사용한 입력. 새 저장만 생성; 날짜별 UNIQUE를 두지 않음 |
| review_scopes | id, user_id, run_id, subject_kind, instrument_id?, task_id?, window_from, window_to, coverage, reason?, checked_at | 대상별 실제 조사 범위. [from,to), from<to; portfolio/instrument/task 대상에 맞는 ID 조합 CHECK |
| research_evidence_revisions | id, user_id, source_url, source_title, published_at?, checked_at, fact_summary, excerpt?, supersedes_id?, correction_reason? | 개인 근거 snapshot. 전체 기사 복사는 필수 아님. 기존 news_facts 변경/삭제와 독립 |
| review_scope_evidence | user_id, scope_id, evidence_revision_id; 복합 PK/FK | 조사와 근거 연결. 같은 URL에도 다른 revision 가능 |
| review_scope_sources | id, user_id, scope_id, source_url, checked_at, outcome, note? | 검색/공시 조회했으나 새 사건이 없었던 확인도 기록. outcome=checked/failed |
| briefing_revisions | id, user_id, run_id UNIQUE, headline, status, changes jsonb, uncertainties jsonb, supersedes_id? | 한 실행의 읽기용 결과. 내용 수정도 새 run/revision; 과거 덮어쓰기 없음 |
| briefing_evidence / briefing_decisions / briefing_tasks | user_id, briefing_id, evidence/decision revision 또는 task_id+task_history_id; 복합 PK/FK | 당시 내용은 불변 revision/history로 복원하고 현재 상태는 head로 별도 조회. 대상 권한 각각 검사 |
| mutation_receipts | user_id, operation, idempotency_key, request_hash, response jsonb, created_at; 복합 UNIQUE | 성공한 쓰기와 같은 트랜잭션으로 저장; 응답 유실 재시도 |

strategy의 current revision 연결은 기존 테이블에 추가하되 공개 응답에는 자동 포함하지 않는다. strategy snapshot의 세부 JSON Schema와 profile structured_fields의 필드/단위는 #43 후속 계약에서 고정한다. 범용 무검증 JSON 저장을 뜻하지 않는다.

## 후속 관계와 첫 슬라이스 경계

후속 관계의 서비스/필드 설계는 [lifecycle-model-api](./lifecycle-model-api.md)로 확장했다. 아래는 첫 구현 슬라이스의 범위 제한이지 후속 설계가 전혀 없다는 뜻이 아니다.

- decision_heads + decision_revisions: 제안/채택/대체의 안정 ID와 이력. 첫 점검 저장은 기존 판단 참조만 허용한다. 채택·대체 API를 먼저 임의 구현하지 않는다.
- tasks + task_history: 열린 질문/실행 계획과 버전. 첫 점검 저장은 기존 할 일 참조만 허용한다. 조사 질문 갱신은 상태전이 계약 완료 후 동일 트랜잭션 확장으로 제공한다.
- 사건/근거 관계, holding thesis revision, 실제 잔고 확인, task-fill 연결은 후속 슬라이스다. 아직 없으면 `unavailable`로 표시하고 연결된 것으로 꾸미지 않는다.
- 위 제한은 #35 최종 범위를 축소하는 제품 결정이 아니라 첫 구현 순서다. 최종 #35/#44 완료에는 후속 관계 계약과 구현이 필요하다.

## 조사 상태

- scope.coverage = sufficient / partial / unverified. partial/unverified에는 reason 필수.
- sufficient는 해당 기간·대상·명시한 출처의 확인 완료일 뿐 모든 웹 정보 확인 보장이 아니다.
- 새 사건 없음도 checked source가 있으면 sufficient 가능하다. 출처 조회 실패만 있는 scope는 sufficient 불가. 기사 1건이 존재한다는 것만으로 충분함을 서버가 보증하지 않는다.
- run.status는 서버가 scope에서 산출: 모두 sufficient → complete, 일부 확인됨 → partial, 모두 unverified → failed. 빈 scope는 거부한다. draft 저장은 후속이며 완료 구간에 반영하지 않는다.
- briefing.status = no_action / attention / insufficient_data. 전체 partial/failed를 no_action으로 저장할 수 없다. complete는 자동 no_action이 아니다.
- 완료 구간은 sufficient scope들의 구간 합집합으로 계산한다. partial은 해당 전체 구간을 완료 처리하지 않는다. 일부만 완료했다면 구간을 나눠 저장한다. max(to) 하나로 구멍을 메우지 않는다.
- 다음 문맥: 이전 미확인 구간 + 마지막 완료 구간 말단의 겹침 + 새 기간. 겹침 기본 3일은 검증 후보이며 버전 있는 서버 설정으로 반환한다. 첫 사용자에게 과거 전체 조사를 강요하지 않는다.

## 공유와 직접 접근

- 기존 공유는 현재 공개 기능을 명시적으로 grant 이관한다. 새 briefings/decisions/tasks/investment_profile/holding_theses/research_evidence는 기본 grant 없음.
- 공유 조회는 기존 친구/뷰어 관계가 유효하고 기능 read grant가 있어야 한다. OAuth MCP는 본인 문맥만 접근한다.
- 원본 context_snapshot, input_versions, request/response receipt, private revision 테이블은 공유에 직접 SELECT 허용하지 않는다. 보안 RPC가 공개 DTO만 투영한다.
- 브리핑 공유 허용 필드 후보: id, analyzed_at, local_date, timezone, headline, status, 공개 본문 changes/uncertainties, 조사 품질 요약, 허용된 관계. owner 인증 식별자·private 기준/스냅샷·receipt는 제외한다.
- 숨긴 관계는 ID/제목/개수/배열 placeholder를 반환하지 않는다. 공유 화면에 공통 ‘일부 근거는 공개 범위에 따라 생략될 수 있음’ 안내만 둘 수 있다. 특정 비공개 관계의 존재를 추론시키지 않는다.
- 본문에 이미 들어간 사적인 설명은 FK 숨김으로 지워지지 않는다. 실제 공개 본문 미리보기와 사용자의 영역 공개 선택이 필요하다.
- 원본 테이블 직접 쓰기는 새 API 검증을 우회하지 못하게 제한한다. RPC는 인증·소유권·허용 필드·트랜잭션을 검증하고 security definer의 search_path/EXECUTE grant를 명시한다.

## 아직 통과하지 않은 게이트

물리 DDL/인덱스·모든 JSON 필드 스키마·공유별 DTO·권한 SQL·실제 충돌 테스트가 남았다. 이 표를 그대로 migration으로 옮기는 단계가 아니다. 특히 모든 기존 쓰기 경로에서 버전 증가를 보장하기 전 stale 감지가 완성됐다고 할 수 없다.
