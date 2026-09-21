# [MCP 가이드] 투자 기준 인터뷰와 최소 가이드 제공

우선순위: P1 · 상태: 로컬 구현·자동 검증 완료, 운영/모델 평가 대기 · 2026-09-21
관련: #57 후속, W02/S02~S04 · 선행: 없음

## 목적과 범위

“내 투자 기준을 인터뷰해서 정리해줘”부터 초안 확인·저장·앱 재조회까지 연결한다. [공통 설계](../design/contracts/agent/workflow-guide-design.md)가 계약 기준이다.

- OAuth get_workflow_guide(topic=policy), 정적 가이드 원본, 기존 envelope/annotations/registry를 연결한다.
- server instructions/관련 description으로 가이드 발견을 돕는다. policy 외 topic은 아직 노출하지 않는다.
- 누락/충돌 질문, 기존 답 재사용, 초안 승인, 부분 patch와 restrictions 보존, 응답 유실/버전 충돌/재조회 실패 처리를 구현한다.
- 런타임 원본·tool 참조 검사·문서 링크를 함께 만든다. 새로운 DB/API 저장 구조나 인터뷰 UI는 필요 없다.

## 인수 조건

- [x] tools/list/call에서 policy 조회·unknown topic·인증·응답 schema를 검증하고 guide 호출 자체에 업무 데이터 쓰기가 없다.
- [x] 기존 get/save_investment_policy를 이용한 실제 OAuth 저장→멱등 재시도→재조회와 앱 표시를 격리 테스트 데이터로 확인한다.
- [x] 신규/기존 기준 일부 수정/null 삭제/버전 충돌/배열 검증 fixture와 인터뷰 초안·저장 경계 계약을 확인한다.
- [x] 저장은 기존 목적별 RPC만 사용하며 전략·잔고를 변경할 수 없는 schema/DB 계약을 유지한다.
- [x] 버전 충돌과 응답 유실에서 기존 복구 계약을 재사용하고 재조회 실패를 별도 단계로 안내한다.
- [x] 가이드 참조 도구 일치 검사, 실제 격리 Edge 호출, 관련 unit/DB/브라우저 계약, encoding과 diff 검사를 통과한다.
- [ ] 실제 ChatGPT 웹/모바일에서 사용자 문장으로 가이드를 발견하고 인터뷰하는지 관찰하거나 미검증으로 명시한다.

## 인계

로컬 OAuth 0.5.0에 구현했다. 운영 배포와 실제 모델 검증은 별도이며, 미실행 항목을 완료 처리하지 않는다.
