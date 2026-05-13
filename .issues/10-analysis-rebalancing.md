## What to build

분석 페이지의 `리밸런싱` 탭을 구현한다. `rebalance_suggestions`에서 리밸런싱 제안을 조회하고, detail drawer에서 액션 feed와 결정 기록 폼을 제공한다.

도메인 언어는 `rebalancing-skill/CONTEXT.md` 참조. JSONB 스키마는 아래에 명시.

## 리밸런싱 탭

- **필터 pills**: `결정 대기` (기본), `전체`, `반영`, `미반영`, `부분 반영`.
  - UI 라벨은 한국어, DB `status` enum은 그대로 저장: `pending`/`accepted`/`rejected`/`partial`.
- **마스터 카드**: 한 줄 요약 / status 배지(한국어 라벨) / `suggestion_date · 액션 N건 · 근거 리포트 M건 · 투자금`.
- `pending` 카드는 상단 고정 + warning 좌측 마커.

### status 배지 색 매핑

| DB 값 | UI 라벨 | 배지 색 |
|---|---|---|
| `pending` | 결정 대기 | `warning` |
| `accepted` | 반영 | `success` |
| `rejected` | 미반영 | `danger` |
| `partial` | 부분 반영 | `warning` (점선) |

## 리밸런싱 detail drawer

**헤더**: 한 줄 요약, status 배지(한국어).

**stat-row 3칸**: 투자 금액, 액션 수, 상태(한국어 + 색 강조).

**액션 feed** (`actions` JSONB):

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

표시: 계좌 · 티커 · BUY/SELL · 수량 · 예상 KRW · reason.

**근거 리포트 chips** (`based_on_reports` JSONB):

```json
[{ "report_date": "2026-05-05", "headline": "나스닥 반등, 성장주 매수 기회" }]
```

클릭 시 리포트 탭의 해당 카드 drawer 오픈.

**추론** (`reasoning`) + 본문 미리보기 버튼 (signed URL, `storage_path` 있을 때).

**결정 기록 폼** (drawer 내부 sticky):

| 필드 | 타입 | 비고 |
|---|---|---|
| `status` | radio | `결정 대기` / `반영` / `미반영` / `부분 반영` |
| `decided_at` | date | |
| `partially_applied` | checkbox list | `actions` 배열의 각 항목 |
| `note` | textarea | |

저장 시 한국어 라벨 → enum 매핑:
- `결정 대기` → `pending`
- `반영` → `accepted`
- `미반영` → `rejected`
- `부분 반영` → `partial`

저장 호출:
```js
from('rebalance_suggestions')
  .update({ status, user_decision: { decided_at, note, partially_applied } })
  .eq('id', id)
```

`user_decision` JSONB 구조:
```json
{
  "decided_at": "2026-05-06",
  "note": "나스닥 50주만 매수, 채권 조정은 보류",
  "partially_applied": ["미래에셋 일반 TIGER 미국나스닥100 50주 매수"]
}
```

**형제 탐색 정렬**: status별(`pending` 우선) → `suggestion_date` 내림차순.

## Supabase 호출

| 작업 | 호출 |
|---|---|
| 제안 목록 | `from('rebalance_suggestions').select().order('status').order('suggestion_date', { ascending: false })` |
| 결정 저장 | `from('rebalance_suggestions').update({ status, user_decision }).eq('id', id)` |
| 본문 signed URL | `storage.from('reports').createSignedUrl(storage_path, 60)` |

## Acceptance criteria

- [ ] 리밸런싱 탭에 `결정 대기 / 전체 / 반영 / 미반영 / 부분 반영` 필터 pills가 있다
- [ ] 마스터 카드 status 배지가 한국어 라벨로 표시된다
- [ ] `pending` 카드가 상단 고정 + warning 좌측 마커로 표시된다
- [ ] detail drawer stat-row에 투자 금액, 액션 수, 상태가 표시된다
- [ ] `actions` feed에 계좌·티커·BUY/SELL·수량·예상 KRW·reason이 표시된다
- [ ] `based_on_reports` chips 클릭 시 리포트 탭의 해당 drawer로 deep link된다
- [ ] 결정 기록 폼에 status 라디오(4종), `decided_at`, `partially_applied` 체크박스, `note`가 있다
- [ ] 저장 시 한국어 라벨이 enum(`pending`/`accepted`/`rejected`/`partial`)으로 매핑된다
- [ ] `from('rebalance_suggestions').update({ status, user_decision }).eq('id', id)` 호출이 수행된다
- [ ] `storage_path`가 있으면 signed URL로 본문 미리보기가 가능하다
- [ ] drawer 헤더에 prev/next + `1/N` 위치가 있고 `pending` 우선 → `suggestion_date` 내림차순으로 형제 탐색된다

## Blocked by

- #1 (스키마 — rebalance_suggestions)
- #2 (Auth)
- #9 (리포트 탭 — deep link 상호 참조)
