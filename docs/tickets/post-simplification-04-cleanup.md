# [후속 정리] 미사용 화면·활동 조회·구 명칭 제거

우선순위: P2 · 상태: 로컬 구현·검증 완료, 운영 배포 전 · 2026-09-23
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

- [x] 참조 검색으로 소비자가 없는 `HoldingThesisModal`, `ActivityPage`, 옛 task 조회 adapter를 확인해 제거했다. `npm test`, `npm run build` 통과.
- [x] 화면에서 소비하지 않던 `agentActions` 상태·최근 활동 fetch·저장 후 재요청을 제거하고, 실제 목록 갱신 키는 유지했다.
- [x] 유효한 토큰/공유/hash 경로는 삭제하지 않았다. 최종 E2E 회귀 검증 결과는 아래에 기록한다.
- [x] 공개 MCP 도구 이름은 그대로 두고 내부 그룹 이름만 현재 용어로 바꿨다. Deno check 및 workflow-guide manifest 검사를 통과했다.

## 구현·검증 기록

- `rg`로 import/호출자를 재확인한 뒤 미사용 파일과 adapter를 삭제했다. 삭제된 추적 파일 때문에 인코딩 검사가 실패하지 않도록 검사 대상의 실제 존재 여부를 확인하게 했다.
- `npm test`: 20 파일/96 테스트 통과. `npm run build`: 성공. OAuth Edge handler Deno check: 성공.
- 공개 MCP 계약·설명 변경은 없다. 내부 소스 hash 변화에 대한 workflow-guide review manifest 사유를 기록했다.
- 운영 배포와 실제 ChatGPT 웹·모바일 평가는 이 로컬 정리 범위 밖이다.

## 진행 규칙

- docs/START-HERE.md, ADR-0008, SIMPLICITY.md와 해당 기능의 최신 구현을 먼저 확인한다.
- 최소 변경으로 수직 구현·검증한다. 새 테이블/이력/범용 프레임워크를 기본 해법으로 삼지 않는다.
- 관련 코드·계약·MCP 설명/가이드 영향과 실제 검사 결과를 함께 기록한다. DB 변경 시 schema/OVERVIEW.md를 갱신한다.
- 사용자 로컬 설정을 보존한다. 로컬 완료와 운영 배포/실제 ChatGPT 검증을 구분한다.
