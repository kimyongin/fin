## What to build

매일 아침 시장 뉴스·지표를 수집하고, Investment Guidelines에 따라 분석해 `daily_reports`에 저장하는 Claude Desktop 스킬을 구현한다.

도메인 언어는 `market-analysis-skill/CONTEXT.md`, 투자 방향성은 `skills/INVESTMENT_GUIDELINES.md` 참조.

## 디렉토리 구조

```
market-analysis-skill/
├── SKILL.md
├── helpers/
│   ├── fetch_rss.py
│   ├── crawl_article.py
│   ├── fetch_indicators.py
│   └── supabase_client.py
├── output/
└── .env
```

## 기술 스택

```
python
feedparser
trafilatura
httpx 또는 requests
yfinance
supabase  # supabase-py (Storage 포함)
```

## 환경 변수

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_OWNER_EMAIL=<portfolio-owner-email>
SUPABASE_OWNER_PASSWORD=<long-random-string>
```

- **`service_role key` 사용 금지** — anon key + RLS.
- 매 실행 시 포트폴리오 소유자 계정으로 로그인:

```python
sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
sb.auth.sign_in_with_password({
    "email": os.environ["SUPABASE_OWNER_EMAIL"],
    "password": os.environ["SUPABASE_OWNER_PASSWORD"],
})
```

## 실행 절차

### 1. 포트폴리오 컨텍스트 조회

```python
portfolio = sb.table('portfolio_view').select('*').execute().data
```

### 2. RSS 뉴스 수집 (최근 24시간)

```
python helpers/fetch_rss.py --hours 24
```

### 3. 기사 본문 크롤링

```
python helpers/crawl_article.py <url>
```

규칙:
- 본문 300자 미만 → RSS summary 사용.
- 둘 다 부실하면 해당 기사 스킵.
- 키워드 매칭 후 Top 30건 분석 대상.

### 4. 시장 지표 수집

```python
import yfinance as yf
data = yf.download(['^GSPC', '^IXIC', '^KS11', '^VIX', 'USDKRW=X'], period='5d', interval='1d')
```

수집 지표: S&P 500, Nasdaq, KOSPI, VIX, USD/KRW.

**이 값들은 `daily_reports.indicators` JSONB에만 사용한다. `holding_prices_daily`에는 쓰지 않는다.** 보유 종목 가격 동기화는 사용자가 Web App 자료 페이지에서 수행한다.

### 5. Claude Desktop 리포트 작성

포함 항목:
- 마켓 임팩트 3–5건
- 각 뉴스/지표가 포트폴리오에 미치는 영향
- 사이클 업데이트 (`recovery`/`caution`/`neutral`)
- 매매 제안 (`BUY`/`SELL`/`HOLD`)
- 리스크 경고 (`low`/`medium`/`high`)

Investment Guidelines(`skills/INVESTMENT_GUIDELINES.md`)의 ETF 우선·균형형·테마 기반 원칙을 반영한다.

### 6. Supabase Storage 본문 업로드

```python
user_id = sb.auth.get_user().user.id
storage_path = f'{user_id}/daily/{report_date}.md'
sb.storage.from_('reports').upload(
    storage_path,
    md_content.encode('utf-8'),
    {'content-type': 'text/markdown', 'upsert': 'true'},
)
```

### 7. 요약 + 스냅샷 저장

```python
# daily_reports upsert
sb.table('daily_reports').upsert({
    'report_date': '2026-05-05',
    'headline': '...',
    'market_impact_summary': '...',
    'trade_suggestions': [...],
    'risk_warnings': [...],
    'cycle_phase': 'recovery',
    'indicators': {...},
    'news_count': 28,
    'storage_path': storage_path,
}, on_conflict='user_id,report_date').execute()

# portfolio_snapshots upsert
sb.table('portfolio_snapshots').upsert({
    'snapshot_date': report_date,
    'total_value_krw': sum(p['market_value_krw'] for p in portfolio if p['market_value_krw']),
}, on_conflict='user_id,snapshot_date').execute()
```

## 저장 JSONB 구조

`trade_suggestions`:
```json
[{ "action": "BUY", "ticker": "133690", "display_name": "TIGER 미국나스닥100", "reason": "..." }]
```

`risk_warnings`:
```json
[{ "level": "high", "message": "..." }]
```

`indicators`:
```json
{
  "sp500": 5200.1, "sp500_change_pct": -0.5,
  "nasdaq": 18300.2, "nasdaq_change_pct": -0.8,
  "kospi": 2680.5, "kospi_change_pct": 0.3,
  "usdkrw": 1380.0,
  "vix": 18.5
}
```

## 트리거

Claude Desktop Cowork Scheduler 매일 07:00 KST 등록.

실행 요청 문구:
```
market-analysis 스킬을 실행해 오늘의 시장 분석 리포트를 생성하고 저장하라.
```

## 실패 처리

- Supabase 접속 불가 → 저장하지 않고 사용자에게 알림.
- Storage 업로드 실패 → `storage_path = null`로 저장할지 사용자에게 확인.
- RSS/크롤링 일부 실패 → 전체 작업 계속 진행.
- yfinance 일부 실패 → 성공한 지표만 `indicators`에 담고 실패 목록을 본문에 명시.

## Acceptance criteria

- [ ] Supabase anon key로 로그인 성공 (`service_role key` 환경 변수에 없음)
- [ ] `portfolio_view`에서 보유 종목 + 평가금액 조회 성공
- [ ] RSS 뉴스 수집 + 본문 크롤링 또는 summary 폴백 동작
- [ ] yfinance 시장 지표 수집 성공 — `holding_prices_daily`에는 쓰지 않음
- [ ] 마크다운 리포트 생성
- [ ] Storage `reports` 버킷에 `{user_id}/daily/{report_date}.md` 업로드 성공
- [ ] `daily_reports` upsert 성공 (`(user_id, report_date)` 중복 시 덮어쓰기)
- [ ] `portfolio_snapshots` 당일 row upsert 성공
- [ ] Portfolio App 분석 페이지 리포트 영역에 리포트가 표시된다
- [ ] Investment Guidelines(ETF 우선·균형형·테마 기반)가 매매 제안에 반영된다

## Blocked by

- #1 (스키마 — daily_reports, portfolio_view, portfolio_snapshots, Storage 버킷)
- #2 (Auth — 이메일+비밀번호 로그인 설정)
