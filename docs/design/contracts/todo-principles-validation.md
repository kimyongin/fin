# ToDo・원칙 통합 검증 기준

> 번들 관련 기준은 ADR-0006/#75~#79로 대체됐다. 아래는 이전 로컬 검증 증거이며 현재 목표 기능의 완료 증거가 아니다. 메모/운영 규칙 검증은 계속 재사용한다.

2026-09-22 기준. 이 문서는 #69~#74의 사용자 시나리오가 어느 자동 검증과 운영 확인으로 증명되는지 연결한다. 자동 테스트, 운영 배포, 실제 ChatGPT 사람 평가는 서로 대체하지 않는다.

| 시나리오 | 핵심 보장 | 자동 검증 |
| --- | --- | --- |
| T01 메모 수정 | 계좌・종목・보유 메모만 바뀌고 잔고・원가・검증 상태는 유지된다. 소유권, 예상 이전값, 멱등 재시도를 검사한다. | `entity_note_test.sql`, OAuth MCP contract |
| T02 확인 메모 | 확인 메모와 출처를 저장・재조회하며, 지정하지 않은 필드나 잔고를 바꾸지 않는다. | `entity_note_test.sql`, `reconciliation_verification_test.sql`, OAuth MCP contract |
| T03 운영 규칙 | 규칙의 현재값・이력・보관・충돌을 소유자 범위에서 관리하고 대조 가이드가 규칙을 먼저 읽는다. | `operating_rule_test.sql`, MCP guide unit/contract, Playwright rule lifecycle |
| T04 세션 결과 묶음 | 여러 완료 결과를 한 번의 원자적 저장으로 묶고 일부 실패 시 전체 rollback한다. 금융 성공 뒤 묶음 재시도가 금융 작업을 반복하지 않는다. | `todo_bundle_test.sql`, MCP guide unit/contract, Playwright bundle creation |
| T05 기존 과제 연결 | research/execution task는 원본 상태를 유지하며 묶음이 이를 복제하거나 전이하지 않는다. 재개・취소・체결 취소는 동적으로 반영된다. | `todo_bundle_test.sql`, 기존 task transition/trade reversal tests |
| T06 통합 탐색 | ToDo에서 할 일・판단・활동을 모아 보되 과거 URL과 API는 유지하고, 오늘 context에는 묶음과 미소속 과제가 중복 없이 포함된다. | `todo_bundle_test.sql`, MCP contract, Playwright navigation/today/shared regressions |

## 최종 로컬 증거

- `npm run test:e2e`: pgTAP 23 files / 381 tests, OAuth MCP contract, Playwright 32 tests 통과.
- `npm test`: Vitest 22 files / 141 tests 통과.
- `npm run build`, `npm run check:edge`, `npm run check:workflow-guides`, `npm run check:encoding` 통과 여부를 릴리스 티켓에 기록한다.
- 기존 자산 4보기, 계산・보정, 공유, 피드백 회귀는 전체 E2E에 포함한다.

## 운영에서만 확인할 수 있는 항목

1. DB migration을 순서대로 적용하고 Edge Function을 배포한 뒤 인증된 원격 readiness를 실행한다.
2. ChatGPT 액션을 새로 고친 새 웹 세션에서 T03 규칙 재사용과 T04 여러 결과 한 묶음 저장을 수행한다.
3. 같은 연결을 사용하는 모바일 세션에서 조회・이어가기와 금지 효과 0건을 확인한다.
4. 앱 공개 후 본인・친구 계정으로 권한과 기존 자산 화면 회귀를 확인한다.

위 항목은 실제 결과와 링크가 없으면 통과로 표시하지 않는다. 운영 데이터에는 테스트용 매매・보정・규칙을 임의로 만들지 않는다.
