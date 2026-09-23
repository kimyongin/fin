# [후속 정리] 미사용 화면·활동 조회·구 명칭 제거

우선순위: P2 · 상태: 티켓 작성, 구현 전 · 2026-09-23
관련: #91, #57 · 기준 코드: 8cb943f

## 문제와 근거

HoldingThesisModal.jsx/ActivityPage.jsx 및 lifecycle/data.js의 일부 조회 함수는 현재 src 참조 검색에서 소비자가 없다. App.jsx는 agentActions 등 사용하지 않는 props를 LifecyclePage에 전달하고, 저장 후 loadAgentActions 호출도 남아 있다. ActionTimeline에는 폐기된 research/partial 작업 분기가 남고 MCP 내부 holdingThesisToolNames 등의 이름은 현재 메모 저장 개념과 다르다.

## 범위

- 구현 시 import/동적 참조/테스트/문서를 재확인하고 미사용 파일·export·props·state·효과·조회 경로를 함께 제거한다.
- 활동 목록은 현재 timeline/search 경로를 사용하고 저장 후 화면에 쓰이지 않는 옛 최근 활동 요청을 제거한다.
- 더 이상 반환하지 않는 task kind/status 분기를 실제 서버 계약과 대조해 제거한다.
- MCP 내부 그룹과 변수 이름을 현재 원칙/메모/활동 개념으로 정리한다. 공개 도구 이름 변경이나 토큰 MCP 폐기는 포함하지 않는다.
- #57의 기존 결정대로 OAuth handler 전체 파일 분할은 선행 과제로 만들지 않는다. 구 migration은 보존한다.

## 완료 조건

- [ ] 제거 대상과 참조 확인 근거를 기록하고 import/build/관련 테스트가 통과한다.
- [ ] 활동 등록·완료·편집 이후 불필요한 최근 활동 요청이 발생하지 않으며 목록은 갱신된다.
- [ ] 토큰 발급/해지, 공유 보기, 기존 hash 진입 등 유효한 소비 흐름이 유지된다.
- [ ] MCP 도구 목록/계약/가이드 검사를 통과하고 내부 명칭 변경의 영향 없음 또는 변경 사항을 기록한다.

## 진행 규칙

- docs/START-HERE.md, ADR-0008, SIMPLICITY.md와 해당 기능의 최신 구현을 먼저 확인한다.
- 최소 변경으로 수직 구현·검증한다. 새 테이블/이력/범용 프레임워크를 기본 해법으로 삼지 않는다.
- 관련 코드·계약·MCP 설명/가이드 영향과 실제 검사 결과를 함께 기록한다. DB 변경 시 schema/OVERVIEW.md를 갱신한다.
- 사용자 로컬 설정을 보존한다. 로컬 완료와 운영 배포/실제 ChatGPT 검증을 구분한다.

