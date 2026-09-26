import { useEffect, useState } from 'react'

const scopeLabels = {
  email: '계정 이메일 확인',
  offline_access: '로그인 상태 유지',
  openid: '계정 식별',
  phone: '전화번호 확인',
  profile: '프로필 정보 확인',
}

function requestedScopes(scope = '') {
  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

export default function OAuthConsentPage({ authorizationId, onSignIn, session, supabase }) {
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(session))
  const [signingIn, setSigningIn] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!session || !authorizationId) return

    let active = true
    setLoading(true)
    setError('')

    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: nextError }) => {
      if (!active) return
      if (nextError) {
        setError(nextError.message ?? '연결 요청을 불러오지 못했습니다.')
        setLoading(false)
        return
      }
      if (data && 'redirect_url' in data) {
        window.location.assign(data.redirect_url)
        return
      }
      setDetails(data)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [authorizationId, session, supabase])

  async function decide(action) {
    setSubmitting(true)
    setError('')
    const method = action === 'approve' ? 'approveAuthorization' : 'denyAuthorization'
    const { data, error: nextError } = await supabase.auth.oauth[method](authorizationId, {
      skipBrowserRedirect: true,
    })

    if (nextError) {
      setError(nextError.message ?? '연결 요청을 처리하지 못했습니다.')
      setSubmitting(false)
      return
    }

    if (data?.redirect_url) {
      window.location.assign(data.redirect_url)
      return
    }

    setError('연결을 마칠 리디렉션 주소가 없습니다.')
    setSubmitting(false)
  }

  async function signIn() {
    setSigningIn(true)
    setError('')

    try {
      const { data, error: nextError } = await onSignIn()
      if (nextError) {
        setError(nextError.message ?? 'Google 로그인을 시작하지 못했습니다.')
        setSigningIn(false)
        return
      }

      if (data?.url) {
        window.location.assign(data.url)
        return
      }

      setError('Google 로그인 주소를 받지 못했습니다.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Google 로그인을 시작하지 못했습니다.')
    }

    setSigningIn(false)
  }

  if (!session || session.user?.is_anonymous) {
    return (
      <main className="grid min-h-screen content-center px-5 text-[var(--ink)]">
        <section className="mx-auto w-full max-w-md rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
          <p className="type-meta text-[var(--accent)]">Portfolio OAuth</p>
          <h1 className="type-page-title mt-3">ChatGPT 연결</h1>
          <p className="type-body type-long-body mt-3 text-[var(--muted-ink)]">
            포트폴리오 계정으로 로그인한 뒤 ChatGPT가 내 데이터에 접근하도록 승인할 수 있습니다.
          </p>
          {error && (
            <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}
          <button
            className="mt-6 w-full rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
            disabled={signingIn}
            onClick={signIn}
            type="button"
          >
            {signingIn ? '로그인 준비 중' : 'Google로 로그인'}
          </button>
        </section>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="grid min-h-screen content-center px-5 text-[var(--ink)]">
        <p className="text-center text-sm text-[var(--muted-ink)]">연결 요청을 확인하고 있습니다.</p>
      </main>
    )
  }

  const scopes = requestedScopes(details?.scope)

  return (
    <main className="grid min-h-screen content-center px-5 py-8 text-[var(--ink)]">
      <section className="mx-auto w-full max-w-md rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
        <p className="type-meta text-[var(--accent)]">Portfolio OAuth</p>
        <h1 className="type-page-title mt-3">{details?.client?.name ?? 'AI 도구'} 연결</h1>
        <p className="type-body type-long-body mt-3 text-[var(--muted-ink)]">
          이 도구가 로그인한 사용자의 포트폴리오를 조회하고, 사용자가 요청한 변경 작업을 수행할 수 있게 됩니다.
        </p>

        <div className="type-body mt-5 rounded-2xl bg-[var(--surface-2)] p-4">
          <p className="type-item-title">요청 권한</p>
          <ul className="mt-2 grid gap-2 text-[var(--muted-ink)]">
            {(scopes.length ? scopes : ['openid']).map((scope) => (
              <li key={scope}>• {scopeLabels[scope] ?? scope}</li>
            ))}
          </ul>
          <p className="mt-4 break-all text-xs text-[var(--muted-ink)]">로그인 계정: {session.user.email}</p>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-60"
            disabled={submitting}
            onClick={() => decide('deny')}
            type="button"
          >
            거부
          </button>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
            disabled={submitting}
            onClick={() => decide('approve')}
            type="button"
          >
            {submitting ? '처리 중' : '연결 승인'}
          </button>
        </div>
      </section>
    </main>
  )
}
