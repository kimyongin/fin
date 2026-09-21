# 설계 문서 지도

design은 화면 디자인뿐 아니라 제품·데이터·API 설계를 포함한다. 개발 방법은 별도 [engineering](../engineering/architecture.md), 제품 목적은 [PRD](../prd/portfolio.md), 확정 결정은 [ADR](../adr/0001-mcp-first-product-boundaries.md)에 있다.

## 현재 사용하는 문서

구조 단순화의 최신 기준은 [ADR-0004](../adr/0004-domain-storage-and-minimal-mutation-contract.md)다. 과거 초안의 복잡한 구조를 새 계약과 동시에 구현하지 않는다.

| 파일/폴더 | 역할 / 상태 |
| --- | --- |
| PRINCIPLES.md | 모바일 우선 반응형 디자인 원칙 |
| screen-structure.md | #59~#62 구현 기준: 헤더·보기·필터·본문·푸터·모달/드로어·전체 화면 편집 |
| component-system.md | 기존 React 공통 UI 재사용, 모달/드로어·폼·상태와 접근성 계약안 |
| product-reorganization.md | 기존 기능 유지/재구성/이동과 책임 |
| implementation-contract-draft.md | 계산·버전·점검 등의 초기 기술 초안. 후속 계약/조사 링크 우선 확인 |
| schema-audit-20260921.md | 특정 날짜 원격/로컬 DB 대조 결과. 영구 최신 스키마 명세 아님 |
| contracts/README.md | 로컬 계약 구현 상태와 운영 전 게이트 |
| contracts/scenario-api-model-matrix.md | S01~S24 사용자 시나리오, API, 변경/불변 데이터, 담당 |
| contracts/daily-review-model.md | 일일 점검·버전·조사 범위·근거 모델 |
| contracts/daily-review-api.md | 문맥 조회/브리핑 저장/조회, 오류, R01~R16 검증 사례 |
| contracts/lifecycle-model-api.md | 원칙·판단·질문·체결·보정의 모델/API |
| contracts/agent/README.md | MCP 에이전트 명세의 원본/갱신/제공 상태 관리 |
| contracts/agent/behavior.md | OAuth instructions에 반영한 공통 행동 규칙 원본 |
| contracts/agent/tool-descriptions.md | OAuth 공통 정의에 연결된 도구 설명 카탈로그와 후순위 후보 |
| contracts/agent/workflows.md | W01~W08 호출 순서·예외/복구 가이드 |

계약 문서는 로컬 구현과 대조됐지만 존재만으로 운영 API 제공·배포 완료를 의미하지 않는다. 실제 상태는 [구현 현황 감사](../tickets/implementation-audit-20260921.md)를 따른다.

## 과거 화면 검토 자료

- portfolio-v2.md: 이전 화면 기획안.
- prototype.html / prototype-v2.html / prototype-v3.html: 가상 HTML 시안. 승인된 최종 React 구현 명세가 아니다.
- assets-v2.js / responsive-v3.js: 시안용 코드.
- desktop.png, mobile-*.png, v2-*.png, v3-*.png: 시안 캡처.

삭제/이동하지 않고 검토 이력으로 보존한다. 특히 v3 자산 전면 재설계를 구현 지시로 해석하지 않는다.
