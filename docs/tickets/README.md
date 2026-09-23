# MCP-first Portfolio: 매일 점검하고 쉽게 기록하는 앱

## 미구현 — UI 버그 후속 (#104~#106)

2026-09-23 정적 검토에서 발견한 버그다. 브라우저 재현과 코드 수정은 아직 하지 않았다. #98~#103의 기존 검증 증거와 운영 게이트를 대체하지 않는다.

| 티켓 | 로컬 명세 |
| --- | --- |
| [#104 활동 상세 초안 보존·취소·연결 이동](https://github.com/kimyongin/fin/issues/104) | [명세](./ui-bug-followup-01-activity-drafts.md) |
| [#105 유형 전환의 숨겨진 필드 검증](https://github.com/kimyongin/fin/issues/105) | [명세](./ui-bug-followup-02-action-validation.md) |
| [#106 원칙 편집 보호·날짜 조회 순서](https://github.com/kimyongin/fin/issues/106) | [명세](./ui-bug-followup-03-principles.md) |

버그와 별개인 [구조 리팩토링 검토](../engineering/refactoring-review-20260923.md)는 아래 #107~#110으로 구체화했다.

## 미구현 — 구조 리팩토링 (#107~#110)

| 티켓 | 로컬 명세 |
| --- | --- |
| [#107 전략 계산과 화면 표현 분리](https://github.com/kimyongin/fin/issues/107) | [명세](./refactor-01-strategy-calculations.md) |
| [#108 공유·게스트 접근을 자산 액션에서 분리](https://github.com/kimyongin/fin/issues/108) | [명세](./refactor-02-sharing-boundary.md) |
| [#109 E2E를 사용자 흐름별로 분리](https://github.com/kimyongin/fin/issues/109) | [명세](./refactor-03-e2e-scenarios.md) |
| [#110 운영 전환 후 구 활동 표시 호환 정리](https://github.com/kimyongin/fin/issues/110) | [명세](./refactor-04-legacy-activity-display.md) |

순서: #104~#106 버그 수정 → #107 → #108. #109는 버그 회귀 테스트 추가 후 분리하며, 파일 간 병렬 실행과 공유 데이터 의존성을 먼저 확인한다. #110은 #91 운영 전환/표시 호환 확인 후에만 진행하는 후순위이며 릴리스 선행 조건이 아니다. 외부 동작·저장 계약을 유지하고 새 범용 프레임워크를 만들지 않는다. 티켓 작성만 완료했으며 구현·커밋·배포는 하지 않았다.

## 로컬 구현·격리 검증 완료 — 안정화 재검토 (#98~#103)

2026-09-23 · 기준 코드 `b7ee31d`에서 정적 재검토로 확인한 후속 문제를 로컬에서 구현했다. DB 37파일/510건, MCP 계약, Chromium 48건, 단위 99건과 빌드/가이드/인코딩을 검증했다. 각 티켓에 실제 결과와 미검증 범위를 기록했다. 원격 CI·운영 적용·실제 ChatGPT 평가는 별도 게이트다.

| 티켓 | 목적 | 로컬 명세 |
| --- | --- | --- |
| #98 | [활동 필터 재선택과 조회 상태 회귀 수정](https://github.com/kimyongin/fin/issues/98) | [명세](./stability-review-01-filters.md) |
| #99 | [원칙·후속 할 일 저장 재시도와 날짜 기준 정리](https://github.com/kimyongin/fin/issues/99) | [명세](./stability-review-02-saves.md) |
| #100 | [활동 모달의 미저장·저장 중 닫기·뒤로가기 일관화](https://github.com/kimyongin/fin/issues/100) | [명세](./stability-review-03-modals.md) |
| #101 | [활동 태그 목록 상태와 갱신 경로 통합](https://github.com/kimyongin/fin/issues/101) | [명세](./stability-review-04-tags.md) |
| #102 | [필수 저장 RPC 누락을 잡는 배포 호환성 검사](https://github.com/kimyongin/fin/issues/102) | [명세](./stability-review-05-readiness.md) |
| #103 | [현재 개발 기준과 과거 설계 문서 분리](https://github.com/kimyongin/fin/issues/103) | [명세](./stability-review-06-docs.md) |

순서: #98 조회 회귀 → #99 저장 재시도 → #100 모달 → #101 태그 갱신. #102 배포 검사는 운영 전환 전에, #103 문서 정리는 각 변경 기록과 최종 인계에 적용한다. 새 테이블/범용 엔진은 기본 해법으로 삼지 않는다. #92~#97의 기존 구현·검증 증거와 미검증 항목은 유지하며, 새 티켓은 해당 문제의 후속 구현을 담당한다. 기존 티켓은 자동 종료하지 않는다.


## 로컬 구현 완료 — 저장 단순화 후속 안정화 (#92~#97)

2026-09-23 로컬 구현과 자동 검증을 마쳤다. 기준 코드 `8cb943f`에서 재시도 중복·늦은 응답·날짜 불일치를 먼저 고친 뒤 미사용 코드와 실제 중복만 정리했다. 새 제품 개념이나 범용 저장 테이블을 추가하지 않았다. 운영 배포·실제 ChatGPT 평가·원격 PR CI 관찰은 별도 게이트로 남는다. 각 티켓의 미검증 범위를 확인한다.

| 순서 | GitHub | 로컬 명세 |
| --- | --- | --- |
| 1 | [#92 활동·할 일과 태그의 원자 저장 및 재시도 안정화](https://github.com/kimyongin/fin/issues/92) | [명세](./post-simplification-01-save.md) |
| 2 | [#93 활동 상세·검색의 늦은 응답과 조회 상태 정리](https://github.com/kimyongin/fin/issues/93) | [명세](./post-simplification-02-requests.md) |
| 3 | [#94 업무 날짜와 시간대 처리 통일](https://github.com/kimyongin/fin/issues/94) | [명세](./post-simplification-03-dates.md) |
| 4 | [#95 미사용 화면·활동 조회·구 명칭 제거](https://github.com/kimyongin/fin/issues/95) | [명세](./post-simplification-04-cleanup.md) |
| 5 | [#96 활동 본문·출처 표시 재사용과 편집 모달 분리](https://github.com/kimyongin/fin/issues/96) | [명세](./post-simplification-05-components.md) |
| 6 | [#97 PR·배포의 공통 검증 기준 일치](https://github.com/kimyongin/fin/issues/97) | [명세](./post-simplification-06-ci.md) |

추천 순서: #92 → #93 → #94 → #95 → #96. #97은 첫 슬라이스부터 필요한 검증을 보강하고 최종 적용 결과를 확인한다. #96은 저장·조회 안정화와 미사용 코드 제거 후 착수한다. 기존 #49/#50/#51/#57/#58 및 #82/#86~#91의 완료 증거와 운영/실사용 미검증 조건은 보존하고, 이번에 확인된 후속 코드 변경은 새 티켓에서 관리한다. #91이 운영 전환 인계를 계속 담당하며 새 티켓 생성으로 기존 티켓을 자동 종료하지 않는다.

MCP 전체 handler 분할은 #57의 최소 구조 결정을 유지해 별도 필수 작업으로 만들지 않는다. #95는 내부 명칭·미사용 연결만 정리하고 공개 도구/기존 토큰 endpoint를 유지한다.


## 현재 작업 — 저장 구조 전반 단순화 (#86~#91)

2026-09-23 · 로컬 수직 슬라이스 구현 중이며 #86~#91 전체 완료·운영 배포 전. [단순성 원칙](../engineering/SIMPLICITY.md), [ADR-0008](../adr/0008-minimal-portfolio-storage.md), [재설계](../design/minimal-portfolio.md)를 우선한다. 아래 이전 티켓의 별도 도메인/이력/원장 유지 요구는 충돌 범위에서 대체된다. 실제 진척과 잔여 조건은 각 티켓의 진행 기록을 따른다.

| 순서 | GitHub | 로컬 명세 |
| --- | --- | --- |
| 1 | [#86 최소 저장 계약과 전체 테이블 처분 확정](https://github.com/kimyongin/fin/issues/86) | [명세](./storage-simplification-01-contract.md) |
| 2 | [#87 조사·판단·점검·회고를 활동 결과로 통합](https://github.com/kimyongin/fin/issues/87) | [명세](./storage-simplification-02-records.md) |
| 3 | [#88 할 일과 반복 완료 흐름 단순화](https://github.com/kimyongin/fin/issues/88) | [명세](./storage-simplification-03-tasks.md) |
| 4 | [#89 보유 메모와 서술형 원칙 통합](https://github.com/kimyongin/fin/issues/89) | [명세](./storage-simplification-04-notes-principles.md) |
| 5 | [#90 현재 보유값 중심 매매·보정·확인 단순화](https://github.com/kimyongin/fin/issues/90) | [명세](./storage-simplification-05-holdings.md) |
| 6 | [#91 구 구조 종료·물리 정리·릴리스 검증](https://github.com/kimyongin/fin/issues/91) | [명세](./storage-simplification-06-retirement.md) |

#86은 최소 계약, #87~#90은 사용자 흐름별 수직 구현, #91은 첫 슬라이스부터 이관 검증을 진행하고 최종 물리 정리를 맡는다. #69/#70/#75~#85의 기존 구현 증거와 미검증 외부 게이트는 보존한다. 새 설계로 대체되는 구 기능을 그대로 배포하는 것은 새 목표가 아니다. 이전 티켓은 후속 링크로 연결하며 검증 없이 완료로 닫지 않는다.

## 현재 개발 기준 — 활동·결과·태그·검색 (2026-09-23)

최신 단순화: 기존 activity_events를 편집 가능한 활동 저장으로 활용한다. 별도 결과 테이블과 일반 편집의 의무 수정 이력·판단 정정 자동 분류는 제외한다. 자동 금융 원본의 보호와 기존 반복 동작은 유지한다. ADR-0007 및 #80~#85의 축소된 인수 조건을 따른다.

[새 설계](../design/activity-simplification.md)와 [ADR-0007](../adr/0007-activity-results-and-search.md)을 먼저 읽는다. 사용자에게 활동 하나로 할 일·한 일·결론을 제공한다. 판단 모아보기 탭과 등록 경로별 라벨은 제거했고 다중 활동 태그 및 조건·키워드·유사도 검색을 제공한다. 기존 판단 정본·이력은 보존하고 활동에서 상세로 이어진다.

티켓 #80~#85의 로컬 구현과 자동 검증을 완료했다. DB 516 assertions, 실제 Edge MCP 계약, Chromium 33개, Vitest 107개와 build/encoding/guide 검사가 기준점이다. 운영 DB/Edge/앱 배포와 실제 ChatGPT 웹·모바일 평가는 별도 외부 게이트로 남아 있다. 의미 검색은 Supabase Edge 내장 `gte-small`이 가능할 때만 보완하며 실패하면 키워드 검색으로 fallback한다. 뉴스 조사·의견 생성은 ChatGPT가 담당한다.


## 활동 단순화 티켓

| 순서 | GitHub | 로컬 명세 |
| --- | --- | --- |
| 1 | [#80 활동·결과 통합 계약과 기존 판단 데이터 매핑](https://github.com/kimyongin/fin/issues/80) | [명세](./activity-simplification-01-contract.md) |
| 2 | [#81 할 일·한 일·판단 결과를 하나의 활동 경험으로 통합](https://github.com/kimyongin/fin/issues/81) | [명세](./activity-simplification-02-activity.md) |
| 3 | [#82 다중 활동 태그와 조건·키워드 검색](https://github.com/kimyongin/fin/issues/82) | [명세](./activity-simplification-03-tags-search.md) |
| 4 | [#83 조건·키워드·유사도 하이브리드 검색](https://github.com/kimyongin/fin/issues/83) | [명세](./activity-simplification-04-semantic.md) |
| 5 | [#84 일일 문맥·리포트·MCP 작업 가이드 정합성](https://github.com/kimyongin/fin/issues/84) | [명세](./activity-simplification-05-context-guides.md) |
| 6 | [#85 기존 기록 전환·통합 회귀·릴리스 인계](https://github.com/kimyongin/fin/issues/85) | [명세](./activity-simplification-06-transition.md) |

## 이전 개발 기준 — 태스크・자동 행동 이벤트 (2026-09-22)

[설계](../design/tasks-and-events.md)와 [ADR-0006](../adr/0006-tasks-and-action-events.md)이 우선한다. 내부 태스크/이벤트는 분리하고 사용자에게는 예정된 행동과 수행한 행동을 하나의 목록으로 제공한다. 값 수정은 자동 이벤트, 태스크 완료는 연결 이벤트, 매일 반복은 회차별 유효 완료 이벤트로 기록한다. 영구 번들은 제거 방향이며 날짜별 표시와 요청 기반 일/주/월 리포트를 제공한다.

구현 순서: #75 자동 이벤트/일반 태스크 → #76 매일 반복 → #77 통합 목록 → #78 기간 리포트 → #79 전환/가이드/검증. 명세와 로컬 구현 결과는 action-timeline-01~05에 있다. 운영 배포와 실제 ChatGPT 평가는 별도 게이트다.

#69/#70 메모/운영 규칙은 유지한다. #71~#74는 로컬 구현/검증 이력을 보존하되 해당 후속 작업은 #75~#79로 대체한다. 기존 migration과 로컬 기록을 삭제하지 않는다. 운영 배포/사람 평가 완료를 뜻하지 않는다.

## 이전 개발 기준 — ToDo·원칙 통합 (대체된 설계 이력)
설계/티켓 작성 완료, 구현 전. [공통 설계](../design/todo-principles-integration.md)와 [ADR-0005](../adr/0005-todo-bundles-and-operating-rules.md)를 먼저 읽는다.
신규 순서: #69 기존 메모/확인 메모 → #70 원칙의 데이터 관리 규칙 → #71 ToDo 묶음 → #72 탐색/판단/활동 통합 → #73 오늘/MCP 연결 → #74 검증. 각 티켓은 docs/tickets/todo-principles-01~06 로컬 명세에 대응한다.
주 메뉴는 오늘/자산/ToDo/원칙으로 변경 예정이며 기존 대상 메모・조사/실행・판단・금융/활동 원본을 유지한다. 규칙은 독립 저장하고 관련 작업에서 조회하며, ToDo는 여러 작업을 한 묶음으로 기록한다.
아래 과거 메뉴·구현 전 표기·작업 순서는 작성 당시 이력이다. 충돌하는 범위에서는 이번 설계를 적용한다. 기존 미완료 검증은 자동 완료 처리하지 않는다.
GitHub 대조: #66/#68 closed, #67 실제 모델 평가 open. 피드백 기능은 구현되어 있으므로 아래 '아직 미구현'을 새 구현 지시로 읽지 않는다. 운영/평가 상태는 개별 최신 티켓을 확인한다.

## 제품 피드백 — 다음 구현 계획

2026-09-21 · 티켓 작성 완료, 구현 전. [공통 설계](../design/product-feedback.md)가 제안/동의·데이터·권한·최신화 계약의 기준이다.

| 순서 | 티켓 | 로컬 명세 |
| --- | --- | --- |
| 1 | [#66 자유 입력과 본인 접수](https://github.com/kimyongin/fin/issues/66) | [명세](./feedback-01-app.md) |
| 2 | [#67 ChatGPT 대화 접수·제안](https://github.com/kimyongin/fin/issues/67) | [명세](./feedback-02-mcp.md) |
| 3 | [#68 운영자 검토·결과](https://github.com/kimyongin/fin/issues/68) | [명세](./feedback-03-triage.md) |

자유 텍스트만으로 접수하며 투자 판단/할 일과 분리한다. 명시적 등록 요청은 재승인 없이 처리하고 모델이 제안한 접수는 동의 후 저장한다. MCP의 자발적 제안은 실제 모델 검증 대상이다. 새 도구/topic은 구현 전 광고하지 않는다. 자동 GitHub 동기화·공개 원문·복잡한 관리자 시스템은 제외한다.

## MCP 작업 가이드 — 로컬 구현 결과

2026-09-21 · OAuth MCP 0.5.0 로컬 구현·자동 검증 완료, 운영 배포·실제 모델 평가 전. [제공·최신화 설계](../design/contracts/agent/workflow-guide-design.md)를 기준으로 한다.

| 순서 | 티켓 | 로컬 명세 |
| --- | --- | --- |
| 1 | [#63 투자 기준 인터뷰](https://github.com/kimyongin/fin/issues/63) | [명세](./workflow-guide-01-policy.md) |
| 2 | [#64 나머지 작업 가이드](https://github.com/kimyongin/fin/issues/64) | [명세](./workflow-guide-02-topics.md) |
| 함께 | [#65 최신화 검사·회귀 평가](https://github.com/kimyongin/fin/issues/65) | [명세](./workflow-guide-03-maintenance.md) |

`get_workflow_guide`의 policy 포함 여섯 topic, 단일 원본, 기존 daily-review resource 렌더링, 변경 영향 review manifest와 CI 검사를 구현했다. 격리 OAuth에서 여섯 가이드 조회 및 투자 기준 저장·멱등 재시도·재조회를 확인했다. 실제 ChatGPT 웹/모바일 선택·인터뷰 평가는 남아 있으며 기존 #57의 후순위 판단을 실제 소비 사례로 재검토한 후속이다.

## UI 구조 일관성 — 로컬 구현 결과

2026-09-21 · #59~#62의 로컬 구현과 자동 검증을 완료했다. [화면 구조 규칙](../design/screen-structure.md)이 구현 결과와 실기기 미검증 항목의 기준이다.

| 순서 | 티켓 | 로컬 명세 | 상태 |
| --- | --- | --- | --- |
| 1 | [#59 페이지 구조·보기 전환·필터](https://github.com/kimyongin/fin/issues/59) | [명세](./ui-consistency-01-pages.md) | 로컬 완료 |
| 2 | [#60 모달·상세·편집 액션](https://github.com/kimyongin/fin/issues/60) | [명세](./ui-consistency-02-surfaces.md) | 로컬 완료 |
| 3 | [#61 표 전체 화면 편집](https://github.com/kimyongin/fin/issues/61) | [명세](./ui-consistency-03-sheet.md) | 로컬 완료 |
| 4 | [#62 나머지 페이지·회귀 검증](https://github.com/kimyongin/fin/issues/62) | [명세](./ui-consistency-04-rollout.md) | 로컬 완료·실기기 확인 전 |

구현 커밋은 `7dee08d` → `1fbddf8` → `71d0c13` → `e6623dc` → `a73ee9d`다. DB/API/MCP 의미는 바꾸지 않았고 디자인 문서의 이전 850px 기준안 대신 현재 앱과 일치하는 1024px을 사용했다. 실기기 확인은 #39에서 수행한다.

운영 상태 보충: 아래 이전 인계의 미배포/secret 대기 표기는 작성 당시 기록이다. 2026-09-21 migration 024~026, OAuth MCP 0.4.0, Pages 배포와 인증 smoke secret 구성을 완료했다. #54~#57은 종료됐으며 #58의 모바일/전체 모델 평가와 기존 파일럿은 남아 있다. 증거는 agent/evaluation.md와 commit c22ad20을 참조한다.

## MCP 사용성·계약 품질 개선 — 현재 개발 시작점

2026-09-21 재검토 후속. 아래 5개 티켓의 로컬 구현과 자동 검증을 완료했다. 기존 #49~#53 구현을 유지하면서 확인된 계약·검증 공백을 보완했으며, 운영 배포와 실제 ChatGPT 웹/모바일 평가는 아직 수행하지 않았다.

| 순서 | 티켓 | 로컬 명세 |
| --- | --- | --- |
| 01 | [#54 브리핑·보정 입력과 결과 계약 명시](https://github.com/kimyongin/fin/issues/54) | [명세](./mcp-quality-01-contracts.md) |
| 02 | [#55 안정적 오류 코드와 멱등 재시도 계약 보완](https://github.com/kimyongin/fin/issues/55) | [명세](./mcp-quality-02-recovery.md) |
| 03 | [#56 도구 선택 설명과 대상별 연속 조회 정비](https://github.com/kimyongin/fin/issues/56) | [명세](./mcp-quality-03-discovery.md) |
| 04 | [#57 업무별 모듈 분리와 설명 원본 일원화](https://github.com/kimyongin/fin/issues/57) | [명세](./mcp-quality-04-maintenance.md) |
| 05 | [#58 시나리오 평가와 실제 계약·배포 게이트 보강](https://github.com/kimyongin/fin/issues/58) | [명세](./mcp-quality-05-validation.md) |

구현 순서: #54 계약 → #55 복구/#56 조회 → #57 최소 모듈 정리 → #58 통합 검증. #58의 시나리오 fixture는 먼저 작성하고 각 슬라이스에 함께 적용한다. 전 기능 구현 후 한 번만 검증하지 않는다.

구현 검증은 Vitest 79개, DB 278개, 실제 로컬 OAuth MCP 저장·재조회/커서/금융 재시도 계약, 브라우저 E2E 27개, Edge 타입 검사와 build를 포함한다. 실제 ChatGPT 도구 선택·운영 배포 성공의 증거는 아니며 [평가 사례](../design/contracts/agent/evaluation.md)는 아직 실행 전이다.

## 운영 안정성 개선 — 다음 개발 시작점

2026-09-21 운영 관점의 정적 코드 리뷰 후속 **#49~#53의 로컬 구현과 자동 검증을 완료했다.** 운영 DB/Edge/Pages 배포와 실사용 확인은 수행하지 않았다. #51이 추가한 인증 smoke gate를 사용하려면 GitHub에 테스트 전용 계정 secret 두 개를 먼저 설정해야 한다.

| 우선순위 | GitHub 티켓 | 로컬 명세 | 상태 |
| --- | --- | --- | --- |
| P1 | [#49 매매 동시 처리·저장 재시도](https://github.com/kimyongin/fin/issues/49) | [명세](./operations-01-financial-writes.md) | 로컬 완료 |
| P1 | [#50 사용자 전환·비동기 상태 격리](https://github.com/kimyongin/fin/issues/50) | [명세](./operations-02-async-state.md) | 로컬 완료 |
| P1 | [#51 검증·서버 호환성·배포 순서](https://github.com/kimyongin/fin/issues/51) | [명세](./operations-03-release-gates.md) | 구현 완료·secret 설정 대기 |
| P2 | [#52 대상별 조회·공유 응답 필드](https://github.com/kimyongin/fin/issues/52) | [명세](./operations-04-scoped-reads.md) | 로컬 완료 |
| P2 | [#53 공통 모달·MCP 오류 진단](https://github.com/kimyongin/fin/issues/53) | [명세](./operations-05-ui-errors.md) | 로컬 완료 |

구현 commit은 `77a727a` → `fef165f` → `16ef2b6` → `5292b70` → `d5653c6`, 추가 실패 경로 E2E는 `34f8512`다. 기능별 테이블·RPC를 유지하고 request gate와 오류 adapter처럼 실제 소비자가 있는 작은 공통 처리만 추출했다. 범용 CRUD/명령 프레임워크나 전면 재작성은 도입하지 않았다.

배포 상태 보충: RPC 누락 대응으로 운영 migration 020~023을 추가 적용하고 로컬/원격 목록 일치를 확인했다. 익명 요청의 권한 거부 응답은 인증된 사용자 성공 검증이 아니다. 프런트·Edge 배포 및 실사용 검증 완료를 뜻하지 않으며 #51에서 각각의 버전·검증 결과를 분리해서 관리한다.

## 2026-09-21 제품 리뷰 후속 — 다음 개발 시작점

제품 리뷰 후속의 로컬 구현 상태다. #45~#48의 코드·문서·자동 검증을 마쳤고, 운영 배포와 본인·지인 외부 사용 검증 및 5일 파일럿은 별도 게이트로 남아 있다.

| 순서 | GitHub 티켓 | 로컬 명세 | 기존 책임 |
| --- | --- | --- | --- |
| 1 | [#45 계산 품질·공유 접근](https://github.com/kimyongin/fin/issues/45) | [명세](./review-01-quality-sharing.md) | #32/#34/#36/#39/#43 |
| 2 | [#46 판단·할 일 통합](https://github.com/kimyongin/fin/issues/46) | [명세](./review-02-decision-tasks.md) | #35/#36/#44 |
| 3 | [#47 메뉴·오늘 재편](https://github.com/kimyongin/fin/issues/47) | [명세](./review-03-navigation-today.md) | #34/#36/#43 |
| 4 | [#48 온보딩·사용 검증](https://github.com/kimyongin/fin/issues/48) | [명세](./review-04-onboarding-validation.md) | #33/#36/#39 |

구현 순서는 #45의 공유 접근/계산 품질을 각각 검증한 뒤 #46 → #47 → #48이다. 각 티켓은 기존 시나리오 S ID, API/데이터 불변 조건, 실패·권한·반응형 인수 조건을 포함한다. 기능별 구현·검증·커밋하며 운영 배포와 실제 ChatGPT/지인 검증은 별도로 기록한다.

승인된 목표 탐색은 **오늘 / 자산 / 판단·할 일 / 투자 원칙** 네 개와 보조 메뉴다. #47에서 PRD/제품 재정리와 React 탐색을 함께 갱신했다. 자산 4가지 보기, 자료 보관함 CRUD, 변경 이력, 공유 문맥은 유지한다. 아래 기존 구현 이력은 당시 상태이며, 남은 온보딩·사용 검증은 #48에서 추적한다.

배포 기준점: `1a13ae4`에서 운영 migration 001~019/OAuth MCP/Pages 배포 및 CI E2E 성공을 확인했다. 과거 문서의 배포 전 표기는 갱신 대상이다. 실사용 5일·운영 전후 데이터 정량 대조·새 클라이언트 사용자 격리는 별도 미검증 항목으로 유지한다.

## 구현 인계 확정 사항 (2026-09-20)

- 필독: [ADR-0002](https://github.com/kimyongin/fin/blob/master/docs/adr/0002-cost-basis-reconciliation-and-sharing.md), [ADR-0003](https://github.com/kimyongin/fin/blob/master/docs/adr/0003-extensible-feature-sharing.md), [구현 계약 초안](https://github.com/kimyongin/fin/blob/master/docs/design/implementation-contract-draft.md).
- 체결가 기준 평균(수수료·세금 제외), 보정 이전 거래 정정의 현재값 유지, 내부 기능별 read 권한과 단순 묶음 UI는 확정 정책이다.
- 기능별 공유 데이터/API/RLS는 #43, 공개 필드·관계 계약은 #44, 설정 UI는 #36, 소비 경로는 #35, 검증은 #39가 담당한다. #35-A는 권한 계약을 먼저 맞추고 실제 공유 연동 전에 #43 기반과 통합한다.
- 사용자에게 추가로 확인받을 큰 제품 결정은 현재 없다. 기술 초안은 해당 티켓 첫 단계에서 DDL·예제·테스트로 확정한다. 공개 범위나 데이터 의미를 바꿀 때만 재확인한다.
- 문서화는 구현/배포/보안 검증 완료가 아니다. 미검증 DDL·정밀도·상태 전이는 해당 티켓의 첫 작업으로 남기며 완료 체크를 앞당기지 않는다.

## 2026-09-20 재정리 — 기존 앱을 목적에 맞게 재구성

공통 기준: [제품 재정리](../design/product-reorganization.md), [디자인 원칙](../design/PRINCIPLES.md).
기존 앱에 기능을 쌓기만 하거나 모든 화면을 다시 만들지 않는다. 각 티켓의 첫 재구성 절이 기존 범위의 구체적 유지/변경 조건이다.

| 결정 | 내용 | 담당 |
| --- | --- | --- |
| 유지·개선 | 자산 4가지 보기, 표 편집, 자산 유형, 복수 계좌 | #36/#38 |
| 재구성 | 전략 → 원칙·운용 계획 + 자산에서 여는 배분 점검 | #43/#36 |
| 신규 | 오늘, 판단 기록, 실행·점검할 일, 버전 있는 개인 기준 | #34/#35/#36/#43/#44 |
| 보조 이동 | 뉴스 → 근거 자료·보관함, 활동 → 감사 내역 | #35/#36 |
| 입력 정리 | 초기/대량 등록, 보정, 실제 매매, 값 없는 잔고 확인 | #37/#38/#42 |

- 태그와 전략 버킷을 구분하고 앱/MCP 계산 계약을 공통화한다. 기존 리밸런싱 계산은 모델 의견·사용자 결정과 별개다.
- 기존 전략 공유와 새 개인 기준의 비공개 요구를 필드별로 정리한다. 데이터 보존과 공개 범위 검증을 인수 조건으로 둔다.
- 새 탐색은 오늘/자산/판단·할 일/투자 원칙을 기준으로 검증한다. 기존 overview는 자산으로 유지하고 오늘을 별도 추가한다.
- prototype v1~v3는 검토 이력이며 현재 구현 명세가 아니다. 기존 테마·React 컴포넌트 기반 통합 시안이 다음 작업이다.
- #39는 신규 경험뿐 아니라 기존 기능 회귀와 중복 입력·화면 왕복 감소도 검증한다.

## 공통 개념 확정: 투자 원칙·판단 기록·할 일
- PRD에 대응하는 투자 원칙·운용 계획(#43), ADR에 대응하는 판단 기록(#44 설계/#35 구현), Ticket에 대응하는 조사·점검/실행할 일(#44 설계/#35 구현)을 공통 모델로 사용한다.
- 실제 체결·잔고 원장은 #37/#38이 담당하며 계획과 분리한다. 신규 대형 시스템/중복 티켓을 추가하지 않는다.
- #41 종목별 보유 이유는 현재 보유 가설이며 근거가 되는 판단 기록과 연결한다.
- #34는 연결된 문맥 조회, #36은 익숙한 사용자 용어와 연결 화면, #39는 통합 경험 검증을 담당한다.
- 분석 제안 → 사용자 채택 결정 → 실행할 일은 선택적 연결이다. 조사할 일은 결정 전에 생길 수 있고 유지 결정은 실행 없이 끝날 수 있다.
- 하나의 실행할 일에 여러 실제 체결을 연결할 수 있다. 계획 완료만으로 잔고를 변경하지 않는다.
- 사용자는 문서 작성 절차를 거치지 않고 평소 대화로 기록·판단·다음 점검을 이어간다.

## 연속 점검을 위한 데이터 설계
- [x] [#44 점검 범위·사건·검토 질문·판단 이력 데이터 계약](https://github.com/kimyongin/fin/issues/44) — 로컬 설계·구현 대조 완료
- #32 → #44 및 #43 버전 계약 → #35-A 공통 스키마 → #34 읽기/#35-B 저장 → #36 표시 → #39 연속성 검증으로 연결한다. #44는 설계, 실제 DB/RPC 구현은 #35의 책임이다.
- #41 보유 이유·#43 개인 기준의 버전을 참조하고 #42 실제 잔고 확인과 조사 시점을 구분한다.
- 사용자 요청으로 매일 분석한다. 자동 생성·예약 실행은 현재 범위에서 제외하며 기존 알림/자동화 언급은 후속 가능성만 의미한다.
- 이전 조사 이후 변화·미확인 범위·열린 질문을 따라잡고, 새 근거로 질문을 해결하거나 재개하며 과거 판단을 보존한다.
- 부분 실패, 중복 사건, 정정 자료, 동시 분석 저장을 데이터 계약에 포함한다. 우선 관계형 데이터와 버전 이력으로 구현한다.

## 내 투자 기준 관리 추가
- [ ] [#43 내 투자 기준·성향 관리와 기존 상세 원칙 화면 확인](https://github.com/kimyongin/fin/issues/43)
- #32/#33 이후 #43을 진행하고, #41 종목별 보유 이유와 별도의 범위로 구현한다.
- #34/#35/#36은 optional 계약으로 먼저 진행 가능하지만 최종 완료 및 #39 검증에는 #43 연동을 포함한다.
- 사용자 기준 → 운용 전략/모드 → 종목별 보유 이유를 읽어 제안하고, 적용 기준과 당시 버전을 저장한다.
- 상세 원칙은 로컬 코드에 존재하나 실제 화면에서 보이지 않는다는 사용자 보고가 있다. #43에서 배포·권한·진입 조건을 확인하며 원인을 미리 단정하지 않는다.

## 제품 방향
사용자에게 제공할 핵심 가치는 “출근할 때 잠깐 보면 내 투자 상태와 오늘 신경 쓸 것만 알 수 있다”이다.
기본 아침 경험은 ChatGPT에서 점검·저장까지 마치고, 앱에서는 저장된 결과를 바로 읽거나 수정하는 흐름이다. 매일 양쪽 방문을 요구하지 않는다.
기본 브리핑은 한 줄 결론 → 중요 변화 최대 3개 → 보유 이유에 미치는 영향 → 오늘 할 일 0~3개로 구성한다. 약 60초 읽기를 목표로 하고 생성 대기 시간은 별도 측정한다.
추가 행동 없음, 확인 필요, 자료 부족을 구분한다. 실제 조사하지 않은 상태를 변화 없음으로 표시하지 않는다.
보유 이유·재검토 조건은 선택적 기억으로 보존하고, 마지막 실제 잔고 확인은 거래 입력·시세 갱신·브리핑 작성과 구분한다.
사용자 요청 시 분석을 생성하는 첫 버전이다. 앱에 오늘 분석이 없으면 최근 분석 날짜를 표시하며 자동 생성되었다고 가정하지 않는다.

ChatGPT는 조사하고 생각하고 설명하며, Portfolio는 기억하고 계산하고 검증한다.
사용자는 ChatGPT 웹/모바일에서 점검을 시작하고, Portfolio 앱에서 저장된 결과와 보유 상태를 다시 확인한다.
현재 holdings와 전략·뉴스·활동 기능을 재사용한다. 별도 OpenAI API나 skill 패키지 배포는 이 작업의 전제가 아니다.

## 재검토로 변경한 사항
- 첫 번째 가치 검증은 일일 점검 → 조사 결과 저장 → 앱 재열람이다. 거래 입력만 먼저 만들면 매일 돌아올 이유를 검증할 수 없다.
- 기존 보유량 직접 편집이 존재하므로 거래 원장 도입 전 기준점·보정·과거일 처리 규칙을 확정한다.
- “정확성을 포기”한다는 의미는 증권사 전체 원장과 자동 동기화하지 않는다는 뜻이다. 앱이 약속한 수량/원가 계산은 정확해야 한다.
- 미리보기는 동시 수정과 계산 검증에 필요하다. 모든 저장마다 무조건 재확인을 요구하는 UX는 확정하지 않았다.
- 출처 필드 검증은 사실의 진실성 보장이 아니다. 사실·해석·확인되지 않은 정보를 구분한다.
- 2026-09-20 웹 MCP 실험은 instructions 노출 및 prompt/resource 미노출이라는 관찰이다. 모델의 자기보고만으로 전체 제품 또는 모바일 지원 불가를 확정하지 않는다.
- 서버 번들 배포 성공은 타입 검사/실제 동작 검증 완료가 아니다.
- RLS가 존재한다는 사실과 OAuth 전체 경로의 사용자 격리 검증 완료를 구분한다.
- 고정된 도구 개수 목표 대신 실제 사용자 업무와 토큰 크기를 기준으로 API를 정한다.

## 작업 티켓

체크박스는 티켓의 전체 인수 조건이 충족됐을 때만 완료한다. `부분 완료`는 로컬 핵심 기능이 있으나 배포·클라이언트·실사용 인수 조건이 남았다는 뜻이다. 상세 근거는 [구현 현황 감사](./implementation-audit-20260921.md)에 있다.

- [x] [#32 [MCP-first] 제품 계약·잔고 계산 규칙과 사용자 시나리오 확정](https://github.com/kimyongin/fin/issues/32) — 완료(로컬 계약)
- [ ] [#33 [MCP-first] OAuth MCP 계약 정비와 클라이언트 호환성 검증](https://github.com/kimyongin/fin/issues/33) — 부분 완료
- [ ] [#34 [MCP-first] 아침 점검용 get_daily_context 구현](https://github.com/kimyongin/fin/issues/34) — 부분 완료
- [ ] [#35 [MCP-first] 출처 있는 뉴스·일일 브리핑·판단 결과 저장과 조회](https://github.com/kimyongin/fin/issues/35) — 부분 완료
- [ ] [#36 [MCP-first] Portfolio 오늘 화면과 지인용 OAuth 온보딩](https://github.com/kimyongin/fin/issues/36) — 부분 완료
- [x] [#37 [MCP-first] 초기 잔고 기반 매매 미리보기·확정·거래 조회](https://github.com/kimyongin/fin/issues/37) — 완료(로컬 구현)
- [x] [#38 [MCP-first] 잔고 보정·거래 취소와 기존 편집 경로 통합](https://github.com/kimyongin/fin/issues/38) — 완료(로컬 구현)
- [ ] [#39 [MCP-first] 5일 출근 사용 파일럿과 릴리스 검증](https://github.com/kimyongin/fin/issues/39) — 미완료(외부 실행 필요)

## 진행 순서
1. #32 제품 계약을 확정하고 #33 MCP 계약/호환성을 검증한다.
2. #44 관계 계약과 #43 원칙 버전 계약을 맞춘 뒤 #35-A 기반 → #34 문맥/#35-B 저장·조회 → #36 화면으로 첫 순환을 완성한다. #43은 원칙·운용 계획/배분 점검 본문, #36은 탐색 연결을 담당한다.
3. #37 매매 → #38 보정/취소를 완성한다. 제품 계약 확정 후 일일 점검 구현과 별도로 착수할 수 있다.
4. #39 읽기 파일럿은 #36 이후 시작하고 전체 릴리스는 모든 경로를 검증한 뒤 판단한다.
5. #41 보유 이유와 #42 실제 잔고 확인은 #32/#33 이후 구현한다. #34/#35/#36은 optional 필드 계약으로 먼저 개발 가능하지만 최종 완료에는 두 기능 연동을 포함한다.

## 사용자 경험 검토로 추가된 작업
- [x] [#41 종목별 보유 이유·재검토 조건과 판단 이력](https://github.com/kimyongin/fin/issues/41) — 완료(로컬 구현)
- [x] [#42 실제 잔고 확인 시점·범위 기록과 상태 표시](https://github.com/kimyongin/fin/issues/42) — 완료(로컬 구현)
- #32: 대표 아침 응답 4종과 최소 입력·저장 의도 정책을 먼저 확정한다.
- #34/#35: 보유 이유와 자료 범위를 반영하고 같은 사건/할 일을 반복 생성하지 않는다.
- #36: 결과를 먼저 보여주고 앱·ChatGPT 왕복을 강요하지 않는다.
- #37/#38: 매매와 잔고 실제 확인을 구분하고 보정으로 쉽게 복구한다.
- #39: 핵심 파악 시간, 화면 전환·추가 질문 부담, 다시 사용할 의향을 검증한다.

## 현행 구현 근거
- supabase/functions/portfolio-mcp-oauth/index.ts: 로컬 36개 목적 중심 도구(운영 35개), OAuth, annotations, 강화된 instructions, 선택적 prompt/resource 실험.
- supabase/schema/OVERVIEW.md: 기존 holdings/transactions 및 뉴스/리포트/전략/감사 모델의 조사 시작점. 적용된 SQL의 정확한 동작은 각 구현 티켓에서 확인한다.
- src/features/portfolio/holdingActions.js: 현행 보유량 직접 편집과 자산 유형별 저장.
- src/features/news/data.js: 기존 뉴스 사실/해석 CRUD.
- src/features/guide/GuidePage.jsx: 기존 온보딩과 토큰 MCP 설명.
- 기존 GitHub #1–#31은 종료됨. 과거 완료 이슈를 현행 React 기능의 동작 증명으로 사용하지 않는다.

## 실제 구현 현황 — 2026-09-21 로컬 `master`

| 티켓 | 상태 | 완료된 근거 | 티켓을 닫기 전에 남은 것 |
| --- | --- | --- | --- |
| #32 제품·계산 계약 | 완료(로컬 계약) | PRD/ADR, 24개 시나리오, 체결가 평균·보정 기준점, 초기/매수/부분·전량 매도/재매수 decimal fixture | 구현 티켓의 운영 배포 게이트로 이관 |
| #33 OAuth MCP | 부분 완료 | OAuth 다중 사용자 연결, 공통 tool schema/handler, 로컬 Edge의 인증된 initialize·36개 tools/list·오류 계약 | 0.5.0 배포 후 전체 인증 격리와 웹·모바일 새 세션 재검증 |
| #34 일일 문맥 | 로컬 핵심 구현 | 임시 context 생명주기, 원칙·판단·열린 질문·보유 이유 포함, DB 테스트 | 누락 시세/복귀/부분 조사/응답 크기 통합 검증 |
| #35 저장·조회 | 로컬 핵심 구현 | 브리핑+출처+조사 범위, 판단+질문, 실행 계획·부분 체결, 보유 이유/task 관계, 공유 read DTO, 상태 전이, idempotency | 정정 근거와 전체 사용자 흐름 검증 |
| #36 오늘 화면 | 로컬 핵심 구현 | 오늘·판단·할 일·원칙·보유 이유 UI, 친구 전환, 점검 기록 공유 묶음 설정 | 전체 반응형/빈 상태/왕복 감소 실사용 검증 |
| #37 매매 기록 | 완료(로컬 구현) | preview/log/list MCP, numeric 원가 풀, 전체 매매 lifecycle fixture, 실행 task 부분 체결, stale/idempotency, 모바일 UI | 운영 legacy 이관은 #39 배포 게이트 |
| #38 보정·취소 | 완료(로컬 구현) | 타입별 보정, 확인 범위, 거래 취소와 task 진행도, 기준점 전후 재생, 단건/표 편집 기준점, 전체 E2E | 운영 legacy 이관은 #39 배포 게이트 |
| #39 파일럿 | 미완료 | 로컬 전체 E2E 22개와 자동 검증은 통과 | 운영 보안·실기기 검증과 5일 사용 관찰 |
| #41 보유 이유 | 완료(로컬 구현) | 종목 공통/계좌별 재정의, 판단·task 연결, 이력, MCP, 자산 UI, 일일 문맥, 전량 매도 비활성/재매수 재확인 | 운영 전체 흐름은 #39에서 확인 |
| #42 잔고 확인 | 완료(로컬 구현) | 필드별 verification, version 충돌, changed-since, 보정 연계 UI, 계좌/전체 집계와 오늘 요약 | 운영 문구·빈 상태는 #39에서 확인 |
| #43 개인 기준 | 로컬 핵심 구현 | 선택 필드, 부분 patch, version/history, MCP, 원칙 UI, 기능별 공유 키/CAS | 전략 변경 이력/당시 참조와 개인 기준 공개 UI(현재 기본 비공개) |
| #44 관계 계약 | 완료(로컬 계약) | 관계형 모델·상태 전이·24개 시나리오/API 대응표를 실제 거래/보정/공유 구현과 최종 대조 | 운영·파일럿 결과가 계약을 바꾸면 갱신 |

위 표의 “로컬 핵심 구현”은 배포·GitHub 이슈 완료를 뜻하지 않는다. 현재 기능 커밋은 원격보다 앞서 있으며 운영 DB/Edge/App에는 아직 반영하지 않았다.
