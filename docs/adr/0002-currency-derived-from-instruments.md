# 통화는 instruments에서 도출, transactions/holding_prices_daily에 저장하지 않음

`transactions`와 `holding_prices_daily`에 `currency` 컬럼을 두지 않는다. 통화는 항상 `instruments.currency`를 join해서 쓴다.

## 이유

같은 종목의 거래마다 `currency`를 반복 저장하면 `instruments.currency`와 불일치가 생길 수 있다. 종목의 거래 통화는 종목 자체의 속성이므로 `instruments`가 단일 출처가 되어야 한다.

## 주의

`transactions.currency` 또는 `holding_prices_daily.currency` 컬럼이 없는 것은 버그가 아니라 의도된 설계다. 추가하지 않는다.
