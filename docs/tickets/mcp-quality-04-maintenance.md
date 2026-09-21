# [MCP 개선] 업무별 모듈 분리와 설명 원본 일원화

우선순위: P2 · 상태: 최소 구조 정리·운영 배포 완료 · 작성: 2026-09-21
상위: #40 · 시나리오/연관: W01~W08 · ADR-0004 · #33/#53 후속
선행/통합: 01~03의 변경을 작은 단위로 따라가며 적용

## 목적

ChatGPT가 추측 없이 Portfolio 도구를 선택·사용·복구하고, 운영자가 계약 변경을 안전하게 유지할 수 있게 한다. ChatGPT는 조사·해석·설명, Portfolio는 기억·계산·검증을 담당한다.

## 검토 근거

- OAuth index.ts에 검증·변환·RPC 연결·프로토콜 처리가 모여 있다.
- workflows.md에는 미등록 get_research_history와 미지원 batch 흐름이 섞여 있고 runtime resource는 과거 개별 조회 흐름을 안내한다.
- 도구 설명 초안과 코드의 수동 이중 관리가 남아 있다.

## 작업 범위

- 일일 점검/판단·할 일/원칙·보유 이유/매매·보정의 실제 소비 단위로 계약과 handler를 분리한다.
- 공유 범위는 검증·응답·오류·추적 helper로 제한한다. 도메인 테이블/목적별 RPC/DB transaction을 유지한다.
- 실행 가능한 도구 정의는 코드 한 곳에서 관리하고 참고 목록은 생성 또는 직접 링크로 대체한다. 시나리오의 이유·의도는 문서에 유지한다.
- 계획 기능은 현재 workflow에서 분리하고 optional prompt/resource도 현재 기능으로 맞춘다. prompt/resource 노출을 필수 전제로 삼지 않는다.
- 정의/handler/문서 참조의 일치 검사와 변경 체크리스트를 연결한다. legacy agent-token endpoint는 별도 호환 경계를 보존한다.

## 인수 조건

- [x] 이름·입출력·annotations·인증의 characterization tests를 통과한 상태에서 최소 공통 registry를 분리한다.
- [x] 현재 workflow에 미등록 도구나 미지원 원자 저장을 실행 가능한 기능으로 안내하지 않는다.
- [x] 정의 변경 시 참조 문서·schema·fixture 불일치를 자동 검사하거나 명확한 리뷰 절차로 탐지한다.
- [x] 범용 CRUD/DI/명령 엔진, 불필요한 버전·패키지·전용 가이드 도구를 추가하지 않는다.

## 구현 결과

- 공통 registry가 정의·handler 이름과 업무 그룹의 중복/미등록을 시작 시 검사한다. 실제 소비가 없는 범용 command/DI 계층은 만들지 않았다.
- 실행 계약의 원본을 portfolio-tools.ts로 명시하고 workflow의 미등록 get_research_history와 미지원 briefing batch 안내를 제거했다.
- prompt/resource의 일일 점검 시작 경로를 get_daily_context 한 번으로 맞췄다. legacy token endpoint는 변경하지 않았다.
- handler 전면 파일 분할은 하지 않았다. 현재 OAuth 소비자 하나에서는 파일 이동보다 registry/계약 검사가 작은 해법이며, 두 번째 실제 소비가 생길 때 목적별 handler 추출을 검토한다.

## 진행 규칙

- docs/START-HERE.md, 관련 계약과 ADR-0004를 읽고 기존 구현을 먼저 확인한다. 과거 티켓의 구현을 재작성하지 말고 위 후속 차이만 처리한다.
- 최소 공통 기반 + 수직 슬라이스로 구현·검증한다. 기존 migration을 고치지 말고 필요한 증분 migration과 schema/OVERVIEW.md를 갱신한다.
- 실제 실행한 검증과 미검증 항목을 구분하고 npm run check:encoding을 수행한다. 운영 배포·push·실사용 검증을 자동 완료 처리하지 않는다.
