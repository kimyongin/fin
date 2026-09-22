# [행동 통합] 번들 전환·MCP 가이드 정리와 릴리스 검증
상태: 로컬 구현・자동 검증 완료, 운영 미배포 · 2026-09-22
GitHub: https://github.com/kimyongin/fin/issues/79
선행: 01~04 (action-timeline 시리즈)
기준: [공통 설계](../design/tasks-and-events.md), [ADR-0006](../adr/0006-tasks-and-action-events.md).
기존 대상: todo_bundles/items 관련 코드/증분 migrations, MCP registry/guides/manifest, 배포 runbook.

## 목적과 범위
A01~A06. 기존 번들 데이터와 클라이언트 호환을 보존하며 통합 행동 모델로 전환하고 실제 검증을 기록한다.

## 인수 조건
- [ ] 운영 배포 및 운영 데이터 존재 재확인
- [x] 로컬 migration 적용 및 데이터 계약 재확인
- [x] 기존 migration 보존
- [x] open/done/paused/cancelled 항목과 task 연결·결과·태그·규칙 snapshot·판단/확인 관계 대응표
- [x] 완료 일반 항목을 자동 검증 금융 사실로 승격 금지
- [x] 제목/날짜 추정 병합 금지
- [x] 전환 행수/관계의 정확히 한 대상 제약과 조회 대응표
- [x] 새 API 광고 시점과 구 API 종료 계획
- [x] guide 설명에서 별도 결과 저장 제거/자동 이벤트 책임 명시
- [x] DB→Edge→readiness→앱 순서와 복구
- [x] 자동 검증/운영 배포/실제 ChatGPT 평가 분리
- [x] 정확한 API signature/오류/권한/날짜 의미와 필요한 최소 모델 계약을 구현 전에 설계 문서에 기록한다.
- [x] 실제 DB→RPC/OAuth→앱 시나리오 검증과 미검증 범위를 기록한다. 문서/가이드 변경 영향과 encoding check를 포함한다.

## 구현 결과와 운영 게이트
- `20260922083000_retire_todo_bundles.sql`은 기존 item마다 원본 task, 이관 general task, 또는 reported non-financial event 중 정확히 하나를 연결한다. 태그・결과・수행시각・규칙 snapshot・판단/확인 관계는 대응표 metadata에 보존한다.
- 앱과 MCP 광고에서는 bundle 기능을 제거했다. 구 테이블/migration과 읽기 API는 한 릴리스의 감사・롤백 호환을 위해 유지하되 신규 클라이언트는 쓰지 않는다. 다음 운영 릴리스에서 실제 호출 로그를 확인한 뒤 구 write 권한 제거 티켓을 만든다.
- 오늘 컨텍스트와 앱은 unified task/event projection만 사용한다. 구 `todo_bundles` projection은 `retired`를 명시해 조용한 이중 표시를 막는다.
- 로컬에서 DB 450건, Vitest 102건, Playwright 33건과 MCP 계약 검사가 통과했다. 운영 migration 적용, readiness, 실제 ChatGPT 웹・모바일 평가는 배포 요청 전까지 완료로 표시하지 않는다.

## 후속 범위

2026-09-23 후속: 활동 결과 통합의 문맥/가이드는 #84, 기존 판단/활동 데이터 전환과 릴리스 대조는 #85에서 수행한다. 이 티켓의 번들 전환 이력과 미검증 항목은 보존한다.

## 진행 기준
최소 기반+수직 슬라이스로 구현하며 기존 금융/판단/메모/운영 규칙을 재사용한다. 신규 범용 CRUD나 이벤트 소싱 엔진을 만들지 않는다. 개인 로컬 설정은 보존한다. 운영 배포는 별도 요청 시 진행하며 실제 ChatGPT 사람 평가를 자동 테스트로 대체하지 않는다.
