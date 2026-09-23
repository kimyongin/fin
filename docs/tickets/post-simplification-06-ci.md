# [후속 정리] PR·배포의 공통 검증 기준 일치

우선순위: P2 · 상태: 로컬 구현·검증 완료, 원격 CI 관찰 전 · 2026-09-23
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

- [x] PR workflow에 `npm test`와 `npm run check:edge`를 명시해 해당 단계의 실패가 검증 job을 중단하도록 했다. 의도적 결함을 넣은 원격 PR 실험은 아직 하지 않았다.
- [x] PR 경로에 guide, build/encoding, 격리 DB/MCP/Chromium E2E를 포함했다. 정상 코드의 로컬 검증 결과는 아래에 기록했다.
- [x] PR에서는 운영 secret/readiness를 읽지 않으며, 배포 workflow의 인증된 원격 호환성 검사와 배포 의존성은 유지했다.
- [x] PR은 한 job에서 각 테스트를 한 번만, master 배포는 기존 verify job에서 한 번만 실행한다. PR workflow는 master push에서 별도로 실행하지 않는다.

## 구현·검증 기록

- GitHub workflow YAML을 작은 변경으로 맞췄다. PR의 순서는 unit → guide → Edge type → build/encoding → 격리 E2E다. Deno 2 설치도 명시했다.
- 로컬: `npm test` 20 파일/96 테스트, `npm run check:workflow-guides` 9개 topic, `npm run build` 성공. 로컬 PATH에 Deno가 없어 `npm run check:edge` 대신 `npm exec --yes --package=deno@2 -- deno check ...`로 5개 entrypoint를 검사해 통과했다. CI에는 Deno 설치 단계가 있다.
- `npm run test:e2e`: 격리 DB 검사·OAuth/토큰 MCP 계약·Chromium 37개 모두 통과(약 2분). 테스트 실행기가 초기화한 대상은 `.e2e` 인스턴스뿐이다.
- 원격 CI가 실제 PR에서 녹색인지와 고의 단위/타입 오류를 주입한 검출 실험은 아직 확인하지 않았다. 운영 readiness·배포도 수행하지 않았다.

## 진행 규칙

- docs/START-HERE.md, ADR-0008, SIMPLICITY.md와 해당 기능의 최신 구현을 먼저 확인한다.
- 최소 변경으로 수직 구현·검증한다. 새 테이블/이력/범용 프레임워크를 기본 해법으로 삼지 않는다.
- 관련 코드·계약·MCP 설명/가이드 영향과 실제 검사 결과를 함께 기록한다. DB 변경 시 schema/OVERVIEW.md를 갱신한다.
- 사용자 로컬 설정을 보존한다. 로컬 완료와 운영 배포/실제 ChatGPT 검증을 구분한다.
