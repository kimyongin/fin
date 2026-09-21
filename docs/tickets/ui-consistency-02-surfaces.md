# [UI 일관성] 모달·상세 드로어·편집 액션 통일

우선순위: P1 · 상태: 로컬 구현·자동 검증 완료 · 2026-09-21
상위: #40 · 관련 기존 UI: #36/#47/#53
선행: 01의 페이지 골격 후 적용. 03이 사용할 surface 계약을 먼저 연결한다.

## 목적과 기준

모바일에서 페이지를 바꿔도 제목·보기·필터·본문·행동 위치를 예측할 수 있게 한다. [화면 구조 규칙](../design/screen-structure.md), [디자인 원칙](../design/PRINCIPLES.md), [컴포넌트 계약](../design/component-system.md)을 적용한다. 기존 유용한 자산 흐름을 보존한다.

## 대상과 작업

대상: components/ModalShell.jsx, components/ModalActions.jsx, features/lifecycle/LifecyclePage.jsx, features/review/DailyReviewPage.jsx, features/modals/EditorModals.jsx, features/assets/*Modal.jsx, features/strategy/StrategyPage.jsx, features/news/NewsPage.jsx.

- 기존 focus trap/inert/scroll lock을 보존하고 ModalShell에 분리된 header/body/footer와 modal/detail variant를 보완한다.
- 판단 상세와 기존 계좌 편집 한 곳으로 읽기/편집 소비를 먼저 검증한 뒤 브리핑/할 일 및 나머지 폼에 적용한다.
- 모바일 전체 높이와 PC 오른쪽 상세 drawer, 긴 제목/본문, 내부 뒤로가기를 지원한다.
- 저장/취소/위험 행동, dirty/pending/실패/저장 후 재조회 실패를 screen-structure.md 계약으로 통일한다.
- detail 이력·브라우저 뒤로·필터/스크롤 복귀를 연결하고 resize로 draft가 사라지지 않게 한다. 호출부 적용 목록을 기록한다.

## API·데이터 불변 조건

표현과 상호작용만 변경한다. 기존 feature data/actions 및 RPC를 재사용하며 DB migration·MCP 계약·권한 확대·원가 계산 변경은 없다. 초기 작업에서 실제 호출 API와 보존할 흐름을 기록한다. 서버 소유권·멱등성·버전 충돌·매매/보정 규칙을 우회하지 않는다. 새 프레임워크/라우터/범용 CRUD 엔진을 선행 작업으로 추가하지 않는다.

## 완료 조건

- [x] header/footer는 긴 본문 스크롤 밖에 있고 마지막 입력/오류가 가려지지 않는다.
- [x] Tab/Shift+Tab/Escape, background inert, 최상위 overlay, 호출 위치 복귀를 검증한다.
- [x] dirty 닫기/계속 편집/버리기, pending 닫기 차단, 실패 후 초안 보존을 검증한다.
- [x] 저장 성공 후 재조회 실패를 저장 실패와 구분하고 편집창을 닫은 뒤 전역 재조회 안내를 표시해 중복 저장으로 복구하지 않는다.
- [x] 브리핑→연결 상세→목록 복귀와 resize 중 초안 유지가 동작하며 브라우저 뒤로가기로 열린 상세를 닫을 수 있다.
- [x] 360/390/768/1024/1440px, 긴 이름/본문, 빈 데이터/오류, 소유자/공유 상태를 자동 fixture로 검증하고 결과를 기록한다.
- [x] 관련 사용자 행동을 검증하는 E2E, npm test, npm run build, npm run check:encoding 및 git diff --check가 통과한다. 실기기 키보드는 미검증이다.

## 구현 결과와 남은 작업

`ModalShell`에 고정 header/body/footer, 모바일 전체 높이, PC detail drawer, safe-area, dirty/pending 닫기 정책을 연결했다. 푸터 닫기도 shell의 동일 정책을 거치며 계좌·종목·보유·태그·뉴스 편집에 적용했다. 판단/할 일과 브리핑 상세는 detail variant를 사용한다. 기존 hash 라우팅을 유지하면서 상세를 열 때 같은 URL의 history entry를 추가해 브라우저 뒤로가기가 surface를 닫도록 했다. 자산 편집은 쓰기 성공 직후 편집창을 닫고 재조회 실패를 전역 안내로 분리한다. 구현 커밋은 `1fbddf8`, 확대 적용과 회귀 수정은 `e6623dc`, 남은 상태 계약 완료는 `a73ee9d`다.

## 구현 인계

AGENTS.md → docs/START-HERE.md → 위 디자인 문서와 architecture/development를 읽고 착수한다. 최소 공통 기반을 실제 화면과 함께 완성하고 슬라이스별 검증·커밋한다. 운영 데이터에 테스트 쓰기를 하지 않는다. 새 앱 코드 구현/운영 배포는 현재 티켓 작성 단계에 포함하지 않았다. 구현 중 기술 선택은 위 계약 안에서 정하고 결과·예외·남은 검증을 로컬/GitHub 양쪽에 기록한다.
