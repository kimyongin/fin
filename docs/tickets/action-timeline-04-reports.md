# [행동 통합] 기간 활동 조회와 일간·주간·월간 리포트
상태: 구현 완료・운영 미배포 · 2026-09-22
GitHub: https://github.com/kimyongin/fin/issues/78
선행: 03 (action-timeline 시리즈)
기준: [공통 설계](../design/tasks-and-events.md), [ADR-0006](../adr/0006-tasks-and-action-events.md).
기존 대상: daily context/기존 daily_reports 및 daily_briefings 조사, MCP guides와 도구, 리포트 UI.

## 목적과 범위
A06. 원본 기간 활동과 관련 판단/태스크를 ChatGPT가 읽고 요청 시 기간 리포트를 저장/조회한다.

## 인수 조건
- [x] #77의 혼합 행동 목록을 실제 브라우저 시나리오에서 확인한 뒤 리포트를 연결한다. 사람 대상 장기 사용성 평가는 운영 배포 뒤 별도로 남긴다.
- [x] UI에서 접은 이벤트도 허용된 기간 원본 조회에는 포함한다. 동일 행동의 태스크/이벤트를 중복 집계하지 않고 값 수정·실제 체결·태스크 완료를 구분한다.
- [ ] 변경 이유는 명시된 메모/판단 근거가 있을 때만 설명한다. 자동 로그만으로 투자 의도를 추정하지 않는다.
- [x] 기존 리포트 저장 구조와 실제 소비 경로를 확인한 후 재사용 범위 확정
- [x] 기간/시간대/원본 ID/집계 기준 계약
- [x] 원본 페이지 누락 없이 수집
- [x] 주간·월간은 일간 요약에만 의존하지 않기
- [x] 후일 재개로 과거 완료를 삭제하지 않기
- [x] 과거 미완료 계산 불가 범위 명시
- [x] 정정 후 리포트 재생성
- [x] 조회만이면 리포트 저장 없음
- [x] 자동 LLM/스케줄 호출 없음
- [x] 정확한 API signature/오류/권한/날짜 의미와 필요한 최소 모델 계약을 구현 전에 설계 문서에 기록한다.
- [x] 실제 DB→RPC/OAuth→앱 시나리오 검증과 미검증 범위를 기록한다. 문서/가이드 변경 영향과 encoding check를 포함한다.

## 구현 계약과 결과
- 원격 legacy `daily_reports`는 시장 분석 파일의 역사 자료이고 로컬 소비 경로가 없어 재사용하지 않았다. 활동 회고는 `activity_reports`와 immutable `activity_report_revisions`로 목적을 분리했다.
- `app_get_activity_report_context(start,end,timezone,limit,cursor)`는 성공 이벤트 원본을 `(occurred_at,id)`로 끝까지 페이지한다. 주간・월간도 일간 요약이 아닌 원본을 읽는다. 현재 미완료 과제는 `current_at_request_not_historical_period_end`라고 명시한다.
- `app_save_activity_report`는 기간 종류/날짜, 모든 소유 원본 ID, 기대 버전과 멱등 키를 검증한다. 저장 자체는 `activity_events`에 추가하지 않는다. 같은 기간에 포함되지 않은 새 이벤트가 생기면 `needs_regeneration=true`다.
- MCP에 `activity_report` 가이드와 context/list/save 도구를 추가했다. 앱 행동 화면은 저장된 리포트와 재생성 필요 상태를 표시한다. 자동 생성・스케줄・앱 내 LLM 호출은 없다.
- #79 최종 전환과 함께 DB 450건, Vitest 102건, Playwright 33건 및 MCP 계약 검사를 통과했다. 운영 배포와 실제 ChatGPT 웹・모바일 평가는 미실행이다.

## 진행 기준
최소 기반+수직 슬라이스로 구현하며 기존 금융/판단/메모/운영 규칙을 재사용한다. 신규 범용 CRUD나 이벤트 소싱 엔진을 만들지 않는다. 개인 로컬 설정은 보존한다. 운영 배포는 별도 요청 시 진행하며 실제 ChatGPT 사람 평가를 자동 테스트로 대체하지 않는다.
