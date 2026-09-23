# Portfolio 에이전트 계약 관리

2026-09-24 · 아래 운영 배포 이력과 현재 로컬 계약을 구분한다. 로컬에서는 #122의 활동 종류 제거·본문/태그/대상 참조 계약으로 OAuth MCP 도구와 가이드를 갱신했다. 운영에는 아직 적용하지 않았고 현재 계약의 ChatGPT 웹·모바일 행동 평가는 별도다.

## 원본과 전달 경로

2026-09-21~22 후속 구현: 투자 기준 인터뷰를 실제 소비 사례로 [작업 가이드 제공·최신화 설계](./workflow-guide-design.md)와 #63~#65를 구현했다. 이어 #66~#68의 제품 피드백을 추가해 런타임 단일 원본, 일곱 topic, 도구 의존성·source digest 검사와 평가 사례를 연결하고 운영에 배포했다. 실제 모델 평가는 남아 있다.

구조 단순화는 [ADR-0004](../../../adr/0004-domain-storage-and-minimal-mutation-contract.md)를 따른다. 문맥은 context_id로 연결하며 가이드 전용 도구는 첫 버전 선행조건이 아니다. 공통 instructions/도구 설명으로 부족한 실제 사례가 있을 때 도입한다.

| 정보 | 지금의 원본 | 구현 시 전달/검증 |
| --- | --- | --- |
| 제품 정책 | PRD / Accepted ADR | 아래 설명이 제품 경계를 바꾸지 않는지 검토 |
| 공통 행동 규칙 | [behavior.md](./behavior.md) | 짧은 server instructions. 필수 안전 규칙은 관련 도구 설명에도 포함 |
| 사용자 의도와 호출 흐름 | [workflow-guides.ts](../../../../supabase/functions/_shared/mcp/workflow-guides.ts), [workflows.md](./workflows.md) | 런타임은 topic별 구조화 가이드, 문서는 시나리오 의도·매핑을 제공 |
| 도구 사용 설명 초안 | [tool-descriptions.md](./tool-descriptions.md) | 실제 등록 description의 출발점 |
| 데이터·입출력·오류 계약 | [일일 점검](../daily-review-api.md), [생애주기](../lifecycle-model-api.md) | 검증된 JSON Schema와 서버 구현, DB 테스트 |
| 시나리오 인수 조건 | [S01~S24](../scenario-api-model-matrix.md), 일일 점검 R01~R16 | 도구 선택 평가 + 서버 계약 테스트 |

런타임 가이드 원본은 `workflow-guides.ts`, 공통 description/inputSchema/outputSchema/annotations는 `portfolio-tools.ts`에 둔다. 나머지 Markdown은 사람과 구현 에이전트를 위한 의도·평가 기록이다. OAuth handler registry는 시작 시 정의 이름과 일치하는지 검사한다.

기존 `portfolio-mcp`는 사용자가 발급한 agent token과 legacy `mcp_*` RPC를 사용하는 호환 endpoint이고, `portfolio-mcp-oauth`는 사용자 OAuth와 최신 `app_*` RPC를 사용하는 ChatGPT용 기준 endpoint다. 두 endpoint는 인증·도구 의미가 달라 하나의 tools 배열을 억지로 공유하지 않는다. 신규 기능은 OAuth 쪽에만 추가하고 legacy endpoint는 별도 폐기 결정 전까지 안정화 변경만 한다. 이는 중복 방치를 뜻하지 않고 서로 다른 공개 API의 경계를 명시한 것이다.

MCP prompt/resource는 표준 호환성 실험을 위해 유지하되 daily-review resource는 같은 런타임 가이드 원본에서 렌더링한다. 노출되지 않는 클라이언트에서도 instructions, self-contained 도구 설명과 `get_workflow_guide`만으로 안전 경계가 유지돼야 한다.

가이드와 도구 변경은 `npm run check:workflow-guides` 및 review manifest로 연결한다. 사람이 수정하는 런타임 문장을 Markdown과 코드에 영구히 두 개 만들지 않는다. 전체 PRD에서 설명을 자동 추출해 배포하지도 않는다.

## 제공 상태

- `observed-local`: 현 작업 트리의 OAuth tools 배열에서 확인. 운영 제공/호환성 보증이 아님.
- `planned`: 계약만 있음. tools/list나 작업 가이드의 실행 가능한 기능으로 광고 금지.
- `released`: 구현·서버 테스트·배포·대상 클라이언트 검증 근거가 기록된 상태. 2026-09-21의 `list_daily_briefings` 웹 호출은 퇴역한 도구의 역사적 근거이며 현재 활동 통합 계약의 검증으로 재사용하지 않는다.
- 앱 전용/내부 API는 별도 분류한다. 서비스 API 하나당 MCP 도구 하나를 만들지 않는다.

## 변경·버전 관리

1. 기능 티켓에서 관련 S/R 시나리오 ID, workflow ID, 도구명을 지정한다.
2. 동작을 바꾸면 데이터/API 계약, 설명, 시나리오의 변경·불변 조건, 테스트를 함께 수정한다. 정책 변경은 ADR도 갱신한다.
3. 설명 문구만 고치면 계약 revision을 기록한다. 필드/enum/기본값/부수 효과 변경은 API schema version과 구 클라이언트 호환성을 검토한다. workflow revision과 API version은 별개다.
4. 계획 이름을 바꾸면 모든 가이드 참조를 수정한다. 이미 배포된 이름을 바꾸면 폐기 안내/호환 기간을 정하고 조용히 제거하지 않는다.
5. tools/list 설명과 스키마의 중복 이름·핵심 annotations/enum은 단위 테스트하고 OAuth 처리기 이름은 시작 시 공통 정의와 대조한다. 독립 Edge 타입 검사와 fixture 확대는 남았다.
6. 배포 후 새 세션/메타데이터 갱신을 거친 웹·모바일에서 도구 선택을 확인한다. 저장소 변경만으로 클라이언트 반영됐다고 하지 않는다.

## 티켓/PR 완료 체크리스트

- [ ] 관련 시나리오·가이드·도구·스키마·오류 처리·서버 테스트를 함께 확인했다.
- [ ] description만 읽어도 저장 범위와 금지 부수 효과를 알 수 있다.
- [ ] 가이드 조회 없이도 권한/버전/상태/중복 방지가 서버에서 강제된다.
- [ ] 성공/모호한 입력/의도 없는 저장/충돌/응답 유실/타 사용자 접근의 기대 동작이 있다.
- [ ] 제공 중인 기능만 등록/안내하며 미지원 기능은 명확히 알린다.
- [ ] 실제 검사 환경·결과·미검증 사항과 변경 revision을 남겼다.

책임: #33 공통 정의/안내 전달, #34~#38/#41~#43 기능별 설명과 계약, #44 시나리오/관계 일치, #39 클라이언트 사용성·회귀. 설명 작성은 실제 구현 티켓을 완료 처리하는 조건이 아니다.
