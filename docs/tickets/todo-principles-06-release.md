# [ToDo·원칙] 통합 시나리오·공유 회귀와 배포 검증

GitHub: https://github.com/kimyongin/fin/issues/74

> 2026-09-22: 후속 작업은 #75~#79로 대체됨(설계 변경). 아래 로컬 구현/검증 사실은 보존한다. 번들 모델을 새 운영 목표로 배포하지 않는다. 남은 전환/운영 배포/실제 ChatGPT 평가는 #79로 이관하며 완료로 간주하지 않는다. 메모/운영 규칙 #69/#70은 유지한다.

상태: 로컬 통합 검증 완료・Edge type/운영 배포/사람 평가 대기 · 2026-09-22
선행: 01~05 (동일 todo-principles 시리즈)

## 기준과 기존 구현
공통 설계: https://github.com/kimyongin/fin/blob/master/docs/design/todo-principles-integration.md
ADR: https://github.com/kimyongin/fin/blob/master/docs/adr/0005-todo-bundles-and-operating-rules.md
실제 변경 대상: 기존 pgTAP/Vitest/Playwright/OAuth contract smoke, docs/engineering/deployment.md, docs/design/contracts/agent/evaluation.md
기존 원본을 재사용하고 아래 차이만 구현한다. 명칭은 공통 계약을 따르고 새 RPC는 구현 전 정확한 SQL signature・입출력・오류・권한을 설계 문서에 확정한다.

## 범위
T01~T06 fixture를 각 slice부터 작성하여 마지막 통합 검증에 재사용한다. 증분 migration→Edge→readiness→앱의 배포 순서/기존 client 호환/복구 계획을 정리한다. 기존 자산 4보기・계산・보정・공유・피드백 기능을 회귀 검증한다.

## 인수 조건
- [ ] 실제 새 웹/모바일 세션에서 규칙 재사용과 여러 작업 한 묶음 저장을 확인하거나 미검증으로 명시한다. 자동 결과/배포 결과/사람 평가를 구분한다. 배포는 명시적 요청 시 실행하며 미실행을 완료 체크하지 않는다.
- [x] DB→RPC/OAuth→앱의 해당 사용자 시나리오를 연결하고 실제 검증 결과를 기록한다.
- [x] 문서/도구 설명/가이드 변경 영향, 증분 migration 및 schema/OVERVIEW.md(해당 시)를 갱신한다.
- [x] npm run check:encoding 및 변경 위험에 맞는 검증을 통과하고 미검증 범위를 기록한다.

## 로컬 릴리스 결과

- T01~T06의 DB・RPC/OAuth・앱 근거를 `docs/design/contracts/todo-principles-validation.md`에 연결했다.
- 배포 Runbook에 다섯 증분 migration → Edge → readiness → 앱 → 실제 ChatGPT 평가 순서와 전진 복구 원칙을 추가했다.
- agent evaluation에 E21 운영 규칙 재사용, E22 여러 결과 한 묶음, E23 규칙만 기억, E24 읽기만 수행 사례를 추가했다.
- 2026-09-22: pgTAP 23 files / 381 tests, 실제 로컬 Edge 런타임을 사용하는 OAuth MCP contract, Playwright 32 tests, Vitest 22 files / 141 tests, build, workflow guide check, encoding check를 통과했다.
- standalone `npm run check:edge`는 로컬에 `deno` 실행 파일이 없어 실행하지 못했다. 운영 DB/Edge/앱 배포, 원격 readiness, 새 ChatGPT 웹・모바일 사람 평가도 실행하지 않았다. 따라서 첫 번째 인수 조건과 GitHub 이슈는 열린 상태로 유지한다.

## 제외・진행 규칙
운영 데이터에 테스트용 매매/보정/규칙을 임의 저장하지 않는다.
최소 기반+수직 슬라이스로 진행하고 완료 슬라이스 단위로 커밋한다. 개인 로컬 설정을 섞지 않는다. 기존 금융 검증・공개 범위・미완료 평가를 유지한다.
