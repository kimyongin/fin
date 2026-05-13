## What to build

자료 페이지의 `환율 / 종목 / 태그` 3개 탭을 구현한다. 각 탭은 master 카드 리스트 + detail drawer 구조다. Instrument CRUD, FX Rate CRUD, Tag CRUD를 포함한다.

도메인 언어는 `portfolio-app/CONTEXT.md` (Instrument vs FX Rate 개념 구분 포함), UI 패턴은 동일 파일의 Drawer 패턴 섹션 참조.

## 페이지 구조

```
/data
├── hero strip: synced/total + 마지막 실행 + 실패 건수 (sync_runs 최신 행 기준)
└── 탭: 환율 | 종목 | 태그
```

- hero에는 생성/동기화 전역 버튼을 두지 않는다.

## 환율 탭

- 대상: `instrument_type = 'fx'` 항목.
- 카드: `display_name · ticker` / 동기화 배지(`success`=sync / `warning`=manual / `danger`=failed) / 최근 가격.

### 환율 detail drawer

view/edit/create/delete-confirm 모드 공유.

**메타데이터 폼 필드:**

| 필드 | 타입 | 비고 |
|---|---|---|
| `ticker` | text (PK) | create에서만 입력, 이후 disabled |
| `display_name` | text | |
| `instrument_type` | dropdown | `fx` 고정 또는 선택 |
| `currency` | text | KRW/USD 등 |
| `price_source` | text | 기본 `yfinance` |
| `source_symbol` | text | 외부 소스 식별 코드. 비우면 ticker 그대로 사용 |
| `note` | textarea | |

**가격 타임라인 차트:**
- 최근 가격 series를 SVG line + area fill.
- 제목 우측 해상도 segmented control `1D / 1M` (기본 `1M`).
- `sync-prices` / `manual` / `missing` 상태를 마커 또는 범례로 표시.

**데이터 품질 요약:**
- 데이터 시작일, 마지막 동기화일, 누락/실패 일자.
- 누락 일자 chip 또는 `누락 가격 보완` CTA → 수동 보완 draft 진입.

**view 모드 footer:** `동기화` (ghost) + `편집` (primary).

동기화 버튼 클릭 → `supabase.functions.invoke('sync-prices', { body: { tickers: [ticker] } })` → 결과를 drawer 안에 표시.

## 종목 탭

- 대상: `instrument_type != 'fx'`.
- 카드: `display_name · ticker` / 동기화 배지 / `instrument_type` outline 칩 / currency / 최근 가격 / 연결 태그 outline 칩.
- 실패/경고 종목은 상단 고정 + danger 좌측 마커.

### 종목 detail drawer

**메타데이터 폼 필드:**

| 필드 | 타입 | 비고 |
|---|---|---|
| `ticker` | text (PK) | create에서만 입력, 이후 disabled |
| `display_name` | text | |
| `instrument_type` | dropdown | `stock`/`etf`/`fund`/`cash`/`other` |
| `currency` | text | KRW/USD 등 |
| `price_source` | text | 기본 `yfinance` |
| `source_symbol` | text | 외부 소스 식별 코드 |
| `사용자 태그` | multi-select | `tags` 마스터에서 선택 (`instrument_tags` insert/delete) |
| `note` | textarea | |

- 가격 타임라인 차트 + 데이터 품질 요약: 환율 drawer와 동일.
- 실패 종목이면 상단 amber notice + `누락 가격 보완` primary CTA.
- **전체 가격 원장을 탐색하는 별도 drawer는 제공하지 않는다.**

## 태그 탭

- 카드: 태그명 / 색상 배지 / 연결 종목 수.

### 태그 detail drawer

| 필드 | 타입 | 비고 |
|---|---|---|
| `name` | text | |
| `color` | dropdown | `success` / `info` / `neutral` / `warning` 중 하나 |
| `sort_order` | number | 자산·자료의 태그 pill 노출 순서 |
| `연결 종목 수` | 읽기 전용 | |
| `연결 종목` | outline 칩 리스트 | 읽기 전용 |

- 삭제 비활성 조건: 연결 종목이 남아 있을 때.
- 삭제는 drawer 안 `delete-confirm` 모드를 거친다.

## 생성 흐름

- `+` FAB → master list 최상단에 blank-card draft 삽입 → create 모드 drawer 즉시 오픈.
- 환율/종목은 동기화 drawer footer의 버튼에서 실행하므로 탭 FAB에 동기화 버튼 없음.

## Supabase 호출

| 작업 | 호출 |
|---|---|
| 종목/환율 목록 | `from('instruments').select().order('ticker')` |
| 종목 생성/수정 | `from('instruments').upsert({...})` |
| 종목 삭제 | `from('instruments').delete().eq('id', id)` |
| 태그 목록 | `from('tags').select().order('sort_order')` |
| 태그 생성/수정 | `from('tags').upsert({...})` |
| 태그 삭제 | `from('tags').delete().eq('id', id)` |
| 종목-태그 연결 | `from('instrument_tags').insert({...})` |
| 종목-태그 해제 | `from('instrument_tags').delete().eq('id', id)` |
| 동기화 | `functions.invoke('sync-prices', { body: { tickers: [...] } })` |

## Acceptance criteria

- [ ] 자료 페이지 hero가 `sync_runs` 최신 행의 `synced/total`, 마지막 실행 시각, 실패 건수(티커)를 표시한다
- [ ] `환율 / 종목 / 태그` 3개 탭이 존재한다
- [ ] 환율 탭은 `instrument_type = 'fx'` 항목만 표시한다
- [ ] 종목 탭은 `fx`가 아닌 항목만 표시한다
- [ ] 카드 동기화 배지가 `success`/`warning`/`danger` 3종으로 표시된다
- [ ] 종목/환율 detail drawer에 `source_symbol` 필드가 있다
- [ ] 종목 detail drawer의 태그 필드가 자유 텍스트가 아니라 `tags` 마스터에서 선택한다
- [ ] detail drawer view 모드 footer에 `동기화` (ghost) + `편집` (primary)가 있고, 동기화 결과가 drawer 안에 표시된다
- [ ] 태그 detail drawer에 `color` 드롭다운(`success`/`info`/`neutral`/`warning`)과 `sort_order` 필드가 있다
- [ ] 연결 종목이 있는 태그는 삭제 버튼이 비활성된다
- [ ] 삭제는 drawer 안 `delete-confirm` 모드를 거친다
- [ ] 가격 타임라인 차트에 `1D/1M` 해상도 선택이 있고 기본값이 `1M`이다
- [ ] 데이터 품질 요약이 누락/실패 일자를 표시한다

## Blocked by

- #1 (스키마)
- #2 (Auth)
- #3 (sync-prices Edge Function)
