# Static HTML/JS on GitHub Pages, not Next.js on Vercel

Web App은 Next.js + Vercel 대신 순수 HTML/JS로 구현하고 GitHub Pages에 배포한다. 빌드 단계가 없으며 `@supabase/supabase-js`를 CDN 또는 ESM으로 직접 로드한다.

## 이유

- Supabase가 BaaS 전체를 처리하므로 SSR이 필요한 서버 사이드 기능이 없다. Auth, DB, Storage, Edge Function 모두 클라이언트 JS SDK로 접근 가능.
- GitHub Pages는 무료이고 빌드·배포 파이프라인이 단순하다.
- mockup(`index-v2.html`)이 이미 순수 HTML/JS로 구현되어 있어 동일한 방식이 그대로 이어진다.

## 결과

- `@supabase/ssr`, Next.js middleware, TypeScript 빌드, `supabase gen types` 파이프라인은 사용하지 않는다.
- Auth redirect(미인증 보호)는 서버 middleware 대신 클라이언트 사이드 라우트 가드로 처리한다.
- `PRD_PORTFOLIO_APP.md §2 기술 스택`, `§3 디렉토리 구조`, `§13 타입 생성 파이프라인`은 이 결정에 맞게 수정이 필요하다.
