import { tagColorMap } from '../../constants/portfolio'

export default function SettingsPage({
  onCreateTag,
  onEditTag,
  onSyncPrices,
  onViewerProfileChange,
  onViewerProfileSave,
  syncingPrices,
  syncMessage,
  tags,
  viewerProfile,
  viewerProfileDraft,
  viewerProfileError,
  viewerProfileMessage,
  viewerProfileSaving,
  viewerProfileSchemaReady,
}) {
  return (
    <section className="mt-8 grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">공유 보기</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
              공개 이름과 보기 비밀번호로 포트폴리오를 읽기 전용으로 공유합니다.
            </p>
          </div>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!viewerProfileSchemaReady || viewerProfileSaving}
            onClick={onViewerProfileSave}
            type="button"
          >
            {viewerProfileSaving ? '저장 중' : '공유 설정 저장'}
          </button>
        </div>

        {!viewerProfileSchemaReady ? (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            공유 보기 기능을 위한 데이터베이스 마이그레이션이 아직 적용되지 않았습니다. Supabase migration 적용 후 다시 사용해 주세요.
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">공개 이름</span>
              <input
                className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
                onChange={(event) => onViewerProfileChange('public_name', event.target.value)}
                placeholder="예: yongin-portfolio"
                value={viewerProfileDraft.public_name}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">보기 비밀번호</span>
              <input
                className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
                onChange={(event) => onViewerProfileChange('viewer_password', event.target.value)}
                placeholder={viewerProfile.viewer_password_updated_at ? '변경할 때만 입력' : '최소 4자 이상'}
                type="password"
                value={viewerProfileDraft.viewer_password}
              />
            </label>

            <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">공유 보기 활성화</p>
                <p className="mt-1 text-sm text-[var(--muted-ink)]">
                  친구가 공개 이름과 비밀번호로 자산, 계좌, 종목을 읽기 전용으로 볼 수 있습니다.
                </p>
              </div>
              <button
                aria-pressed={viewerProfileDraft.sharing_enabled}
                className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${
                  viewerProfileDraft.sharing_enabled
                    ? 'border-[var(--accent)] bg-[var(--accent)]'
                    : 'border-[var(--line)] bg-[var(--surface-3)]'
                }`}
                onClick={() => onViewerProfileChange('sharing_enabled', !viewerProfileDraft.sharing_enabled)}
                type="button"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    viewerProfileDraft.sharing_enabled ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]">
              <p>
                현재 상태:{' '}
                <span className="font-semibold text-[var(--ink)]">
                  {viewerProfile.sharing_enabled ? '활성화됨' : '비활성화됨'}
                </span>
              </p>
              <p className="mt-2">
                비밀번호는 다시 보여주지 않습니다. 바꾸고 싶을 때만 새 비밀번호를 입력해 주세요.
              </p>
            </div>
          </div>
        )}

        {viewerProfileError && (
          <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {viewerProfileError}
          </div>
        )}

        {viewerProfileMessage && (
          <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {viewerProfileMessage}
          </div>
        )}
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">가격 동기화</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
              서버 함수에서 최신 가격을 가져와 보유 평가 금액을 갱신합니다.
            </p>
          </div>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={syncingPrices}
            onClick={onSyncPrices}
            type="button"
          >
            {syncingPrices ? '동기화 중' : '가격 동기화'}
          </button>
        </div>
        {syncMessage && (
          <p className="mt-4 rounded-2xl bg-[var(--surface-2)] px-3 py-3 text-sm text-[var(--muted-ink)]">
            {syncMessage}
          </p>
        )}
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">태그 관리</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
              종목 하나당 태그 하나만 연결합니다. 이름, 색상, 정렬 순서를 관리합니다.
            </p>
          </div>
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            onClick={onCreateTag}
            type="button"
          >
            태그 추가
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {tags.map((tag) => (
            <button
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3 text-left transition hover:bg-[var(--surface-2)]"
              key={tag.id}
              onClick={() => onEditTag(tag)}
              type="button"
            >
              <span
                className="h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: tagColorMap[tag.color] ?? tag.color ?? '#8a8e96' }}
              />
              <span className="min-w-0 text-sm font-medium">{tag.name}</span>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
                {tag.sort_order}
              </span>
            </button>
          ))}
        </div>
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">가져오기</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
          React 버전에서는 예전 CSV 일괄 가져오기 흐름을 직접 노출하지 않습니다. 현재 구조에서는 계좌, 종목, 보유 수량을 직접 관리하는 쪽으로 단순화했습니다.
        </p>
      </article>
    </section>
  )
}
