# 일일 점검 API와 검증 시나리오 — 1차안

대상 #34/#35/#44. MCP 목적 중심 도구와 앱의 서버 계약은 같고 인증 adapter만 다르다. 아래 이름은 신규 도구 계약안이며 아직 구현된 API가 아니다. 모델/DB 경계는 [모델](./daily-review-model.md)을 따른다.

## 1. 입출력 공통

- schema_version=1. 추가 필드 묵시 수용 금지. 신규 필드/enum은 스키마 버전과 호환성 검토로 추가한다.
- owner/user_id/작성 주체는 입력하지 않는다. 서버가 인증 사용자와 실제 호출 채널을 기록한다. 모델이 actor=user라고 보내도 사용자 채택 증거가 되지 않는다.
- 성공은 `{ok:true,data:{...}}`, 업무 오류는 `{ok:false,error:{code,message,field?,retryable}}`. SQL 원문/타인 레코드 정보는 노출하지 않는다. MCP adapter는 오류를 정상 저장 결과로 설명하지 않도록 isError를 설정한다.
- 인증/전송 오류는 adapter의 표준 오류로 반환한다. 업무 오류 코드는 앱/MCP에서 동일하다.
- decimal 및 bigint ID/version은 문자열, 날짜는 YYYY-MM-DD, 시각은 offset 포함 RFC3339. URL은 http/https만 허용하며 서버가 자동 fetch하지 않는다.

## 2. get_daily_context — 읽기 전용

입력: `{schema_version:1, timezone:"Asia/Seoul", subject_ids?:[기존 종목 ID 문자열]}`. 기준시각 as_of는 서버가 발급한다. subject_ids 생략은 전체 보유 문맥; 일부 선택이면 응답과 브리핑에 해당 범위를 표시한다.

출력 필드:

| 필드 | 의미 |
| --- | --- |
| as_of, timezone, local_date | 같은 기준시각에서 계산된 분석 입력 |
| portfolio | 계좌/종목 ID·이름·유형·통화·수량·평균가·평가 금액·가격/환율 날짜·품질 상태 |
| policy | 당시 strategy revision과 개인 기준 revision(null 허용), 누락/충돌 표시 |
| input_versions | holdings/metadata/prices, policy 참조; 서버 발급, 저장 때 재검증 |
| previous_review | 이전 분석 ID/분석 시각/상태/요약. 저장 도착순과 분석 시각순을 구분 |
| research_windows | 대상별 요청 구간·이전 실패·겹침 설정. 과거 전체 조사 강제 금지 |
| open_tasks / decisions | 현재 버전과 간단 요약; 상세는 별도 조회. 미구현 관계는 unavailable 명시 |
| context_receipt | 서버가 생성한 문맥을 저장 요청에 결합할 수 있는 불투명 증명 |
| completeness | complete 또는 truncated, 누락 영역·추가 조회 방법 |

조회는 review_run/브리핑/열람/잔고 확인을 생성하지 않는다. 데이터 없으면 초기 등록 안내와 empty 상태를 반환한다. 누락 환율은 null이지 0이 아니다. 한 번의 DB snapshot 안에서 읽어 서로 다른 시점의 버전과 보유값을 섞지 않는다.

문맥에는 요청 대상과 조사 기간의 manifest를 포함한다. 저장 scopes가 이를 덮는지 확인하고 누락 구간은 unverified로 기록해 complete가 되지 못하게 한다. 일부 대상으로 요청했다면 complete도 그 대상 범위에만 적용한다. truncated 문맥을 전체 포트폴리오 완료로 저장하지 못한다. 페이지를 합칠 때 같은 snapshot임을 보장하는 방식은 receipt 기술 검증에 포함한다.

### 먼저 검증할 기술 쟁점: 순수 조회와 문맥 보존

기존 초안은 ‘조회는 쓰지 않음’과 ‘저장 시 이미 존재하는 context_id 참조’를 동시에 요구했다. 그대로는 구현할 수 없다.

우선 검증할 안은 **서버 서명된 self-contained context receipt**다. 당시 snapshot·owner·schema/issued_at와 digest를 검증 가능하게 담고, 저장 시 이를 검증해 snapshot을 DB에 처음 보존한다. 클라이언트가 재작성한 snapshot을 신뢰하지 않는다. receipt는 암호화 보장이 없으므로 본문과 동일한 개인 데이터로 취급하고 URL/일반 로그에 남기지 않는다.

구현 전 작은 기술 검증으로 payload 크기, MCP 왕복, 서명 키 회전, 만료와 재시도, 압축/해제 한도, 앱과 MCP의 공통 검증 경로를 확인한다. 이 방식이 과도하면 임시 snapshot 저장 대안의 보존기간·‘읽기 전용’ 의미 변경을 문서화한 뒤 선택한다. 임의 구현 금지. 서명검증 없이 payload를 DB RPC에 전달하는 우회 경로도 금지한다.

이 항목과 크기/페이지 계약이 해결되기 전 아래 저장 API를 구현 준비 완료로 판정하지 않는다.

## 3. save_daily_briefing — 첫 저장 슬라이스

입력 필드(필수 unless `?`):

| 필드 | 제약 |
| --- | --- |
| schema_version | 1 |
| idempotency_key | 호출자가 생성한 UUID, 같은 논리 저장의 재시도에 유지 |
| context_receipt | get_daily_context 응답 원문. owner 일치/서명/버전 검증 |
| evidence[] | local_key, source_url, source_title, published_at(null 가능), checked_at, fact_summary; local_key 요청 내 유일 |
| scopes[] | local_key, subject, window_from/to, coverage, reason?, checked_at, evidence_keys[], checked_sources[] |
| briefing | headline, status, changes[], uncertainties[], evidence_keys[], decision_revision_ids[], task_ids[] |
| supersedes_briefing_id? | 기존 잘못된 분석의 정정일 때만 사용. 같은 소유자 및 순환 금지 |

changes의 항목은 summary와 evidence_keys로 구성한다. 첫 카드에는 최대 3개를 노출하지만 전체 저장의 건수 제한과는 별개다. 근거 없는 개인 의견은 사실/뉴스로 보내지 않고 uncertainties에 의견임을 표시한다.

checked_sources는 source_url/checked_at/outcome/note로 구성한다. 새 기사가 없을 때도 어떤 출처를 확인했는지 남긴다. 검색 실패를 no_action으로 저장하지 않는다. 전부 조회 실패한 실행도 insufficient_data와 사유를 저장할 수 있다.

첫 슬라이스에서는 원칙 수정·판단 채택·매매 생성·질문 상태 변경을 받지 않는다. 기존 task/decision 연결만 허용하고 미지원 관계 입력은 명확한 오류로 거부한다. 질문 해결/새 제안 저장은 후속 API 계약에서 추가하며 #35 전체 완료에는 필요하다.

후속 제안/조사 질문 batch 계약과 충돌 정책은 [lifecycle-model-api](./lifecycle-model-api.md)를 따른다. 연결 task의 당시 history/version을 보존한다. 실제 API 확장 시 schema_version/호환성 검토 없이 v1에 unknown 필드를 추가하지 않는다.

서버 처리 순서:

1. 인증 후 (user,operation,key) receipt를 조회한다. 이미 성공한 요청이면 입력 동일성 검사 후 저장된 결과를 반환한다. 재시도 시 문맥이 만료됐더라도 이미 저장된 성공 결과는 읽을 수 있다.
2. 새 요청은 문맥 증명, 필드, 모든 ID의 소유권, scope와 근거 연결을 검증한다. JSON 키 순서와 무관한 canonical 입력 digest를 사용한다. 배열 순서는 의미를 보존한다.
3. 동일 사용자/키 경쟁을 DB unique/락으로 직렬화한다. 비교 대상 버전을 일관된 snapshot/락 정책으로 읽어 stale_at_save를 판정한다.
4. run + 근거 + scopes + briefing + 관계 + 성공 receipt를 한 트랜잭션으로 저장한다. 중간 실패면 전부 rollback. 실패 응답은 성공 receipt로 저장하지 않는다.
5. stale라도 당시 분석을 보존하되 current-applicable로 승격하지 않는다. 조회 때도 현재 버전과 재비교해 그 이후 stale이 된 결과를 표시한다. 해당 scope의 과거 조사 사실은 보존하지만 새 종목/새 질문까지 조사한 것으로 확장하지 않는다.

성공 data: run_id, briefing_id, status(complete/partial/failed), analyzed_at, saved_at, stale_context, applied_task_changes(첫 버전 빈 배열), evidence_ids(local_key→UUID), scope_ids(local_key→UUID). 동일 키/입력의 재시도는 동일 응답을 반환한다.

주요 오류: validation_error(필드), context_invalid, context_expired, not_found_or_forbidden, idempotency_conflict, version_conflict, unsupported_operation, payload_too_large. 네트워크/일시 장애만 자동 재시도한다. conflict는 같은 요청을 무한 재시도하지 않고 조회·재검토한다.

## 4. list_daily_briefings / get_daily_briefing

- list 입력: limit(기본20, 최대50), cursor?. 분석 시각 DESC + ID DESC keyset 순서. 늦게 도착한 과거 분석이 최신 분석이 되지 않는다. 동일 날짜 여러 실행은 모두 보존한다.
- cursor는 인증 사용자·필터·마지막 정렬 키에 결합한다. total count는 기본 제공하지 않는다.
- detail 입력: briefing_id. 본인 아닌 ID와 없는 ID는 같은 not_found_or_forbidden.
- detail은 당시 본문·scope 품질·허용된 근거·당시 policy 참조와 현재 stale 여부를 반환한다. 생성 완료와 사용자 열람을 혼동하지 않는다.
- 첫 MCP는 본인 전용. 앱 공유용 조회는 별도 DTO/기능별 권한 검사를 사용하며 이 API에 owner 파라미터만 추가해 공개하지 않는다.

## 5. 설계 검토용 시나리오 / 예상 결과

아래는 실행한 테스트가 아니다. 다음 단계에서 JSON fixture 및 DB 인수 테스트로 옮긴다.

| ID | 입력/상황 | 기대 결과 | 담당 |
| --- | --- | --- | --- |
| R01 | 오늘 점검해줘(저장 요청 없음) | 문맥 읽기/분석만, run/열람/잔고확인 0건 생성 | #33/#34 |
| R02 | 새 기사 없음, 공시 목록 확인 성공 | scope sufficient 가능; 개인 기준에 따라 no_action 저장. 존재하지 않는 뉴스 생성 금지 | #35 |
| R03 | A 성공, B 검색 실패 | run partial; B 구간 유지; 전체 no_action 거부 | #34/#35 |
| R04 | 며칠 후 복귀, 앞날 B 실패 | 마지막 저장일 이후만 조회하지 않음; B 실패 구간+겹침 포함 | #34 |
| R05 | 저장 commit 후 응답 유실 | 같은 키·입력 재시도 → 동일 ID와 응답, 추가 행 0 | #35-C |
| R06 | 같은 키로 제목 변경 | idempotency_conflict, 원본 유지 | #35-C |
| R07 | 근거 한 항목이 다른 사용자 ID | 전체 rollback, 다른 사용자 존재/제목 노출 없음 | #35/#43 |
| R08 | 분석 중 잔고나 기준 변경 | 분석 저장은 가능, stale 표시, 사용자 원칙/질문 자동 변경 없음 | #34/#35 |
| R09 | 두 대화가 같은 시각 분석 | 각 run 보존. 이전 질문 갱신 도입 후에는 CAS 충돌을 별도 검증 | #35-C |
| R10 | 늦게 도착한 과거 분석 | 분석 기준시각으로 정렬. 최신 상태를 덮지 않음 | #35-C |
| R11 | 원문 기사 정정/삭제 | 새 evidence revision 연결; 과거 브리핑 근거 snapshot 유지 | #35/#44 |
| R12 | 같은 사건의 반복 보도 | URL만으로 사건 병합 안 함. 사건 계약 도입 전 중복 변화 자동판정 보장 안 함 | #44 |
| R13 | 브리핑만 공유, 개인 기준 비공개 | 공개 본문만 제공; private ID/제목/개수/context 없음 | #43/#39 |
| R14 | 공유 철회 직후 직접 링크/CSV 요청 | 새 요청 거부, 캐시 무효화, 이미 복사한 자료 회수 보장 안 함 | #43/#39 |
| R15 | 실제 매수했다는 말 없는 ‘유지 의견 저장’ | 체결/보정 생성 0; 의견과 사용자 채택은 별개 | #35/#37 |
| R16 | 위조 receipt / 타인 receipt / 압축 폭탄 | 검증 오류, 저장 0, 민감 payload 로그 없음 | #33/#35 |

## 다음 검증 산출물

1. context receipt 작은 기술 검증 및 크기/분할 계약 확정.
2. 위 필드의 JSON Schema와 실제 UUID·RFC3339·decimal을 사용한 정상/반례 fixture 작성 및 자동 검증.
3. 같은 fixture로 RPC 트랜잭션/RLS/idempotency 테스트 작성. 구현 전에는 예상 실패 테스트임을 명시한다.
4. 결정·질문 갱신 및 공유 DTO 계약을 확장한 뒤 티켓 완료 조건과 대조한다.
