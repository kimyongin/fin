# 재테크 시스템 마스터 PRD

> 이 문서는 전체 시스템의 경계, 앱 간 관계, 공통 원칙을 설명한다. 세부 구현 요구사항은 각 PRD를 따른다.

## 문서 구성

- [Portfolio App PRD](./PRD_PORTFOLIO_APP.md) — Next.js 프로젝트 셋업 + Supabase 백엔드(스키마, RLS, 트리거, `sync-prices` Edge Function)
- [Portfolio App UI PRD](./PRD_PORTFOLIO_UI.md) — `index-v2.html` 기준 웹 UI, master-detail, drawer, 차트, 상호작용
- [Market Analysis Skill PRD](./PRD_MARKET_ANALYSIS_SKILL.md)
- [Rebalancing Skill PRD](./PRD_REBALANCING_SKILL.md)

## 공통 용어 표준

- **Portfolio App**: Next.js 프로젝트와 Supabase 프로젝트 설정(스키마, RLS, Edge Function, Storage 정책)을 소유하는 앱.
- **Portfolio App UI**: `mockups/portfolio-web-app/index-v2.html`을 정합성 기준으로 삼는 웹 UI 명세.
- **Market Analysis Skill**: 매일 시장 뉴스·지표·포트폴리오 컨텍스트를 분석해 `daily_reports`와 리포트 본문을 저장하는 Claude Desktop 스킬.
- **Rebalancing Skill**: 사용자의 투자 가능 금액과 제약을 받아 `rebalance_suggestions`를 생성하는 Claude Desktop 스킬.
- **자산 / 분석 / 자료**: Portfolio App의 3개 주요 LNB 메뉴. 자산은 계좌·보유종목·거래와 태그 필터, 분석은 리포트·리밸런싱, 자료는 환율·종목 마스터·관리형 태그·가격 데이터를 담당한다.
- **포트폴리오 소유자 Auth 사용자**: Web App과 Skills가 같은 데이터를 보기 위해 공통으로 사용하는 Supabase Auth 사용자. Web App은 Supabase Email OTP(Magic Link) 방식으로 로그인하되 사용자 화면에는 "로그인 링크"로 표기한다. Skills는 이 계정의 이메일+비밀번호 세션으로 로그인하며 별도 데이터 소유자가 아니다.
- **`anon key`**: Web App과 Skills가 공통으로 사용하는 공개 Supabase 클라이언트 키. 실제 데이터 접근은 Auth 세션과 RLS가 보호한다.
- **`storage_path`**: `reports` Storage 버킷 안의 리포트/리밸런싱 본문 경로. DB에는 본문 대신 이 경로만 저장한다.
- **`portfolio_view`**: 보유 종목, 평가금액, 미실현손익을 조회하는 표준 view. 화면과 Skills는 직접 환산 로직을 중복 구현하지 않는다.
- **KST 기준 날짜**: 모든 DATE 컬럼(`report_date`, `suggestion_date`, `trade_date`, `price_date`)은 한국 시간 기준 날짜로 해석한다.

회귀 방지:
- 별도 API 서버, 공유 API 키, Google Drive 저장, 별도 대시보드 페이지는 요구사항으로 되살리지 않는다.
- 사용자 화면의 주요 목록은 카드/리스트 카드 중심으로 설계한다. 마스터 카드 안에는 수정/삭제 버튼을 두지 않고, 카드 클릭으로 detail drawer를 연 뒤 동일한 drawer form을 `view / edit / create` 모드로 전환해 편집한다.
- 거래 기록과 가격 기록처럼 계속 늘어나는 로그성 데이터는 최근 N건, 그룹 헤더, 필터, 명시적 `더 보기` 패턴으로 제한해 탐색한다.
- 신규 UI 기능은 [Portfolio App UI PRD](./PRD_PORTFOLIO_UI.md)의 UX 설계 원칙과 신규 기능 추가 판단 템플릿을 통과해야 한다.

---

# 1. 제품 목표

개인 투자 포트폴리오를 관리하고, 매일 시장 분석 리포트와 수동 리밸런싱 제안을 생성하는 재테크 시스템을 만든다.

시스템은 Supabase를 BaaS(Backend-as-a-Service)로 활용하며, 클라이언트가 Supabase SDK로 Auth/DB에 직접 접근한다. 서버 환경이 꼭 필요한 외부 가격 수집(Yahoo)만 Edge Function으로 분리한다.

구성요소:

- **Portfolio App**
  - Next.js 웹 UI (Vercel) + Supabase 백엔드(스키마, RLS, holdings 재계산 트리거, `portfolio_view`, `sync-prices` Edge Function, `reports` Storage 버킷) 통합 단위
  - Supabase Auth(이메일 로그인 링크)로 사용자 로그인
  - 브라우저는 anon key + 사용자 세션으로 DB와 Storage에 직접 접근 (RLS가 보호)
- **Market Analysis Skill**
  - Claude Desktop 스킬 (로컬 Python)
  - anon key + 포트폴리오 소유자 로그인으로 DB와 Storage 접근 (Web App과 동일한 `auth.uid()`)
  - yfinance로 시장 지표(S&P 500/Nasdaq/KOSPI/VIX/USD/KRW) 수집 → `daily_reports.indicators`에 저장. 본문은 `reports` Storage에 업로드, 메타는 `daily_reports` upsert. **보유 종목 가격(`holding_prices_daily`)은 쓰지 않는다 — 가격 동기화는 사용자가 Web App "동기화" 버튼으로 수행**
- **Rebalancing Skill**
  - Claude Desktop 스킬 (로컬 Python)
  - anon key + 포트폴리오 소유자 로그인으로 DB와 Storage 접근
  - 사용자 수동 실행, 리포트/포트폴리오 조회 후 `rebalance_suggestions` 저장 (본문 Storage 업로드는 선택)

---

# 2. 전체 아키텍처

```text
┌──────────────────────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Portfolio App (Web)           │      │ Market Analysis Skill         │      │ Rebalancing Skill             │
│ Next.js, Vercel               │      │ Claude Desktop, daily 07:00   │      │ Claude Desktop, manual        │
│ Supabase JS SDK               │      │ Supabase Python client        │      │ Supabase Python client        │
└───────────────┬──────────────┘      └───────────────┬──────────────┘      └───────────────┬──────────────┘
                │ anon key + 사용자 세션              │ anon key + 같은 소유자 세션         │ anon key + 같은 소유자 세션
                │                                     │                                     │
                └─────────────────────────────────────┼─────────────────────────────────────┘
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ Supabase                      │
                                      │ - Auth (이메일 로그인 링크)   │
                                       │ - Postgres + RLS              │
                                       │ - Storage `reports` 버킷       │
                                       │ - Edge Function: sync-prices  │
                                       └──────────────────────────────┘
                                                      │
                                                      │ Edge Function 내부에서만
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ Yahoo Finance JSON 엔드포인트 │
                                       │ (비공식, 인증 없음)           │
                                       └──────────────────────────────┘
```

Supabase 프로젝트는 Portfolio App 레포가 마이그레이션, Edge Function 코드, Storage 버킷 정책으로 소유한다. Google Drive 의존성은 없다.

---

# 3. 핵심 경계 원칙

## 3.1 DB 접근 방식

- **모든 클라이언트(Web App, Skills)는 Supabase SDK + anon key + 사용자 세션으로 DB에 직접 접근한다.** 별도 백엔드 API 레이어, `service_role key`는 사용하지 않는다.
- Web App: 포트폴리오 소유자 이메일 로그인 링크 세션.
- Skills: 같은 포트폴리오 소유자 계정의 이메일+비밀번호 로그인 세션.
- 모든 접근에 동일한 RLS(`auth.uid() = user_id`)가 적용된다.
- Web App과 Skills가 같은 `auth.uid()`를 사용하므로 Skills가 저장한 리포트, 리밸런싱 제안은 Web App에서 그대로 조회된다. (보유 종목 가격은 사용자가 Web App "동기화" 버튼으로 직접 채운다.)
- holdings 갱신은 Postgres 트리거가 자동으로 수행하므로 클라이언트는 `transactions` 테이블만 insert/update/delete 하면 된다.
- 평가금액·손익 계산은 `portfolio_view`에서 처리하므로 클라이언트는 view를 select만 한다.

## 3.2 인증과 권한

- Supabase Auth로 모든 클라이언트 로그인.
  - Web App: 이메일 로그인 링크
  - Skills: 같은 포트폴리오 소유자 계정의 이메일+비밀번호
- 모든 테이블에 `user_id UUID NOT NULL DEFAULT auth.uid()` 컬럼이 있고, RLS 정책은 `auth.uid() = user_id`.

  ```sql
  CREATE POLICY "owner_all" ON <table>
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  ```

- 단일 사용자 단계에선 모든 행이 동일한 포트폴리오 소유자 `user_id`로 채워지지만, 정책은 처음부터 사용자별 격리로 가동된다.
- 별도 공유 API 키나 `service_role key`는 사용하지 않는다.

## 3.3 sync-prices Edge Function

- 브라우저에서 Yahoo Finance JSON 엔드포인트는 CORS로 막혀있어 직접 호출 불가.
- Web App "동기화" 버튼 → `sync-prices` Edge Function이 Yahoo JSON 엔드포인트를 fetch하고 `holding_prices_daily`에 upsert.
- Skills는 이 함수를 호출하지 않는다. 보유 종목 가격은 사용자가 Web App에서 수동으로 동기화한다.
- Edge Function 인증: Supabase Auth JWT 검증.

## 3.4 환경 변수 분포

| 위치 | 보유 키 |
|---|---|
| Portfolio App (Vercel) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Skills (로컬) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_OWNER_EMAIL`, `SUPABASE_OWNER_PASSWORD` |
| Edge Function | Supabase 런타임이 자동 주입 (별도 키 관리 없음) |

`service_role key`는 어디에도 두지 않는다(Supabase 대시보드에만 존재).

---

# 4. 공통 기술 결정

| 항목 | 결정 |
|---|---|
| Backend | Supabase (BaaS) |
| DB | Supabase Postgres + RLS |
| Edge Functions | `sync-prices` 1개 (Deno) |
| Web | Next.js on Vercel + Supabase JS SDK |
| Skills | Claude Desktop + Supabase Python client |
| 인증 | Supabase Auth (이메일 로그인 링크) |
| 사용자 범위 | 초기 릴리스는 개인용 단일 포트폴리오 소유자 |
| RLS 정책 | `auth.uid() = user_id` 단일 정책 |
| LLM | Claude Desktop 구독, 별도 LLM API 키 없음 |
| Currency | 계좌가 아니라 종목 레벨 |

---

# 5. 무료 사용량 원칙

- Supabase Free의 DB 500MB 한도 안에서 운영.
- Edge Functions Free 500K invocations/month — `sync-prices` 1개만이라 차고 넘침.
- Auth Free 50K MAU — 단일 사용자에게 무한대.
- Storage Free 1GB — 마크다운 리포트 1건당 5–50KB, 매일 1건씩 50년치 가능.
- 리포트 전체 본문은 DB에 저장하지 않고 Supabase Storage `reports` 버킷에 저장하고 `daily_reports.storage_path`로 참조.
- `daily_reports`에는 요약, 지표, 매매 제안, 리스크 경고만 저장.
- 티커는 외부 가격 소스에서 사용하는 코드, 종목명은 `instruments.display_name`으로 별도 관리.
- `USDKRW=X`는 Yahoo Finance/yfinance의 USD/KRW 환율 티커이며, 하드코딩 상수가 아니라 `instrument_type = 'fx'`인 종목 마스터 데이터로 관리.
- 일별 가격은 현재 보유 종목과 환율 코드 위주로 저장.
- 가격 수집 책임:
  - Web App "동기화" 버튼 → `sync-prices` Edge Function이 마지막 저장일 다음 날부터 누락된 날짜만 upsert (유일한 자동 경로)
  - Market Analysis Skill은 보유 종목 가격을 채우지 않는다. 시장 지표(S&P 500/Nasdaq/KOSPI/VIX/USD/KRW)만 수집해 `daily_reports.indicators`에 저장.
  - 누락/오류 데이터는 자료 페이지(`/data`, F-W4)에서 사용자가 수동 보완

---

# 6. 전체 검증 체크리스트

- [ ] Portfolio App PRD가 DB 스키마, RLS 정책, holdings 재계산 트리거, `portfolio_view`, `sync-prices` Edge Function, Storage `reports` 버킷을 소유한다.
- [ ] Portfolio App UI PRD가 `index-v2.html` 기준 Web UI, master-detail drawer, 차트, 상호작용을 소유한다.
- [ ] Web App과 Skills 모두 anon key + 사용자 세션으로 DB에 접근한다 (`service_role key` 미사용).
- [ ] Web App과 Skills가 같은 포트폴리오 소유자 `auth.uid()`를 사용해 동일 데이터를 조회한다.
- [ ] 모든 테이블에 `user_id UUID NOT NULL DEFAULT auth.uid()` 컬럼이 있고 `auth.uid() = user_id` RLS 정책이 적용된다.
- [ ] 거래 추가/수정/삭제 후 holdings 재계산이 Postgres 트리거로 처리된다.
- [ ] Market Analysis Skill은 `portfolio_view`, `daily_reports`, `portfolio_snapshots`를 포트폴리오 소유자 세션으로 직접 사용한다 (보유 종목 가격은 사용자 수동 동기화).
- [ ] Rebalancing Skill은 `daily_reports`, `portfolio_view`, `rebalance_suggestions`를 포트폴리오 소유자 세션으로 직접 사용한다.
- [ ] Web App "동기화" 버튼이 `sync-prices` Edge Function을 호출하고, 누락된 날짜만 처리한다.
- [ ] Holdings 재계산 알고리즘(매수 평단, 매도 정책, 수량 0 처리)이 PL/pgSQL 트리거 함수로 명세되어 있다.
- [ ] `transactions.currency`, `holding_prices_daily.currency` 컬럼이 존재하지 않는다 (instruments join으로 도출).
- [ ] 리포트/리밸런싱 본문 참조는 Drive 계열 컬럼이 아니라 `storage_path`로 통일되어 있다.
- [ ] `reports` Storage 버킷이 private이고 본인 폴더 격리 RLS가 적용된다.
- [ ] Skills에 Google OAuth 환경 변수가 없다.
- [ ] `supabase gen types`로 생성된 TypeScript 타입 파일이 커밋되어 있다.
- [ ] 옛 API 서버, 공유 API 키, Google Drive 기반 요구사항이 어떤 PRD에도 남아있지 않다.
- [ ] 모든 PRD가 공통 용어 표준(자산/분석/자료, 포트폴리오 소유자 Auth 사용자, `anon key`, `storage_path`, `portfolio_view`, KST 기준 날짜)을 일관되게 사용한다.
- [ ] Portfolio App UI 요구사항이 카드 중심, detail drawer form, 반응형, 가로 스크롤 금지, 신규 기능 판단 템플릿 원칙을 따른다.
- [ ] Portfolio App UI가 master-detail 드릴다운 구조다 — 데스크탑은 우측 detail 패널이 항상 떠있고 모바일은 풀스크린 위→아래 overlay로 동작한다.
- [ ] 자산 페이지에 태그 필터 적용 종목별 비중 차트와 보유 종목 detail의 매매 타임라인 차트(BUY/SELL 마커 포함)가 포함되어 있다.
