# Skills는 호스팅 서비스가 아닌 Claude Desktop에서 실행

Market Analysis Skill과 Rebalancing Skill은 별도 서버나 cron job이 아니라 로컬 Claude Desktop에서 실행한다.

## 이유

Claude Desktop 구독을 이미 사용 중이므로 Anthropic API를 별도로 호출하면 구독 요금 외 추가 API 비용이 발생한다. Claude Desktop 스킬로 실행하면 추가 비용 없이 동일한 모델을 사용할 수 있다.

## 결과

- Skills는 항상 로컬 머신에서 수동 또는 Claude Desktop Scheduler로 실행된다.
- 서버 배포, 별도 LLM API 키, 호스팅 cron 인프라가 필요 없다.
- 머신이 꺼져 있으면 스킬이 실행되지 않는다 — 이는 허용된 제약이다(단일 사용자 로컬 운영).
