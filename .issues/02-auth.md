## What to build

Supabase Auth 기반 로그인 플로우를 구현한다. 이메일 로그인 링크(Magic Link)로 인증하고, 인증 후 `/assets`로 진입한다. 미인증 접근은 클라이언트 사이드 라우트 가드로 `/login`으로 리다이렉트한다.

도메인 언어는 `portfolio-app/CONTEXT.md`, 기술 스택은 `docs/adr/0001-static-html-github-pages.md` 참조.

## 라우트

| 경로 | 역할 |
|---|---|
| `/login` | 이메일 입력 → 로그인 링크 발송 |
| `/auth/callback` | 링크 클릭 후 세션 설정 → `/assets` 리다이렉트 |
| `/assets`, `/analysis`, `/data` | 보호 라우트 — 미인증 시 `/login` 리다이렉트 |

## 인증 방식

- Supabase Auth Email OTP(Magic Link) 사용.
- **UI 표기는 "로그인 링크"** — "매직링크" 표기 금지.
- 이메일 입력 → `supabase.auth.signInWithOtp({ email })` 호출 → 메일 발송.
- 링크 클릭 → `/auth/callback` 처리 → 세션 쿠키/localStorage 설정 → `/assets` 리다이렉트.

## 모바일 대응

모바일에서는 메일 앱을 거쳐 링크가 열리면 현재 브라우저에 세션이 없을 수 있다. 로그인 페이지에 **`로그인 완료 확인`** 버튼을 제공하고, 클릭 시 `supabase.auth.getSession()`으로 현재 브라우저 세션 존재 여부를 확인한다.

## 라우트 가드

Next.js middleware 대신 **클라이언트 사이드 라우트 가드**를 사용한다 (ADR-0001 — 빌드 단계 없는 순수 HTML/JS).

```js
// 페이지 로드 시 실행
const { data: { session } } = await supabase.auth.getSession()
if (!session) {
    window.location.href = '/login'
}
```

## 환경 변수

| 키 | 위치 |
|---|---|
| `SUPABASE_URL` | HTML/JS 인라인 또는 GitHub Pages 환경변수 |
| `SUPABASE_ANON_KEY` | 동일 — anon key는 RLS로 보호되므로 노출 무방 |

- `service_role key`는 웹 앱에서 절대 사용하지 않는다.

## Skills용 이메일+비밀번호 로그인 설정

Web App은 Magic Link만 사용하지만, Market Analysis Skill과 Rebalancing Skill은 이메일+비밀번호로 로그인해야 한다. Supabase Auth 설정에서 동일 포트폴리오 소유자 계정에 비밀번호 로그인을 활성화한다.

## Acceptance criteria

- [ ] `/login` 페이지에서 이메일 입력 후 로그인 링크가 발송된다
- [ ] 화면에 "매직링크"가 없고 "로그인 링크"로 표기된다
- [ ] 링크 클릭 후 `/auth/callback`을 거쳐 `/assets`로 진입한다
- [ ] 모바일 대응: `로그인 완료 확인` 버튼이 있고 `supabase.auth.getSession()`으로 동작한다
- [ ] 미인증 상태로 `/assets`, `/analysis`, `/data` 접근 시 `/login`으로 리다이렉트된다
- [ ] 브라우저 번들(HTML 소스)에 `service_role key`가 없다
- [ ] Supabase Auth 설정에서 포트폴리오 소유자 계정의 이메일+비밀번호 로그인이 활성화되어 있다

## Blocked by

- #1 (스키마 — Supabase 프로젝트 설정 필요)
