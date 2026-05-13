# Portfolio App

Next.js 웹 앱과 Supabase 백엔드(스키마, RLS, 트리거, Edge Function, Storage)를 하나의 단위로 소유하는 컨텍스트. Skills는 같은 Supabase 프로젝트에 직접 접근하지만 이 컨텍스트 밖이다.

## 기술 스택

- **Web**: 순수 HTML/JS, GitHub Pages 배포. 빌드 단계 없음.
- **Supabase SDK**: `@supabase/supabase-js` 클라이언트 전용 (CDN 또는 ESM). `@supabase/ssr` 미사용.
- **Auth redirect**: 클라이언트 사이드 라우트 가드. Next.js middleware 없음.

→ 결정 배경: [ADR-0001](../docs/adr/0001-static-html-github-pages.md)

## Language

### 가격 수집 대상

**Instrument** (종목):
투자 보유·거래·가격 수집의 대상 코드. `instrument_type`이 `stock`, `etf`, `fund`, `cash`, `other`인 것.
_Avoid_: 종목 마스터(구현 용어), asset

**FX Rate** (환율 코드):
KRW 환산을 위한 보조 코드. 투자 대상이 아니라 환산 도구. `instrument_type = 'fx'`인 것. 대표: `USDKRW=X`.
_Avoid_: 환율 종목, fx 종목

> Instrument와 FX Rate는 `instruments` DB 테이블을 공유하지만 도메인 개념은 다르다. UI는 자료 페이지에서 `환율 / 종목` 탭으로 분리해 표시한다.

**Ticker**:
외부 가격 소스와 내부 DB에서 공통으로 사용하는 코드 식별자. 사용자별로 유일(`UNIQUE(user_id, ticker)`). 화면 표시에는 `display_name`을 사용한다.
_Avoid_: symbol, code

### 계좌와 거래

**Account** (계좌):
투자 종목을 담는 포트폴리오 컨테이너. 통화 속성을 갖지 않는다. 통화는 계좌가 아닌 Instrument 레벨에서 관리한다.
_Avoid_: 지갑, 펀드

**Transaction** (거래):
매수(BUY) 또는 매도(SELL) 원장 레코드. Holding 재계산의 유일한 근거. 거래를 insert/update/delete하면 트리거가 Holding을 자동 갱신한다.
_Avoid_: 주문, 체결

**Sync** (동기화):
`sync-prices` Edge Function을 호출해 보유 Instrument와 FX Rate의 누락 가격을 채우는 작업. Web App "동기화" 버튼에서만 트리거한다. Skills는 실행하지 않는다.
_Avoid_: 업데이트, 새로고침

### 보유 상태

**Holding**:
계좌별 현재 보유 수량과 평균단가. `transactions` 트리거가 자동 갱신하는 파생 상태. `holdings` 테이블로 표현.
_Avoid_: 보유 종목(UI 표현과 혼동), position(평가금액 포함 개념과 구분)

**Position**:
Holding에 최신 가격·평가금액·미실현손익·비중까지 계산된 현재 상태. `portfolio_view` 한 행이 하나의 Position. 화면의 "보유 종목 카드"가 표시하는 것.
_Avoid_: holding(원본 수량/단가만 있는 개념과 구분)

**Initial Load** (초기 적재):
거래 원장 없이 현재 보유 상태를 `holdings`에 직접 insert하는 공식 허용 작업. 오래된 보유 종목처럼 과거 거래 내역이 없을 때 사용. 이후 `transactions`를 입력하면 트리거가 덮어쓴다.
_Avoid_: seed, migration(DB 스키마 변경과 혼동)

### 계산 레이어

**portfolio_view**:
Holding에 최신 가격·KRW 환산·미실현손익을 합산한 표준 view. 모든 클라이언트(Web App, Skills)가 평가금액 조회에 이것만 사용한다. `weight_pct`(비중)는 포함하지 않는다 — 태그 필터 적용 시 "필터된 종목끼리의 비중"이 필요하므로 클라이언트가 `market_value_krw / SUM`으로 그때그때 계산한다.
_Avoid_: holdings(수량·평단만 있는 원본 테이블과 구분)

## Example dialogue

> **Dev:** "보유 종목 화면에 비중을 보여주려면 어디서 가져와요?"
> **Domain expert:** "`portfolio_view`를 select하면 `market_value_krw`가 나와요. Position마다 그 값을 전체 합계로 나누면 비중이 됩니다. view에 비중 컬럼은 없어요 — 태그 필터를 적용하면 필터된 것들끼리의 비중이 달라지거든요."

> **Dev:** "거래를 추가했는데 holdings 테이블을 직접 업데이트해야 하나요?"
> **Domain expert:** "아니요. `transactions`에 insert 하나만 하면 트리거가 Holding을 자동으로 재계산합니다. holdings를 직접 건드리는 건 Initial Load 때만요."

## Flagged ambiguities

- "instrument"가 주식/ETF와 환율 코드를 모두 가리키는 데 혼용됨 — 해소: Instrument(투자 종목)와 FX Rate(환율 코드)는 별도 개념이며 DB만 공유한다.
