# 설계 문서 지도

## 우선 적용: 저장 구조 단순화

[minimal-portfolio](./minimal-portfolio.md), [ADR-0008](../adr/0008-minimal-portfolio-storage.md), [단순성 원칙](../engineering/SIMPLICITY.md)을 따른다. 아래 세대별 계획은 이력이며 최신 작업은 START-HERE를 확인한다.

## 현재 개발 기준 — 활동·결과·태그·검색 (2026-09-23)

[새 설계](../design/activity-simplification.md)와 [ADR-0007](../adr/0007-activity-results-and-search.md)을 먼저 읽는다. 사용자에게 활동 하나로 할 일·한 일·결론을 제공한다. 판단 모아보기 탭과 등록 경로별 라벨을 제거하고 다중 활동 태그 및 조건·키워드·유사도 검색을 제공하는 계획이다. 물리적 판단 테이블 통합 여부는 #80에서 결정한다.

티켓 #80 계약 → #81 활동/결과 수직 통합 → #82 태그/기본 검색 → #83 하이브리드 검색. #84 문맥/MCP 가이드는 각 slice와 함께, #85 전환/검증은 첫 slice부터 진행한다. **현재는 티켓 작성 완료·구현 전**이다. #75~#79 기반과 미검증 게이트는 보존하며 아래 이전 기준과 충돌하면 이 절을 우선한다. 검색용 임베딩의 비용/실행 방식은 #83에서 검증하며 뉴스 조사·의견 생성은 ChatGPT가 담당한다.


## 현재 개발 기준 — 태스크・자동 행동 이벤트 (2026-09-22)

[설계](../design/tasks-and-events.md)와 [ADR-0006](../adr/0006-tasks-and-action-events.md)이 우선한다. 내부 태스크/이벤트는 분리하고 사용자에게는 예정된 행동과 수행한 행동을 하나의 목록으로 제공한다. 값 수정은 자동 이벤트, 태스크 완료는 연결 이벤트, 매일 반복은 회차별 유효 완료 이벤트로 기록한다. 영구 번들은 제거 방향이며 날짜별 표시와 요청 기반 일/주/월 리포트를 제공한다.

구현 순서: #75 자동 이벤트/일반 태스크 → #76 매일 반복 → #77 통합 목록 → #78 기간 리포트 → #79 전환/가이드/검증. 명세와 로컬 구현 결과는 docs/tickets/action-timeline-01~05에 있다. 운영 배포와 실제 ChatGPT 평가는 별도 게이트다.

#69/#70 메모/운영 규칙은 유지한다. #71~#74는 로컬 구현/검증 이력을 보존하되 해당 후속 작업은 #75~#79로 대체한다. 기존 migration과 로컬 기록을 삭제하지 않는다. 운영 배포/사람 평가 완료를 뜻하지 않는다.

## 이전 개발 기준 — ToDo·원칙 통합 (대체된 설계 이력)
설계/티켓 작성 완료, 구현 전. [공통 설계](./todo-principles-integration.md)와 [ADR-0005](../adr/0005-todo-bundles-and-operating-rules.md)를 먼저 읽는다.
신규 순서: #69 기존 메모/확인 메모 → #70 원칙의 데이터 관리 규칙 → #71 ToDo 묶음 → #72 탐색/판단/활동 통합 → #73 오늘/MCP 연결 → #74 검증. 각 티켓은 docs/tickets/todo-principles-01~06 로컬 명세에 대응한다.
주 메뉴는 오늘/자산/ToDo/원칙으로 변경 예정이며 기존 대상 메모・조사/실행・판단・금융/활동 원본을 유지한다. 규칙은 독립 저장하고 관련 작업에서 조회하며, ToDo는 여러 작업을 한 묶음으로 기록한다.
아래 과거 메뉴·구현 전 표기·작업 순서는 작성 당시 이력이다. 충돌하는 범위에서는 이번 설계를 적용한다. 기존 미완료 검증은 자동 완료 처리하지 않는다.
GitHub 대조: #66/#68 closed, #67 실제 모델 평가 open. 피드백 기능은 구현되어 있으므로 아래 '아직 미구현'을 새 구현 지시로 읽지 않는다. 운영/평가 상태는 개별 최신 티켓을 확인한다.

design은 화면 디자인뿐 아니라 제품·데이터·API 설계를 포함한다. 개발 방법은 별도 [engineering](../engineering/architecture.md), 제품 목적은 [PRD](../prd/portfolio.md), 확정 결정은 [ADR](../adr/0001-mcp-first-product-boundaries.md)에 있다.

## 현재 사용하는 문서

구조 단순화의 최신 기준은 [ADR-0004](../adr/0004-domain-storage-and-minimal-mutation-contract.md)다. 과거 초안의 복잡한 구조를 새 계약과 동시에 구현하지 않는다.

| 파일/폴더 | 역할 / 상태 |
| --- | --- |
| PRINCIPLES.md | 모바일 우선 반응형 디자인 원칙 |
| screen-structure.md | #59~#62 구현 기준: 헤더·보기·필터·본문·푸터·모달/드로어·전체 화면 편집 |
| component-system.md | 기존 React 공통 UI 재사용, 모달/드로어·폼·상태와 접근성 계약안 |
| product-reorganization.md | 기존 기능 유지/재구성/이동과 책임 |
| product-feedback.md | 계획: 앱 자유 입력·ChatGPT 피드백 제안/접수·운영자 처리 경계 |
| implementation-contract-draft.md | 계산·버전·점검 등의 초기 기술 초안. 후속 계약/조사 링크 우선 확인 |
| schema-audit-20260921.md | 특정 날짜 원격/로컬 DB 대조 결과. 영구 최신 스키마 명세 아님 |
| contracts/README.md | 로컬 계약 구현 상태와 운영 전 게이트 |
| contracts/scenario-api-model-matrix.md | S01~S24 사용자 시나리오, API, 변경/불변 데이터, 담당 |
| contracts/daily-review-model.md | 일일 점검·버전·조사 범위·근거 모델 |
| contracts/daily-review-api.md | 문맥 조회/브리핑 저장/조회, 오류, R01~R16 검증 사례 |
| contracts/lifecycle-model-api.md | 원칙·판단·질문·체결·보정의 모델/API |
| contracts/agent/README.md | MCP 에이전트 명세의 원본/갱신/제공 상태 관리 |
| contracts/agent/behavior.md | OAuth instructions에 반영한 공통 행동 규칙 원본 |
| contracts/agent/tool-descriptions.md | OAuth 공통 정의에 연결된 도구 설명 카탈로그와 후순위 후보 |
| contracts/agent/workflows.md | W01~W08 호출 순서·예외/복구 가이드 |

계약 문서는 로컬 구현과 대조됐지만 존재만으로 운영 API 제공·배포 완료를 의미하지 않는다. 실제 상태는 [구현 현황 감사](../tickets/implementation-audit-20260921.md)를 따른다.

## 과거 화면 검토 자료

- portfolio-v2.md: 이전 화면 기획안.
- prototype.html / prototype-v2.html / prototype-v3.html: 가상 HTML 시안. 승인된 최종 React 구현 명세가 아니다.
- assets-v2.js / responsive-v3.js: 시안용 코드.
- desktop.png, mobile-*.png, v2-*.png, v3-*.png: 시안 캡처.

삭제/이동하지 않고 검토 이력으로 보존한다. 특히 v3 자산 전면 재설계를 구현 지시로 해석하지 않는다.
