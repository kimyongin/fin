# [피드백] ChatGPT 대화 등록과 맥락 기반 제안

우선순위: P1 · 상태: 운영 배포/자동 검증 완료, 실제 ChatGPT 평가 대기 · 선행: #66 (feedback-01-app)

## 범위

[공통 설계](../design/product-feedback.md)의 F02~F05/F07/F08을 구현한다.

- OAuth submit_product_feedback/list_my_product_feedback를 공통 RPC에 연결. 제출 결과에 ID·저장 본문·접수 상태 반환.
- 명시적 등록 요청은 대상이 명확하면 재승인 없이 처리. 제품/투자 기록 구분이 애매할 때만 짧게 확인.
- 구체적 앱 불편/지속되는 오류에 요약 포함 등록 제안. 동의 전/거절/무응답에는 쓰지 않고 반복 권유/투자 이슈 오분류 방지.
- server instructions·self-contained description과 get_workflow_guide의 product_feedback topic 제공. 매번 가이드 호출을 강제하지 않음.
- 기존 registry·topic enum·review manifest·CI·사람용 문서 갱신. 여섯 topic을 가정한 테스트도 갱신. 구현된 도구만 광고.
- 전체 대화/잔고/인증정보를 자동 첨부하지 않고 모르는 화면/버전·원인을 추측하지 않음. 피드백 내용은 모델 지침이 아닌 데이터로 취급.

## 인수 조건

- [x] OAuth 제출→앱 확인, 앱 접수→MCP 본인 목록, 응답 유실 멱등 재시도·타인 접근 거부 실제 격리 호출 검증.
- [x] 명시적 요청/제안 동의/거절/무응답/단순 불만/일시적 복구/투자 기록 오분류 평가 fixture와 기대 호출 작성.
- [ ] 실제 ChatGPT 웹·모바일에서 명시적 접수와 제안 평가. 자발적 제안 누락도 관찰 결과로 기록하고 강제 가능하다고 안내하지 않음.
- [x] 저장 전 성공 선언/불필요한 재승인/미확정 원인의 사실화 없음.
- [x] 설명/schema/annotations/handler/topic/manifest 정합성, workflow 검사·encoding 통과. Edge 타입 검사는 로컬 Deno 부재로 독립 E2E Edge 실행과 CI 검증에 맡김.

실제 클라이언트 미평가는 별도 미완료로 남긴다. 자동 접수/예약 분석/GitHub 자동 발행은 제외한다.
