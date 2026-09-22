# 일일 점검 API와 검증 시나리오

적용 기준: [ADR-0004](../../adr/0004-domain-storage-and-minimal-mutation-contract.md). 범용 저장 모델 대신 도메인 테이블+공통 변경 규약을 사용하며, 문맥은 서버 임시 보관, 당시 내용은 snapshot으로 보존한다.

대상 #34/#35/#44. MCP 목적 중심 도구와 앱은 동일한 `app_*` RPC 의미를 사용하고 인증 adapter만 다르다. 아래 `get/save/list` 계약은 migration 001~009와 OAuth 도구로 구현·로컬 검증됐다. 운영 제공 여부는 [구현 현황 감사](../../tickets/implementation-audit-20260921.md)를 따른다. 모델/DB 경계는 [모델](./daily-review-model.md)을 따른다.

## 1. 입출력 공통

- schema_version=1. 추가 필드 묵시 수용 금지. 신규 필드/enum은 스키마 버전과 호환성 검토로 추가한다.
- owner/user_id/작성 주체는 입력하지 않는다. 서버가 인증 사용자와 실제 호출 채널을 기록한다. 모델이 actor=user라고 보내도 사용자 채택 증거가 되지 않는다.
- 성공은 `{ok:true,data:{...}}`, 업무 오류는 `{ok:false,error:{code,message,field?,retryable}}`. SQL 원문/타인 레코드 정보는 노출하지 않는다. MCP adapter는 오류를 정상 저장 결과로 설명하지 않도록 isError를 설정한다.
- 인증/전송 오류는 adapter의 표준 오류로 반환한다. 업무 오류 코드는 앱/MCP에서 동일하다.
- decimal 및 bigint ID/version은 문자열, 날짜는 YYYY-MM-DD, 시각은 offset 포함 RFC3339. URL은 http/https만 허용하며 서버가 자동 fetch하지 않는다.

## 2. get_daily_context — 업무 데이터 조회 + 임시 문맥 보관

입력: `{schema_version:1, timezone:"Asia/Seoul", subject_ids?:[기존 종목 ID 문자열]}`. 기준시각 as_of는 서버가 발급한다. subject_ids 생략은 전체 보유 문맥; 일부 선택이면 응답과 브리핑에 해당 범위를 표시한다.

출력 필드:

| 필드 | 의미 |
| --- | --- |
| as_of, timezone, local_date | 같은 기준시각에서 계산된 분석 입력 |
| portfolio | 계좌/종목 ID·이름·유형·통화·수량·평균가·평가 금액·가격/환율 날짜·품질 상태 |
| policy | 당시 전략/개인 기준 값·대상별 version(null 허용), 누락/충돌 표시 |
| dependencies | 실제 변경에 필요한 대상 ID/version. 전역 가격/메타데이터 카운터는 요구하지 않음 |
| previous_review | 이전 분석 ID/분석 시각/상태/요약. 저장 도착순과 분석 시각순을 구분 |
| research_windows | 대상별 요청 구간·이전 실패·겹침 설정. 과거 전체 조사 강제 금지 |
| open_tasks / decisions | 현재 버전과 간단 요약; 상세는 별도 조회. 미구현 관계는 unavailable 명시 |
| recent_activity | 최신 수행 활동의 현재 제목·메모·결과·결론과 원본 참조. 같은 활동 편집은 새 행을 만들지 않으며 태스크 생성/수정 유지보수 이벤트는 제외 |
| context_id | 서버에 임시 보관된 불변 문맥 ID. 인증된 소유자만 접근 |
| completeness | complete 또는 truncated, 누락 영역·추가 조회 방법 |

조회는 review_run/브리핑/열람/잔고 확인을 생성하지 않는다. 데이터 없으면 초기 등록 안내와 empty 상태를 반환한다. 누락 환율은 null이지 0이 아니다. 한 번의 DB snapshot 안에서 읽어 서로 다른 시점의 버전과 보유값을 섞지 않는다.

저장된 활동 리포트는 생성 당시 요약을 보존한다. 참조 활동의 현재 내용이 수정되거나 기간 밖으로 이동했거나, 현재 기간에 포함되는 새 활동이 생기면 `needs_regeneration=true`를 반환한다. 이를 위해 별도 결과 revision이나 편집 이벤트를 만들지 않고 활동 ID·`updated_at`·현재 기간만 대조하며, 서버가 리포트를 자동 재작성하지 않는다.

문맥에는 요청 대상과 조사 기간의 manifest를 포함한다. 저장 scopes가 이를 덮는지 확인하고 누락 구간은 unverified로 기록해 complete가 되지 못하게 한다. 일부 대상으로 요청했다면 complete도 그 대상 범위에만 적용한다. truncated 문맥을 전체 포트폴리오 완료로 저장하지 못한다. 페이지는 같은 context_id의 snapshot을 읽는다. 서버 context의 크기/페이지 한도는 첫 기능에서 검증한다.

### 서버 임시 문맥 — ADR-0004로 확정한 방향

서버가 문맥을 임시 저장하고 context_id만 전달한다. 분석/열람/실제확인 기록은 생성하지 않는다. context는 불변이며 인증된 owner만 읽고 저장에 사용할 수 있다. 만료·정리·생성 제한·크기 상한은 첫 기능에서 검증한다. 성공 저장은 snapshot을 브리핑에 복사하므로 임시 context 삭제와 독립적이다. signed receipt·압축·키 회전은 도입하지 않는다. 현재 도구 메타데이터의 read-only 의미도 실제 임시 쓰기에 맞춰 검증한다.

## 3. save_daily_briefing — 첫 저장 슬라이스

입력 필드(필수 unless `?`):

| 필드 | 제약 |
| --- | --- |
| schema_version | 1 |
| idempotency_key | 호출자가 생성한 UUID, 같은 논리 저장의 재시도에 유지 |
| context_id | 서버 임시 문맥의 소유권·만료 확인. 저장 시 원본 snapshot 복사 |
| evidence[] | local_key, source_url, source_title, published_at(null 가능), checked_at, fact_summary; local_key 요청 내 유일 |
| scopes[] | local_key, subject, window_from/to, coverage, reason?, checked_at, evidence_keys[], checked_sources[] |
| briefing | headline, status, changes[], uncertainties[], evidence_keys[], decision_ids[], task_ids[] |
| supersedes_briefing_id? | 기존 잘못된 분석의 정정일 때만 사용. 같은 소유자 및 순환 금지 |

changes의 항목은 summary와 evidence_keys로 구성한다. 첫 카드에는 최대 3개를 노출하지만 전체 저장의 건수 제한과는 별개다. 근거 없는 개인 의견은 사실/뉴스로 보내지 않고 uncertainties에 의견임을 표시한다.

checked_sources는 source_url/checked_at/outcome/note로 구성한다. 새 기사가 없을 때도 어떤 출처를 확인했는지 남긴다. 검색 실패를 no_action으로 저장하지 않는다. 전부 조회 실패한 실행도 insufficient_data와 사유를 저장할 수 있다.

`save_daily_briefing` schema v1은 원칙 수정·판단 채택·매매 생성·질문 상태 변경이나 decision/task ID 연결을 받지 않는다. 관계 변경은 별도의 version/idempotency 보호 도구로 처리하며 미지원 필드는 명확한 오류로 거부한다.

판단·조사 질문·실행 계획과 충돌 정책은 [lifecycle-model-api](./lifecycle-model-api.md)를 따른다. 첫 버전은 과도한 batch API 대신 목적별 원자 RPC를 택했다. API 확장 시 schema_version/호환성 검토 없이 v1에 unknown 필드를 추가하지 않는다.

서버 처리 순서:

1. 인증 후 (user,operation,key) receipt를 조회한다. 이미 성공한 요청이면 입력 동일성 검사 후 저장된 결과를 반환한다. 재시도 시 문맥이 만료됐더라도 이미 저장된 성공 결과는 읽을 수 있다.
2. 새 요청은 서버 context 소유권/만료, 필드, 모든 ID의 소유권, scope와 근거 연결을 검증한다. JSON 키 순서와 무관한 canonical 입력 digest를 사용한다. 배열 순서는 의미를 보존한다.
3. 동일 사용자/키 경쟁을 DB unique/락으로 직렬화한다. 수정 대상과 필요한 의존값만 잠금/버전 검사한다. 단순 가격 갱신으로 질문 변경을 차단하지 않는다.
4. context snapshot을 포함한 briefing + 근거 + scopes + 관계 + 성공 receipt를 한 트랜잭션으로 저장한다. 중간 실패면 전부 rollback. 실패 응답은 성공 receipt로 저장하지 않는다.
5. 당시 분석과 입력 시각을 보존하고 알려진 관련 변경을 표시한다. 대상별 확인 범위를 명시하며 전역 최신성 보장은 하지 않는다. 해당 scope의 과거 조사 사실은 보존하지만 새 종목/새 질문까지 조사한 것으로 확장하지 않는다.

성공 data: briefing_id, coverage_status(complete/partial/failed), analyzed_at, saved_at, stale_context, applied_task_changes(첫 버전 빈 배열), evidence_ids(local_key→UUID), scope_ids(local_key→UUID). 동일 키/입력의 재시도는 동일 응답을 반환한다.

주요 오류: validation_error(필드), context_invalid, context_expired, not_found_or_forbidden, idempotency_conflict, version_conflict, unsupported_operation, payload_too_large. 네트워크/일시 장애만 자동 재시도한다. conflict는 같은 요청을 무한 재시도하지 않고 조회·재검토한다.

## 4. list_daily_briefings / get_daily_briefing

- list 입력: limit(기본20, 최대50), cursor?. 분석 시각 DESC + ID DESC keyset 순서. 늦게 도착한 과거 분석이 최신 분석이 되지 않는다. 동일 날짜 여러 실행은 모두 보존한다.
- cursor는 인증 사용자·필터·마지막 정렬 키에 결합한다. total count는 기본 제공하지 않는다.
- detail 입력: briefing_id. 본인 아닌 ID와 없는 ID는 같은 not_found_or_forbidden.
- detail은 당시 본문·scope 품질·허용된 근거·당시 policy 참조와 현재 stale 여부를 반환한다. 생성 완료와 사용자 열람을 혼동하지 않는다.
- 첫 MCP는 본인 전용. 앱 공유용 조회는 별도 DTO/기능별 권한 검사를 사용하며 이 API에 owner 파라미터만 추가해 공개하지 않는다.

## 5. 계약 시나리오 / 기대 결과

R01~R10의 핵심 소유권·멱등·만료·부분 범위·정렬 계약은 DB/MCP 테스트에 반영했다. R11~R12의 실제 정정 기사·반복 보도 품질은 운영 대화 파일럿에서 확인한다.

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
| R11 | 원문 기사 정정/삭제 | 이전 근거를 참조하는 새 기록 연결; 과거 브리핑 근거 snapshot 유지 | #35/#44 |
| R12 | 같은 사건의 반복 보도 | URL만으로 사건 병합 안 함. 사건 계약 도입 전 중복 변화 자동판정 보장 안 함 | #44 |
| R13 | 브리핑만 공유, 개인 기준 비공개 | 공개 본문만 제공; private ID/제목/개수/context 없음 | #43/#39 |
| R14 | 공유 철회 직후 직접 링크/CSV 요청 | 새 요청 거부, 캐시 무효화, 이미 복사한 자료 회수 보장 안 함 | #43/#39 |
| R15 | 실제 매수했다는 말 없는 ‘유지 의견 저장’ | 체결/보정 생성 0; 의견과 사용자 채택은 별개 | #35/#37 |
| R16 | 존재하지 않는/타인/만료 context, 과도한 조회 생성 | 접근/만료/한도 오류, 업무 저장 0, 민감 로그 없음 | #33/#35 |

## 다음 검증 산출물

1. 서버 context의 TTL·정리·사용자별 생성 제한·크기/분할 및 저장 복사 검증.
2. 위 필드의 JSON Schema와 실제 UUID·RFC3339·decimal을 사용한 정상/반례 fixture 작성 및 자동 검증.
3. 같은 fixture로 RPC 트랜잭션/RLS/idempotency 테스트 작성. 구현 전에는 예상 실패 테스트임을 명시한다.
4. 결정·질문 갱신 및 공유 DTO 계약을 확장한 뒤 티켓 완료 조건과 대조한다.
