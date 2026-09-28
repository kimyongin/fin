# 티켓 색인

티켓은 목적·계약·검증 근거의 원본이다. OPEN/CLOSED만으로 구현·배포 상태를 추정하지 않는다. 최신 원격 본문과 작업 트리를 함께 확인한다.

## 목록의 보기·편집 텍스트 전환

[#170](https://github.com/kimyongin/fin/issues/170) · [표현·정렬·줄바꿈·적용표·검증](./ui-36-text-list-actions.md) · [공통 가이드](../design/list-interaction-guidelines.md). 로컬·CI 전체 검증과 운영 배포 완료, 수동 확대·실기기 확인 대기. #167의 문서/연필을 제목 옆 `보기 · 편집` 텍스트로 바꾸고 글자 기준선 정렬, 좁은 폭에서 묶음 단위 줄바꿈, 투명한 기본/호버 표현을 통일했다. 기존 권한·마크다운 읽기·44px 누름 영역·초점 복귀는 유지한다.

## 목록 읽기·편집과 모바일 사용성

[#167](https://github.com/kimyongin/fin/issues/167) · [명세와 전체 목록 적용표](./ui-35-list-reading-and-mobile-interaction.md) · [공통 가이드](../design/list-interaction-guidelines.md). 기존 구현·자동 검증·운영 배포 완료, 실기기 터치·확대·화면낭독기 확인 대기. 활동의 마크다운 읽기/원문 편집 분리와 명시적 진입·복귀를 유지하며, 아이콘의 후속 텍스트 전환은 #170에서 진행한다. 인라인 목표 입력과 선택 목록은 의미에 맞는 예외로 유지한다.

## 활동 검색과 연결 맥락

활동 검색 후속 설계(2026-09-28): [정본 계약](../design/activity-context-search.md). #161 [Pinecone 전환 계약](../design/activity-search-pinecone.md)의 문맥 보존 원문 분할은 운영 DB·Edge·웹에 배포돼 재색인을 마쳤다. 실모델 품질 게이트는 후반부 1건과 무관 질문 1건에서 실패했지만 사용자 요청으로 의미 검색을 활성화했다. 인증된 운영 HTTP/OAuth 검사와 배포 회귀 검사는 통과했고 Astra의 실패 사례 검토가 남았다. #162~#164는 구현 전이며 #165 검색 근거 표시는 운영 배포됐고 실제 ChatGPT/확대 검증은 남았다.

| 티켓 | 수직 슬라이스 | 명세 |
| --- | --- | --- |
| [#161](https://github.com/kimyongin/fin/issues/161) | 한국어 검색·운영 오류·색인과 범위 | [search-01](./search-01-korean-hybrid.md) |
| [#162](https://github.com/kimyongin/fin/issues/162) | 할 일·기록 양방향 연결 맥락 | [search-02](./search-02-linked-context.md) |
| [#163](https://github.com/kimyongin/fin/issues/163) | 종목명·티커 자동완성 | [search-03](./search-03-instrument-autocomplete.md) |
| [#164](https://github.com/kimyongin/fin/issues/164) | 근거 기반 에이전트 검토·교차 검증 | [search-04](./search-04-agent-grounded-review.md) |
| [#165](https://github.com/kimyongin/fin/issues/165) | 실제 검색 방식·폴백·결과별 근거와 유사도 점수 | [search-05](./search-05-search-evidence.md) |
| [#166](https://github.com/kimyongin/fin/issues/166) | 시장 종목 티커 참조·미등록 종목·기존 연결 이관 | [activity-19](./activity-19-market-ticker-reference.md) |

#166은 로컬 수직 슬라이스 구현·검증 중이며 #163의 등록 종목 ID 전제를 대체한다. #163 자동완성은 티커 계약을 소비한다. #162의 할 일/기록 관계와 #164 검증 범위는 유지한다.

각 슬라이스를 웹/HTTP/OAuth까지 연결하고, #164의 근거·품질 검증을 첫 슬라이스부터 수행한다. 모델 교체나 검색 결과 신뢰 전에는 [#161 검증과 한계](./search-01-korean-hybrid.md)를 확인한다.

## 저장 시 활동 기록 분류

후속 설계 · 구현 전: [#160 계좌별 보유의 배분 포함 여부](https://github.com/kimyongin/fin/issues/160) — [최소 계약·수직 슬라이스](./allocation-01-holding-inclusion.md). 자산 합계는 보존하고 전체 계좌 중 포함된 보유만 배분·리밸런싱 제안 대상으로 사용한다. 계좌 자체 flag나 부분 금액 제외는 만들지 않는다.

| 티켓 | 범위 | 명세 |
| --- | --- | --- |
| [#159](https://github.com/kimyongin/fin/issues/159) | 자산·배분·원칙 저장 확인에서 선택 메모·활동 태그 지정, HTTP/OAuth 원자 저장 | [저장 시 활동 태그](./activity-17-save-record-context.md) |

로컬 코드·DB·OAuth MCP 계약 구현과 세 화면의 임시 계정 브라우저 검증 후 운영 DB·Edge·웹 배포까지 완료했다. 극단 상태·실기기·실제 ChatGPT 확인은 남았다. 2차 확인창의 활동 태그 선택은 모달 가이드에 명시된 제한적 예외이며 일반 태그 관리/원본 편집을 허용하지 않는다.

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
