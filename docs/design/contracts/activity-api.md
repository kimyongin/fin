# 활동 API 계약

상태: #80 최소 계약에서 시작, #115 활동 상세 간소화를 반영 · 2026-09-24. 이전 판단 테이블/후속 연결 설명보다 ADR-0008과 #115가 우선한다.

## 저장 정본

- `portfolio_tasks`: 앞으로 할 일과 반복 설정의 정본이다.
- `activity_events`: 실제로 한 일과 자동 변경의 정본이다. `title`, `note`, `result`, `conclusion`, `occurred_at`, 선택 `instrument_id`/`account_id`를 현재값으로 가진다.
- 별도 결과 테이블이나 일반 편집 이력 테이블을 만들지 않는다. 같은 활동 편집은 `activity_events.version`과 `updated_at`만 갱신한다.
- `before_data`/`after_data`, 대상 참조와 금융 도메인 테이블은 자동 금융 사실의 정본이다. 일반 활동 편집으로 덮어쓰지 않는다.
- `activity_events.task_id`는 해당 기록이 수행한 기존 할 일을 가리킨다. 반대 방향 후속 연결 필드는 제거했다.

## 편집 허용 범위

| 활동 | 허용 필드 | 보호 필드 |
| --- | --- | --- |
| 수동 활동, 일반 할 일 완료 | 제목, 수행 시각, 메모, 결과, 결론, 종목, 계좌 | 소유자, 원본 태스크 참조, 생성 시각 |
| 자동 금융·도메인 변경 | 메모 | action type, 대상, before/after, 수량·금액, 원본 참조, 발생 시각 |
| 기존 투자 판단 이벤트 | 메모 | 기존 판단 본문·상태·당시 원칙·연결·이력 |

서버 RPC가 허용 목록과 소유권을 검사한다. 클라이언트가 이벤트 JSON 전체를 저장할 수 없다.

## 앱·MCP 공통 RPC

| RPC | 의미 |
| --- | --- |
| `app_create_activity` | 이미 한 활동 한 건을 멱등 저장한다. 결과·결론은 선택이다. |
| `app_get_activity` | 현재 내용, 편집 가능 필드와 권한이 허용된 관련 할 일 요약을 한 번에 읽는다. |
| `app_update_activity` | expected version으로 같은 활동의 허용된 현재값만 수정한다. |
| `app_save_general_task` / `app_transition_general_task` | 기존 예정·반복·완료·재개 계약을 유지한다. |

MCP는 저장 유형을 사용자에게 묻지 않는다. 미래 의도는 `save_general_task`, 이미 한 일은 `record_manual_activity`, 기존 할 일 수행은 `transition_general_task`, 현재 활동 수정은 `update_activity`를 사용한다. `record_manual_activity`라는 호환 도구 이름은 유지하지만 사용자 설명은 ‘완료한 활동 기록’으로 제공한다.

## 기존 판단 매핑

판단의 현재 내용은 `activity_events`에 저장한다. 할 일 완료 기록은 `task_id`로 원래 할 일을 표시한다. 판단 후 사용자가 요청한 미래 할 일은 독립된 `portfolio_tasks` 행으로 저장한다.

## 충돌·재시도

- 활동과 독립 할 일의 생성은 각각 idempotency key로 재시도한다.
- 현재 내용 수정은 `expected_version`이 다르면 충돌로 실패하고 다시 읽는다.
- 일반 메모 변경마다 별도 활동이나 revision을 만들지 않는다.
- 공유 조회는 기존 `activity`/`tasks` 기능 권한을 각각 적용하고 공유 사용자는 편집할 수 없다. 할 일 완료 기록은 제목 자체가 비공개 할 일을 드러낼 수 있으므로 친구에게는 활동·할 일 읽기 권한이 모두 있을 때만 목록·검색·상세에 나타난다. 독립 수동 기록은 활동 권한만으로 읽는다.

## 통합 검색

2026-09-27 #161 로컬 구현 계약. 운영 배포와 실제 ChatGPT 검증은 별도다. [검색 정본](../activity-context-search.md)의 연결 맥락과 종목 자동완성은 #162~#164 후속 작업이다.

- 앱과 OAuth MCP의 `search_activities`는 같은 검색 함수를 사용한다. 검색어가 있으면 현재·완료·중단 할 일과 기록을 함께 찾고, 제목 정확 일치/접두/본문 포함을 유사도보다 우선한다. 기록 기간·상태·종목·일반 태그·공유 권한은 결과 정렬과 페이지 지정 전에 적용한다.
- 저장/수정은 task/event 트리거가 기존 벡터를 지우고 전용 pgmq 큐에 400자씩 색인 요청을 보낸다. cron/pg_net은 Vault의 프로젝트 URL과 서비스 키가 설정된 환경에서 요청 하나씩 색인 함수를 호출한다. 작업은 현재 본문 해시를 다시 확인하고 오래된 요청을 버린다. 최대 다섯 번의 실패 뒤 큐 보관 영역으로 옮긴다. 저장 자체는 색인 성공을 기다리지 않는다.
- 현재 제공자는 Supabase Edge 내장 `gte-small`(384차원)이다. 사용자가 우선 사용하기로 정한 초기 선택이며 한국어 유사 표현의 품질을 보장하지 않는다. 모델 호출은 하나의 모듈에 두었고 추후 Cloudflare 등 차원이 다른 모델을 쓰려면 벡터 스키마/인덱스와 백필도 함께 교체한다. 제목·본문/설명만 색인하고 금융 snapshot과 인증정보는 색인하지 않는다.
- 검색 요청은 문서를 색인하지 않는다. 검색어 벡터 하나는 별도 Edge 호출에서 생성한다. 그 호출이 실패하면 같은 필터와 페이지 계약의 단어 검색을 제공한다. `semantic_status=active`는 현재 색인 범위가 채워졌다는 뜻, `indexing`은 일부 자료의 색인이 남았다는 뜻, `unavailable`은 단어 검색만 했다는 뜻이다. 세 값 모두 자료 부재나 의미 품질을 증명하지 않는다.
- #165부터 응답의 `search_mode`는 실제 `browse`/`keyword`/`hybrid` 경로, `fallback_reason`은 확인된 대체 원인 또는 null, `index_status`는 `complete`/`partial`/`unknown`/`not_checked`다. `semantic_status`는 기존 소비자 호환을 위해 유지하므로 coverage 조회 실패 때도 보수적으로 `indexing`일 수 있다. 실제 색인 확인 여부는 `index_status`로 구분한다. 직접 결과의 `matched_by`는 실제 단어 포함/유사도 임계값 판정을 나타낸다. `semantic_score`는 원본별 최고 청크의 코사인 유사도이며 계산하지 않았으면 null이다. 점수가 있다고 유사도 일치인 것은 아니며 정확도·확률로 해석하지 않는다. 벡터를 사용한 응답에만 `embedding_model`과 `semantic_threshold`를 넣는다. 자세한 표시·커서 계약은 [#165](../../tickets/search-05-search-evidence.md)를 따른다.
- 정렬 커서는 검색어·필터·모델·검색 모드를 묶는다. 조건이나 모드가 바뀐 커서는 새 검색을 요구한다. 유사도는 검색 순서에만 쓰며 투자 판단의 확률이나 신뢰도로 표현하지 않는다.
