# 시작하기

2026-09-26 · 현재 규칙으로 안내하는 색인. 날짜별 작업 기록은 정본 계약과 구분한다.

## 먼저 읽기

1. 저장소 AGENTS.md → [개발·모델·환경 규칙](./engineering/development.md).
2. [제품 PRD](./prd/portfolio.md) → [단순성 원칙](./engineering/SIMPLICITY.md).
3. Accepted [ADR-0008 저장 간소화](./adr/0008-minimal-portfolio-storage.md), [ADR-0009 전체 포트폴리오 공유](./adr/0009-whole-portfolio-sharing.md), [ADR-0004 저장 책임](./adr/0004-domain-storage-and-minimal-mutation-contract.md).
4. [티켓 색인](./tickets/README.md)에서 해당 티켓과 검증 기록을 읽고 Git/GitHub 최신 상태를 확인한다.
5. 코드 변경 전 [구조와 책임](./engineering/architecture.md). DB 작업은 [스키마 색인](../supabase/schema/OVERVIEW.md)에서 시작한다.

Astra는 설계·검토·티켓, Sol은 구현·수정·검증을 담당한다. 사용자 모델 선택 확인은 전환 안내가 있기 전까지 유효하다. 설계 요청을 코드 수정으로 확대하지 않는다.

## 작업별 정본

- UI: [디자인 원칙](./design/PRINCIPLES.md), [공통 컴포넌트](./design/component-system.md).
- 해당 UI를 변경할 때: [상단 카드](./design/page-panel-guidelines.md), [모달](./design/modal-guidelines.md), [태그](./design/tag-guidelines.md), [타이포그래피](./design/typography-guidelines.md), [타임라인](./design/timeline-guidelines.md).
- 서버: [백엔드 모듈](./engineering/backend-modules.md). MCP 런타임 도구/가이드는 supabase/functions/_shared/mcp의 코드와 review manifest가 원본이다. 개발 지침과 제품 에이전트 지침을 혼합하지 않는다.
- 운영: [배포·복구 및 배포 기록](./engineering/deployment.md). 로컬 구현, 커밋/푸시, DB·Edge·웹 배포, 실클라이언트 확인을 따로 기록한다.

## 현재 인계

- #147·#148·#150: 로컬 구현과 검증 및 커밋 기록은 각 티켓에 있다. 미체크 수동 검증은 남아 있다.
- #149: 현재 문서와 과거 상태 설명 분리. 상세 근거·문서 검사 결과는 해당 티켓이 원본이다.
- 마지막 확인한 운영 앱 기준은 [2026-09-26 배포 기록](./engineering/deployment.md)의 05c156f다. 이후 로컬 커밋을 운영 배포로 간주하지 않는다. 실제 Google 로그인·ChatGPT 웹/모바일 확인 등 남은 항목은 배포 기록을 따른다.
- 사용자 로컬 설정과 무관한 미커밋 파일은 보존한다. 테스트·배포 명령의 대상 환경을 실행 전에 확인한다.

## 과거 기록

[이전 시작 문서 전체](./history/start-here-before-149-20260926.md)와 [이전 티켓 목록](./history/ticket-index-before-149-20260926.md)은 당시 상태를 보존한 자료다. 과거의 “구현 전/배포 대기”를 현재 상태로 해석하거나 퇴역 기능을 복원하지 않는다.
