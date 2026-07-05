function GuestUnlockForm({ error, onChange, onSubmit, saving, value }) {
  return (
    <div className="grid gap-3">
      <input
        className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
        onChange={(event) => onChange('public_name', event.target.value)}
        placeholder="공개 이름"
        value={value.public_name}
      />
      <input
        className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
        onChange={(event) => onChange('viewer_password', event.target.value)}
        placeholder="보기 비밀번호"
        type="password"
        value={value.viewer_password}
      />
      {error && (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}
      <button
        className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={saving}
        onClick={onSubmit}
        type="button"
      >
        {saving ? '입장 중' : '공유 포트폴리오 보기'}
      </button>
    </div>
  )
}

export function CenteredMessage({ title, body }) {
  return (
    <main className="grid min-h-screen content-center px-5">
      <section className="mx-auto max-w-sm rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--ink)] shadow-[var(--shadow-soft)]">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">{body}</p>
      </section>
    </main>
  )
}

export function LoginScreen({
  guestUnlockDraft,
  guestUnlockError,
  guestUnlockSaving,
  loginMode,
  onGuestUnlock,
  onGuestUnlockChange,
  onLoginModeChange,
  onSignInWithGoogle,
}) {
  return (
    <main className="min-h-screen px-5 py-8 text-[var(--ink)]">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-sm content-center gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Portfolio</p>
          <h1 className="mt-3 text-4xl font-semibold text-[var(--ink)]">포트폴리오</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">
            여러 계좌에 흩어진 보유 종목을 한 화면에서 보고, 태그 기준 비중까지 빠르게 확인합니다.
          </p>
        </div>

        <div className="grid gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
          <div className="flex rounded-2xl bg-[var(--surface-2)] p-1">
            <button
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                loginMode === 'owner' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-ink)]'
              }`}
              onClick={() => onLoginModeChange('owner')}
              type="button"
            >
              내 계정
            </button>
            <button
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                loginMode === 'guest' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-ink)]'
              }`}
              onClick={() => onLoginModeChange('guest')}
              type="button"
            >
              공유 보기
            </button>
          </div>

          {loginMode === 'owner' ? (
            <button
              className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
              onClick={onSignInWithGoogle}
              type="button"
            >
              Google로 로그인
            </button>
          ) : (
            <GuestUnlockForm
              error={guestUnlockError}
              onChange={onGuestUnlockChange}
              onSubmit={onGuestUnlock}
              saving={guestUnlockSaving}
              value={guestUnlockDraft}
            />
          )}
        </div>
      </section>
    </main>
  )
}

export function GuestUnlockScreen({
  guestUnlockDraft,
  guestUnlockError,
  guestUnlockSaving,
  onExit,
  onGuestUnlock,
  onGuestUnlockChange,
}) {
  return (
    <main className="min-h-screen px-5 py-8 text-[var(--ink)]">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-sm content-center gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Shared View</p>
          <h1 className="mt-3 text-4xl font-semibold text-[var(--ink)]">공유 포트폴리오 보기</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">
            공개 이름과 보기 비밀번호를 입력하면 읽기 전용으로 자산 현황을 볼 수 있습니다.
          </p>
        </div>

        <div className="grid gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
          <GuestUnlockForm
            error={guestUnlockError}
            onChange={onGuestUnlockChange}
            onSubmit={onGuestUnlock}
            saving={guestUnlockSaving}
            value={guestUnlockDraft}
          />
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            onClick={onExit}
            type="button"
          >
            나가기
          </button>
        </div>
      </section>
    </main>
  )
}
