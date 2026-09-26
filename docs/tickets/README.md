# 티켓 색인

티켓은 목적·계약·검증 근거의 원본이다. OPEN/CLOSED만으로 구현·배포 상태를 추정하지 않는다. 최신 원격 본문과 작업 트리를 함께 확인한다.

## 웹 HTTP · OAuth MCP CRUD 동등성

2026-09-26 재검토: [현황·목표·삭제 계약](../design/domain-crud-parity.md). 아래는 새 구현 티켓이며 기존 OPEN 이슈가 모두 미구현이라는 뜻은 아니다.

| 티켓 | 수직 슬라이스 | 명세 |
| --- | --- | --- |
| [#151](https://github.com/kimyongin/fin/issues/151) | 원칙 이력 조회·정정·삭제 | [CRUD-01](./crud-01-principles.md) |
| [#152](https://github.com/kimyongin/fin/issues/152) | 할 일 삭제·활동 원자 편집 | [CRUD-02](./crud-02-tasks-activities.md) |
| [#153](https://github.com/kimyongin/fin/issues/153) | 계좌·종목·보유 | [CRUD-03](./crud-03-assets.md) |
| [#154](https://github.com/kimyongin/fin/issues/154) | 자산 태그·목표 배분 초기화 | [CRUD-04](./crud-04-tags-allocation.md) |
| [#155](https://github.com/kimyongin/fin/issues/155) | 피드백 수정·삭제 | [CRUD-05](./crud-05-feedback.md) |
| [#156](https://github.com/kimyongin/fin/issues/156) | 프로필·공유·친구 연결 | [CRUD-06](./crud-06-sharing-profile.md) |
| [#157](https://github.com/kimyongin/fin/issues/157) | 시세·환율 조회와 가격 갱신 | [CRUD-07](./crud-07-prices.md) |
| [#158](https://github.com/kimyongin/fin/issues/158) | 양쪽 교차 CRUD·실제 도구 발견·릴리스 | [CRUD-08](./crud-08-parity-release.md) |

원칙부터 작은 수직 슬라이스로 진행한다. #158은 첫 슬라이스부터 검사하고 마지막에 전수 검증한다. 시세·환율은 사용자 재확정에 따라 직접 CRUD를 제공하지 않고 웹/MCP의 동일 가격 갱신을 제공한다.

## 현재 리팩토링

| 티켓 | 범위 | 상태 원본 |
| --- | --- | --- |
| [#147](https://github.com/kimyongin/fin/issues/147) | 사용하지 않는 편집 경로 제거 | [로컬 구현·검증·커밋](./refactor-05-unused-editor-paths.md) |
| [#148](https://github.com/kimyongin/fin/issues/148) | 공통 UI 표현 정렬 | [로컬 구현·검증·커밋](./refactor-06-shared-ui-presentation.md) |
| [#149](https://github.com/kimyongin/fin/issues/149) | 현재 문서와 과거 상태 분리 | [문서 감사와 검증](./refactor-07-current-documentation.md) |
| [#150](https://github.com/kimyongin/fin/issues/150) | App의 기능 상태 소유권 정리 | [로컬 구현·검증·커밋](./refactor-08-app-feature-ownership.md) |

#147/#148/#150의 미체크 수동 검증은 문서 정리로 완료하지 않는다. 배포 상태는 [배포 기록](../engineering/deployment.md)에서 별도로 확인한다.

## 주요 현재 계약으로 가는 길

- 제품·데이터·공유: [PRD](../prd/portfolio.md), [ADR-0008](../adr/0008-minimal-portfolio-storage.md), [ADR-0009](../adr/0009-whole-portfolio-sharing.md).
- 자산 등록·시세: [#139](./ui-28-instrument-registration-and-quote-display.md).
- 모달 필드·태그·필터: [필드 통일](./ui-29-modal-field-consistency.md), [태그 검색 제거](./ui-30-activity-tags-without-search.md), [필터 정돈](./ui-31-activity-filter-fields.md), [태그 간격](./ui-32-stable-tag-selection-spacing.md).
- 공유 설정: [공유 폼·조회 친구](./ui-34-sharing-form-and-viewers.md). 과거 항목별 공유 정책보다 ADR-0009가 우선한다.

## 전체 과거 목록

[2026-09-26 정리 직전의 전체 티켓 목록](../history/ticket-index-before-149-20260926.md)에 이전 분류·상태·티켓 링크를 보존했다. 각 티켓 파일은 그대로 유지한다. 과거 완료/대기 서술은 당시 기록이며 현재 계약을 덮어쓰지 않는다.

새 작업은 관련 정본 문서와 티켓에만 계약·검증을 기록한다. 이 색인과 시작 문서에 같은 상세 진행일지를 복제하지 않는다.
