# [MCP 개선] 브리핑·보정 입력과 결과 계약 명시

우선순위: P1 · 상태: 구현·자동 검증·운영 배포 완료 · 작성: 2026-09-21
상위: #40 · 시나리오/연관: S05~S09/S18~S22 · W01/W06
선행/통합: 없음

## 목적

ChatGPT가 추측 없이 Portfolio 도구를 선택·사용·복구하고, 운영자가 계약 변경을 안전하게 유지할 수 있게 한다. ChatGPT는 조사·해석·설명, Portfolio는 기억·계산·검증을 담당한다.

## 검토 근거

- portfolio-tools.ts의 changes/uncertainties는 임의 객체를 허용하지만 DailyReviewPage.summaryText는 summary/title/body만 표시한다.
- 보정 values의 공개 스키마는 실제 decimal string 요구를 설명하지 않으며 대부분의 출력은 data: {}다.

## 작업 범위

- 브리핑 항목과 보정 값의 필드·숫자 문자열·null/생략 의미 및 유효/무효 예제를 확정한다.
- context ID/만료/범위, 저장 ID, version, preview 영향 등 다음 호출에 필요한 결과 DTO를 명시한다.
- 공개 스키마와 입력 검증의 불일치를 줄인다. 서버 소유권·도메인 검증을 클라이언트 검증으로 대체하지 않는다.
- 기존 저장 데이터/호출 호환을 먼저 조사한다. 기존 항목은 읽기 호환 adapter로 보존하고 무조건적인 재작성이나 버전 증가는 피한다.

## 인수 조건

- [x] schema-valid 브리핑이 실제 MCP 저장→재조회→웹 표시에서 빈 항목 없이 표시된다.
- [x] 자산 유형별 보정의 정상/0/음수/숫자 타입/알 수 없는 필드/누락 입력을 검증한다.
- [x] 대표 실제 응답이 output schema를 만족하고 기존 저장 데이터도 표시된다.
- [x] 출력 형식만 맞는 것이 아니라 소유권·참조·원자성 DB 테스트도 유지한다.

## 구현 결과

- 브리핑 항목을 문자열 또는 summary/title/body가 있는 객체로 제한하고 저장 시 summary 형태로 정규화했다. 기존 임의 객체는 웹에서 첫 문자열 값 또는 이전 형식 안내로 표시한다.
- 일일 context/브리핑과 보정 preview/commit의 다음 호출 필드를 output schema에 명시했다. 보정 값은 자산 유형별 decimal string 조합을 공개했다.
- OAuth MCP context→브리핑 저장→상세 재조회와 웹 표시 회귀를 같은 격리 환경에서 검증했다.

## 진행 규칙

- docs/START-HERE.md, 관련 계약과 ADR-0004를 읽고 기존 구현을 먼저 확인한다. 과거 티켓의 구현을 재작성하지 말고 위 후속 차이만 처리한다.
- 최소 공통 기반 + 수직 슬라이스로 구현·검증한다. 기존 migration을 고치지 말고 필요한 증분 migration과 schema/OVERVIEW.md를 갱신한다.
- 실제 실행한 검증과 미검증 항목을 구분하고 npm run check:encoding을 수행한다. 운영 배포·push·실사용 검증을 자동 완료 처리하지 않는다.
