# [운영 개선] 공통 모달과 MCP 오류 복구·진단 정비

우선순위: P2 · 규모: 소~중 · 상태: 로컬 구현·검증 완료
상위: #40 · 연관: #33/#37/#38/#47
금융 저장 시도 규약 확정 후 통합한다. 두 하위 슬라이스는 각각 검증·커밋한다.

## A. 공통 모달
근거: src/components/ModalShell.jsx에 dialog 의미, 초기 포커스/가두기/복귀, 배경 상호작용 차단, 저장 중 닫기 정책이 없다.

- 공통 모달에 접근성·포커스·배경 스크롤 및 상호작용 처리를 구현한다.
- 저장 중 닫기를 단순히 모든 화면에서 금지하지 않는다. 데이터 입력/쓰기 결과 확인이 필요한 화면에 명시적인 close 정책을 전달한다.
- 중첩 상세의 Escape 처리와 이전 상세/호출 버튼 포커스 복귀를 점검한다.
- 매매/보정 JSX는 입력·미리보기·저장 상태 단위로 읽기 쉽게 정리하되 의미 없는 파일 분할은 피한다.

### 인수 조건
- [x] 키보드 Tab/Shift+Tab이 모달 안에 머무르고 닫은 뒤 호출 위치로 복귀한다.
- [x] 모달에 이름과 dialog 의미가 있고 배경을 키보드로 조작할 수 없다.
- [x] 저장 중 Escape/닫기 정책이 금융 재시도 규약과 일치한다.
- [x] 중첩 상세와 360/390/768/1024/1440px에서 입력·안전 영역·스크롤이 유지된다.

## B. MCP 오류와 운영 진단
근거: portfolio-mcp-oauth/index.ts:374,396,789에서 DB 오류 정보를 문자열로 축소하고 문구로 분류한다. preview 만료/stale 등은 일반 operation_failed가 되어 복구 행동을 안내하기 어렵다.

- 실제 오류 분기에서 안정적인 코드와 재시도/재조회 의미를 정한다. SQL 오류의 code/details를 필요한 범위에서 보존한다.
- context 만료, preview 만료/stale/consumed, version conflict, 동일 키 충돌, 접근 불가, 내부 실패를 구분한다.
- 요청 식별자·도구 이름·코드·처리 시간을 구조화 로그로 남긴다. 토큰/개인 snapshot/원문 payload는 기록하지 않는다.
- 정의와 handler의 계약을 실제 호출로 검증한다. Vite build나 schema 목록 검사만으로 Edge 검증을 대신하지 않는다.

### 인수 조건
- [x] 각 오류 fixture가 명세된 코드와 복구 의미로 반환된다.
- [x] 예상 밖 오류는 내부 내용을 사용자에게 노출하지 않으면서 로그 식별자로 조사할 수 있다.
- [x] 로그에 인증정보·사용자 원문이 포함되지 않는다.
- [x] initialize/tools/list/tools/call 및 인증·입력·실패 계약의 재현 가능한 로컬 검사가 있다.

## 구현 결과

- `d5653c6`: ModalShell에 dialog/aria-modal, focus trap·복귀, 배경 inert, body scroll lock, 44px 닫기, 최상위 Escape와 `closeDisabled`를 구현했다.
- 360/390/768/1024/1440px의 모달 폭·가로 넘침과 Escape 후 호출 버튼 복귀를 실제 브라우저에서 확인했다.
- DB 오류의 code를 보존하는 안전한 오류 adapter와 만료/stale/consumed/version/idempotency/권한별 복구 계약, payload 없는 구조화 로그를 추가했다.
- 격리 E2E가 실제 OAuth MCP Edge Function의 무인증 거부, initialize, tools/list, 인증 tools/call, validation 오류와 request ID를 호출하고 테스트 사용자를 정리한다.

## 제외
대형 디자인 시스템, 범용 오류 엔진, 외부 모니터링 서비스 도입은 선행조건이 아니다.
