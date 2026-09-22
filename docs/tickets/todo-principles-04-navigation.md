# [ToDo·원칙] ToDo 화면으로 판단·활동 통합과 기존 링크 유지

GitHub: https://github.com/kimyongin/fin/issues/72

상태: 로컬 구현·검증 완료, 운영 배포 전 · 2026-09-22
선행: 03 (동일 todo-principles 시리즈)

## 기준과 기존 구현
공통 설계: https://github.com/kimyongin/fin/blob/master/docs/design/todo-principles-integration.md
ADR: https://github.com/kimyongin/fin/blob/master/docs/adr/0005-todo-bundles-and-operating-rules.md
실제 변경 대상: src/App.jsx, src/constants/portfolio.js, src/features/lifecycle/LifecyclePage.jsx, src/features/activity/{ActivityPage,ActivityEventViewer}.jsx, src/features/portfolio/usePortfolioNavigation.js
기존 원본을 재사용하고 아래 차이만 구현한다. 명칭은 공통 계약을 따르고 새 RPC는 구현 전 정확한 SQL signature・입출력・오류・권한을 설계 문서에 확정한다.

## 범위
하단 오늘/자산/ToDo/원칙을 적용한다. 할 일/완료, 보류/취소 필터, 판단 모아보기・활동 내역을 제공한다. 미소속 과제/판단은 별도로 접근하고 명시적 묶음 편입을 지원한다. 기존 활동 상세・CSV를 재사용하고 묶음과 활동 ID 연결을 검증한다. 기존 hash/deep link/공유 owner/뒤로가기 상태를 보존한다.

## 인수 조건
- [x] T06: #tasks/#decisions/#activity/#strategy와 과제 상세 링크, 기존/신규 혼합 목록, CSV, 필터/목록 복귀, 권한별 뷰, 360/390/768/1024/1440px・키보드・긴 목록・빈 상태를 검증한다.
- [x] DB→RPC/OAuth→앱의 해당 사용자 시나리오를 연결하고 실제 검증 결과를 기록한다.
- [x] 문서/도구 설명/가이드 변경 영향, 증분 migration 및 schema/OVERVIEW.md를 갱신한다.
- [x] npm run check:encoding 및 변경 위험에 맞는 검증을 통과하고 미검증 범위를 기록한다.

## 구현·검증 결과
- 하단 주 메뉴를 `오늘 / 자산 / ToDo / 투자 원칙`으로 정리하고 PC·모바일 모두 하단 고정 구조를 유지했다.
- ToDo 안에서 `할 일 / 판단 모아보기 / 활동 내역`을 전환한다. 활동 원본의 상세 표현과 Before/After CSV 복사 기능은 기존 컴포넌트를 그대로 재사용한다.
- 묶음은 할 일/완료/보류/취소 필터를 제공한다. 기존 조사·실행 과제를 앱에서 명시적으로 묶음에 편입할 수 있고, 연결된 과제 ID는 별도로 조회해 원본 과제 목록에서 중복 노출하지 않는다.
- 기존 #tasks/#decisions/#activity deep link와 오늘→과제 상세, 공유 owner 문맥을 유지했다. 공유 사용자는 비공개 묶음은 보지 않고 기존 허용된 판단·과제·활동만 같은 허브에서 본다.
- 전체 DB 379개, MCP 계약, 브라우저 E2E 32개, 프런트 단위 테스트 101개를 통과했다. E2E는 360/390/768/1024/1440px 하단 메뉴·오버플로·키보드 및 기존 URL을 포함한다.

## 제외・진행 규칙
활동을 시간으로 추정 묶거나 과거 기록을 무조건 backfill하지 않는다.
최소 기반+수직 슬라이스로 진행하고 완료 슬라이스 단위로 커밋한다. 개인 로컬 설정을 섞지 않는다. 기존 금융 검증・공개 범위・미완료 평가를 유지한다.
