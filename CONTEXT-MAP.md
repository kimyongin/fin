# Context Map

개인 투자 포트폴리오를 관리하고 매일 시장 분석·리밸런싱 제안을 생성하는 재테크 시스템.

## Contexts

- [Portfolio App](./portfolio-app/CONTEXT.md) — 순수 HTML/JS 웹 앱과 Supabase 백엔드(스키마, RLS, 트리거, Edge Function, Storage)를 소유
- [Market Analysis Skill](./market-analysis-skill/CONTEXT.md) — 매일 아침 시장 뉴스·지표를 분석해 리포트를 생성하고 Supabase에 저장
- [Rebalancing Skill](./rebalancing-skill/CONTEXT.md) — 사용자 수동 트리거로 리밸런싱 액션을 제안하고 Supabase에 저장

## 시스템 전반 개념

**Portfolio Owner** (포트폴리오 소유자):
이 시스템의 단일 사용자. Web App과 Skills가 공유하는 하나의 Supabase Auth 계정. Web App은 이메일 로그인 링크로, Skills는 같은 계정의 이메일+비밀번호로 로그인하며 동일한 `auth.uid()`를 사용한다. 다중 사용자 확장을 고려하지 않는다.

**anon key**:
Web App과 Skills가 공통으로 사용하는 공개 Supabase 클라이언트 키. 실제 데이터 접근은 Auth 세션과 RLS가 보호하므로 번들에 노출되어도 안전하다. `service_role key`는 사용하지 않는다.

**storage_path**:
Supabase Storage `reports` 버킷 안의 리포트·리밸런싱 본문 경로(`{user_id}/daily/{date}.md` 등). DB에는 전문 대신 이 경로만 저장한다. → [ADR-0003](./docs/adr/0003-report-body-in-storage.md)

**KST 기준 날짜**:
모든 DATE 컬럼(`report_date`, `suggestion_date`, `trade_date`, `price_date`)은 한국 시간(KST, UTC+9) 기준 날짜로 해석한다. TIMESTAMPTZ는 UTC 저장, 표시 시 클라이언트가 KST 변환.

## Relationships

- **Portfolio App → Skills**: Portfolio App이 DB 스키마·RLS·`portfolio_view`를 소유. Skills는 같은 Supabase 프로젝트에 직접 접근하되 스키마를 변경하지 않는다.
- **Market Analysis Skill → Portfolio App**: `daily_reports`와 `portfolio_snapshots`에 write. `portfolio_view`에서 read.
- **Rebalancing Skill → Portfolio App**: `rebalance_suggestions`에 write. `portfolio_view`·`daily_reports`에서 read.
- **Skills 실행 환경**: Claude Desktop 로컬 실행. API 추가 비용 없이 구독 모델 활용. → [ADR-0004](./docs/adr/0004-skills-on-claude-desktop.md)
