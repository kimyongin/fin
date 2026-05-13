# Rebalancing Skill

사용자 수동 트리거로 최근 리포트와 현재 포트폴리오를 종합해 리밸런싱 액션을 제안하고 `rebalance_suggestions`에 저장하는 스킬. Claude Desktop에서 실행된다.

## Language

**Rebalancing Action** (리밸런싱 액션):
계좌·종목·방향(BUY/SELL/HOLD)·수량·예상 금액·이유를 포함한 구체적 실행 제안 단위. `rebalance_suggestions.actions` JSONB 배열의 원소.
_Avoid_: 거래 제안(실제 거래가 아닌 제안), 매매 신호

**User Decision** (결정 기록):
사용자가 리밸런싱 제안에 대해 반영/미반영/부분 반영을 기록하는 행위. `rebalance_suggestions.status`와 `user_decision` JSONB에 저장된다. Rebalancing Skill이 생성하고 Web App에서 기록한다.
_Avoid_: 승인, 확정

**Weekly Review** (주간 리뷰):
권장 실행 주기. 매주 1회 Rebalancing Skill을 실행해 테마 비중과 사이클 변화를 점검한다.

**Investment Guidelines**:
제안 생성 시 따르는 투자 방향성 문서. [`skills/INVESTMENT_GUIDELINES.md`](../skills/INVESTMENT_GUIDELINES.md)에 위치. ETF 우선·균형형·테마 기반·단기 모멘텀 배제 원칙을 담는다.

## Relationships

- `daily_reports` → 최근 14일 리포트 조회 (Portfolio App 소유)
- `portfolio_view` → 현재 포지션·평가금액 조회 (Portfolio App 소유)
- `rebalance_suggestions` → 제안 insert (Portfolio App 소유)
- `reports` Storage 버킷 → 리밸런싱 본문 업로드 (선택)
