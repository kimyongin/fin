# [후속 정리] PR·배포의 공통 검증 기준 일치

우선순위: P2 · 상태: 티켓 작성, 구현 전 · 2026-09-23
관련: #51, #58, #91 · 기준 코드: 8cb943f

## 문제와 근거

.github/workflows/deploy.yml은 unit/guide/Edge type/E2E를 실행하지만 e2e.yml의 PR 경로에는 unit과 Edge type 검사가 없다. 같은 코드의 검사 수준이 실행 시점에 따라 다르다.

## 범위

- PR과 배포 전 검사에 encoding/unit/guide/Edge type/격리 E2E/build가 포함되는지 실제 실행 경로를 대조하고 중복 실행 없이 맞춘다.
- package script 또는 작은 reusable workflow 중 현재 두 소비자에 맞는 최소 방법을 선택한다. 새 CI 플랫폼이나 범용 파이프라인 생성기는 추가하지 않는다.
- Deno/Node/Supabase 설치 요구와 개발 문서의 실행 명령을 일치시킨다.
- 운영 인증 readiness와 배포는 별도 게이트로 유지한다. fork PR에 운영 secret을 요구하거나 PR 테스트에서 운영 데이터를 변경하지 않는다.
- .e2e만 초기화하는 기존 안전 경계를 유지한다.

## 완료 조건

- [ ] PR 경로에서 의도적 unit/Edge 타입 오류가 검출됨을 확인한다.
- [ ] 정상 commit의 공통 검사·빌드·격리 DB/MCP/브라우저 검증 결과를 기록한다.
- [ ] 운영 readiness가 없는 PR도 공통 검증을 실행하고 배포 게이트는 계속 작동한다.
- [ ] 동일 테스트가 중복 실행되지 않는지 확인하고 로컬 명령·실행 시간·CI 확인 여부를 남긴다.

## 진행 규칙

- docs/START-HERE.md, ADR-0008, SIMPLICITY.md와 해당 기능의 최신 구현을 먼저 확인한다.
- 최소 변경으로 수직 구현·검증한다. 새 테이블/이력/범용 프레임워크를 기본 해법으로 삼지 않는다.
- 관련 코드·계약·MCP 설명/가이드 영향과 실제 검사 결과를 함께 기록한다. DB 변경 시 schema/OVERVIEW.md를 갱신한다.
- 사용자 로컬 설정을 보존한다. 로컬 완료와 운영 배포/실제 ChatGPT 검증을 구분한다.

