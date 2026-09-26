# 보유 확인 상태 퇴역 — 현재값 수정·보정은 유지

2026-09-25 사용자 결정. 자산의 “N개 보유가 아직 미확인”은 웹에서 해소할 경로가 없고 매일의 자산 확인·수정 목적에도 필요하지 않다. 확인됨/미확인/확인 뒤 변경됨을 별도 상태로 유지하지 않는다.

## 범위

- 자산 화면의 확인 상태 카드와 도달 불가능한 확인 전용 웹 모달·클라이언트 코드를 제거한다.
- `holdings.last_verification`, 확인 전용 DB 함수, MCP의 `get_holding_integrity`·`get_portfolio_integrity`·`verify_holdings`를 퇴역한다. `confirmed_fields`와 `verification_id`도 보정 preview/확정 계약에서 제거한다.
- 현재 보유값 직접 편집, 절대 보정, 매매 기록, 자동 활동, 사용자 격리, 금융 쓰기의 잠금·버전 충돌·멱등 영수증은 유지한다. 이미 기록된 확인 활동은 당시 수행 사실로 남지만 현재 보유 상태를 계산하지 않는다.
- 이전 보정 영수증은 확인 전용 필드를 무시한 동일 요청 재시도에도 기존 성공을 반환한다. 확인 전용 영수증 행은 제거하고 영수증 테이블을 보정 전용으로 이름을 바꾼다. 과거 migration은 수정하지 않는다.
- 운영 DB 적용·OAuth MCP Edge 배포는 별도 게이트다. 오래된 ChatGPT 도구 목록은 배포 후 새로고침이 필요하다.

## 수직 검증

- [x] 자산 화면에서 확인 상태 배너 제거, 보유 목록·상세 편집 유지.
- [x] DB 보정 preview/확정에 확인 입력·상태 없이 수량/평균가·평가형·현금 보정, 실패/중복/타인 접근 검증 추가.
- [x] MCP 도구·설명·가이드·계약 검사에서 확인 전용 도구 제거, 보정 경로 유지.
- [x] 격리 DB 전체 46파일/558검사, OAuth·토큰 MCP 계약 및 인증된 배포 준비 검사, Chromium 브라우저 67건 모두 통과. 단위 20파일/98검사, 빌드·인코딩·워크플로우 가이드 검사 통과. 오래된 상세 필터 클릭 테스트를 현재 UI에 맞춰 수정했다.
- [ ] 실기기/운영 적용과 실제 ChatGPT 웹·모바일에서 새 목록 확인.

일반 로컬 DB에는 데이터 백업(`C:\Users\yongin\AppData\Local\Temp\fin-local-before-verification-retirement-20260925.sql`) 후 이번 migration 하나만 적용했고, 일반 로컬 DB 558검사를 통과했다. 로컬 보안 advisor는 이번 함수와 무관한 기존 `normalize_public_name`·`set_profile_updated_at`의 mutable search_path 경고 두 건을 보고했다. 이 호스트에는 독립 `deno` 실행 파일이 없어 `npm run check:edge`를 직접 실행하지 못했지만, 격리 Edge Runtime의 MCP 계약·실행 검사는 통과했다. 운영 DB와 Edge에는 적용하지 않았다.
