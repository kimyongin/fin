# Rebalancing Skill PRD

> **역할:** 사용자 수동 트리거. 최근 시장 리포트와 현재 포트폴리오를 종합해 구체적인 리밸런싱 액션을 제안한다. Supabase에 직접 접근.

Rebalancing Skill은 Claude Desktop 스킬로 실행된다. 사용자의 추가 투자 가능 금액과 제약을 묻고, Supabase에서 최근 리포트와 현재 포트폴리오를 조회해 리밸런싱 제안을 생성·저장한다.

---

# 1. 책임

1. 사용자에게 추가 투자 가능 금액과 제약 질문
2. Supabase `daily_reports` 최근 14일 직접 조회
3. Supabase `portfolio_view`로 현재 포트폴리오와 평가금액 직접 조회
4. Claude Desktop이 리밸런싱 분석 작성
5. 계좌별/종목별 구체 액션 제안
6. 선택적으로 상세 리포트(.md)를 Supabase Storage `reports` 버킷에 업로드
7. Supabase `rebalance_suggestions`에 직접 insert (`storage_path` 포함)
8. 사용자에게 액션 카드 목록과 근거 출력

---

# 2. 구성

```text
skills/rebalancing/
├── SKILL.md
├── helpers/
│   └── supabase_client.py     # 리포트/포트폴리오 조회, 제안 insert, Storage 업로드
├── output/
└── .env
```

---

# 3. 기술 스택

```text
python
supabase                    # supabase-py (Storage 포함)
```

---

# 4. 환경 변수

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_OWNER_EMAIL=<portfolio-owner-email>
SUPABASE_OWNER_PASSWORD=<long-random-string>
```

Google OAuth 관련 환경 변수는 사용하지 않는다(본문 저장이 Supabase Storage로 통합됨).

- **service_role key는 사용하지 않는다.** Web App과 동일한 anon key + RLS.
- Market Analysis Skill, Web App과 같은 포트폴리오 소유자 계정으로 로그인:

  ```python
  sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
  sb.auth.sign_in_with_password({
      "email": os.environ["SUPABASE_OWNER_EMAIL"],
      "password": os.environ["SUPABASE_OWNER_PASSWORD"],
  })
  ```

- INSERT 시 `user_id`는 포트폴리오 소유자의 `auth.uid()`로 자동 채워짐(DDL DEFAULT). Web App과 같은 `auth.uid()`이므로 저장된 제안은 분석 페이지에서 바로 보인다.

---

# 5. 사용자 입력

시작 시 사용자에게 반드시 묻는다.

```text
이번에 추가 투자 가능한 금액은? 없으면 0으로 알려주세요.
```

```text
특별한 제약이나 선호가 있나요? 예: 미국 비중 늘리기, 채권 줄이기, 현금 유지, 특정 종목 매수 금지.
```

입력값은 `investment_amount`, `reasoning`, `actions`에 반영한다.

---

# 6. 실행 절차

## 6.1 최근 리포트 조회

```python
from supabase import create_client
sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
sb.auth.sign_in_with_password({"email": ..., "password": ...})

reports = sb.table('daily_reports').select('*') \
    .order('report_date', desc=True) \
    .limit(14) \
    .execute().data
```

## 6.2 현재 포트폴리오 조회

```python
# portfolio_view가 평가금액·미실현손익까지 계산해서 반환
portfolio = sb.table('portfolio_view').select('*').execute().data
```

비중은 `market_value_krw`의 합계 대비 비율로 클라이언트가 계산. 환산 규칙 자체는 view에 들어가 있으므로 스킬 코드에 환율 로직이 필요 없다([Portfolio App PRD](./PRD_PORTFOLIO_APP.md) §9 참고).

## 6.3 Claude Desktop이 분석 작성

포함 항목:
- 최근 14일 리포트의 반복 신호
- 시장 사이클 변화
- 현재 포트폴리오의 강점/약점
- 현재 종목별 비중과 사용자 태그 관점의 노출
- 사용자 추가 투자 금액과 제약 반영
- 구체적인 매수/매도/관망 액션

## 6.4 구체 액션 작성

액션은 계좌, 종목, 방향, 수량 또는 금액, 이유를 포함한다.

예:

```text
미래에셋 일반 - TIGER 미국나스닥100 50주 매수, 약 250만원, 미국 성장주 비중 확대 목적
```

## 6.5 선택적 본문 Storage 업로드

```python
user_id = sb.auth.get_user().user.id
storage_path = f'{user_id}/rebalancing/{suggestion_date}.md'

sb.storage.from_('reports').upload(
    storage_path,
    md_content.encode('utf-8'),
    {'content-type': 'text/markdown', 'upsert': 'true'},
)
```

## 6.6 제안 저장

```python
sb.table('rebalance_suggestions').insert({
    'suggestion_date': '2026-05-05',
    'investment_amount': 5000000,
    'reasoning': '...',
    'actions': [...],
    'based_on_reports': [...],
    'storage_path': storage_path,   # 본문이 있으면, 없으면 None
}).execute()
```

성공 여부는 Supabase 응답과 Portfolio App 분석 페이지의 리밸런싱 영역 표시 여부로 판단한다.

## 6.7 사용자에게 결과 출력

출력 항목:
- 액션 카드 목록
- 핵심 근거
- 리스크
- Portfolio App 분석 페이지의 리밸런싱 영역에서 채택/거부/부분 채택을 기록하라는 안내

---

# 7. 사용하는 Supabase 자원

| 작업 | 호출 |
|---|---|
| 최근 리포트 조회 | `from('daily_reports').select().order('report_date', desc=True).limit(14)` |
| 보유 종목 + 평가금액 조회 | `from('portfolio_view').select()` |
| 본문 업로드 (선택) | `storage.from_('reports').upload(f'{user_id}/rebalancing/{date}.md', ...)` |
| 제안 저장 | `from('rebalance_suggestions').insert({...})` (`storage_path` 포함) |

스키마 상세는 [Portfolio App PRD](./PRD_PORTFOLIO_APP.md) §6, §10을 따른다.

---

# 8. 저장 데이터

`rebalance_suggestions` 행 구조:

```json
{
  "suggestion_date": "2026-05-05",
  "investment_amount": 0,
  "reasoning": "",
  "actions": [],
  "based_on_reports": [],
  "storage_path": "<user_id>/rebalancing/2026-05-05.md"
}
```

JSONB 필드 권장 구조는 [Portfolio App PRD §10](./PRD_PORTFOLIO_APP.md)을 따른다.

`actions` 예시:

```json
[
  {
    "account_name": "미래에셋 일반",
    "ticker": "133690",
    "display_name": "TIGER 미국나스닥100",
    "action": "BUY",
    "quantity": 50,
    "estimated_amount_krw": 2500000,
    "reason": "미국 성장주 비중 확대"
  }
]
```

`based_on_reports` 예시:

```json
[
  {
    "report_date": "2026-05-05",
    "headline": "나스닥 반등, 성장주 모멘텀 회복"
  }
]
```

---

# 9. 실패 처리

- 최근 14일 리포트가 없으면 사용자에게 분석 한계와 함께 알린다.
- Supabase 응답 실패 시 사용자에게 알리고 저장하지 않는다.
- 투자 가능 금액이 0이면 신규 매수보다 매도/비중 조정/관망 중심으로 제안한다.
- Storage 업로드 실패 시 `storage_path = null`로 저장하고 사용자에게 알린다.

---

# 10. 검증 체크리스트

- [ ] Supabase 클라이언트 초기화 + 포트폴리오 소유자 로그인 성공 (anon key 사용)
- [ ] `service_role key`가 환경 변수에 존재하지 않음
- [ ] 사용자에게 투자 가능 금액 질문
- [ ] 사용자에게 제약/선호 질문
- [ ] 최근 14일 `daily_reports` 조회 성공
- [ ] `portfolio_view` 조회로 보유 종목 + 평가금액 획득
- [ ] 액션이 계좌/종목/수량 또는 금액을 포함
- [ ] `rebalance_suggestions` insert 성공 (`storage_path` 컬럼 포함)
- [ ] (본문 업로드 시) Supabase Storage `reports` 버킷에 `{user_id}/rebalancing/{date}.md` 업로드 성공
- [ ] Portfolio App 분석 페이지의 리밸런싱 영역에 제안 표시 + 본문 미리보기 가능
- [ ] Skill PRD에 옛 API 서버, 공유 API 키, Google Drive 기반 요구사항이 없음
