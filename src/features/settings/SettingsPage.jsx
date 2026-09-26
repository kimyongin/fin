import { useState } from 'react'
import { appVersion } from '../../lib/version'
import { ConfirmDialog } from '../../components/ModalShell'
import { profileAvatars } from '../../lib/profileAvatar'
import SharingSwitch from './SharingSwitch'
import { profileAvatar } from '../../lib/profileAvatar'

function SettingsSection({ children }) {
  return (
    <article className="min-w-0 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      {children}
    </article>
  )
}

function formatLastViewed(value) {
  if (!value) return '아직 열람 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '아직 열람 없음'
  const includeYear = date.getFullYear() !== new Date().getFullYear()
  return new Intl.DateTimeFormat('ko-KR', {
    ...(includeYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

export default function SettingsPage({
  friendDraft, friendError = '', friendSaving = false, friends = [],
  portfolioViewers = [], portfolioViewersError = '', portfolioViewersLoading = false, portfolioViewersNextOffset = null,
  onPortfolioViewersReload, onPortfolioViewersMore,
  onAddFriend, onFriendChange, onRemoveFriend,
  onViewerProfileChange, onViewerProfileSave, onViewerProfileReset, onViewerProfileReload,
  onAvatarSelect, avatarSaving = false, avatarError = '',
  viewerProfile, viewerProfileDraft, viewerProfileError, viewerProfileErrorTarget, viewerProfileLoaded,
  viewerProfileMessage, viewerProfileSaving, viewerProfileSchemaReady, onViewFriend,
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const sharingDirty = viewerProfileDraft.public_name !== viewerProfile.public_name
    || Boolean(viewerProfileDraft.viewer_password)
    || Boolean(viewerProfileDraft.sharing_enabled) !== Boolean(viewerProfile.sharing_enabled)

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <SettingsSection>
        <h2 className="type-section-title">내 프로필 아이콘</h2>
        <p className="type-secondary mt-2 text-[var(--muted-ink)]">하단에서 내 포트폴리오를 나타낼 아이콘을 고릅니다.</p>
        <div aria-busy={avatarSaving} aria-label="프로필 아이콘 선택" className="mt-4 flex flex-wrap items-center gap-2" role="group">
          {profileAvatars.map((avatar) => <button aria-label={avatar.name} aria-pressed={viewerProfileDraft.avatar_key === avatar.key} className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border ${viewerProfileDraft.avatar_key === avatar.key ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--surface-2)]'}`} disabled={!viewerProfileSchemaReady || !viewerProfileLoaded || avatarSaving} key={avatar.key} onClick={() => onAvatarSelect(avatar.key)} type="button"><span aria-hidden="true" style={{ fontSize: '1.25rem', lineHeight: 1 }}>{avatar.symbol}</span></button>)}
        </div>
        {avatarError && <p className="type-secondary mt-2 text-red-200" role="alert">{avatarError}</p>}
      </SettingsSection>
      <SettingsSection>
        <h2 className="type-section-title">공유 하기</h2>
        <p className="type-secondary mt-2 text-[var(--muted-ink)]">자산·배분·활동·원칙과 이력을 읽기 전용으로 공유합니다.</p>
        {!viewerProfileSchemaReady ? (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">공유 기능에 필요한 데이터베이스 마이그레이션이 아직 적용되지 않았습니다. Supabase migration 적용 후 다시 사용해 주세요.</div>
        ) : !viewerProfileLoaded ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="type-secondary text-[var(--muted-ink)]">{viewerProfileError ? '공유 설정 상태를 확인할 수 없습니다.' : '공유 설정을 불러오는 중입니다.'}</p>
            {viewerProfileError && <button className="type-action min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={() => onViewerProfileReload(sharingDirty)} type="button">다시 조회</button>}
          </div>
        ) : (
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="grid content-start gap-2"><span className="type-label text-[var(--muted-ink)]">공개 이름</span><input aria-invalid={viewerProfileErrorTarget === 'public_name' && Boolean(viewerProfileError)} className="type-input h-12 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 outline-none focus:border-[var(--accent)]" disabled={viewerProfileSaving} onChange={(event) => onViewerProfileChange('public_name', event.target.value)} placeholder="예: yongin-portfolio" value={viewerProfileDraft.public_name} />{viewerProfileErrorTarget === 'public_name' && viewerProfileError && <span className="type-secondary text-red-200" role="alert">{viewerProfileError}</span>}</label>
              <label className="grid content-start gap-2"><span className="type-label text-[var(--muted-ink)]">보기 비밀번호</span><input aria-invalid={viewerProfileErrorTarget === 'viewer_password' && Boolean(viewerProfileError)} className="type-input h-12 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 outline-none focus:border-[var(--accent)]" disabled={viewerProfileSaving} onChange={(event) => onViewerProfileChange('viewer_password', event.target.value)} placeholder={viewerProfile.viewer_password_updated_at ? '변경할 때만 입력' : '최소 4자 이상'} type="password" value={viewerProfileDraft.viewer_password} />{viewerProfileErrorTarget === 'viewer_password' && viewerProfileError && <span className="type-secondary text-red-200" role="alert">{viewerProfileError}</span>}</label>
              <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 sm:justify-end">
                <div className="flex items-center gap-2"><span className="type-label">공유</span><SharingSwitch checked={Boolean(viewerProfileDraft.sharing_enabled)} disabled={viewerProfileSaving} label="공유" onClick={() => onViewerProfileChange('sharing_enabled', !viewerProfileDraft.sharing_enabled)} /><span className="type-secondary text-[var(--muted-ink)]">{viewerProfileDraft.sharing_enabled ? '켜짐' : '꺼짐'}</span></div>
                <div className="flex items-center gap-2">{sharingDirty && <span className="type-secondary text-[var(--muted-ink)]">저장 전</span>}<button className="type-action min-h-12 rounded-xl bg-[var(--accent)] px-4 text-white disabled:opacity-50" disabled={!sharingDirty || viewerProfileSaving} onClick={onViewerProfileSave} type="button">{viewerProfileSaving ? '저장 중' : '저장하기'}</button></div>
              </div>
            </div>
            {viewerProfileError && !['public_name', 'viewer_password'].includes(viewerProfileErrorTarget) && <p className="type-secondary mt-2 text-red-200" role="alert">{viewerProfileError}</p>}
            {viewerProfileMessage && <p className="type-secondary mt-2 text-emerald-200" role="status">{viewerProfileMessage}</p>}
            {(viewerProfile.public_name || viewerProfile.viewer_password_updated_at || viewerProfile.sharing_enabled) && <button className="type-action mt-3 min-h-11 rounded-xl border border-[var(--line)] px-3 text-red-200 disabled:opacity-50" disabled={viewerProfileSaving} onClick={() => setConfirmReset(true)} type="button">공유 설정 초기화</button>}
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <h3 className="type-item-title">공유받는 친구</h3>
              {portfolioViewersError && <div className="mt-3 flex flex-wrap items-center gap-3"><p className="type-secondary text-red-200" role="alert">{portfolioViewersError}</p><button className="type-action min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={onPortfolioViewersReload} type="button">다시 조회</button></div>}
              {!portfolioViewersError && !portfolioViewersLoading && portfolioViewers.length === 0 && <p className="type-secondary mt-3 text-[var(--muted-ink)]">아직 내 포트폴리오를 연결한 친구가 없습니다.</p>}
              <div className="mt-3">{portfolioViewers.map((viewer) => <div className="flex min-w-0 flex-wrap items-center gap-3 border-t border-[var(--line)] py-3" key={viewer.viewer_user_id}><span aria-hidden="true" className="text-2xl">{profileAvatar(viewer.avatar_key).symbol}</span><p className="type-item-title min-w-0 flex-1 break-words">{viewer.public_name || '이름 없는 친구'}</p><p className="type-secondary text-[var(--muted-ink)]">{formatLastViewed(viewer.last_viewed_at)}</p></div>)}</div>
              {portfolioViewersNextOffset !== null && <button className="type-action min-h-11 rounded-xl border border-[var(--line)] px-4 disabled:opacity-50" disabled={portfolioViewersLoading} onClick={onPortfolioViewersMore} type="button">더 보기</button>}
              {portfolioViewersLoading && <p className="type-secondary mt-2 text-[var(--muted-ink)]">불러오는 중</p>}
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection>
        <h2 className="type-section-title">공유 받기</h2>
        <p className="type-secondary mt-2 text-[var(--muted-ink)]">공유받은 이름과 비밀번호를 입력하세요.</p>
        <div className="mt-5 grid gap-4 border-t border-[var(--line)] pt-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="grid content-start gap-2"><span className="type-label text-[var(--muted-ink)]">공개 이름</span><input className="type-input h-12 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 outline-none focus:border-[var(--accent)]" onChange={(event) => onFriendChange('public_name', event.target.value)} placeholder="상대방의 공개 이름" value={friendDraft?.public_name ?? ''} /></label>
          <label className="grid content-start gap-2"><span className="type-label text-[var(--muted-ink)]">보기 비밀번호</span><input className="type-input h-12 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 outline-none focus:border-[var(--accent)]" onChange={(event) => onFriendChange('viewer_password', event.target.value)} placeholder="비밀번호" type="password" value={friendDraft?.viewer_password ?? ''} /></label>
          <button className="type-action min-h-12 w-full rounded-xl bg-[var(--accent)] px-4 text-white disabled:opacity-60 sm:w-auto" disabled={!viewerProfileSchemaReady || friendSaving || !friendDraft?.public_name?.trim() || !friendDraft?.viewer_password} onClick={onAddFriend} type="button">{friendSaving ? '연결 중' : '연결하기'}</button>
        </div>
        {friendError && <p className="type-secondary mt-3 text-red-200" role="alert">{friendError}</p>}
        <p className="type-secondary mt-3 text-[var(--muted-ink)]">내 공개 이름과 최근 열람 시각이 상대방에게 표시됩니다.</p>
        <div className="mt-6 border-t border-[var(--line)] pt-5"><h3 className="type-item-title">내가 연결한 친구</h3><div className="mt-3 grid gap-2">{friends.length === 0 ? <p className="type-secondary text-[var(--muted-ink)]">아직 연결한 포트폴리오가 없습니다.</p> : friends.map((friend) => <div className="flex min-w-0 flex-wrap items-center gap-3 border-t border-[var(--line)] py-3" key={friend.owner_user_id}><span aria-hidden="true" className="text-2xl">{profileAvatar(friend.owner_avatar_key).symbol}</span><p className="type-item-title min-w-0 flex-1 break-words">{friend.owner_public_name || '이름 없는 친구'}</p><div className="flex gap-2"><button className="type-action min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={() => onViewFriend(friend.owner_user_id)} type="button">보기</button><button aria-label={`${friend.owner_public_name || '친구'} 해제`} className="type-action min-h-11 rounded-xl border border-[var(--line)] px-3 text-[var(--muted-ink)] disabled:opacity-60" disabled={friendSaving} onClick={() => onRemoveFriend(friend.owner_user_id)} type="button">해제</button></div></div>)}</div></div>
      </SettingsSection>

      <p className="pb-2 text-center text-xs text-[var(--muted-ink)]">버전 {appVersion}</p>
      {confirmReset && <ConfirmDialog cancelLabel="유지" confirmLabel="초기화" danger description="공개 이름과 보기 비밀번호를 지우고 공유를 끕니다. 기존 친구 연결과 보기 세션도 해제됩니다. 투자 데이터와 프로필 아이콘은 유지됩니다." onCancel={() => setConfirmReset(false)} onConfirm={async () => { setConfirmReset(false); await onViewerProfileReset() }} pending={viewerProfileSaving} title="공유 설정 초기화" />}
    </section>
  )
}
