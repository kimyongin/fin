# Market Analysis Skill

매일 아침 시장 뉴스·지표를 수집하고, Investment Guidelines에 따라 분석해 `daily_reports`에 저장하는 스킬. Claude Desktop에서 실행된다.

## Language

**Market Cycle** (시장 사이클):
장기 시장 흐름 판단. `recovery`(회복) / `caution`(주의) / `neutral`(중립) 세 값 중 하나로 매 리포트마다 업데이트된다. 단기 급등·급락이 아닌 추세와 사이클 전환 신호로 판단한다.
_Avoid_: 시장 상황, 트렌드(단기 모멘텀과 혼동)

**Theme** (테마):
리밸런싱의 방향을 결정하는 섹터 단위 투자 렌즈. 현재: 전력·반도체·바이오. Investment Guidelines에서 관리하며 리포트는 각 테마별 뉴스 흐름과 사이클 위치를 평가한다.
_Avoid_: 섹터(광범위한 의미), 산업군

**Investment Guidelines**:
이 스킬이 분석과 매매 제안 생성 시 따르는 투자 방향성 문서. [`skills/INVESTMENT_GUIDELINES.md`](../skills/INVESTMENT_GUIDELINES.md)에 위치.

## Relationships

- `portfolio_view` → 현재 보유 포지션과 평가금액 컨텍스트 조회 (Portfolio App 소유)
- `daily_reports` → 리포트 요약 저장 (Portfolio App 소유)
- `portfolio_snapshots` → 당일 스냅샷 upsert
- `reports` Storage 버킷 → 리포트 전문 업로드
