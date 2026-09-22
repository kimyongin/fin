# [ToDo·원칙] ToDo 묶음과 세부 작업의 일괄 기록

GitHub: https://github.com/kimyongin/fin/issues/71

상태: 설계 완료・구현 전 · 2026-09-22
선행: 02 (규칙 참조 계약) (동일 todo-principles 시리즈)

## 기준과 기존 구현
공통 설계: https://github.com/kimyongin/fin/blob/master/docs/design/todo-principles-integration.md
ADR: https://github.com/kimyongin/fin/blob/master/docs/adr/0005-todo-bundles-and-operating-rules.md
실제 변경 대상: src/features/lifecycle/{LifecyclePage.jsx,data.js}, migration 002/004/013/019, supabase/functions/_shared/mcp/portfolio-tools.ts
기존 원본을 재사용하고 아래 차이만 구현한다. 명칭은 공통 계약을 따르고 새 RPC는 구현 전 정확한 SQL signature・입출력・오류・권한을 설계 문서에 확정한다.

## 범위
todo_bundles/items와 필요한 관계를 추가하고 list/get/save RPC・OAuth 도구와 최소 묶음 생성/상세 앱 흐름을 수직 구현한다. 일반 항목과 기존 research/execution 연결을 구분하고 상태를 서버에서 도출한다. 배열 upsert/명시적 제거/순서/CAS/멱등 원자 저장, 규칙 적용 snapshot, 판단/확인 결과 연결을 구현한다.

## 인수 조건
- [ ] T04/T05: 한 번에 완료 항목 4개→목록 한 묶음, 부분 수정/누락 유지/타인 FK 거부/배열 일부 실패 전체 rollback, 기존 task 상태 반영/재개/체결 취소/빈 묶음/혼합 취소를 검증한다. 금융 성공 후 묶음 실패는 금융 재실행 없이 복구한다.
- [ ] DB→RPC/OAuth→앱의 해당 사용자 시나리오를 연결하고 실제 검증 결과를 기록한다.
- [ ] 문서/도구 설명/가이드 변경 영향, 증분 migration 및 schema/OVERVIEW.md(해당 시)를 갱신한다.
- [ ] npm run check:encoding 및 변경 위험에 맞는 검증을 통과하고 미검증 범위를 기록한다.

## 제외・진행 규칙
기존 domain 이관과 세션 자동 감지, 모든 변경의 자동 완료 항목 생성은 제외한다.
최소 기반+수직 슬라이스로 진행하고 완료 슬라이스 단위로 커밋한다. 개인 로컬 설정을 섞지 않는다. 기존 금융 검증・공개 범위・미완료 평가를 유지한다.
