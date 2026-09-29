# Portfolio 에이전트 계약 관리

2026-09-29 · 로컬 스킬 통합 구현 기준. 실제 플러그인·OAuth 배포와 웹·모바일 검증은 [agent-01](../../../tickets/agent-01-workflow-guide-to-skill.md)에서 확인한다.

## 원본과 책임

| 정보 | 원본 | 검증 |
| --- | --- | --- |
| 제품 정책 | PRD / Accepted ADR | 권한·저장·공유 경계 유지 |
| 제품 작업 지침 | [Portfolio 스킬](../../../../plugins/portfolio/skills/portfolio/SKILL.md)과 참고 문서 6개 | 형식·참조 파일·도구 이름·패키지 검사, 실제 웹·모바일 행동 |
| 짧은 공통 경계 | portfolio-mcp-oauth의 server instructions | 조회와 쓰기 동의, 성공·실패 보고 |
| 도구 공개 계약 | portfolio-tools.ts의 description/schema/annotations | unit·Edge 타입·도구 발견·입출력·오류 |
| 데이터·쓰기·권한 | 목적별 RPC와 서버 구현 | 인증된 MCP/HTTP, DB 원자성·권한·재시도 |
| 설계·평가 기록 | [전환 설계](./portfolio-skill-migration.md), [기존 지식 활용 시험](./portfolio-knowledge-skill-plan.md) | 코드/배포/실클라이언트 결과 구분 |

스킬 본문은 공통 규칙과 요청별 참고 문서 선택을 담고, 실제 필요한 파일만 읽는다. get_workflow_guide와 중복 일일 prompt/resource는 로컬에서 제거했다. 도구 설명만으로 해당 쓰기 범위·부수 효과·실패 후 행동을 알 수 있어야 하며 안전한 서버 검증은 스킬 선택에 의존하지 않는다.

OAuth handler registry는 시작 시 실제 도구 정의와 handler의 일치를 검사한다. 작업 가이드 전용 source digest·review manifest·검사 명령은 제거했다. 같은 지침의 정본을 서버 코드와 스킬 양쪽에 만들지 않는다.

기존 portfolio-mcp는 과거 agent token용 호환 endpoint이고 portfolio-mcp-oauth는 최신 ChatGPT용 기준 endpoint다. legacy endpoint의 종료는 별도 범위다. 새 기능은 OAuth에 구현하고 기존 인증·도구 계약을 무리하게 하나로 합치지 않는다.

## 변경·검증

1. 실제 사용자 시나리오와 영향받는 도구·스킬 참고 문서를 선택한다.
2. 도구 계약을 바꾸면 schema/description/handler/테스트와 관련 스킬 내용을 대조한다. 스킬에서 입력 필드 전체를 중복 관리하지 않는다.
3. `npm test`가 registry·도구 schema 및 플러그인의 참조 파일/도구 이름/앱 연결을 확인한다. 스킬 frontmatter 검사와 ZIP 내용·해시도 확인한다.
4. 실제 인증된 MCP initialize/tools/list/call로 조회·쓰기·권한·실패·재시도를 확인한다. 스킬 형식 검사를 의미·행동 검증으로 대체하지 않는다.
5. [플러그인 배포 절차](../../../engineering/chatgpt-plugin-deployment.md)에 따라 같은 앱 플러그인을 갱신한다. 플러그인 업로드와 서버 배포는 별도 기록한다.
6. 새 웹·모바일 대화에서 자동 선택·첨부 문서 읽기·실제 앱 조회·자발적 초안·동의 후 저장을 확인한다. 클라이언트가 제공하지 않는 선택 증거는 미확인으로 남긴다.

앱만 연결한 클라이언트도 목적별 도구·서버 권한 보호를 사용한다. 스킬이 없는 경로의 자발적 검색·기록 제안을 보장한다고 말하지 않는다. 미지원 기능을 정상 도구로 광고하지 않는다.

## 과거 기록

[작업 가이드 제공 설계](./workflow-guide-design.md)는 제거 전 제공 방식의 기록이다. [도구 설명 카탈로그](./tool-descriptions.md)와 [workflows](./workflows.md)는 시나리오 검토 자료이며 현재 schema/도구 목록의 대체물이 아니다. 과거 배포·시험 결과는 당시 버전의 증거로 보존한다.
