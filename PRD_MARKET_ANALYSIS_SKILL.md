# Market Analysis Skill PRD

> **역할:** 매일 아침 시장 분석 리포트 생성. Supabase에 직접 접근.

Market Analysis Skill은 Claude Desktop 스킬로 실행된다. RSS 뉴스, 시장 지표, Supabase에서 조회한 포트폴리오 컨텍스트를 모아 데일리 리포트를 생성하고, 전체 본문은 Supabase Storage `reports` 버킷에 저장한다. `daily_reports` 테이블에는 요약과 `storage_path`만 저장한다.

---

# 1. 책임

1. RSS 피드에서 최근 24시간 뉴스 수집
2. 기사 본문 크롤링
3. 본문 크롤링 실패 시 RSS summary 폴백
4. yfinance로 시장 지표(S&P 500, Nasdaq, KOSPI, VIX, USD/KRW) 수집 — 리포트의 `indicators` JSONB에만 사용한다. `holding_prices_daily`에는 쓰지 않는다.
5. Supabase `portfolio_view`로 보유 종목 + 평가금액 컨텍스트 직접 조회 (가격은 사용자가 마지막으로 동기화한 값 기준)
6. Claude Desktop이 직접 투자자용 시장 분석 작성
7. 전체 본문(.md)을 Supabase Storage `reports` 버킷에 업로드
8. Supabase `daily_reports` 테이블에 요약과 `storage_path` 직접 upsert

> **참고:** 보유 종목 가격(`holding_prices_daily`) 동기화는 본 스킬이 수행하지 않는다. 사용자가 Web App의 자료 페이지에서 "동기화" 버튼을 눌러 `sync-prices` Edge Function을 호출하는 방식만 지원한다. 본 스킬 실행 시점에 가격이 오래되어 있으면 리포트에 그 사실을 명시한다.

---

# 2. 구성

```text
skills/market-analysis/
├── SKILL.md
├── helpers/
│   ├── fetch_rss.py
│   ├── crawl_article.py
│   ├── fetch_indicators.py
│   └── supabase_client.py     # Supabase 접근 (auth, DB, Storage)
├── output/
└── .env
```

---

# 3. 기술 스택

```text
python
feedparser
trafilatura
httpx 또는 requests
yfinance
supabase                    # supabase-py (Storage 포함)
```

---

# 4. 환경 변수

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_OWNER_EMAIL=<portfolio-owner-email>
SUPABASE_OWNER_PASSWORD=<long-random-string>
```

Google OAuth 관련 환경 변수는 사용하지 않는다(본문 저장이 Supabase Storage로 통합됨).

- **service_role key는 사용하지 않는다.** Web App과 동일한 anon key + RLS로 권한 모델을 일관되게 유지.
- Web App과 같은 포트폴리오 소유자 Supabase Auth 계정에 이메일+비밀번호 로그인을 활성화하고, Skills가 매 실행 시 이 계정으로 로그인:

  ```python
  sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
  sb.auth.sign_in_with_password({
      "email": os.environ["SUPABASE_OWNER_EMAIL"],
      "password": os.environ["SUPABASE_OWNER_PASSWORD"],
  })
  # 이후 모든 sb.table(...) 호출은 Web App과 같은 auth.uid()로 RLS 통과
  ```

- 포트폴리오 소유자의 `auth.uid()`로 INSERT 시 `user_id` 컬럼이 자동 채워진다(DDL DEFAULT).
- Web App과 Skills가 같은 `auth.uid()`를 사용하므로 저장된 리포트는 Portfolio App에서 바로 보인다.

---

# 5. 실행 절차

## 5.1 포트폴리오 컨텍스트 조회

```python
# helpers/supabase_client.py
from supabase import create_client
sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
sb.auth.sign_in_with_password({"email": ..., "password": ...})

# portfolio_view로 평가금액까지 한 번에 받기
portfolio = sb.table('portfolio_view').select('*').execute().data
```

## 5.2 최근 24시간 뉴스 URL 수집

```text
python helpers/fetch_rss.py --hours 24
```

## 5.3 기사 본문 크롤링

```text
python helpers/crawl_article.py <url>
```

규칙:
- 본문이 300자 미만이면 RSS summary를 사용한다.
- 본문과 RSS summary가 모두 부실하면 해당 기사는 스킵한다.
- 키워드 매칭 후 Top 30건 정도를 분석 대상으로 삼는다.

## 5.4 시장 지표 수집

```python
# helpers/fetch_indicators.py
import yfinance as yf

data = yf.download(['^GSPC', '^IXIC', '^KS11', '^VIX', 'USDKRW=X'], period='5d', interval='1d')
indicators = {
    'sp500': ...,  'sp500_change_pct': ...,
    'nasdaq': ..., 'nasdaq_change_pct': ...,
    'kospi': ...,  'kospi_change_pct': ...,
    'usdkrw': ...,
    'vix': ...,
}
```

수집 지표:
- S&P 500, Nasdaq, KOSPI, VIX, USD/KRW

이 값들은 리포트의 `daily_reports.indicators` JSONB에만 들어간다. **`holding_prices_daily`에는 쓰지 않는다** — 보유 종목 가격 동기화는 사용자가 자료 페이지의 동기화 버튼으로 수행한다.

`portfolio_view` 조회로 평가금액 스냅샷을 만들 때 사용하는 가격은 DB에 이미 저장된 값(사용자가 마지막으로 동기화한 가격)을 그대로 쓴다. 리포트 생성 시점에 가격이 오래되어 있으면 본문에 그 사실을 명시한다.

## 5.5 Claude Desktop이 리포트 작성

포함 항목:
- 마켓 임팩트 3-5건
- 각 뉴스/지표가 포트폴리오에 미치는 영향
- 사이클 업데이트
- 매매 제안
- 리스크 경고

매매 제안 형식:

```text
▶ [매수/매도/관망] 종목명 또는 티커 - 이유
```

## 5.6 본문 Supabase Storage 업로드

```python
user_id = sb.auth.get_user().user.id
storage_path = f'{user_id}/daily/{report_date}.md'

sb.storage.from_('reports').upload(
    storage_path,
    md_content.encode('utf-8'),
    {'content-type': 'text/markdown', 'upsert': 'true'},
)
```

## 5.7 요약 저장

```python
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
```

성공 여부는 Supabase 응답과 Portfolio App 분석 페이지의 리포트 영역 표시 여부로 판단한다.

---

# 6. 사용하는 Supabase 자원

| 작업 | 호출 |
|---|---|
| 보유 종목 + 평가금액 조회 | `from('portfolio_view').select()` |
| 포트폴리오 스냅샷 upsert | `from('portfolio_snapshots').upsert(..., on_conflict='user_id,snapshot_date')` |
| 리포트 본문 업로드 | `storage.from_('reports').upload(f'{user_id}/daily/{date}.md', ...)` |
| 리포트 메타 upsert | `from('daily_reports').upsert(..., on_conflict='user_id,report_date')` |

스키마 상세는 [Portfolio App PRD](./PRD_PORTFOLIO_APP.md) §6을 따른다.

---

# 7. 저장 데이터

`daily_reports` 행 구조:

```json
{
  "report_date": "2026-05-05",
  "headline": "",
  "market_impact_summary": "",
  "trade_suggestions": [],
  "risk_warnings": [],
  "cycle_phase": "recovery",
  "indicators": {},
  "news_count": 0,
  "storage_path": "<user_id>/daily/2026-05-05.md"
}
```

`trade_suggestions`, `risk_warnings`, `indicators`는 Portfolio App 분석 페이지의 카드 UI에서 바로 표시 가능한 구조로 저장한다. `cycle_phase`는 `recovery`/`caution`/`neutral` 중 하나로 저장하고, 액션/리스크 level/시장 지표 키는 표시용 배지와 메트릭 카드에 그대로 매핑된다.

DB에는 전체 리포트 본문을 저장하지 않는다. 본문은 Supabase Storage `reports` 버킷의 `{user_id}/daily/{report_date}.md`에 저장하고, DB에는 요약과 `storage_path`만 저장한다.

---

# 8. 트리거

Claude Desktop의 Cowork Scheduler에 매일 07:00 등록한다.

실행 요청 문구 예:

```text
market-analysis 스킬을 실행해 오늘의 시장 분석 리포트를 생성하고 저장하라.
```

---

# 9. 실패 처리

- Supabase에 접속할 수 없으면 사용자에게 실패를 알리고 저장하지 않는다.
- Storage 업로드 실패 시 `storage_path = null`로 저장할지 사용자에게 물어 결정한다.
- RSS/크롤링이 일부 실패해도 전체 작업은 계속 진행한다.
- 수집 뉴스 수가 너무 적으면 `news_count`와 리포트 본문에 한계를 명시한다.
- yfinance 시장 지표 수집 실패 시 부분 성공한 지표만 `indicators`에 담고 실패 목록을 본문에 명시한다.

---

# 10. 검증 체크리스트

- [ ] Supabase 클라이언트 초기화 + 포트폴리오 소유자 로그인 성공 (anon key 사용)
- [ ] `service_role key`가 환경 변수에 존재하지 않음
- [ ] `portfolio_view` 조회로 보유 종목 + 평가금액 획득
- [ ] RSS 뉴스 수집 성공
- [ ] 기사 본문 크롤링 또는 summary 폴백 동작
- [ ] yfinance 시장 지표(S&P 500/Nasdaq/KOSPI/VIX/USD/KRW) 수집 성공 — 단, `holding_prices_daily`에는 쓰지 않음
- [ ] `portfolio_snapshots` 당일 row upsert 성공 (DB에 저장된 마지막 동기화 가격 기준)
- [ ] 마크다운 리포트 생성
- [ ] Supabase Storage `reports` 버킷에 `{user_id}/daily/{report_date}.md` 업로드 성공
- [ ] `daily_reports` upsert 성공 (`(user_id, report_date)` 중복 시 덮어쓰기)
- [ ] `storage_path` 컬럼이 채워져 있고 Web App에서 미리보기 가능
- [ ] Portfolio App 분석 페이지의 리포트 영역에 리포트 표시
- [ ] Portfolio App 자산 페이지 상단 요약/`portfolio_view` 평가금액이 저장된 가격으로 계산됨
- [ ] Skill PRD에 옛 API 서버, 공유 API 키, Google Drive 기반 요구사항이 없음
