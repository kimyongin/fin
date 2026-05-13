# 재테크 시스템 PRD

> 이 문서는 `/to-prd` 스킬로 생성됐습니다. 기존 PRD들(`PRD.md`, `PRD_PORTFOLIO_APP.md`, `PRD_PORTFOLIO_UI.md`, `PRD_MARKET_ANALYSIS_SKILL.md`, `PRD_REBALANCING_SKILL.md`)을 대체합니다.
>
> 도메인 용어는 `CONTEXT-MAP.md` 및 각 컨텍스트의 `CONTEXT.md`를 따릅니다.
> 아키텍처 결정은 `docs/adr/`을 참조하세요.

---

## Problem Statement

포트폴리오 소유자가 여러 계좌에 분산된 ETF 보유 현황을 한 곳에서 파악하고, 매일 시장 뉴스와 지표를 자신의 투자 방향성에 맞게 해석한 리포트를 받아보고, 주 1회 리밸런싱 제안을 통해 테마 비중을 조정하고 싶다. 현재는 이 세 가지가 분리되어 있어 실행까지의 마찰이 크다.

---

## Solution

세 가지 컴포넌트로 구성된 개인용 재테크 시스템:

1. **Portfolio App** — 계좌·Position·Transaction을 관리하는 정적 웹 앱(HTML/JS). GitHub Pages 배포. Supabase를 직접 BaaS로 사용.
2. **Market Analysis Skill** — 매일 아침 뉴스·시장 지표를 Investment Guidelines에 따라 분석해 리포트를 생성하고 Supabase에 저장하는 Claude Desktop 스킬.
3. **Rebalancing Skill** — 주 1회 수동 실행. 최근 리포트와 현재 포트폴리오를 종합해 테마 비중 조정 액션을 제안하는 Claude Desktop 스킬.

세 컴포넌트는 같은 Supabase 프로젝트를 공유한다. Web App은 GitHub Pages에서 서빙되고, Skills는 포트폴리오 소유자의 로컬 머신에서만 실행된다. ([ADR-0001](./docs/adr/0001-static-html-github-pages.md), [ADR-0004](./docs/adr/0004-skills-on-claude-desktop.md))

---

## User Stories

### 인증

1. 포트폴리오 소유자로서, 이메일 로그인 링크를 받아 로그인할 수 있어야 한다. 매번 비밀번호를 기억하지 않아도 된다.
2. 포트폴리오 소유자로서, 모바일에서 로그인 링크를 열었을 때 현재 브라우저의 세션 상태를 확인하는 버튼이 있어야 한다.
3. 포트폴리오 소유자로서, 로그인하지 않은 상태로 보호된 페이지에 접근하면 로그인 화면으로 이동해야 한다.

### 자산 관리

4. 포트폴리오 소유자로서, 전체 포트폴리오의 총 평가금액과 이번 달 변동을 한눈에 볼 수 있어야 한다.
5. 포트폴리오 소유자로서, 보유한 ETF의 최근 가격이 없으면 화면에 경고가 표시되어야 한다.
6. 포트폴리오 소유자로서, 태그로 보유 종목을 필터링해 특정 테마의 비중만 볼 수 있어야 한다.
7. 포트폴리오 소유자로서, 필터된 종목의 평가금액 비중을 차트로 볼 수 있어야 한다.
8. 포트폴리오 소유자로서, 보유 종목 카드를 클릭하면 평가금액·미실현손익·비중 상세와 매매 타임라인 차트를 볼 수 있어야 한다.
9. 포트폴리오 소유자로서, 매매 타임라인 차트에서 BUY/SELL 마커를 보고 언제 어떤 거래를 했는지 파악할 수 있어야 한다.
10. 포트폴리오 소유자로서, 보유 종목 상세에서 최근 거래 5건을 바로 볼 수 있어야 하고, 더 보기로 과거 거래도 확인할 수 있어야 한다.
11. 포트폴리오 소유자로서, 거래(Transaction)를 추가하면 Holding이 자동으로 재계산되어야 한다.
12. 포트폴리오 소유자로서, 거래를 수정하거나 삭제해도 Holding이 정확하게 재계산되어야 한다.
13. 포트폴리오 소유자로서, 매도 수량이 보유 수량을 초과하면 오류 메시지가 표시되어야 한다.
14. 포트폴리오 소유자로서, 과거 거래 원장 없이 현재 보유 상태만 직접 입력(Initial Load)할 수 있어야 한다.
15. 포트폴리오 소유자로서, 계좌별 평가금액과 보유 종목 수를 볼 수 있어야 한다.
16. 포트폴리오 소유자로서, 거래 목록을 태그·기간·계좌·BUY/SELL로 필터링할 수 있어야 한다.

### 가격 동기화

17. 포트폴리오 소유자로서, 동기화 버튼 한 번으로 보유 Instrument와 FX Rate의 누락 가격을 한꺼번에 채울 수 있어야 한다(Sync).
18. 포트폴리오 소유자로서, Sync 결과(성공/실패 ticker 수)를 즉시 확인할 수 있어야 한다.
19. 포트폴리오 소유자로서, 자동 Sync가 실패한 종목의 가격을 수동으로 직접 입력할 수 있어야 한다.

### 종목·태그 관리

20. 포트폴리오 소유자로서, 종목 마스터(Instrument)에 ticker, 표시명, 통화, 가격 소스를 등록할 수 있어야 한다.
21. 포트폴리오 소유자로서, 태그를 만들고 종목에 연결해 자산 화면의 필터로 사용할 수 있어야 한다.
22. 포트폴리오 소유자로서, 종목 상세에서 가격 데이터 품질(마지막 동기화일, 누락 일자)을 확인할 수 있어야 한다.

### 시장 분석 리포트

23. 포트폴리오 소유자로서, 매일 아침 최신 시장 리포트가 자동으로 생성되어 있어야 한다.
24. 포트폴리오 소유자로서, 리포트에서 S&P 500·Nasdaq·KOSPI·VIX·USD/KRW 지표를 한눈에 볼 수 있어야 한다.
25. 포트폴리오 소유자로서, 리포트에서 Investment Guidelines에 맞는 매매 제안과 리스크 경고를 볼 수 있어야 한다.
26. 포트폴리오 소유자로서, 리포트의 Market Cycle(회복/주의/중립)을 보고 현재 시장 국면을 파악할 수 있어야 한다.
27. 포트폴리오 소유자로서, 리포트 전문 본문을 웹 앱에서 미리보기할 수 있어야 한다.
28. 포트폴리오 소유자로서, 일시적 급등·급락이 아닌 장기 사이클 신호가 리포트에서 강조되어야 한다.
29. 포트폴리오 소유자로서, 단기 이슈 기반 개별 종목 매수·매도 제안은 리포트에 포함되지 않아야 한다.

### 리밸런싱

30. 포트폴리오 소유자로서, 추가 투자 가능 금액과 제약을 입력하면 테마 비중 조정 액션을 제안받을 수 있어야 한다.
31. 포트폴리오 소유자로서, 제안된 Rebalancing Action에 계좌·ticker·수량·예상 금액·이유가 포함되어야 한다.
32. 포트폴리오 소유자로서, 리밸런싱 제안에 대해 반영/미반영/부분 반영(User Decision)을 웹 앱에서 기록할 수 있어야 한다.
33. 포트폴리오 소유자로서, 어떤 리포트를 근거로 이 제안이 만들어졌는지 확인하고 해당 리포트로 바로 이동할 수 있어야 한다.
34. 포트폴리오 소유자로서, 결정 대기 중인 리밸런싱 제안이 목록 상단에 강조되어야 한다.

---

## Implementation Decisions

### 아키텍처

- **Web App**: 순수 HTML/JS, 빌드 단계 없음, GitHub Pages 배포. `@supabase/supabase-js` 클라이언트 전용. ([ADR-0001](./docs/adr/0001-static-html-github-pages.md))
- **Backend**: Supabase (Postgres + RLS + 트리거 + Edge Function + Storage). 별도 API 서버 없음.
- **Skills**: Claude Desktop 로컬 실행. Python + `supabase-py`. ([ADR-0004](./docs/adr/0004-skills-on-claude-desktop.md))
- 모든 클라이언트는 `anon key` + Supabase Auth 세션으로 접근. `service_role key` 미사용.

### 모듈

**`supabaseClient`**
Supabase JS 클라이언트 싱글톤. Auth 세션 관리 및 로그인/로그아웃 담당. 모든 DB·Storage·Functions 호출의 진입점.

**`portfolioStore`**
`portfolio_view` 조회 및 클라이언트 계산 담당. `weight_pct`는 `market_value_krw / SUM(market_value_krw)`로 여기서 계산한다 — `portfolio_view`에 포함하지 않는 이유는 태그 필터 적용 시 window function 조합이 복잡해지기 때문.

**`drawerController`**
Drawer 상태 머신(`view` → `edit` → `delete-confirm`, `create` 등)과 형제 탐색(prev/next/1 of N) 관리. 단일 인터페이스로 모든 페이지의 drawer 동작을 통일한다.

**`syncPricesService`**
`sync-prices` Edge Function 호출 및 결과(`synced`, `failed`) 파싱. Sync는 Web App에서만 트리거하며 Skills는 호출하지 않는다.

**`priceChart`**
SVG 라인 차트 + area fill + BUY/SELL 마커 렌더링. `1D`/`1M` 해상도 전환 지원.

**`sync-prices` Edge Function (Deno)**
Yahoo Finance 비공식 JSON 엔드포인트에서 가격 fetch. 마지막 저장일 이후 누락 날짜만 `holding_prices_daily`에 upsert. 결과를 `sync_runs`에 기록. ([ADR-0005](./docs/adr/0005-yahoo-finance-unofficial.md))

**`supabase_client.py` (Skills 공통)**
포트폴리오 소유자 이메일+비밀번호로 Supabase 로그인. `portfolio_view`, `daily_reports`, `rebalance_suggestions`, Storage 접근.

### 스키마 핵심 결정

- `holdings`는 `transactions` 트리거가 자동 갱신하는 파생 테이블. 클라이언트는 `transactions`만 건드린다. Initial Load 예외: 거래 원장 없이 현재 보유 상태만 있을 때 `holdings` 직접 insert 허용.
- 통화는 `instruments.currency`에서 도출. `transactions`와 `holding_prices_daily`에 `currency` 컬럼 없음. ([ADR-0002](./docs/adr/0002-currency-derived-from-instruments.md))
- 리포트·리밸런싱 전문 본문은 Supabase Storage `reports` 버킷에 저장. DB에는 `storage_path`만 저장. ([ADR-0003](./docs/adr/0003-report-body-in-storage.md))
- 모든 DATE 컬럼은 KST 기준.
- Instrument(투자 종목)와 FX Rate(환율 코드)는 개념상 다르지만 `instruments` 테이블을 공유. UI에서 `instrument_type = 'fx'` 여부로 분리 표시.

### Investment Guidelines

Skills의 분석 방향은 `skills/INVESTMENT_GUIDELINES.md`에서 관리한다. ETF 우선, 균형형, 테마(전력·반도체·바이오) 기반, 단기 모멘텀 배제, 주간 리뷰 원칙을 담는다. DB나 Web App UI에서 관리하지 않는다.

### UI 패턴

- hero strip(단일 1차 메트릭) + 전체폭 탭 + master 카드 리스트 + detail drawer 구조.
- 생성은 우하단 FAB → draft 카드 삽입 → create-mode drawer.
- 편집·삭제·저장은 drawer 우하단 sticky footer에서만.
- 로그성 데이터(Transaction, 가격)는 최근 N건 + 그룹 헤더 + 더 보기.
- 가로 스크롤 금지. 모든 상태(로딩/오류/빈 상태)는 inline 표시.

---

## Testing Decisions

**좋은 테스트의 기준**: 구현 상세가 아닌 외부 동작을 테스트한다. "이 함수가 이 로직을 쓰는가"가 아니라 "이 입력에서 이 출력이 나오는가"를 검증한다.

**테스트 대상 모듈:**

- **`portfolioStore`** — `getWeights()`, `getTotalValue()` 등 순수 계산 함수. Supabase 응답 데이터를 fixture로 주고 계산 결과가 올바른지 검증. 외부 의존 없이 실행 가능.
- **`drawerController`** — 상태 전환 로직(`view → edit`, `edit → delete-confirm → edit` 취소 등). 형제 탐색 순서 검증. DOM 없이 순수 JS로 테스트 가능.
- **`sync-prices` Edge Function** — Yahoo Finance 응답 fixture를 사용한 파싱 로직, 누락 날짜 계산 로직 단위 테스트.

**테스트하지 않는 것:**
- DOM 렌더링, SVG 출력 (`priceChart`) — 시각적 결과는 mockup(`index-v2.html`)으로 검증.
- 실제 Supabase 호출 — RLS·트리거는 Supabase 대시보드에서 수동 검증.

---

## Out of Scope

- 다중 사용자 지원 — 단일 포트폴리오 소유자 전용. RLS는 다중 사용자 구조로 설계되어 있으나 UI·Skills에서 다른 사용자를 관리하는 기능은 없다.
- 공개 API 서버 — 모든 클라이언트는 Supabase SDK로 직접 접근.
- 자동 리밸런싱 실행 — 제안만 생성하며 실제 주문 연동은 없다.
- 실시간 가격 — Sync 버튼으로 수동 트리거하는 방식. 스트리밍 시세 없음.
- 모바일 앱 — 반응형 웹 앱만 제공.
- 알림/푸시 — 리포트 생성 후 별도 알림 없음. Web App 접속 시 확인.

---

## Further Notes

- **PRD 이전 파일**: `PRD.md`, `PRD_PORTFOLIO_APP.md`, `PRD_PORTFOLIO_UI.md`, `PRD_MARKET_ANALYSIS_SKILL.md`, `PRD_REBALANCING_SKILL.md`는 이 문서로 대체됩니다. UI 상세(drawer form 필드, 데이터 매핑 표, 시각 토큰)가 필요하면 `PRD_PORTFOLIO_UI.md`를 계속 참조할 수 있습니다.
- **mockup 기준**: `mockups/portfolio-web-app/index-v2.html`이 UI 정합성 기준입니다.
- **Investment Guidelines 업데이트**: 투자 테마나 방향성이 바뀌면 `skills/INVESTMENT_GUIDELINES.md`를 직접 편집합니다.
- **GitHub remote 미설정**: 현재 이 레포에 GitHub remote가 없어 이슈 발행을 생략했습니다. Remote 추가 후 `gh issue create`로 발행하세요.
