# React 공통 컴포넌트

2026-09-26 · 현재 코드의 표현 책임과 재사용 기준. 과거 후보와 검증 서술은 [이전 문서](../history/component-system-before-149-20260926.md)에 보존한다. 후보 목록은 신규 기반을 만들라는 지시가 아니다.

React + Vite + Tailwind의 기존 구조를 유지한다. 실제 버전은 package.json이 원본이다. 공통 UI는 표현·접근성을 담당하고 도메인 저장/권한은 기능과 서버에 남긴다. 새로운 범용 폼·레이아웃·명령 엔진을 선행 도입하지 않는다.

## 현재 재사용 지점

| 코드 | 책임 | 하지 않는 일 |
| --- | --- | --- |
| ModalShell / ConfirmDialog | 대상 모달과 최상위 확인, 포커스·inert·스크롤·닫기 보호 | 도메인 저장·서버 rollback |
| ModalActions | 공통 저장·닫기·오류 표현 | 재시도/금융 확정 규칙 |
| PageControls의 PagePanel | 제목·작업 메뉴·상태·본문 구획 | 조회·필터·합계 상태 |
| MenuPresentation | 상단/하단 메뉴의 공통 아이콘·표현 | 기능별 메뉴 열림 상태·권한 |
| TagChip | 선택/표시 칩과 접근성 상태 | 태그 사전 CRUD·단일/다중 선택 정책 |
| TagManagerModal | 같은 본문의 목록·추가·직접 편집 | 배분 목표/활동 검색의 업무 규칙 |
| Timeline | 날짜 그룹과 기록 행 | 조회·커서·권한 |
| ReadOnlyField와 styles.css 폼 스타일 | 같은 라벨/필드 구조, 선택·복사 가능한 고정값 | 편집 권한 부여·payload 추가 |
| CalendarDateField / ClockTimeField | 날짜·시간 필드 | 일정 회차·시간대 계산 |
| MarkdownContent | 긴 원칙/기록 본문 | 도메인 상태 |
| PortfolioEntityHeader / PortfolioEntityIdentity | 엔티티 이름/식별 표현 | 모든 엔티티용 범용 데이터 모델 |

MetricSummary, PageToolbar, 구 TradeEntryModal 및 사용하지 않는 보유 편집 경로는 [#147](../tickets/refactor-05-unused-editor-paths.md)에서 제거했다. 이들을 새 기능에 재연결하지 않는다. 공통 메뉴와 ActivityDetailModal 액션 연결은 [#148](../tickets/refactor-06-shared-ui-presentation.md)을 따른다.

## 표현 계약의 정본

- [상단 카드](./page-panel-guidelines.md): PagePanel을 소비 화면에서 재사용한다. 네 페이지의 필터/문서 의미는 기능별로 유지한다.
- [모달](./modal-guidelines.md): 직접 편집·단일 저장, 2차는 짧은 의사 확인 전용. 일반 폼은 모바일 전체 화면/넓은 화면 중앙, 표 편집은 전체 화면 예외다. 별도 DialogSurface/DetailSurface를 새로 만들 필요는 없다.
- [태그](./tag-guidelines.md): 고정 곡률 칩과 라벨 간격, 선택 체크 표시 없음. 배분 행의 주된 태그명은 제목, 자산 목록의 부가 태그는 보조 텍스트다.
- [타이포그래피](./typography-guidelines.md): styles.css의 의미별 역할을 사용한다. 범용 Text 엔진을 만들지 않는다.
- [타임라인](./timeline-guidelines.md): 활동·원칙의 표현만 공통화한다.
- 필드 구현/예외는 [필드 적용표](../tickets/ui-29-modal-field-consistency.md), 활동 필터·달력은 [필터 티켓](../tickets/ui-31-activity-filter-fields.md)을 따른다. 달력은 @daypicker/react, 시간은 기존 HH:mm 입력을 사용한다.

## 상태와 저장 책임

기능 page → feature hooks/actions → data adapter → 목적별 RPC 흐름을 따른다. 공유 프로필/친구 상태는 auth/useSharingProfile, 표 저장 직렬화와 saving 상태는 assets/useSpreadsheetSave가 소유한다([#150](../tickets/refactor-08-app-feature-ownership.md)). App은 인증·탐색·기능을 조립한다.

서버 응답과 사용자 초안을 구분한다. 늦은 응답/refetch로 초안을 덮지 않고 다른 소유자의 상태를 재사용하지 않는다. 금융 정밀도·소유권·원자성·중복 방지는 서버 계약을 따르며 UI 리팩토링으로 직렬화 계약을 바꾸지 않는다.

ModalShell은 닫기 요청과 입력 보호를 공통 처리하고 기능은 dirty/pending/저장 결과를 전달한다. 확인 취소는 초안을 유지하며 네트워크 요청 취소가 서버 rollback을 뜻하지 않는다. 목록 필터·스크롤·상세 복귀는 기능 navigation 책임이다.

## 검증 기록

공통 코드 존재와 전 화면 검증 완료는 다르다. 적용 범위·예외·자동 테스트·수동 viewport/키보드 검증은 각 티켓에서 관리한다. 실기기 가상 키보드·safe-area·스크린리더, 실제 ChatGPT 웹/모바일 확인을 자동 테스트 통과로 대체하지 않는다. 배포 여부는 [배포 기록](../engineering/deployment.md)에서 확인한다.
