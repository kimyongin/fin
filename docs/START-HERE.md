# 시작하기

2026-09-27 · 현재 규칙으로 안내하는 색인. 날짜별 작업 기록은 정본 계약과 구분한다.

## 먼저 읽기

1. 저장소 AGENTS.md → [개발·모델·환경 규칙](./engineering/development.md).
2. [제품 PRD](./prd/portfolio.md) → [단순성 원칙](./engineering/SIMPLICITY.md).
3. Accepted [ADR-0008 저장 간소화](./adr/0008-minimal-portfolio-storage.md), [ADR-0009 전체 포트폴리오 공유](./adr/0009-whole-portfolio-sharing.md), [ADR-0004 저장 책임](./adr/0004-domain-storage-and-minimal-mutation-contract.md).
4. [티켓 색인](./tickets/README.md)에서 해당 티켓과 검증 기록을 읽고 Git/GitHub 최신 상태를 확인한다.
5. 코드 변경 전 [구조와 책임](./engineering/architecture.md). DB 작업은 [스키마 색인](../supabase/schema/OVERVIEW.md)에서 시작한다.

Astra는 설계·검토·티켓, Sol은 구현·수정·검증을 담당한다. 사용자 모델 선택 확인은 전환 안내가 있기 전까지 유효하다. 설계 요청을 코드 수정으로 확대하지 않는다.

## 작업별 정본

- UI: [디자인 원칙](./design/PRINCIPLES.md), [공통 컴포넌트](./design/component-system.md).
- 목록·상세 진입: [읽기/편집·모바일 조작](./design/list-interaction-guidelines.md). 활동 마크다운 읽기와 명시적 진입의 기존 구현은 [#167](./tickets/ui-35-list-reading-and-mobile-interaction.md), 아이콘을 `보기 · 편집` 텍스트로 바꾸는 후속은 [텍스트 전환 티켓](./tickets/ui-36-text-list-actions.md)을 따른다. 후속은 로컬 구현·자동 검증을 마쳤으며 제목 기준선·묶음 줄바꿈·투명 표현을 적용했다. 수동 확대·실기기 확인과 운영 배포는 남아 있다.
- 해당 UI를 변경할 때: [상단 카드](./design/page-panel-guidelines.md), [모달](./design/modal-guidelines.md), [태그](./design/tag-guidelines.md), [타이포그래피](./design/typography-guidelines.md), [타임라인](./design/timeline-guidelines.md).
- 서버: [백엔드 모듈](./engineering/backend-modules.md). MCP 런타임 도구/가이드는 supabase/functions/_shared/mcp의 코드와 review manifest가 원본이다. 개발 지침과 제품 에이전트 지침을 혼합하지 않는다.
- 운영: [배포·복구 및 배포 기록](./engineering/deployment.md), [ChatGPT 플러그인 배포](./engineering/chatgpt-plugin-deployment.md). 로컬 구현, 커밋/푸시, DB·Edge·웹·플러그인 배포, 실클라이언트 확인을 따로 기록한다.

## 현재 인계

- 활동 지식 활용 후속: [제품용 스킬·개인 플러그인 검증 인계](./design/contracts/agent/portfolio-knowledge-skill-plan.md). 사용자에게 태그/검색/기록 지시를 반복시키지 않는 흐름을 보존했다. 새 Portfolio 앱과 스킬을 하나의 개인용 플러그인 1.0.1로 통합하고 설치 목록의 중복 항목을 해제했다. 이 문서에 다음 버전의 통합 절차를 남겼다. 명시 선택 웹 대화와 플러그인을 지정하지 않은 일반 웹 대화 두 건에서 Portfolio 앱 조회가 표시됐다. 스킬 자동 선택의 독립 확인·자발적 기록 제안·동의 후 저장·실제 모바일 행동 검증은 남아 있다.

- #161~#165: [활동 검색 후속 설계](./design/activity-context-search.md). [Pinecone 전환 계약](./design/activity-search-pinecone.md)의 원문 분할과 새 모델이 운영 DB·Edge·웹에 배포돼 재색인을 마쳤다. 실모델 품질 게이트는 후반부 질문 1건·무관 질문 1건에서 실패했지만, 사용자의 명시적 요청에 따라 의미 검색을 활성화했다. 인증된 운영 HTTP/OAuth와 배포 회귀 검사는 통과했고 품질 개선은 Astra 검토 대상이다. 상세 근거는 [#161](./tickets/search-01-korean-hybrid.md), [#165](./tickets/search-05-search-evidence.md), [배포 기록](./engineering/deployment.md). 실제 ChatGPT 확인과 #162~#164 후속 기능도 남아 있다.

- #151~#158: [도메인 CRUD 동등성 설계](./design/domain-crud-parity.md), [HTTP·OAuth 계약표](./design/contracts/agent/domain-crud-parity-matrix.md), [티켓 색인](./tickets/README.md)을 따른다. 주요 웹 HTTP/OAuth MCP 경로는 2026-09-27 운영 배포됐지만, 티켓에 적힌 전체 필드 양방향·실 ChatGPT 웹/모바일 검증은 남아 있다. 시세·환율은 직접 편집 없이 동일 가격 갱신을 호출한다.

- #147·#148·#150: 로컬 구현과 검증 및 커밋 기록은 각 티켓에 있다. 미체크 수동 검증은 남아 있다.
- #149: 현재 문서와 과거 상태 설명 분리. 상세 근거·문서 검사 결과는 해당 티켓이 원본이다.
- 마지막 확인한 운영 앱 기준은 [2026-09-29 배포 기록](./engineering/deployment.md)의 `47ca601` (목록 아이콘 정렬·타임라인 압축 포함)이다. 전체 로컬·CI 검증과 Pages 게이트는 통과했지만 실기기 터치·200% 확대·화면낭독기 수동 확인은 남아 있다. #166의 실제 Google 로그인·ChatGPT 웹/모바일 확인과 구 ID 호환 계약 종료도 남아 있다. 이후 로컬 커밋을 운영 배포로 간주하지 않는다.
- 사용자 로컬 설정과 무관한 미커밋 파일은 보존한다. 테스트·배포 명령의 대상 환경을 실행 전에 확인한다.

## 과거 기록

[이전 시작 문서 전체](./history/start-here-before-149-20260926.md)와 [이전 티켓 목록](./history/ticket-index-before-149-20260926.md)은 당시 상태를 보존한 자료다. 과거의 “구현 전/배포 대기”를 현재 상태로 해석하거나 퇴역 기능을 복원하지 않는다.
