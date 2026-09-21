# 앱과 ChatGPT의 제품 피드백

2026-09-21 · 로컬 구현/자동 검증. 운영 배포와 실제 ChatGPT 웹·모바일 평가는 남아 있다. ADR-0004의 전용 도메인과 최소 변경 규약을 따른다.

## 경험과 책임

사용자가 앱 사용 중 발견한 오류·불편함·기능 제안·주의점을 다시 설명하지 않고 접수한다. 투자 판단·portfolio_tasks와 별도 도메인이다. 개발자인 본인도 같은 접수 흐름을 쓰며 검토할 때만 운영자 권한을 사용한다.

| 상황 | 기대 흐름 |
| --- | --- |
| 앱에서 직접 접수 | 햄버거 `피드백` → 자유 텍스트 → 등록 → 내 접수 내역 |
| “방금 문제 피드백으로 등록해줘” | 확인된 대화 내용을 짧게 정리 → 저장 → 접수 내용과 ID 안내. 대상이 명확하면 재승인 없음 |
| “저장됐다고 하는데 앱에 안 보여” | 확인된 현상/불확실성을 구분 → “저장 결과를 앱에서 확인하기 어렵다는 내용으로 남길까요?” 제안 → 동의하면 저장 |
| “가격 날짜가 거래일이라는 점도 메모해줘” | 제품 주의점으로 접수 가능. 투자 메모인지 애매하면 대상만 확인. 검증된 공개 공지로 자동 승격하지 않음 |
| 개발자 검토 | 접수 검토 → 필요한 항목만 GitHub 개발 티켓 수동 작성 → 상태·답변·이슈 링크 기록 |

제목·분류·기대 동작은 필수 입력으로 요구하지 않는다. 등록은 개발 확약이 아니며 해결·배포와 구분한다. 일반 사용자는 본인 접수와 답변을 보고 운영자는 전체 피드백만 관리한다.

## 대화 중 제안 규칙

구체적인 앱 불편이나 반복/지속되는 도구 문제에서 한 줄 요약과 함께 등록을 한 번 제안한다. 원래 요청 해결을 먼저 돕는다. 작업마다 만족도를 묻거나, 복구된 일시적 오류·투자 손실·시장 뉴스·모델 추정을 앱 버그로 등록하지 않는다. 같은 대화에서 동일 문제 반복 권유를 피하고 거절·무응답에는 저장하지 않는다.

명시적인 등록 요청 또는 제시한 요약에 대한 동의가 저장 근거다. 대상이 충분히 명확하면 별도 양식이나 재승인을 요구하지 않는다. 대화에 없는 재현 조건·근본 원인·기대 동작을 만들어내지 않는다. 피드백 동의는 투자 데이터 변경이나 GitHub 원문 공개 동의가 아니다. 성공 응답 전 접수 완료를 선언하지 않는다.

MCP는 ChatGPT 대화를 상시 관찰하거나 자발적 제안을 강제할 수 없다. server instructions와 self-contained 도구 설명에 짧은 제안·동의 규칙을 두고, `get_workflow_guide(topic=product_feedback)`로 상세 흐름을 제공한다. 모든 투자 가이드에 본문을 복제하거나 매번 가이드 조회를 요구하지 않는다. 자발적 제안의 작동 여부는 실제 웹·모바일 평가로 기록한다.

## 구현된 모델/API 계약

전용 `product_feedback` 테이블을 중심으로 다음 계약을 구현했다.

- id, 인증에서 결정한 reporter_user_id, 필수 body(공백 제외 1~4,000자), 서버 created_at/updated_at.
- source(app/mcp), 선택적 context 허용 목록(page_key, app_version, tool_name, error_code, request_id). MCP가 모르는 화면/버전은 생략.
- status(received/reviewing/planned/resolved/deferred), 작성자에게 보이는 response, 선택적 github_issue_url. 기본은 received.
- 작성자+idempotency_key unique와 정규화 입력 fingerprint로 동일 재시도는 같은 ID, 같은 key의 다른 내용은 conflict. 신규 생성에 expected_version이나 전체 revision 엔진을 추가하지 않는다. 운영자 현재값 변경만 단순 CAS로 보호한다.
- `app_submit_product_feedback(body, context, source, idempotency_key)`와 `app_list_my_product_feedback(cursor, limit)`를 앱/MCP가 함께 사용한다. 비익명 인증 사용자만 접수, 작성자·시각·관리 필드는 서버에서 결정한다.
- OAuth MCP는 `submit_product_feedback`(write), `list_my_product_feedback`(read-only) 두 목적별 도구. 기존 envelope/오류/registry/annotations를 재사용한다. legacy token endpoint 확장은 제외한다.
- `app_list_product_feedback_admin`과 `app_update_product_feedback_admin`은 별도 관리자 RPC다. `product_feedback_admins`에 서비스 역할로 지정한 UUID만 허용하고 자기 승격을 금지한다. 변경은 expected version CAS와 본문을 복제하지 않는 최소 관리 이벤트로 남는다. 운영자 권한은 타인의 투자 데이터 접근권을 주지 않는다.

## 공개와 수집 범위

제출 화면과 도구 설명에 “앱 운영자가 내용을 확인합니다”를 안내한다. 본인과 운영자만 조회하고 친구 공유·일일 context·CSV·공유 활동 피드에 넣지 않는다. 공유 포트폴리오를 보는 로그인 사용자도 자신의 피드백으로 접수하며 익명 방문자에게는 로그인을 안내한다.

전체 대화, 계좌·잔고 snapshot, 이메일, 인증 헤더, access/refresh token, 전체 URL query/hash를 자동 수집하지 않는다. 앱은 라우트 키만 수집한다. 요약에는 지적한 현상·기대만 남기고 불필요한 투자 수치/식별자를 제외한다. 서버는 context 키·타입·길이를 검증하고 본문은 HTML로 실행하지 않는다. 자유 텍스트의 완벽한 비밀정보 탐지를 보장하지 않는다.

원문을 is_public으로 공개하지 않는다. 공개 주의사항은 운영자가 검토·익명화한 안내문으로 기존 가이드에 반영한다. GitHub 이슈도 개발자가 공개 가능한 문제/재현 조건을 정리하는 별도 수동 작업으로 한다.

## 최신화와 검증

런타임 안내는 기존 workflow-guides.ts/portfolio-tools.ts에서 관리한다. topic·tool 의존성·review manifest·schema·handler·테스트를 같은 변경에서 갱신하고 check:workflow-guides를 통과시킨다. 구현 전 미지원 도구를 런타임에 광고하지 않는다.

F01 앱 자유 입력/실패 복구, F02 명시적 채팅 등록, F03 제안 동의/거절/무응답, F04 반복 권유·모델 추정·투자 이슈 오분류, F05 응답 유실/중복, F06 작성자/운영자/타인/익명 권한, F07 처리 결과 앱/MCP 조회, F08 기능 변경 시 가이드 동기화를 검증한다. 실제 모델 평가는 자동 API 검사와 별도로 기록한다.

자동 GitHub 동기화, 첨부파일, 댓글·알림·투표, 공개 게시판, 자동 중복 병합, 역할 관리 UI, 접수 본문 편집/삭제는 첫 버전 범위 밖이다.
