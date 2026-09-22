# [ToDo·원칙] 오늘·ChatGPT 작업 흐름의 묶음 연결과 가이드 최신화

GitHub: https://github.com/kimyongin/fin/issues/73

> 2026-09-22: 후속 작업은 #75~#79로 대체됨(설계 변경). 아래 로컬 구현/검증 사실은 보존한다. 번들 모델을 새 운영 목표로 배포하지 않는다. 남은 전환/운영 배포/실제 ChatGPT 평가는 #79로 이관하며 완료로 간주하지 않는다. 메모/운영 규칙 #69/#70은 유지한다.

상태: 구현 및 로컬 검증 완료 · 2026-09-22
선행: 02/03/04 (동일 todo-principles 시리즈)

## 기준과 기존 구현
공통 설계: https://github.com/kimyongin/fin/blob/master/docs/design/todo-principles-integration.md
ADR: https://github.com/kimyongin/fin/blob/master/docs/adr/0005-todo-bundles-and-operating-rules.md
실제 변경 대상: src/features/review/{DailyReviewPage.jsx,data.js}, daily context 관련 RPC, supabase/functions/_shared/mcp/{portfolio-tools,workflow-guides}.ts, docs/design/contracts/agent
기존 원본을 재사용하고 아래 차이만 구현한다. 명칭은 공통 계약을 따르고 새 RPC는 구현 전 정확한 SQL signature・입출력・오류・권한을 설계 문서에 확정한다.

## 범위
오늘과 daily context에 묶음 요약/미소속 과제를 중복 없이 노출한다. MCP 도구 설명과 가이드에 작업 분류・규칙 조회・명시적 결과 저장・기존 묶음 재개・후속 분리・부분 실패 복구를 반영한다. 구현 도구만 registry/topic/manifest에 연결하고 도구 광고와 배포 순서를 문서화한다.

## 인수 조건
- [x] T03~T06: 완료 Do≠판단 채택/잔고 검증/실제 체결, 조회만이면 쓰기 없음, 규칙 기억 요청만이면 불필요한 Do 생성 없음, 연결 미소속 과제 누락 없음, 오래된 task API 호출 호환과 guide digest 검증.
- [x] DB→RPC/OAuth→앱의 해당 사용자 시나리오를 연결하고 실제 검증 결과를 기록한다.
- [x] 문서/도구 설명/가이드 변경 영향, 증분 migration 및 schema/OVERVIEW.md(해당 시)를 갱신한다.
- [x] npm run check:encoding 및 변경 위험에 맞는 검증을 통과하고 미검증 범위를 기록한다.

## 구현・검증 결과
- daily context에 진행 중 ToDo 묶음 요약과 묶음에 속하지 않은 기존 과제를 추가했다. 앱의 오늘 화면에서도 브리핑 연결 과제와 중복되지 않게 이어갈 일을 노출한다.
- daily/reconciliation/todo workflow guide에 읽기와 쓰기 구분, 기존 묶음 재개, 원자적 저장, 부분 실패 복구와 규칙만 저장할 때 불필요한 ToDo를 만들지 않는 조건을 반영했다.
- OAuth MCP 서버 지침, 도구 설명, guide review manifest, agent contract 검증을 함께 갱신했다.
- 2026-09-22 로컬 검증: pgTAP 23 files / 381 tests, MCP contract, Playwright 32 tests, Vitest 22 files / 141 tests, encoding check 통과.
- 실제 새 ChatGPT 웹・모바일 세션의 사람 평가와 운영 배포는 #74에서 명시적으로 분리한다.

## 제외・진행 규칙
모델 호출만으로 실제 ChatGPT 평가 완료라고 처리하지 않는다. 과거 63~65 검증은 이어서 재사용한다.
최소 기반+수직 슬라이스로 진행하고 완료 슬라이스 단위로 커밋한다. 개인 로컬 설정을 섞지 않는다. 기존 금융 검증・공개 범위・미완료 평가를 유지한다.
