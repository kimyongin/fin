> #149 정리 전 스냅샷 · 2026-09-26. 아래 상태 문장은 당시 기록이며 현재 상태가 아니다. 현재 기준은 [시작 문서](../START-HERE.md)를 따른다. 상대 링크만 보관 위치에 맞게 조정했다.

# React 공통 컴포넌트 설계

상단 카드의 표현 책임은 [페이지 상단 카드 가이드](../design/page-panel-guidelines.md)를 따른다. 자산·활동에서 실제 사용하는 여백/구획만 PageControls의 작은 wrapper 또는 스타일로 공유한다. 조회·조건 적용·평가 계산은 각 feature가 담당한다. 페이지별 설정을 해석하는 범용 필터/레이아웃 엔진은 추가하지 않는다.

글자 표현은 [타이포그래피 가이드](../design/typography-guidelines.md)를 따른다. `styles.css`의 작은 역할별 스타일을 기존 컴포넌트와 실제 소비 화면에서 재사용하며 별도 범용 Text 컴포넌트/디자인 시스템 엔진은 만들지 않는다. 전역 font 상속과 Tailwind layer를 검증하고 공통 제목/입력/버튼의 실제 스타일을 확인한다. [전 영역 적용](../tickets/ui-24-typography-consistency.md)은 설계 완료·구현 대기다.

타임라인 표현은 [타임라인 디자인 가이드](../design/timeline-guidelines.md)를 따른다. #119에서 활동/원칙 두 소비자가 쓰는 날짜 그룹·행 표현만 추출할 예정이며 데이터 조회·권한·커서는 각 기능에 둔다. 공통 타임라인 컴포넌트는 아직 미구현이다.

모달 구현·수정의 필수 기준은 [모달 디자인 가이드](../design/modal-guidelines.md)다. ModalShell/ModalActions를 재사용하고, 아래 초기 DetailSurface 제안과 충돌하면 가이드의 용도별 레이아웃을 따른다.

2026-09-26 [필드 통일 설계](../tickets/ui-29-modal-field-consistency.md): 같은 역할의 편집·읽기 전용 scalar를 `라벨 + 동일 크기 필드`로 통일한다. `styles.css`의 작은 공통 스타일과 필요한 얇은 라벨/읽기 전용 표현을 자산·계좌부터 실제 소비한다. 읽기 전용 값도 선택·복사를 지원하고 잠금/배경으로 구별한다. 범용 폼/검증 엔진은 도입하지 않는다. 긴 본문·확인 설명·표 셀은 가이드의 명시적 예외다. 아래 FormField 후보는 이 최소 범위에서만 판단하며 아직 코드 적용 전이다.

[태그 가이드](../design/tag-guidelines.md)와 [#128](../tickets/ui-20-tag-chip-guidelines.md)은 `TagChip`의 최소 표시/선택 표현을 관리자·필터·상세에서 재사용하도록 한다. `TagManagerModal`은 초기 미선택 칩 목록과 선택 후 목록 아래 직접 편집을 제공한다. #127의 기존 전체 폭 행·목록 내부 스크롤 표현을 대체한다. API·권한·배분 목표/활동 검색 갱신은 기능별 책임이다. `ActivityTagPicker`는 선택만 담당하며 2차 `ConfirmDialog`에 태그 편집 폼을 넣지 않는다.

2026-09-21 · 공통 구조 로컬 구현 완료. 현재 React 19 + Vite + Tailwind를 사용한다(package.json 선언 기준). 구조/배치 계약과 남은 실기기 검증은 [화면 구조 규칙](../design/screen-structure.md)을 따른다. 별도 Web Components/custom elements 프레임워크를 도입한다는 뜻이 아니다. 기존 어두운 테마와 CSS 변수를 유지한다.

## 현재 기반과 보완

ModalShell, ConfirmDialog, ModalActions, PageControls, PortfolioEntityHeader/Identity, MetricSummary, MarkdownContent가 src/components에 있다. 이를 폐기하고 새 디자인 시스템을 전면 도입하지 않는다.
ModalShell에는 Escape, Tab 순환, 호출 요소 focus 복귀, dialog 이름 연결, background inert, scroll lock, 최상위 modal, 고정 footer, detail drawer, dirty/pending 닫기 처리가 구현돼 있다. PageControls는 ViewTabs/FilterChips/PageToolbar를 제공한다. 별도 DialogSurface/FormField/범용 PageLayout은 실제 두 번째 소비자가 생기기 전 만들지 않았다. 자동 접근성 회귀는 통과했지만 실기기 스크린리더 검증 완료를 뜻하지 않는다.

## 공통 UI 계약

아래 목록 전체를 첫 개발의 필수 기반으로 만들지 않는다. ADR-0004에 따라 기존 ModalShell의 접근성/입력 보호와 첫 상세 화면을 먼저 검증한다. 나머지는 실제 소비 기능에서 필요할 때 추출한다.

| 구성요소 | 책임과 입력 후보 | 하지 않는 일 |
| --- | --- | --- |
| DialogSurface | open, title, description?, initialFocusRef?, returnFocusRef?, onRequestClose(reason), children, footer | 도메인 저장·권한·잔고 계산 |
| ModalShell | 기존 호출자를 유지하는 호환 wrapper. 내부 DialogSurface로 점진 전환 | 각 화면마다 Escape/focus 구현 복제 |
| DetailSurface | 좁은 화면 full-height, 넓은 화면 오른쪽 drawer. 공통 제목/닫기/본문 | 화면 폭 변경으로 내용/초안 재생성 |
| ConfirmDialog | 행동명·대상·영향·취소/확인. 삭제/보정/취소를 구체적 문구로 구분 | preview를 사용자 승인으로 간주 |
| FormField | label/id, hint, error, required, children. aria-describedby 연결 | 금융 규칙의 최종 검증 |
| ActionButton / FormActions | pending/disabled, 주/보조/위험 행동, 최소44px, 중복 클릭 방지 | API 재시도/idempotency 생성 |
| AsyncState | loading/empty/error/ready, retry callback; 오래된 데이터와 loading 구별 | 읽기 실패를 빈 목록으로 숨김 |
| QualityBadge / DataTimestamp | missing/stale/estimated/partial, 날짜와 텍스트 레이블 | 품질 상태를 자체 추론해 변경 |

이름/props는 제안이며 React JSX 기존 방식 유지. 범용 UI 라이브러리 채택은 확정하지 않는다. 구현 시 접근성 동작을 검증한 primitive 사용과 자체 구현을 비교하되 저장소 전체 교체를 전제하지 않는다. 날짜 달력에 한정한 `@daypicker/react` 도입은 아래 실제 소비자 기록을 따른다.

## 모달·드로어 공통 동작

최신 직접 편집 계약은 모달 가이드와 #123이 우선한다. 같은 대상의 모든 편집 필드와 선택 태그를 하나의 초안/저장으로 관리한다. 별도 읽기/편집 모드와 속성 모달을 만들지 않으며 원자 저장은 각 기능이 담당한다. 과거 이력/공유 읽기는 읽기 전용이다. 기존 shell과 필드 본문을 재사용하고 범용 저장 엔진은 추가하지 않는다.

- 첫 드로어는 modal 방식으로 통일한다. PC에서도 배경과 동시 편집하는 non-modal 패널은 별도 계약 전 도입하지 않는다. 닫기까지 배경 inert, scroll lock, 포커스 유지, dialog role/aria-modal/label 제공.
- 초점은 첫 입력 또는 긴 내용의 제목처럼 의미 있는 위치로 이동하고, 닫으면 호출 요소로 복귀한다. 호출 요소가 사라지면 목록 제목 등 안정적인 fallback 사용.
- Escape/닫기 버튼/외부 클릭/뒤로가기는 동일한 onRequestClose 경로로 처리한다. 최상위 overlay만 처리한다. 모바일 드래그 닫기는 필수 기능에서 제외한다.
- dirty 편집은 유지/버리기/머무르기 정책에 따라 보호한다. 저장 중 닫기는 진행 상황을 설명하고 중복 저장을 막는다. 네트워크 요청 취소가 서버 rollback을 뜻하지 않는다.
- 기능 controller가 dirty/pending/저장 결과를 소유한다. shell은 닫기 요청만 전달하며 사용자의 입력을 삭제하지 않는다. 위험 확인을 여러 overlay에 중첩하지 않고 최상위 확인 하나만 허용한다.
- DetailSurface는 화면 구조 규칙의 1024px 기준으로 전환한다. 폼의 stable key/상태는 기능 계층에 두어 회전/resize에도 유지한다. 고정 footer는 safe-area/키보드/본문 스크롤을 가리지 않는다.
- 목록 필터·스크롤·선택 대상과 상세 이동은 기능 navigation이 담당한다. 기존 hash 진입/뒤로가기 보존. 새 router 도입을 선행조건으로 만들지 않는다.

## 업무 컴포넌트와 상태

BriefingSummary, DecisionStatus, TaskProgress, EvidenceList, PositionChangePreview 등은 먼저 해당 features 폴더에 둔다. 실제 여러 소비자가 생기면 공개 props를 정리해 공통화한다. 범용 '모든 엔티티 카드'를 미리 만들지 않는다.

기능 page → feature controller/hooks → data adapter → RPC가 기본 흐름이다. 공통 UI는 feature나 Supabase를 import하지 않는다. 서버 응답/캐시와 사용자 draft를 구분하고 refetch로 미저장 입력을 덮지 않는다. 캐시 키는 인증 사용자/공유 문맥/대상/필터를 포함하고 로그아웃·권한 철회 시 제거한다. 늦은 읽기 응답은 request identity로 무시한다. 금융 문자열을 Number로 바꿔 저장하지 않는다.

## 구현 결과와 검증

`src/components/Timeline.jsx`는 #119의 활동·원칙 두 소비자가 사용하는 날짜 카드와 기록 행만 담당한다. 데이터 조회·커서·권한·도메인 의미는 각 기능에 남겨 둔다.

1. #59에서 페이지 골격을 판단·할 일과 자산에 적용했고 #60에서 기존 ModalShell의 접근성 처리를 보존하며 footer/variant/닫기 정책을 보완했다.
2. 판단·할 일·브리핑 상세와 계좌·종목·보유·태그·뉴스 편집으로 확대했다. #61은 표 전체 화면, #62는 나머지 페이지와 터치 영역을 적용했다. 별도 DialogSurface와 범용 form engine은 만들지 않았다.
3. 360/390/768/1024/1440px, 탭 키보드, Tab/Shift+Tab/Escape, 포커스/inert, resize 중 draft, dirty 닫기, 브라우저 뒤로가기를 자동 검증했다.
4. 저장 성공 후 재조회 실패는 편집 오류와 분리했다. 실제 모바일 가상 키보드·safe-area·스크린리더는 #39에서 확인한다.

문서화는 UI 구현/접근성 검증 완료가 아니다. 원칙은 [PRINCIPLES](../design/PRINCIPLES.md), 코드 책임은 [architecture](../engineering/architecture.md)를 따른다.

2026-09-26 날짜·시간 입력 후속: 활동 필터와 기록·할 일 폼의 기본 브라우저 달력을 공통 `CalendarDateField` + `@daypicker/react`로 교체했다. 시간은 한 소비자만 있어 별도 라이브러리 없이 공통 `ClockTimeField`에서 `HH:mm`을 입력한다. 기존 폼 값·저장 API는 그대로 두며 달력은 현재 본문에 펼쳐 2차 모달을 만들지 않는다. [활동 필터 티켓](../tickets/ui-31-activity-filter-fields.md)에 후속 결정과 검증 범위를 기록한다.
