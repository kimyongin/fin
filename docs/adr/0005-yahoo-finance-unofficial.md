# Yahoo Finance 비공식 JSON 엔드포인트 사용

`sync-prices` Edge Function은 Yahoo Finance 공식 API 대신 비공식 JSON 엔드포인트를 직접 fetch한다.

```
https://query1.finance.yahoo.com/v8/finance/chart/<ticker>?interval=1d&range=...
```

## 이유

Yahoo Finance는 공식 공개 API를 제공하지 않는다. 유료 대안(Alpha Vantage, Polygon.io 등)은 추가 비용이 발생한다. yfinance 라이브러리가 내부적으로 사용하는 이 엔드포인트가 현재 가장 현실적인 무료 선택지다.

## 결과

- 엔드포인트 형식이 변경되거나 차단될 수 있다. 실패 시 사용자가 자료 페이지에서 가격을 수동 입력(`source = 'manual'`)한다.
- 인증 키가 없으므로 환경 변수 관리가 필요 없다.
- 공식 API로 교체가 필요해지면 `sync-prices` Edge Function만 수정하면 된다.
