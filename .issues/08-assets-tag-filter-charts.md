## What to build

자산 페이지 종목 탭의 태그 필터, 포트폴리오 구성 차트, 그리고 보유 종목 detail drawer의 매매 타임라인 차트를 구현한다.

도메인 언어는 `portfolio-app/CONTEXT.md`, 시각 토큰은 동일 파일 `## UI 패턴 > 시각 토큰` 섹션 참조.

## 태그 필터

- 자산 종목 탭 상단에 태그 pill 나열.
- **다중 선택 토글 + AND 매칭**: 선택한 태그를 모두 가진 종목만 목록과 차트에 남긴다.
- 아무 태그도 선택하지 않으면 전체 종목 표시.
- 태그 pill 순서는 `tags.sort_order`.
- 태그 데이터 출처: `from('tags').select().order('sort_order')` + `from('instrument_tags').select()`.

## 포트폴리오 구성 차트

- **형태**: stacked horizontal bar (높이 10px) + 범례.
- **색 팔레트 (6단)**: `accent(#ff8a00) → info(#60a5fa) → success(#22c55e) → purple(#a78bfa) → warning(#f59e0b) → slate(#94a3b8)`.
- 데이터: 필터링된 종목의 `market_value_krw` 비중 (`market_value_krw / SUM` 클라이언트 계산).
- **드릴다운**: 막대 segment 또는 범례 행 클릭 → 해당 보유 종목 detail drawer 오픈.
- `weight_pct`는 `portfolio_view`에 없으므로 클라이언트가 계산.

## 매매 타임라인 차트

보유 종목 detail drawer 안에 위치.

### 차트 사양

- **SVG line + accent area fill + 점선 그리드 3줄**.
- 제목 우측 해상도 segmented control `1D / 1M` (기본 `1M`). 선택 상태는 차트별로 독립.
- **X축**: 첫 거래일 또는 90일 전 ~ 현재.
- **Y축**: 종가 범위. 우상단/우하단에 high/low 텍스트 라벨.

### 마커

- BUY = `success`(#22c55e) 마커.
- SELL = `danger`(#ef4444) 마커.
- hover 시 `<title>` 툴팁: 거래일·수량·단가.

### 하단 축

`시작일 / 현재가 / 종료일` + 범례 (BUY N건 · SELL M건 · 종가).

### USD 종목

USD 단위로 그리고 환산 안내 한 줄 추가.

### 데이터 출처

| 시리즈 | 호출 |
|---|---|
| 종가 line | `from('holding_prices_daily').select().eq('ticker', ticker).order('price_date').range(from, to)` |
| 거래 마커 | `from('transactions').select().eq('ticker', ticker).eq('account_id', account_id)` |

## Acceptance criteria

- [ ] 종목 탭 상단에 태그 pill이 `tags.sort_order` 순으로 나열된다
- [ ] 태그 다중 선택 AND 매칭이 동작한다 (선택한 모든 태그를 가진 종목만 표시)
- [ ] 아무 태그도 선택하지 않으면 전체 종목이 표시된다
- [ ] 포트폴리오 구성 차트가 stacked horizontal bar (높이 10px) + 범례로 렌더링된다
- [ ] 차트 segment 팔레트가 `accent → info → success → purple → warning → slate` 순을 따른다
- [ ] 막대 segment 또는 범례 클릭 시 해당 종목 detail drawer가 오픈된다
- [ ] 비중이 `market_value_krw / SUM(market_value_krw)`으로 클라이언트에서 계산된다
- [ ] 매매 타임라인 차트에 SVG line + area fill + 점선 그리드 3줄이 렌더링된다
- [ ] 해상도 segmented control `1D/1M`이 있고 기본값이 `1M`이다
- [ ] BUY 마커가 success(녹), SELL 마커가 danger(적)으로 표시된다
- [ ] hover 시 거래일·수량·단가 툴팁이 표시된다
- [ ] USD 종목에서 환산 안내 한 줄이 표시된다

## Blocked by

- #1 (스키마)
- #2 (Auth)
- #7 (보유 종목 목록 + detail drawer — 차트를 이 위에 구축)
