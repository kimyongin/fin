# [MCP-first] OAuth MCP 계약 정비와 클라이언트 호환성 검증

## 단순화 적용 기준 — ADR-0004 (2026-09-21)

[ADR-0004](https://github.com/kimyongin/fin/blob/master/docs/adr/0004-domain-storage-and-minimal-mutation-contract.md)가 아래 이전 설계의 물리 구조 요구보다 우선한다. 해당 ADR은 현재 작업 트리에서 작성됐으며 원격 링크는 푸시 후 유효하다. 도메인 테이블+공통 변경 규약, 필요한 대상만 version 검사, 현재값+중요 변경 이력/당시 snapshot을 사용한다. 모든 모델에 head/revision 쌍을 만들지 않는다.

- 문맥은 서버 임시 context_id, 결과는 단일 briefing으로 저장한다. signed receipt·전역 가격/메타데이터 버전 차단은 도입하지 않는다. TTL/정리/생성 제한과 소유권은 테스트한다.
- 사건 엔진/일반 조사구간 집합 엔진/보유 구간 자동 복원/가이드 전용 도구는 후순위다. 아래 사건·이력 인수 조건은 첫 버전에서 근거 정정 참조, 판단/task 연결, 중요 변경 이력과 snapshot으로 충족한다. 보안·원가·보정 보호·원자성은 줄이지 않는다.
- 구현되지 않은 과거 진행 기록은 역사다. 신규 완료 게이트는 갱신된 contracts 문서와 이 절을 따른다. 기능 제공/자동 테스트 통과/티켓 완료를 뜻하지 않는다.

## 구현 인계 확정 사항 (2026-09-20)

- 필독: [ADR-0002](https://github.com/kimyongin/fin/blob/master/docs/adr/0002-cost-basis-reconciliation-and-sharing.md), [ADR-0003](https://github.com/kimyongin/fin/blob/master/docs/adr/0003-extensible-feature-sharing.md), [구현 계약 초안](https://github.com/kimyongin/fin/blob/master/docs/design/implementation-contract-draft.md).
- OAuth 본인 접근과 앱 친구 공유를 분리한다. 기능별 공유 설정으로 MCP 타 사용자 읽기를 자동 허용하지 않는다. 기존 미커밋 실험의 실제 존재와 프로토콜 동작부터 확인한다.
- 문서화는 구현/배포/보안 검증 완료가 아니다. 미검증 DDL·정밀도·상태 전이는 해당 티켓의 첫 작업으로 남기며 완료 체크를 앞당기지 않는다.

## 재사용 및 회귀 경계
- 기존 OAuth MCP를 재구현하지 않는다. 제품 재정리의 책임 분리를 지침에 적용하며 규칙 기반 계산을 사용자 결정으로 승격하지 않는다.
- 신규 필드의 소유자 전용 정책과 기존 공유/토큰 경로의 차이를 #43/#39와 검증한다. 이번 티켓이 공유 정책을 임의로 확대하지 않는다.

## 일일 경험에 필요한 지침
- 변화 없음과 조사 부족을 구분하고, 일일 점검만으로 매매·전략 변경을 유도하지 않도록 업무 가이드에 반영한다.
- 사용자 보유 이유와 모델 추론을 구분하며 저장된 사용자 판단을 모델 의견으로 덮어쓰지 않는다.
- 결과의 작성·저장·사용자 열람·잔고 확인을 서로 다른 상태로 취급한다.
- 저장 요청이 포함된 점검은 허용된 도구로 한 흐름에서 처리하고, 도구 실패 시 저장되었다고 말하지 않는다.

## 선행 작업
- #32 [MCP-first] 제품 계약·잔고 계산 규칙과 사용자 시나리오 확정

## 목적
현재 6개 읽기 도구와 server instructions를 안정적인 MCP 진입점으로 정비한다.

## 근거
supabase/functions/portfolio-mcp-oauth/index.ts에 OAuth, 읽기 annotations, instructions와 prompt/resource 실험이 이미 존재한다. 재구현하지 않는다.
웹 실험에서는 instructions 내용을 모델이 요약했고 prompt/resource는 보이지 않는다고 답했다. 이는 해당 연결에서의 관찰이며 ChatGPT 전체/모바일 지원 불가를 증명하지 않는다. 함수 배포 번들 성공도 타입 검증을 대체하지 않는다.

## 범위
- 기존 프로토콜 버전 협상, JSON-RPC 입력/오류, 알림, 인증 만료 처리를 점검한다.
- 기존 도구 이름을 유지하고 간결한 설명·입출력 스키마·오류 코드를 정비한다.
- workflow 지침과 사용자 콘텐츠/뉴스 본문을 분리한다. 외부 본문을 실행 지침으로 승격하지 않는다.
- 실험 prompt/resource의 유지 또는 격리를 결정하고 현재 지원 수준을 기록한다.
- 필요한 경우 메서드명·버전·성공 여부만 기록해 discovery를 진단한다. 토큰/본문/개인정보는 로그에 남기지 않는다.
- instructions는 중요한 짧은 원칙, tool result는 요청 업무에 필요한 가이드만 제공한다.

## 완료 조건

- [ ] `docs/design/contracts/agent/README.md` 및 behavior/tool-descriptions/workflows 문서를 기준으로 공통 instructions·도구 설명·선택적 가이드 전달을 연결한다. 문서 초안은 배포 증거가 아니다.
- [ ] description/inputSchema/outputSchema/annotations/handler의 공통 정의를 tools/list와 dispatch에서 사용하고 OAuth/기존 토큰 경로의 수동 복제를 제거한다. 연결 후 설명 Markdown은 생성 참조 또는 정의 링크로 전환해 이중 원본을 남기지 않는다.
- [ ] 제공 상태를 observed-local/planned/released로 구별하고 계획 도구를 등록하거나 가이드에서 실행 가능하다고 광고하지 않는다. get_workflow_guide는 필요 시 제공하는 읽기 도구 후보이며 필수 안전 규칙은 가이드 호출 없이 유지한다.
- [ ] 모든 기능 변경 PR은 S/R 시나리오와 W 가이드 ID를 연결하고 설명·스키마·오류 처리·서버 테스트를 동시 점검한다. 원본 일치 CI와 실제 클라이언트 도구 선택 평가를 구분해 기록한다.
- [ ] 독립 타입 검사와 initialize/tools/list/잘못된 요청 계약 검증을 통과한다.
- [ ] 웹·실제 모바일 각각 새 세션/메타데이터 갱신 후 도구와 지침 적용 결과를 기록한다.
- [ ] 테스트용 표식 전달과 서버 discovery 요청을 구분해 관찰 근거를 남긴다.
- [ ] 인증 누락·만료·타 사용자 접근이 차단되고 기존 읽기가 정상 동작한다.
