# [UI 일관성] 나머지 페이지 구조 적용과 반응형 회귀 검증

우선순위: P2 · 상태: 구현 준비 / 미착수 · 2026-09-21
상위: #40 · 관련 기존 UI: #36/#47/#53
선행: 01~03. 단 각 티켓의 검증을 이 단계까지 미루지 않는다.

## 목적과 기준

모바일에서 페이지를 바꿔도 제목·보기·필터·본문·행동 위치를 예측할 수 있게 한다. [화면 구조 규칙](../design/screen-structure.md), [디자인 원칙](../design/PRINCIPLES.md), [컴포넌트 계약](../design/component-system.md)을 적용한다. 기존 유용한 자산 흐름을 보존한다.

## 대상과 작업

대상: features/review/DailyReviewPage.jsx, features/strategy/StrategyPage.jsx, features/news/NewsPage.jsx, features/activity/ActivityPage.jsx, features/settings/SettingsPage.jsx, features/guide/GuidePage.jsx, styles.css.

- 오늘/투자 원칙/배분 점검/자료/활동/설정/가이드에 공통 시작 간격·섹션·행동 규칙을 적용한다.
- 오늘의 날짜·결론 우선 순서, 설정별 독립 저장 단위, 가이드 설명형 구조를 유지한다. 필요 없는 탭/필터/푸터는 추가하지 않는다.
- loading/empty/필터 없음/error/load-more 표현, dark theme 오류, 버튼/입력 크기를 정리한다.
- 화면별 적용/예외/검증 표를 docs/design에 남기고 설계 문서의 구현 상태를 갱신한다.
- 기존 자산/모달까지 포함해 대표 사용 흐름을 점검한다. 스타일 문자열 복제만 검사하는 테스트는 추가하지 않는다.

## API·데이터 불변 조건

표현과 상호작용만 변경한다. 기존 feature data/actions 및 RPC를 재사용하며 DB migration·MCP 계약·권한 확대·원가 계산 변경은 없다. 초기 작업에서 실제 호출 API와 보존할 흐름을 기록한다. 서버 소유권·멱등성·버전 충돌·매매/보정 규칙을 우회하지 않는다. 새 프레임워크/라우터/범용 CRUD 엔진을 선행 작업으로 추가하지 않는다.

## 완료 조건

- [ ] 대상 페이지 전부에 적용/예외/검증 여부가 기록된다.
- [ ] 오늘의 결론·분석 시점·조사 상태가 소개/도구 영역에 밀리지 않는다.
- [ ] 원칙 편집과 배분 조회, 자료 CRUD와 활동 전후 값, 공유 읽기가 유지된다.
- [ ] 전체 페이지에서 360/390/768/1024/1440px의 넘침·하단 가림·긴 이름·빈 상태·오류를 검토한다.
- [ ] 기존 관련 E2E 및 변경된 저장/닫기/키보드 사용자 흐름 검증이 통과한다.
- [ ] 360/390/768/1024/1440px, 긴 이름/본문, 빈 데이터/오류, 소유자/공유 상태를 검증하고 결과를 기록한다.
- [ ] 관련 사용자 행동을 검증하는 E2E, npm test, npm run build, npm run check:encoding 및 git diff --check가 통과한다. 실기기 키보드 미검증은 별도 명시한다.

## 구현 인계

AGENTS.md → docs/START-HERE.md → 위 디자인 문서와 architecture/development를 읽고 착수한다. 최소 공통 기반을 실제 화면과 함께 완성하고 슬라이스별 검증·커밋한다. 운영 데이터에 테스트 쓰기를 하지 않는다. 새 앱 코드 구현/운영 배포는 현재 티켓 작성 단계에 포함하지 않았다. 구현 중 기술 선택은 위 계약 안에서 정하고 결과·예외·남은 검증을 로컬/GitHub 양쪽에 기록한다.

