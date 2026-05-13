## What to build

사용자 수동 트리거로 최근 리포트와 현재 포트폴리오를 종합해 리밸런싱 액션을 제안하고 `rebalance_suggestions`에 저장하는 Claude Desktop 스킬을 구현한다.

도메인 언어는 `rebalancing-skill/CONTEXT.md`, 투자 방향성은 `skills/INVESTMENT_GUIDELINES.md` 참조.

## 디렉토리 구조

```
rebalancing-skill/
├── SKILL.md
├── helpers/
│   └── supabase_client.py
├── output/
└── .env
```

## 기술 스택

```
python
supabase  # supabase-py (Storage 포함)
```

## 환경 변수

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_OWNER_EMAIL=<portfolio-owner-email>
SUPABASE_OWNER_PASSWORD=<long-random-string>
```

- **`service_role key` 사용 금지** — anon key + RLS.
- Market Analysis Skill, Web App과 같은 계정으로 로그인:

```python
sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
sb.auth.sign_in_with_password({
    "email": os.environ["SUPABASE_OWNER_EMAIL"],
    "password": os.environ["SUPABASE_OWNER_PASSWORD"],
})
```

## 실행 절차

### 1. 사용자 입력

실행 시 반드시 묻는다:

```
이번에 추가 투자 가능한 금액은? 없으면 0으로 알려주세요.
```

```
특별한 제약이나 선호가 있나요? 예: 미국 비중 늘리기, 채권 줄이기, 현금 유지, 특정 종목 매수 금지.
```

입력값은 `investment_amount`, `reasoning`, `actions`에 반영한다.

### 2. 최근 리포트 조회 (최근 14일)

```python
reports = sb.table('daily_reports').select('*') \
    .order('report_date', desc=True) \
    .limit(14) \
    .execute().data
```

### 3. 현재 포트폴리오 조회

```python
portfolio = sb.table('portfolio_view').select('*').execute().data
# 비중 = market_value_krw / sum 클라이언트 계산
```

환율 로직은 view에 있으므로 스킬 코드에 환율 계산 로직이 필요 없다.

### 4. Claude Desktop 분석 작성

포함 항목:
- 최근 14일 리포트의 반복 신호
- 시장 사이클 변화
- 현재 포트폴리오 강점/약점
- 종목별 비중과 사용자 태그 관점의 노출
- 사용자 추가 투자 금액과 제약 반영
- 구체적인 BUY/SELL/HOLD 액션

Investment Guidelines(`skills/INVESTMENT_GUIDELINES.md`)의 ETF 우선·균형형·테마 기반·주간 리뷰 원칙을 반영한다.

### 5. 선택적 Storage 업로드

```python
user_id = sb.auth.get_user().user.id
storage_path = f'{user_id}/rebalancing/{suggestion_date}.md'
sb.storage.from_('reports').upload(
    storage_path,
    md_content.encode('utf-8'),
    {'content-type': 'text/markdown', 'upsert': 'true'},
)
```

### 6. 제안 저장

```python
sb.table('rebalance_suggestions').insert({
    'suggestion_date': '2026-05-05',
    'investment_amount': 5000000,
    'reasoning': '...',
    'actions': [...],
    'based_on_reports': [...],
    'storage_path': storage_path,  # 없으면 None
}).execute()
```

### 7. 사용자에게 결과 출력

- 액션 카드 목록
- 핵심 근거
- 리스크
- Portfolio App 분석 페이지에서 채택/거부/부분 채택을 기록하라는 안내

## 저장 JSONB 구조

`actions`:
```json
[{
  "account_name": "미래에셋 일반",
  "ticker": "133690",
  "display_name": "TIGER 미국나스닥100",
  "action": "BUY",
  "quantity": 50,
  "estimated_amount_krw": 2500000,
  "reason": "미국 성장주 비중 확대"
}]
```

`based_on_reports`:
```json
[{ "report_date": "2026-05-05", "headline": "나스닥 반등, 성장주 모멘텀 회복" }]
```

## 실패 처리

- 최근 14일 리포트 없음 → 사용자에게 분석 한계와 함께 알림.
- Supabase 응답 실패 → 저장하지 않고 사용자에게 알림.
- 투자 가능 금액 0 → 신규 매수보다 매도/비중 조정/관망 중심 제안.
- Storage 업로드 실패 → `storage_path = null`로 저장 + 사용자 알림.

## Acceptance criteria

- [ ] Supabase anon key로 로그인 성공 (`service_role key` 환경 변수에 없음)
- [ ] 실행 시 투자 가능 금액과 제약/선호를 사용자에게 묻는다
- [ ] 최근 14일 `daily_reports` 조회 성공
- [ ] `portfolio_view`에서 보유 종목 + 평가금액 조회 성공
- [ ] 액션이 계좌/종목/수량 또는 금액/이유를 포함한다
- [ ] `rebalance_suggestions` insert 성공 (`storage_path` 포함)
- [ ] Storage 업로드 시 `{user_id}/rebalancing/{date}.md` 경로로 업로드된다
- [ ] Portfolio App 분석 페이지 리밸런싱 영역에 제안이 표시되고 본문 미리보기가 가능하다
- [ ] Investment Guidelines(ETF 우선·균형형·테마 기반·주간 리뷰)가 액션에 반영된다
- [ ] 최근 14일 리포트가 없으면 사용자에게 분석 한계를 알린다

## Blocked by

- #1 (스키마 — rebalance_suggestions, portfolio_view, Storage 버킷)
- #2 (Auth — 이메일+비밀번호 로그인 설정)
- #11 (Market Analysis Skill — 리포트가 있어야 실질적인 제안 생성 가능)
