# Portfolio App UI PRD

> **역할:** Portfolio App의 Next.js 웹 UI를 소유한다. 페이지 구성, master-detail 패턴, 차트, drawer form, 상호작용을 명세한다.
>
> 백엔드(스키마, RLS, holdings 트리거, `portfolio_view`, `sync-prices` Edge Function, Storage, SDK 사용 패턴)는 [PRD_PORTFOLIO_APP.md](./PRD_PORTFOLIO_APP.md)가 소유한다.

본 PRD는 [mockups/portfolio-web-app/index-v2.html](mockups/portfolio-web-app/index-v2.html)을 정합성 기준으로 한다.

문서 위치:
- 마스터: [PRD.md](./PRD.md)
- 백엔드/플랫폼: [PRD_PORTFOLIO_APP.md](./PRD_PORTFOLIO_APP.md)
- 본 문서: 웹 UI 명세

---

# 1. UX 설계 원칙

좋은 UX는 사용자가 **현재 상태 확인 → 문제 발견 → 수정/기록 → 결과 확인** 흐름을 끊기지 않고 수행하게 만드는 것이다.

본 절의 8개 원칙은 신규 기능 추가 시의 설계 기준이자 PR 리뷰 체크리스트다. 각 원칙은 `목적 / 규칙 / 좋은 예 / 나쁜 예 / 새 기능 체크` 구조를 따른다. 신규 기능은 최소 하나 이상의 좋은 예 패턴에 매핑되어야 하며, 나쁜 예 패턴이 등장하면 설계를 재검토한다. 시각 디테일은 §8, drawer 동작 디테일은 §7에서 확장된다.

## 1.1 한 페이지 = 한 가지 질문에만 답한다

- **목적:** 사용자가 현재 화면의 역할을 즉시 이해하고, 다른 업무로 새지 않게 한다.
- **규칙:** 자산은 현재 포트폴리오 상태, 분석은 시장 해석과 결정, 자료는 원천 데이터 관리만 책임진다.
- **좋은 예:** 자산은 계좌·종목·거래를 보여주고, 가격 동기화나 종목 마스터 편집은 자료로 보낸다.
- **나쁜 예:** 자산 페이지에 가격 동기화, 계좌 관리 overlay, 종목 마스터 편집을 한꺼번에 넣는다. 분석 페이지에서 보유 종목을 직접 편집한다.
- **새 기능 체크:** 이 기능이 답하는 질문이 현재 페이지의 핵심 질문과 같은가? 다르면 다른 페이지나 drawer deep link로 보내야 한다.

## 1.2 Hero strip은 단일 1차 메트릭 + 한 줄 보조

- **목적:** 첫 시선을 하나의 대표 상태에 고정해 화면 해석 비용을 낮춘다.
- **규칙:** hero는 페이지의 1차 메트릭 1개와 한 줄 보조 메타만 표시한다. 전역 액션 버튼은 hero에 두지 않는다.
- **좋은 예:** 자산 `₩54,344,000 · +₩2,544,000 +4.9%`, 분석 `2026-05-07 · 회복 국면 · 뉴스 28건`, 자료 `17 / 18 · 동기화 완료`.
- **나쁜 예:** hero에 KPI 4–6개를 카드 그리드로 펼친다. hero에 `거래 추가`, `가격 동기화` 같은 액션 버튼을 둔다.
- **새 기능 체크:** 이 정보가 페이지의 대표 상태인가, 아니면 탭/카드/drawer 안의 보조 정보인가?

## 1.3 상단 전체폭 탭, 한 탭 = 한 master 객체

- **목적:** 같은 페이지 안에서 보는 관점은 바꾸되, 사용자가 다른 업무 페이지로 이동했다고 느끼지 않게 한다.
- **규칙:** 큰 모드 전환은 hero 아래 전체폭 segmented tab으로 표현한다. 탭 하나는 master 객체군 하나만 소유한다.
- **좋은 예:** 자산 `계좌 / 종목 / 거래`, 분석 `리포트 / 리밸런싱`, 자료 `환율 / 종목 / 태그`. 탭은 개수와 무관하게 컨테이너 폭을 균등하게 채우고, 데스크탑에서 탭 전환 시 해당 탭 master list의 첫 번째 카드가 자동 선택되어 detail drawer가 즉시 교체된다.
- **나쁜 예:** 한 탭 안에 master 리스트 두 개를 좌우로 나열한다. 탭 폭을 텍스트 길이에 맞춰 가변으로 둔다. 탭을 이동했는데 이전 탭의 detail drawer가 그대로 남아 있다. 탭 안에 sub-tab을 다시 만든다.
- **새 기능 체크:** 이 기능은 새 master 객체인가? 그렇다면 탭 후보이고, 기존 객체의 속성이라면 drawer 내부 섹션이다.

## 1.4 마스터 카드는 표시 전용, 편집은 drawer form

- **목적:** 목록은 스캔에 집중하고, 조작은 상세 컨텍스트 안에서만 일어나게 한다.
- **규칙:** 마스터 카드는 클릭 가능한 요약이다. 수정·삭제·저장·다운로드는 drawer form의 우하단 sticky footer에서만 제공한다.
- **좋은 예:** 카드는 `tabindex="0"` + `data-drawer="..."`만 가진다. 같은 drawer form이 `view / edit / create / delete-confirm` 모드를 재사용한다.
- **나쁜 예:** 카드 안에 `수정`/`삭제` 버튼을 둔다. 별도 중앙 dialog를 다시 띄운다. 같은 모델의 보기 화면과 편집 화면을 서로 다른 UI로 만든다.
- **새 기능 체크:** 이 액션이 카드 안에 있어야 한다고 느껴진다면, 실제로는 drawer footer 또는 FAB에 있어야 하는 액션은 아닌가?

## 1.5 생성은 FAB + draft 카드 패턴

- **목적:** 생성 시작 위치와 생성 중 상태를 모든 화면에서 예측 가능하게 만든다.
- **규칙:** 새 항목 생성은 우하단 FAB에서 시작하고, 빈 draft 카드 생성 후 create-mode drawer를 즉시 연다.
- **좋은 예:** 자산 거래 탭 `+` FAB → `trade-new-draft` 카드 삽입 → 거래 drawer가 create mode로 열린다. 자료 환율 탭의 `+`는 누락 가격 수동 보완 draft만 만들고, 동기화는 환율/종목 detail drawer footer에서 실행한다.
- **나쁜 예:** hero에 `+ 거래 추가` 버튼을 둔다. 리스트 마지막에 점선 `+` 슬롯을 둔다. 별도 중앙 dialog로 추가 폼을 띄운다.
- **새 기능 체크:** 새 항목을 만들 때 사용자가 빈 카드와 drawer form을 동시에 볼 수 있는가?

## 1.6 로그성 데이터(거래·가격)는 최근 N + 그룹 + 필터 + 더 보기

- **목적:** 시간이 지날수록 커지는 데이터가 화면 탐색과 성능을 망치지 않게 한다.
- **규칙:** 거래·가격처럼 무한히 늘어나는 데이터는 최근 N건, 그룹 헤더, 필터 요약, 명시적 `더 보기`로 탐색한다.
- **좋은 예:** 거래 탭은 `최근 30건 · 최신순` + 월별 group head + `이전 거래 더 보기`. 보유 종목 drawer는 거래 5건만 보여주고 drawer-local `이전 거래 더 보기`로 확장한다. 자료 가격 데이터는 전체 원장 탐색 대신 타임라인 + 데이터 품질 요약으로 충분히 진단한다.
- **나쁜 예:** 한 화면에 전체 거래를 무한 나열한다. 종목 drawer에 모든 과거 거래를 풀어 놓는다. 사용자 의도 없이 자동 무한 스크롤로 fetch한다.
- **새 기능 체크:** 이 데이터가 운영 기간에 비례해 증가하는가? 그렇다면 기본 노출 개수, 그룹 기준, 필터, 더 보기 정책이 명시되어 있는가?

## 1.7 형제 항목 탐색은 drawer가 책임진다

- **목적:** 상세를 보는 동안 목록으로 돌아가지 않고 인접 항목을 빠르게 비교하게 한다.
- **규칙:** 같은 master 객체군의 이전/다음 이동은 drawer 헤더의 prev/next와 `1/N` 위치 표시가 담당한다.
- **좋은 예:** 보유 종목·리포트·리밸런싱·종목 마스터·계좌·거래는 모두 `drawerSiblings`에 정렬 규칙을 등록한다. 데스크탑은 ←/→, 모바일은 가로 스와이프로 이동한다.
- **나쁜 예:** drawer 안에 "다음 항목 검색" 셀렉트를 둔다. 카드를 닫고 다음 카드를 다시 눌러야 이동한다. 형제 정의 없이 임의 순서로 이동한다.
- **새 기능 체크:** 새 detail drawer가 생긴다면 형제 목록과 정렬 기준이 정의되어 있는가?

## 1.8 시각 절제 + 상태·위험 표면화

- **목적:** 강조색과 시스템 상태가 사용자의 판단을 돕게 하고, 흐름을 끊는 알림을 줄인다.
- **규칙:** 액센트는 1차 CTA와 첫 번째 차트 segment에만 쓴다. 로딩·빈 상태·오류·저장·동기화·삭제 확인은 해당 섹션 또는 drawer-local 영역에 표시한다.
- **좋은 예:** 채색 배지는 `success`/`warning`/`danger`/`neutral` 4종 + outline 칩만 쓴다. 삭제·매도 초과·결정 변경은 drawer 안 `delete-confirm` 모드로 확인한다. 모든 viewport에서 가로 스크롤을 금지한다.
- **나쁜 예:** 카드 hover에 액센트 배경을 쓴다. 임의 hex로 배지 색을 늘린다. 토스트나 풀스크린 dialog로 저장 결과·삭제 확인을 띄운다. 가로 스크롤에 정보를 숨긴다.
- **새 기능 체크:** 이 상태나 위험 안내가 사용자의 현재 맥락 안에 보이는가, 아니면 별도 알림으로 흐름을 끊는가?

## 1.9 신규 기능 추가 판단 템플릿

새 UI 기능을 추가하기 전 PR 설명 또는 이슈에 아래 질문의 답을 남긴다. 답이 비어 있으면 UI 설계를 확정하지 않는다.

| 질문 | 기준 |
|---|---|
| 어느 페이지의 핵심 질문에 답하는가? | 자산/분석/자료 중 하나에만 귀속한다. 둘 이상이면 책임을 쪼갠다. |
| master 객체, detail 속성, 로그성 데이터 중 무엇인가? | master는 탭+카드, detail 속성은 drawer 섹션, 로그성 데이터는 최근 N+그룹+필터+더 보기로 설계한다. |
| 사용자가 어디서 시작하는가? | 기존 항목은 카드 클릭, 새 항목은 FAB+draft 카드, 위험 작업은 drawer footer에서 시작한다. |
| 같은 form을 재사용하는가? | 같은 모델의 보기/편집/생성은 동일 drawer form을 `view / edit / create / delete-confirm` 모드로만 바꾼다. |
| 모바일에서도 같은 흐름인가? | 모바일은 풀스크린 drawer와 하단 footer 액션을 사용한다. 상단 닫기 버튼이나 가로 스크롤에 의존하지 않는다. |
| 상태와 실패가 어디에 보이는가? | 로딩/빈/오류/저장/동기화 결과는 해당 섹션 안에 inline으로 표시한다. |

---

# 2. 라우트와 LNB

LNB는 4개 메뉴로 정리한다: **자산 / 분석 / 자료 / 로그아웃**. 대시보드는 별도 페이지로 두지 않고 핵심 위젯을 각 업무 페이지의 hero에 배치한다. 로그아웃은 업무 페이지나 detail drawer가 아니라 세션 모달 액션이다.

| 라우트 | 메뉴 | ID | 진입 시 우측 detail 기본값 (데스크탑) |
|---|---|---|---|
| `/login`, `/auth/callback` | (메뉴 외) | F-W1 | - |
| `/assets` | 자산 (기본 진입) | F-W2 | 평가금액 1위 보유 종목 |
| `/analysis` | 분석 | F-W3 | 활성 탭의 최신 항목 (리포트 또는 pending 리밸런싱) |
| `/data` | 자료 | F-W4 | 실패/누락 종목이 있으면 그 종목, 없으면 첫 종목 |
| (액션) | 로그아웃 | - | drawer-local 확인 후 세션 종료 |

---

# 3. F-W1. 인증

- 이메일 로그인 링크. `/login` → 이메일 → `/auth/callback` → `/assets`.
- 기술 구현은 Supabase Email OTP(Magic Link)를 사용하되, 사용자 화면에는 "매직링크"가 아니라 "로그인 링크"로 표기한다.
- 모바일에서는 메일 앱을 거쳐 링크가 열릴 수 있으므로 로그인 모달/페이지에 `로그인 완료 확인` 액션을 제공한다. 이 액션은 실제 구현에서 `supabase.auth.getSession()`으로 현재 브라우저의 세션 저장 여부를 확인한다.
- 미인증 보호 라우트 접근 시 `/login`으로 리다이렉트 (middleware).
- Auth 설정과 콜백 라우트 구현은 [PRD_PORTFOLIO_APP.md §5 인증](./PRD_PORTFOLIO_APP.md) 참고.

---

# 4. F-W2. 자산 (`/assets`)

기본 진입 페이지. 상단 탭은 `계좌 / 종목 / 거래`이며, 각 탭은 master 카드 리스트 + detail drawer 구조를 공유한다.

## 4.1 상단 hero strip (한 줄)

- 큰 숫자: 총 평가금액(KRW). 인라인으로 `+₩…(±%)` 보조 텍스트(이번 달 변동, `portfolio_snapshots` 기준).
- 보조 메타: `N개 계좌 · M개 종목 · 마지막 가격 YYYY-MM-DD`.
- hero에는 전역 액션 버튼을 두지 않는다. 생성은 각 탭의 `+` 액션으로 빈 draft 카드를 만들고 해당 drawer를 연다.

## 4.2 상단 탭

- `계좌`: 계좌별 평가금액, 비중, 보유 종목 수를 보여준다.
- `종목`: 태그 필터, 포트폴리오 구성 차트, 보유 종목 리스트를 보여준다.
- `거래`: 거래 카드 리스트를 보여준다. 거래별 고유 drawer를 열어 수정/삭제한다.

## 4.3 상태 알림 (조건부)

- 환율(`USDKRW=X`) 또는 보유 종목의 최근 영업일 가격이 누락되면 hero 아래 amber notice + "자료에서 보완" CTA.

## 4.4 태그 필터 + 포트폴리오 구성 카드

- 자산 상단 필터는 자료에서 관리되는 태그만 표시한다.
- 태그는 다중 선택 토글이며 AND 매칭이다. 선택한 태그를 모두 가진 보유 종목만 목록과 차트에 남긴다.
- 아무 태그도 선택하지 않으면 전체 보유 종목을 표시한다.
- 구성 차트는 필터링된 종목의 평가금액 비중을 stacked horizontal bar(높이 10px)로 표시 + 범례. 색은 `accent → info → success → purple → warning → slate` 6단. 막대 segment 또는 범례 행 클릭 시 해당 보유 종목 detail로 드릴다운.

## 4.5 보유 종목 마스터 리스트 (단일 컬럼)

- 카드 1줄 요약: `종목명 · 티커` / `평가금액(KRW)` / `태그 outline 칩` · `수량 · 평균단가` · `손익% 배지(success/danger/neutral)`.
- 카드 내부에는 수정/삭제 버튼을 두지 않는다.
- 빈 상태: 거래 추가 CTA. 가격 누락 시 자료 페이지 안내.

## 4.6 보유 종목 detail (drawer)

- 헤더: 종목명, 티커, 계좌명, prev/next/위치 칩, (모바일) 닫기.
- **stat-row 3칸**: 평가금액(KRW), 미실현 손익(±, 색), 비중(%).
- **보유 직접 편집**: 메모, 초기 적재용 수량/평단. 거래가 입력되면 트리거가 transactions 기준으로 덮어쓴다는 경고 문구 포함.
- **매매 타임라인 차트**: SVG line + accent area fill + 점선 그리드 3줄.
  - 제목 우측에 작은 해상도 segmented control(`1D` / `1M`)을 둔다. 기본값은 `1M`이며, 선택 상태는 차트별로 독립적이다.
  - X축: 첫 거래일 또는 90일 전 ~ 현재.
  - Y축: 종가 범위. 우상단/우하단에 high/low 텍스트 라벨.
  - **마커**: BUY = success(녹), SELL = danger(적). hover 시 `<title>`로 거래일·수량·단가 툴팁.
  - 하단 축: `시작일 / 현재가 / 종료일` + 범례(BUY N건 · SELL M건 · 종가).
  - USD 종목은 USD 단위로 그리고 환산 안내 한 줄 추가.
- **거래 기록 feed**: 같은 종목의 최근 5건만 읽기 전용 요약으로 표시하고, 하단 `이전 거래 더 보기` 버튼으로 drawer 안에서 과거 거래를 명시적으로 확장한다.
- 거래 수정/삭제는 `거래` 탭의 거래별 detail drawer에서만 처리한다.

## 4.7 거래 detail (drawer)

- 거래 카드는 거래별 고유 drawer id를 가진다 (`trade-{trade_date}-{symbol-slug}-{buy|sell}` 형식). 같은 종목의 여러 거래가 동시에 selected 되지 않아야 한다.
- 거래 목록은 최근 30건을 기본으로 로드하고 월별 또는 날짜별 그룹 헤더(예: `2026-05` · `2건`)를 표시한다. 하단 `이전 거래 더 보기` 버튼으로 명시적으로 추가 로드한다.
- 탭 상단에 태그 필터 pill을 둔다. 자산 종목 탭과 동일한 태그 마스터를 공유하며, 거래 카드의 `data-trade-tags` 속성으로 매칭한다.
- 거래 필터는 태그, 기간, 계좌, 종목, BUY/SELL, 실현손익 여부를 지원한다. 카드 그룹 위에는 `최근 거래 N건 · 최신순` 정보 라인과 적용된 필터 요약 라인을 함께 표시한다. 모바일에서는 필터를 접힌 panel로 제공한다.
- **거래 카드 1줄 요약**: row1 `거래일 · BUY/SELL` / 거래금액(KRW 종목은 `₩…`, USD 종목은 USD 그대로). row2 `종목명 · 계좌`, 태그 outline 칩, `수량 × 단가`, 수수료 또는 (SELL) `실현손익 ±₩…` 배지(success/danger).
- **drawer 구조**: 헤더는 `거래일 · BUY/SELL` 타이틀 + 종목명·계좌 sub. 본문은 stat-row 3칸 + 거래 폼.
  - **stat-row 3칸**: BUY 거래는 `거래금액 / 수량 / 거래 타입`. SELL 거래는 `거래금액 / 수량 / 실현손익(±, 색)`. USD 종목은 마지막 칸을 `환율`로 대체한다.
  - **거래 폼 필드**: 거래일, 거래 타입(`BUY`/`SELL`), 계좌(select), 종목(`instruments` master select — 옵션 라벨에 `display_name (ticker · currency)` 표기), 수량, 단가, 수수료, 금액(자동, `quantity × price + fee`로 계산되며 덮어쓰기 가능, 읽기 전용 표시), (SELL) 실현손익 자동 표시(읽기 전용), (USD 종목) 환율(읽기 전용), 메모.
- 수정/삭제는 drawer 우하단 sticky footer에서만 처리한다. footer는 §7의 drawer mode에 따라 버튼 구성이 바뀐다. 삭제는 drawer 안 inline 확인을 거친다.
- `from('transactions').insert(...)` 한 번이면 holdings는 트리거가 갱신. 매도 수량 초과 시 트리거 예외 → SDK 에러 메시지(트리거 사양은 [PRD_PORTFOLIO_APP.md §7](./PRD_PORTFOLIO_APP.md) 참고).

## 4.8 계좌 detail (drawer)

- 계좌 탭의 카드는 계좌명, 활성 상태 배지, 증권사, 종목 수, 합계 KRW를 표시한다.
- 계좌 카드 내부에는 수정 버튼을 두지 않는다. 수정 CTA는 계좌 detail drawer 안에 둔다.
- 필드: 계좌명, 증권사, 메모, 활성 여부. 계좌에 currency 필드 없음.

---

# 5. F-W3. 분석 (`/analysis`)

상단 hero 아래 전체폭 segmented control(`리포트` / `리밸런싱`)을 둔다. 양쪽 모두 master-detail 패턴이며 같은 우측 패널을 공유한다. 리포트 → 리밸런싱 deep link로 단일 흐름을 유지한다.

## 5.1 상단 hero

- 큰 텍스트: 활성 리포트의 `report_date`. 보조: `cycle_phase · 뉴스 N건` + 카운트(매매 제안 N · 리스크 M · pending 리밸런싱 K).
- hero 아래 전체폭 segmented `리포트` / `리밸런싱`을 표시한다. 리밸런싱 탭에 pending 카운트 배지.

## 5.2 리포트 탭

- 필터 pills: `최근 14일`, 사이클(회복/주의/중립), 리스크 high.
- 마스터 카드: `headline / cycle 배지 / report_date · 뉴스 N건 · 핵심 지표 1~2개`.
- Drawer:
  - 헤더: headline, report_date, cycle 배지.
  - **시장 지표 그리드** (`indicators` JSONB 5종):
    - S&P 500 (`sp500`, `sp500_change_pct`)
    - Nasdaq (`nasdaq`, `nasdaq_change_pct`)
    - KOSPI (`kospi`, `kospi_change_pct`)
    - USD/KRW (`usdkrw`)
    - VIX (`vix`)
  - **매매 제안** feed (`trade_suggestions` JSONB): action 배지(BUY/SELL/HOLD) + ticker + reason.
  - **리스크 경고** feed (`risk_warnings` JSONB): level 배지(low/medium/high) + message.
- **본문 미리보기** 버튼 → drawer 안 접이식 preview:
    ```ts
    const { data } = await supabase.storage
      .from('reports')
      .createSignedUrl(report.storage_path, 60)
    ```
  - **이 리포트 기반 리밸런싱 보기** → 리밸런싱 탭으로 deep link.

## 5.3 리밸런싱 탭

- 필터 pills: `결정 대기`(기본), `전체`, `반영`, `미반영`, `부분 반영`. UI 라벨은 한국어, DB의 `status` enum은 `pending`/`accepted`/`rejected`/`partial` 그대로 저장한다.
- 마스터 카드: `한 줄 요약 / status 배지(한국어 라벨) / suggestion_date · 액션 N건 · 근거 리포트 M건 · 투자금`. `결정 대기`는 상단 고정 + warning 좌측 마커.
- 배지 색 매핑: `결정 대기 = warning`, `반영 = success`, `미반영 = danger`, `부분 반영 = warning(점선)`.
- Drawer:
  - 헤더: 한 줄 요약, status 배지(한국어).
  - **stat-row 3칸**: 투자 금액, 액션 수, 상태(한국어 + 색 강조).
  - **액션 feed** (`actions` JSONB): 계좌 · 티커 · BUY/SELL · 수량 · 예상 KRW · reason.
  - **근거 리포트 chips** (`based_on_reports` JSONB): 클릭 시 리포트 탭의 해당 카드 drawer 오픈.
  - **추론** (`reasoning`) + 본문 미리보기 버튼.
  - **결정 기록 폼** (drawer 내부 sticky):
    - 라디오: `결정 대기` / `반영` / `미반영` / `부분 반영` (저장 시 각각 `pending`/`accepted`/`rejected`/`partial`로 매핑).
    - `decided_at` (date), `partially_applied` 액션 체크박스, `note` (textarea).
    - 저장 시: `from('rebalance_suggestions').update({status, user_decision}).eq('id', id)`.

JSONB 필드의 정확한 스키마는 [PRD_PORTFOLIO_APP.md §10 JSONB 스키마](./PRD_PORTFOLIO_APP.md) 참고.

---

# 6. F-W4. 자료 (`/data`)

자료 페이지는 `환율 / 종목 / 태그` 3개 탭으로 나뉜다. 환율과 종목은 가격 동기화 대상이고, 태그는 자산 필터와 종목 분류의 기준이다.

## 6.1 상단 hero

- 큰 텍스트: `synced/total` (예: `17 / 18`). 보조: `마지막 실행 시각 · 실패 N건(티커)`. 값은 최신 `sync_runs` 기준.
- hero에는 전역 생성/동기화 버튼을 두지 않는다. 생성은 각 탭의 `+` 액션으로 빈 draft 카드를 만들고, 동기화는 환율/종목 detail drawer footer에서 실행한다.
- "가격 동기화" 액션은 sync 가능한 환율/종목 detail의 `동기화` footer 버튼에서 `supabase.functions.invoke('sync-prices')`를 호출한다. Edge Function 사양은 [PRD_PORTFOLIO_APP.md §8](./PRD_PORTFOLIO_APP.md) 참고.

## 6.2 상단 탭

- `환율`: `instrument_type = 'fx'` 항목과 최근 가격, 실패 상태, 수동 보완 CTA를 관리.
- `종목`: `fx`가 아닌 종목 마스터와 가격 동기화 상태를 관리.
- `태그`: `tags` 마스터를 관리. 태그명, 색상, 연결 종목 수를 표시하고 수정/삭제는 태그 detail drawer에서 처리한다.

## 6.3 환율 / 종목 리스트

- 카드: `display_name · ticker / 동기화 배지(success=sync / warning=manual / danger=failed)`. 본문: `instrument_type outline 칩 · currency · source_symbol · 최근 가격`.
- 종목 카드는 연결된 관리형 태그를 outline 칩으로 표시한다.
- 실패 또는 경고 종목은 상단 고정 + danger 좌측 마커.

## 6.4 태그 관리

- 태그 카드는 `태그명 / 연결 종목 수 / 연결 종목 배지`만 표시한다.
- `+` 액션은 빈 태그 draft 카드를 만들고 태그 detail drawer를 연다.
- 태그 detail drawer 필드:
  - `태그명` (text)
  - `색상` 드롭다운 — `success` / `info` / `neutral` / `warning` 중 하나. 자산 필터와 종목 카드의 outline 칩 색에 영향을 준다.
  - `정렬 순서` (number) — 자산·자료의 태그 pill 노출 순서를 결정.
  - `연결 종목 수` (읽기 전용)
  - `연결 종목` outline 칩 리스트
- 태그 저장/삭제 CTA는 drawer 우하단 sticky footer에서만 제공한다. 삭제는 drawer 안 `delete-confirm` 모드를 거치며, 연결 종목이 남아 있으면 삭제 비활성.

## 6.5 종목 detail (drawer)

- 실패 종목인 경우 상단에 amber notice + `누락 가격 보완` primary CTA.
- **메타데이터 폼**:
  - 티커 (PK, disabled)
  - display_name
  - instrument_type 드롭다운: `stock`/`etf`/`fund`/`fx`/`cash`/`other`
  - currency (KRW/USD 등)
  - price_source (기본 `yfinance`)
  - **source_symbol**: 외부 가격 소스의 식별 코드. 비워두면 ticker 그대로 사용.
  - **사용자 태그**: 자유 텍스트 입력이 아니라 `tags` 마스터에서 다중 선택한다.
  - note
- **가격 타임라인 차트**: 최근 가격 series를 SVG line + area fill로 표시한다. 제목 우측에 작은 해상도 segmented control(`1D` / `1M`)을 두고 기본값은 `1M`으로 한다. `sync-prices`/`manual`/`missing` 상태는 차트 마커 또는 하단 범례로 표시한다.
- **데이터 품질 요약**: 차트 하단에 데이터 시작일, 마지막 동기화일, 누락/실패 일자를 표시한다. 누락/실패 일자가 있으면 해당 일자 chip 또는 `누락 가격 보완` CTA로 수동 보완 drawer(`price-new-draft`)를 연다.
- 전체 가격 원장을 탐색하는 별도 drawer는 제공하지 않는다.

---

# 7. Drawer Form 동작

§1 원칙 1.4(마스터 카드 표시 전용), 1.5(FAB+draft), 1.6(로그성 데이터 분리), 1.7(형제 탐색)의 구현 명세. 모달은 사용하지 않는다 — 모든 보기·편집·생성·삭제·확인은 단일 우측 drawer 안에서 처리한다.

## 7.1 위치와 진입

| 환경 | 위치 | 닫기 | 진입 트리거 |
|---|---|---|---|
| 데스크탑 (`≥901px`) | 우측 정적 컬럼(width 400px), 항상 표시 | 닫기 개념 없음(항상 어떤 항목이 표시됨) | 페이지 진입·탭 전환·deep link 시 해당 항목군의 첫 번째 master card 자동 로드. 카드 클릭 시 즉시 교체 |
| 모바일 (`≤900px`) | 풀스크린 overlay, 위→아래 슬라이드 | 하단 `닫기` / Esc | 카드 클릭 시 슬라이드 인 |

한 번에 하나의 drawer만 열린다. 새 항목 선택 시 120ms 페이드 후 교체, 스크롤 top 리셋.

## 7.2 drawer form 모드 + sticky footer

drawer form은 같은 필드 정의를 4개 모드로 재사용한다. 모든 필드는 `data-field="..."`로 식별되며, `data-readonly="true"` 필드는 모든 모드에서 항상 disabled.

| 모드 | 필드 상태 | sticky footer 버튼 |
|---|---|---|
| `view` | 모든 필드 disabled | 기본: `편집` (primary) · `닫기` (ghost, 모바일만 표시). sync 가능한 환율/종목 drawer는 `동기화` (ghost)를 `편집` 앞에 추가 |
| `edit` | 입력 가능 (readonly 필드 제외) | `삭제` (danger) · `저장` (primary) · `취소` (ghost) |
| `create` | 입력 가능, 빈 값 (readonly 필드는 자동 채움) | `저장` (primary) · `취소` (ghost) |
| `delete-confirm` | 직전 모드 유지 | 본문 위 inline 메시지 `정말 삭제할까요? 이 작업은 되돌릴 수 없습니다.` + `삭제` (danger) · `취소` (ghost) |

편집 불가 타입(예: 리포트, derived view)은 `view`에서 `편집` 버튼을 숨긴다.

## 7.3 생성 흐름 (FAB → draft)

1. 우하단 FAB(`data-create-card="..."`) 클릭.
2. 해당 탭 master list의 최상단에 `card.blank-card` draft가 삽입된다 (예: `account-new-draft`, `holding-new-draft`, `trade-new-draft`).
3. drawer가 즉시 `create` 모드로 열리며 form은 빈 값으로 초기화.
4. 저장 시 draft 카드는 실제 카드로 치환되고, `view` 모드로 전환된다. 취소 시 draft 카드와 drawer 컨텐츠는 제거된다.

자료 환율/종목처럼 동기화 액션이 있는 경우 목록 FAB을 사용하지 않고, 해당 detail drawer의 `view` footer에 `동기화` 버튼을 둔다(§1.5).

## 7.4 형제 탐색 정렬 규칙

drawer 헤더의 `prev` / `next` / `1/N`은 다음 정렬을 따른다. 데스크탑 ←/→, 모바일 가로 스와이프 60px+로 이동.

| 객체 | 정렬 규칙 |
|---|---|
| 보유 종목 | 마스터 리스트 순서 (계좌 그룹 → 비중 내림차순) |
| 리포트 | `report_date` 내림차순 |
| 리밸런싱 제안 | status별(`결정 대기` 우선) → `suggestion_date` 내림차순 |
| 종목 마스터 | 실패 우선 → 보유/환율 우선 → 알파벳 |
| 거래 | `trade_date` 내림차순, 거래별 고유 drawer id |
| 계좌 | 마스터 리스트 순서 |

## 7.5 추가 규칙

- 마스터 카드 내부에는 수정/삭제 버튼을 두지 않는다. drawer footer만이 저장·삭제·다운로드 책임을 진다(원칙 1.4).
- 본문 미리보기·가격 수동 보완·삭제 확인은 모두 drawer 본문 또는 footer 안의 inline 영역에서 처리한다. 별도 중앙 dialog·토스트를 새로 추가하지 않는다(원칙 1.8).
- 키보드 트랩: drawer가 열려 있으면 Tab 순환은 drawer 안에서만, Esc는 모바일 닫기.

---

# 8. 시각 토큰

```text
--bg:        #0a0b0d
--surface:   #14151a
--surface-2: #1c1d23
--border:    rgba(255,255,255,0.08)
--border-2:  rgba(255,255,255,0.16)
--text:      #ececef
--muted:     #8a8e96
--accent:    #ff8a00            /* primary CTA만 */
--success:   #22c55e            /* 손익+, sync, accepted */
--warning:   #f59e0b            /* manual, pending, 사이클 주의 */
--danger:    #ef4444            /* 손익−, failed, rejected */
--info:      #60a5fa            /* sync-prices 출처 */
```

- 태그/타입 배지는 모두 outline.
- 그림자는 모바일 drawer 슬라이드에만.
- 라운드: 카드 10px, drawer 0(모바일은 풀스크린).
- 차트 segment 팔레트(6단): accent → info → success → purple(`#a78bfa`) → warning → slate(`#94a3b8`).

---

# 9. 데이터 매핑 (UI ↔ 스키마)

각 UI 셀이 사용하는 컬럼/조인을 한 줄로 명시한다. 컬럼/뷰 정의는 [PRD_PORTFOLIO_APP.md §6 DB 스키마](./PRD_PORTFOLIO_APP.md), [§9 portfolio_view](./PRD_PORTFOLIO_APP.md), [§10 JSONB 스키마](./PRD_PORTFOLIO_APP.md) 참고.

| UI 위치 | 데이터 출처 | 비고 |
|---|---|---|
| 자산 hero 총 평가금액 | `SUM(portfolio_view.market_value_krw)` | ✅ |
| 자산 hero "이번 달 +₩…" | `portfolio_snapshots`의 월초/최근 snapshot 차이 | ✅ |
| 마지막 가격 일자 | `MAX(holding_prices_daily.price_date)` | ✅ |
| 가격 누락 notice | `holding_prices_daily` 결손 검사 (보유 종목 ∪ fx 중 최근 영업일 가격이 없는 ticker) | ✅ 도출 |
| 구성 차트 — 태그 필터 적용 종목별 | `portfolio_view.market_value_krw` + `instrument_tags`/`tags` | ✅ |
| 보유 카드 손익% 배지 | `(close_price − avg_price) / avg_price` | ✅ portfolio_view에서 도출 |
| stat-row | `portfolio_view` | ✅ (비중은 클라이언트 합산) |
| 매매 타임라인 차트 line | `holding_prices_daily` 1D/1M 해상도별 series | ✅ |
| 매매 타임라인 마커 | `transactions.{trade_date, trade_type, price, quantity}` | ✅ |
| 거래 기록 "USD/KRW … 적용" | `holding_prices_daily WHERE ticker='USDKRW=X' AND price_date=trade_date` | ✅ 조인 |
| 거래 기록 "실현손익" | `transactions.realized_pnl_krw` | ✅ |
| 거래 기록 탐색 | `transactions` ORDER BY `trade_date DESC` LIMIT 30 + cursor | ✅ |
| 분석 hero · 리포트 메타 | `daily_reports.{report_date, headline, cycle_phase, news_count}` | ✅ |
| 시장 지표 5종 | `daily_reports.indicators` JSONB | ✅ |
| 매매 제안/리스크 경고 | `daily_reports.{trade_suggestions, risk_warnings}` JSONB | ✅ |
| 본문 미리보기 | `storage.from('reports').createSignedUrl(storage_path, 60)` | ✅ |
| 리밸런싱 제안 카드/액션/근거 리포트/추론 | `rebalance_suggestions.*` | ✅ |
| 결정 기록 폼 저장 | `update({status, user_decision})` | ✅ |
| 자료 hero `synced/total · 마지막 실행` | 최신 `sync_runs` | ✅ |
| 종목 동기화 배지(sync/failed/manual) | 최신 `sync_runs.failed` + 가격 결손 검사 + 최근 가격 source 판별 | ✅ |
| 태그 관리 탭 | `tags` + `instrument_tags` 연결 수 | ✅ |
| 종목 detail 메타데이터 폼 | `instruments.*` | ✅ |
| 가격 타임라인 차트 | `holding_prices_daily` 1D/1M 해상도별 series + source/missing 상태 | ✅ |
| 가격 데이터 품질 요약 | `MIN(price_date)`, 최신 정상 `price_date`, `sync_runs.failed` 또는 missing date 검사 | ✅ |
| 사이클 배지 색 매핑 | `daily_reports.cycle_phase` (`recovery`/`caution`/`neutral`) | ✅ |

---

# 10. 스키마 의존성

mockup이 사용하는 값은 [PRD_PORTFOLIO_APP.md](./PRD_PORTFOLIO_APP.md)에 반영된 스키마를 기준으로 제공한다.

- 자산 기간 변동은 `portfolio_snapshots`.
- 자료 동기화 결과는 `sync_runs`.
- 매도 거래 실현손익은 `transactions.realized_pnl_krw`.
- 사이클 배지는 `daily_reports.cycle_phase` 표준값(`recovery`/`caution`/`neutral`).
- 종목/가격 데이터는 사용자별 `user_id + ticker` 기준으로 격리된다.

---

# 11. 검증 체크리스트

- [ ] Vercel 배포 URL 접속 가능
- [ ] 미인증 상태로 보호 라우트 접근 시 `/login` 리다이렉트
- [ ] 이메일 로그인 링크 인증 후 `/assets`로 진입
- [ ] LNB가 4개 메뉴(자산/분석/자료 + 로그아웃)로 구성됨. 대시보드 별도 페이지가 없음
- [ ] 로그아웃과 로그인은 별도 업무 페이지나 detail drawer가 아니라 세션 모달로 처리됨
- [ ] 모든 페이지가 hero strip(단일 1차 메트릭) + master 카드 리스트 + detail drawer로 구성됨 (4-메트릭 그리드 / 3-패널 워크벤치 사용 안 함)
- [ ] 데스크탑(≥901px)에서 detail 패널이 우측에 항상 표시되고 닫기 버튼이 없음
- [ ] 모바일(≤900px)에서 detail이 풀스크린 overlay로 위→아래 슬라이드, 하단 닫기 / Esc로 닫힘
- [ ] 진입·탭 전환·deep-link 시 데스크탑 detail이 해당 항목군의 기본 항목으로 자동 로드됨
- [ ] 자산/분석/자료의 모든 상단 탭은 데스크탑에서 탭 전환 시 해당 탭 master list의 첫 번째 카드를 자동 선택하고, 이전 탭의 detail을 남기지 않음
- [ ] detail 헤더에 prev/next chevron + `1/N` 위치 표시. 좌우 스와이프(모바일)와 ←/→(데스크탑)으로 형제 항목 이동
- [ ] 읽기 전용 detail drawer에 전역 `저장` 버튼이 없고, 편집 전환 후 저장/삭제/다운로드는 drawer 우하단 sticky footer로만 제공됨
- [ ] **자산 페이지**: hero(총 평가금액 + 변동) / 가격 누락 notice / 태그 다중 선택 필터(AND) / 필터 적용 종목별 구성 차트(stacked bar + 범례, segment 클릭 → 종목 detail) / 보유 종목 master 리스트
- [ ] 보유 종목 detail에 stat-row(평가금액·미실현 손익·비중) + 보유 직접 편집 + **매매 타임라인 차트**(SVG line + BUY/SELL 마커 + `1D/1M` 해상도 선택) + 최근 거래 5건 feed + `이전 거래 더 보기`가 모두 표시됨
- [ ] 계좌 관리는 별도 drawer overlay로 분리되어 있음
- [ ] 거래 drawer form에서 통화가 instruments에서 자동으로 채워짐
- [ ] 보유 종목 직접 편집은 같은 drawer form의 edit mode에서 수량/평단/메모만 다루고 트리거 덮어쓰기 경고가 표시됨
- [ ] 거래 추가/수정/삭제 후 holdings 값이 화면에 반영됨 (트리거 동작 결과)
- [ ] 거래 탭은 최근 30건, 월/일 그룹, 태그/기간/계좌/종목/BUY-SELL/실현손익 필터, `이전 거래 더 보기`로 대량 거래 기록을 탐색함
- [ ] 거래 카드 row1에 `거래일 · BUY/SELL` + 거래금액, row2에 `종목명·계좌` + 태그 칩 + 수량×단가 + 수수료 또는 실현손익 배지(SELL)를 표시함
- [ ] 거래 detail drawer가 stat-row(BUY는 거래금액/수량/거래 타입, SELL은 거래금액/수량/실현손익, USD는 환율) + 거래 폼(종목 select 옵션은 instruments 마스터)을 표시함
- [ ] **분석 페이지**: hero + segmented(`리포트` / `리밸런싱`)으로 구성
- [ ] 리포트 detail이 `indicators` 5종(sp500/nasdaq/kospi/usdkrw/vix) 그리드 + `trade_suggestions` + `risk_warnings`(level 배지) + 본문 미리보기 + 리밸런싱 deep link를 표시
- [ ] 리밸런싱 detail이 stat-row + `actions` feed + `based_on_reports` chips(클릭 시 리포트 drawer) + `reasoning` + 결정 기록 폼(sticky)을 표시
- [ ] 결정 기록 폼이 `user_decision`(decided_at/note/partially_applied) + status 라디오(`결정 대기`/`반영`/`미반영`/`부분 반영`)를 제공하고 저장 시 한국어 라벨을 enum(`pending`/`accepted`/`rejected`/`partial`)으로 매핑해 `update({status, user_decision})` 수행
- [ ] 리밸런싱 필터 pill이 `결정 대기 / 전체 / 반영 / 미반영 / 부분 반영` 5종이고 마스터 카드 status 배지도 한국어 라벨임
- [ ] 태그 detail drawer에 태그명·색상(success/info/neutral/warning)·정렬 순서·연결 종목 수(읽기) + 연결 종목 칩이 표시됨
- [ ] 리포트/리밸런싱 본문이 signed URL로 미리보기/다운로드 가능
- [ ] **자료 페이지**: hero(`sync_runs`의 `synced/total` + 마지막 실행) / `환율·종목·태그` 탭 / 환율 및 종목 master 리스트 / 태그 master 리스트
- [ ] 종목 detail이 메타데이터 폼(source_symbol 포함) + 가격 타임라인 차트(`1D/1M` 해상도 선택, `sync-prices`/`manual`/`missing` 마커 또는 범례) + 데이터 품질 요약 + 누락 보완 CTA를 표시
- [ ] 자료 가격 데이터는 전체 가격 기록 drawer를 제공하지 않고, 누락/실패 일자만 수동 보완 진입점으로 노출함
- [ ] 종목 detail과 종목 추가 drawer form의 태그는 자유 텍스트가 아니라 `tags` 마스터에서 선택함
- [ ] "가격 동기화" 버튼은 환율/종목 detail drawer footer에 있으며 synced/failed 결과를 drawer 안에 표시함
- [ ] 모든 viewport에서 가로 스크롤이 없음. drawer가 데스크탑↔모바일 경계 변경 시 자동 적응
- [ ] 카드 클릭으로 detail이 열리고, 생성/수정/삭제 확인/본문 미리보기/가격 수동 보완은 별도 중앙 dialog 없이 drawer-local UI로 처리됨
- [ ] 주요 섹션에 로딩, 빈 상태, 오류, 저장 결과, 동기화 결과가 화면 안에서 표시됨
- [ ] 채색 배지는 success/warning/danger/neutral 4종 + outline 칩만 사용. 액센트(주황)는 1차 CTA에만 사용
