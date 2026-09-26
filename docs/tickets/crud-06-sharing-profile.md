# [CRUD 동등성] 프로필·공유 설정·친구 연결의 목적별 API 제공

2026-09-26 · [#156](https://github.com/kimyongin/fin/issues/156) · 설계 완료, 구현 전.

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
- [ ] 설정 생성·조회·변경·초기화와 연결 생성·조회·재인증·해제의 교차 실행.
- [ ] OFF/초기화/만료/친구 삭제 후 기존 접근 차단, 타인 쓰기 불가.
- [ ] 공유 범위 portfolio_all 명시 및 비밀 필드 출력/로그 검사.
- [ ] 설정 UI와 OAuth가 동일 동작·오류를 사용, 새로운 공유 종류/권한 테이블 없음.

## 공통 계약과 진행 상태

- 설계 정본: https://github.com/kimyongin/fin/blob/master/docs/design/domain-crud-parity.md
- 상태: 설계·티켓 작성, 구현 전. 로컬 문서는 아직 원격 Git에 없을 수 있다.
- 관련 문서: docs/START-HERE.md → PRD/ADR-0008 → docs/design/domain-crud-parity.md.
- DB·목적별 RPC·필요 UI·OAuth·테스트·런타임 MCP 가이드를 한 수직 slice로 구현/검증/커밋한다.
- 사용자 설정과 기존 데이터를 보존하며 보편 CRUD 엔진/의무 이력을 만들지 않는다.
- 공통 수용 조건(양방향 CRUD, 권한, 삭제 영향, 재시도, UI 폭별 검증)을 정본대로 적용한다.
- 운영 배포/실클라이언트 확인은 로컬 테스트와 별도 기록한다.
