# [행동 통합] 번들 전환·MCP 가이드 정리와 릴리스 검증
상태: 기획 확정・구현 전 · 2026-09-22
GitHub: https://github.com/kimyongin/fin/issues/79
선행: 01~04 (action-timeline 시리즈)
기준: [공통 설계](../design/tasks-and-events.md), [ADR-0006](../adr/0006-tasks-and-action-events.md).
기존 대상: todo_bundles/items 관련 코드/증분 migrations, MCP registry/guides/manifest, 배포 runbook.

## 목적과 범위
A01~A06. 기존 번들 데이터와 클라이언트 호환을 보존하며 통합 행동 모델로 전환하고 실제 검증을 기록한다.

## 인수 조건
- [ ] 운영/로컬 배포 및 데이터 존재 재확인
- [ ] 기존 migration 보존
- [ ] open/done/paused/cancelled 항목과 task 연결·결과·태그·규칙 snapshot·판단/확인 관계 대응표
- [ ] 완료 일반 항목을 자동 검증 금융 사실로 승격 금지
- [ ] 제목/날짜 추정 병합 금지
- [ ] 전환 재시도/행수/관계 대조
- [ ] 새 API 광고 시점과 구 API 종료 계획
- [ ] guide 설명에서 별도 결과 저장 제거/자동 이벤트 책임 명시
- [ ] DB→Edge→readiness→앱 순서와 복구
- [ ] 자동 검증/운영 배포/실제 ChatGPT 평가 분리
- [ ] 정확한 API signature/오류/권한/날짜 의미와 필요한 최소 모델 계약을 구현 전에 설계 문서에 기록한다.
- [ ] 실제 DB→RPC/OAuth→앱 시나리오 검증과 미검증 범위를 기록한다. 문서/가이드 변경 영향과 encoding check를 포함한다.

## 진행 기준
최소 기반+수직 슬라이스로 구현하며 기존 금융/판단/메모/운영 규칙을 재사용한다. 신규 범용 CRUD나 이벤트 소싱 엔진을 만들지 않는다. 개인 로컬 설정은 보존한다. 운영 배포는 별도 요청 시 진행하며 실제 ChatGPT 사람 평가를 자동 테스트로 대체하지 않는다.
