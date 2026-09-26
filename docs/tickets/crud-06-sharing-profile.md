# [CRUD 동등성] 프로필·공유 설정·친구 연결의 목적별 API 제공

2026-09-26 · [#156](https://github.com/kimyongin/fin/issues/156) · 운영 배포, 실사용 검증 전.

## 목적
개인 설정과 공유 관계도 웹과 OAuth에서 같은 범위로 관리한다. 모든 설정 테이블의 직접 CRUD는 제공하지 않는다.

## 현재 구현과 재사용
src/features/auth/accessActions.js / useSharingProfile.js의 set_viewer_profile, app_set_profile_avatar, add_friend/list_friends/remove_friend 및 viewer 조회 RPC를 재사용한다.

## 구현 계약
- 프로필 C는 최초 설정, R는 안전한 설정 조회, U는 이름/아이콘/공유 설정 변경, D는 목적별 초기화다. auth 사용자와 투자 데이터는 삭제하지 않는다.
- 공유 설정 초기화는 이름·공유 비밀번호 제거와 OFF를 원자 처리하고 기존 viewer 접근을 차단한다. 아이콘은 별도 기본값 초기화다. 세션/관계의 정리 방식은 기존 공유 권한 함수에 맞춰 검증한다.
- 친구 C=비밀번호 확인 연결, R=목록/유효 접근, U=같은 관계 재인증/갱신, D=내 연결 해제. U를 만들기 위해 별명 등 새 필드를 추가하지 않는다.
- OAuth에서 명시적 owner 선택에 따른 친구 포트폴리오 R도 웹과 일치시킨다. owner 선택을 쓰기 권한으로 해석하지 않는다. get_daily_context 등 owner-only 도구는 그대로 명시한다.
- 나를 보는 친구 목록/최근 열람 조회를 안전 DTO로 제공한다. 마지막 웹 열람 시각을 MCP 호출로 조용히 갱신하거나 임의 편집하지 않는다.
- 공유 ON/비밀번호 변경/초기화/친구 연결은 명시적 요청 후 실행한다. 기존 비밀번호/hash/token은 응답·로그·활동에 노출하지 않는다. 빈 비밀번호=유지와 초기화를 혼동하지 않는다.
- 관리자나 친구 자격 증명을 에이전트가 대리 추측하지 않도록 도구 설명/가이드에 명시한다.

## 수용 조건
- [x] 설정 생성·조회·변경·초기화와 연결 생성·조회·재인증·해제의 DB 계약. 로컬 OAuth/HTTP 교차 E2E 결과는 아래에 기록.
- [x] OFF/초기화 후 기존 접근 차단 및 직접 profile 쓰기/해시 읽기 차단. 만료·친구 해제는 기존 접근 계약을 유지.
- [x] 공유 범위 portfolio_all 고정 및 안전 DTO(비밀번호/hash 미반환).
- [x] 설정 UI와 OAuth가 같은 목적별 RPC를 사용. 새 권한 테이블 없음.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: DB·웹·OAuth·가이드 연결 및 자동 검증 후 `d1c8103`으로 운영 배포. 배포 근거는 `docs/engineering/deployment.md`의 2026-09-27 기록에 있다. 실제 본인·친구 로그인과 ChatGPT 웹·모바일 평가는 미수행.
- 구현: `20260926162000_safe_sharing_profile.sql`, `20260926162500_sharing_anonymous_guard.sql`. 웹의 공유 저장은 안전 DTO RPC로 변경하고 확인 단계가 있는 초기화 버튼을 추가했다. OAuth는 설정/아이콘/친구/선택한 친구 포트폴리오 전용 도구 9개를 광고한다.
- 검증: 로컬 pgtap 696개 통과, Vitest 114개 통과, Edge Deno check 및 Vite build 통과. 격리 OAuth/HTTP 계약은 설정 변경→반대쪽 조회, 친구 연결/재인증/해제, 초기화 후 접근 차단까지 통과했다. 전체 Chromium E2E 83개가 통과했고, 공유 초기화 화면은 360/390/768/1024/1440px에서 확인했다. 실제 모바일 기기와 운영 배포는 미검증이다.
- 의도적 경계: 기존 `add_friend`는 매 호출마다 비밀번호를 재검증하므로 동일 관계 U는 재인증으로 해석한다. 별명/관계 이력 컬럼은 추가하지 않았다. 마지막 열람 시각은 성공한 웹 보기만 갱신한다.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.
