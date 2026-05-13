## What to build

분석 페이지의 `리포트` 탭을 구현한다. `daily_reports`에서 시장 분석 리포트를 조회하고, detail drawer에서 시장 지표, 매매 제안, 리스크 경고, 본문 미리보기를 표시한다.

도메인 언어는 `market-analysis-skill/CONTEXT.md` 참조. JSONB 스키마는 아래에 명시.

## 페이지 구조

```
/analysis
├── hero: report_date + cycle_phase + 뉴스 N건 + pending 리밸런싱 카운트
└── 탭: 리포트 | 리밸런싱
```

### 분석 hero

- **큰 텍스트**: 활성 리포트의 `report_date`.
- **보조**: `cycle_phase · 뉴스 N건` + 카운트 (매매 제안 N · 리스크 M · pending 리밸런싱 K).
- hero 아래 전체폭 segmented `리포트 / 리밸런싱`. 리밸런싱 탭에 pending 카운트 배지.

## 리포트 탭

- **필터 pills**: `최근 14일` (기본), 사이클(회복/주의/중립), 리스크 high.
- **마스터 카드**: `headline / cycle 배지 / report_date · 뉴스 N건 · 핵심 지표 1~2개`.

### cycle_phase 배지 색 매핑

| DB 값 | UI 라벨 | 배지 색 |
|---|---|---|
| `recovery` | 회복 | `success` |
| `caution` | 주의 | `warning` |
| `neutral` | 중립 | `neutral` |

### 리포트 detail drawer

**헤더**: headline, report_date, cycle 배지.

**시장 지표 그리드** (`indicators` JSONB):

| 키 | 표시 |
|---|---|
| `sp500`, `sp500_change_pct` | S&P 500 값 + 등락% |
| `nasdaq`, `nasdaq_change_pct` | Nasdaq 값 + 등락% |
| `kospi`, `kospi_change_pct` | KOSPI 값 + 등락% |
| `usdkrw` | USD/KRW |
| `vix` | VIX |

`indicators` JSONB 예시:
```json
{
  "sp500": 5200.1, "sp500_change_pct": -0.5,
  "nasdaq": 18300.2, "nasdaq_change_pct": -0.8,
  "kospi": 2680.5, "kospi_change_pct": 0.3,
  "usdkrw": 1380.0,
  "vix": 18.5
}
```

**매매 제안 feed** (`trade_suggestions` JSONB):
- action 배지(`BUY`/`SELL`/`HOLD`) + ticker + reason.

```json
[{ "action": "BUY", "ticker": "133690", "display_name": "TIGER 미국나스닥100", "reason": "..." }]
```

**리스크 경고 feed** (`risk_warnings` JSONB):
- level 배지(`low`/`medium`/`high`) + message.

```json
[{ "level": "high", "message": "..." }]
```

**본문 미리보기:**
- `동기화` 버튼 → drawer 안 접이식 preview.
- ```js
  const { data } = await supabase.storage.from('reports').createSignedUrl(report.storage_path, 60)
  ```
- `storage_path`가 null이면 버튼 숨김.

**리밸런싱 deep link**: `이 리포트 기반 리밸런싱 보기` 버튼 → 리밸런싱 탭의 해당 카드 drawer 오픈.

**형제 탐색 정렬**: `report_date` 내림차순.

## Supabase 호출

| 작업 | 호출 |
|---|---|
| 리포트 목록 | `from('daily_reports').select().order('report_date', { ascending: false }).limit(14)` |
| 본문 signed URL | `storage.from('reports').createSignedUrl(storage_path, 60)` |

## Acceptance criteria

- [ ] 분석 hero에 최신 `report_date`, `cycle_phase`, `news_count`가 표시된다
- [ ] 리포트 탭에 `최근 14일` / 사이클 / 리스크 high 필터 pills가 있다
- [ ] 마스터 카드에 headline, cycle 배지, report_date, 뉴스 건수가 표시된다
- [ ] cycle_phase가 DB 값 `recovery`/`caution`/`neutral`을 한국어 라벨 + 색으로 표시한다
- [ ] detail drawer에 `indicators` 5종(sp500/nasdaq/kospi/usdkrw/vix) 그리드가 표시된다
- [ ] `trade_suggestions` feed에 action 배지(BUY/SELL/HOLD) + ticker + reason이 표시된다
- [ ] `risk_warnings` feed에 level 배지(low/medium/high) + message가 표시된다
- [ ] `storage_path`가 있으면 signed URL로 본문 미리보기가 가능하다
- [ ] `storage_path`가 null이면 미리보기 버튼이 숨겨진다
- [ ] `이 리포트 기반 리밸런싱 보기` 버튼이 리밸런싱 탭으로 deep link된다
- [ ] drawer 헤더에 prev/next + `1/N` 위치가 있고 `report_date` 내림차순으로 형제 탐색된다

## Blocked by

- #1 (스키마 — daily_reports)
- #2 (Auth)
