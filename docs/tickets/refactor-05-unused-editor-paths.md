# [리팩토링] 구 보유 편집 경로와 미사용 웹 코드 제거

2026-09-26 · P2 · 구현 및 선택 회귀 검증 완료 · 검토 기준: 82826e6.

GitHub: [#147](https://github.com/kimyongin/fin/issues/147). #149 문서 기준 정리 후 시작하며 #148/#150보다 먼저 진행한다.

관련: #95의 정리 이후 #124/#139에서 바뀐 자산 편집 흐름의 후속이다. 기존 티켓의 완료 기록을 다시 수행하거나 덮어쓰지 않는다.

## 목적과 근거

현재 종목 상세에서 보유값을 편집하는 경로만 읽고 수정할 수 있도록 사용되지 않는 옛 웹 경로를 제거한다. `PortfolioEditorModals.jsx`는 계좌·종목 모달만 렌더링하지만 보유 모달 props를 받는다. `usePortfolioEditorState.js`의 holding 상태, `actions.js`의 openHolding/holdingActions 연결, App에서 AssetsPage로 전달하는 소비되지 않는 onEditHolding이 남아 있다. TradeEntryModal은 현재 src의 호출자가 없으며 MetricSummary/PageToolbar와 lifecycle/data의 일부 export도 제거 후보다. 정적 검색 결과이지 모든 API가 폐기됐다는 뜻은 아니다.

## 범위와 진행

1. import·동적 참조·공개 export·테스트·스크립트를 다시 검색해 후보별 실제 소비자를 기록한다.
2. 구 보유 편집의 상태 → 액션 → props → 미사용 화면을 함께 제거한다. 종목 등록 → 0보유 목록 → 종목 상세의 계좌별 보유 저장을 첫 소비 흐름으로 검증한다.
3. 호출자가 없는 웹 컴포넌트와 adapter/export를 정리한다. 테스트가 구 경로만 검증한다면 필요한 업무 회귀를 현재 경로에 남긴 뒤 제거한다.
4. 실제 제거 목록과 유지 이유, 검사 결과를 이 티켓에 기록한다.

## 유지·제외

- 종목/계좌 추가, 자산 상세 저장·삭제, 다계좌, 표 편집, 공유 읽기를 유지한다.
- 웹 호출자가 없다는 이유로 DB RPC·MCP 매매/보정 도구를 제거하지 않는다. 적용 migration은 보존한다.
- 토큰 MCP 종료, 구 RPC fallback 제거, 새 데이터 모델, 폴더 전체 재배치는 제외한다.
- 사용자 로컬 설정과 무관한 dirty 파일을 보존한다.

## 완료 조건

- [x] 후보별 호출자 조사 및 제거/유지 표가 있고 삭제한 경로의 상태·props·import가 남지 않는다.
- [x] 현재 자산 상세의 다계좌·삭제·평가형/현금성·표 편집 회귀가 통과한다. 종목 등록/공유 읽기의 별도 브라우저 검증은 이번 선택 E2E에 포함하지 않았다.
- [x] 공개 MCP 도구와 서버 API가 유지됨을 확인한다. 웹 전용 코드 정리의 MCP/가이드 영향 없음 근거를 기록한다.
- [x] npm test, npm run build, npm run check:encoding, git diff --check 및 관련 E2E 결과를 기록한다. E2E는 격리 환경만 사용한다.
- [x] 완료 단위로 커밋하고 로컬 검증과 운영 배포를 구분한다.

## 구현 기록 (2026-09-26)

| 후보 | 확인한 소비자 | 처리 |
| --- | --- | --- |
| 구 보유 편집 state/actions/helpers/props | App에서 액션 생성·전달만 하고 렌더링되는 보유 모달은 없음 | 한 경로로 제거. 해당 구 경로만 검증하던 단위 테스트도 제거 |
| `TradeEntryModal`, `MetricSummary`, `PageToolbar` | 앱 코드 import 없음 | 미사용 웹 코드 제거 |
| 종목 상세의 계좌별 보유 편집 | `AssetsPage` → `AssetDetailModal` → `app_save_asset_detail_current` | 유지 |
| 매매/보정 서버 RPC와 OAuth MCP 도구 | 웹의 미사용 모달과 별도의 공개 소비자 | 유지. 공개 도구 설명/가이드 의미 변경 없음 |
| `normalizeTickerInput` | 별도 유틸 테스트 소비자 | 유지 |

정적 소비자 검색, `npm test` 21파일/105건, `npm run build`와 prebuild 인코딩 검사(679파일) 통과. 격리 E2E는 DB 50파일/604건, OAuth MCP 계약/인증된 조회, 자산 브라우저 3건(다계좌 원자 저장과 재시도·종목/계좌 삭제 제약·평가형/현금성 보유와 표 가져오기)이 통과했다. DB/migration/API/MCP 코드는 변경하지 않았다. 실제 Google OAuth·실기기·운영 배포는 이번 검사에 포함하지 않았다.

커밋: `f324518 refactor: remove unused holding editor paths`. 푸시·운영 배포는 수행하지 않았다.
