import { useState } from 'react'
import { tagColorMap } from '../../constants/portfolio'

function SettingsSection({ children }) {
  return (
    <article className="min-w-0 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      {children}
    </article>
  )
}

function formatActionTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function mcpToken(token) {
  return token || '<issued_agent_token>'
}

function buildFileConfigCommand(pathExpression, endpoint, token) {
  return [
    `$env:PORTFOLIO_MCP_TOKEN = "${mcpToken(token)}"`,
    `$path = ${pathExpression}`,
    'New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null',
    '@{',
    '  mcpServers = @{',
    '    portfolio = @{',
    '      type = "http"',
    `      url = "${endpoint}"`,
    '      headers = @{',
    '        Authorization = "Bearer $env:PORTFOLIO_MCP_TOKEN"',
    '      }',
    '    }',
    '  }',
    '} | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $path',
  ].join('\n')
}

function buildMcpExamples(endpoint, token) {
  return [
    { name: 'Cursor', target: '.cursor/mcp.json', body: buildFileConfigCommand('".cursor/mcp.json"', endpoint, token) },
    { name: 'Antigravity', target: 'mcp_config.json', body: buildFileConfigCommand('Join-Path $env:USERPROFILE ".gemini\\antigravity-cli\\mcp_config.json"', endpoint, token) },
    { name: 'Codex', target: 'Codex CLI', body: [`$env:PORTFOLIO_MCP_TOKEN = "${mcpToken(token)}"`, `codex mcp add portfolio --url "${endpoint}" --bearer-token-env-var PORTFOLIO_MCP_TOKEN`].join('\n') },
    { name: 'Claude', target: 'Claude Code CLI', body: [`$env:PORTFOLIO_MCP_TOKEN = "${mcpToken(token)}"`, `claude mcp add --scope user --transport http portfolio "${endpoint}" --header "Authorization: Bearer $env:PORTFOLIO_MCP_TOKEN"`].join('\n') },
  ]
}

export default function SettingsPage({
  agentMcpEndpoint = '', agentTokenError = '', agentTokenSaving = false, agentTokens = [], agentTokensLoading = false,
  friendDraft, friendError = '', friendSaving = false, friends = [], issuedAgentToken = '',
  onAddFriend, onCreateTag, onEditTag, onFriendChange, onRemoveFriend, onAgentTokenCreate, onAgentTokenDismiss,
  onAgentTokenRevoke, onSyncPrices, onViewerProfileChange, onViewerProfileSave, syncingPrices, syncMessage, tags,
  viewerProfile, viewerProfileDraft, viewerProfileError, viewerProfileMessage, viewerProfileSaving, viewerProfileSchemaReady,
}) {
  const examples = buildMcpExamples(agentMcpEndpoint, issuedAgentToken)
  const [vendor, setVendor] = useState('Codex')
  const selectedExample = examples.find((example) => example.name === vendor) ?? examples[0]

  return (
    <section className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-5">
      <SettingsSection>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">공유 보기</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">공개 이름과 비밀번호로 포트폴리오를 읽기 전용으로 공유합니다.</p>
          </div>
          <button className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60" disabled={!viewerProfileSchemaReady || viewerProfileSaving} onClick={onViewerProfileSave} type="button">
            {viewerProfileSaving ? '저장 중' : '공유 설정 저장'}
          </button>
        </div>
        {!viewerProfileSchemaReady ? (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">공유 보기 기능에 필요한 데이터베이스 마이그레이션이 아직 적용되지 않았습니다. Supabase migration 적용 후 다시 사용해 주세요.</div>
        ) : (
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">공개 이름</span><input className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]" onChange={(event) => onViewerProfileChange('public_name', event.target.value)} placeholder="예: yongin-portfolio" value={viewerProfileDraft.public_name} /></label>
            <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">보기 비밀번호</span><input className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]" onChange={(event) => onViewerProfileChange('viewer_password', event.target.value)} placeholder={viewerProfile.viewer_password_updated_at ? '변경할 때만 입력' : '최소 4자 이상'} type="password" value={viewerProfileDraft.viewer_password} /></label>
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
              <div><p className="text-sm font-semibold text-[var(--ink)]">공유 보기 활성화</p><p className="mt-1 text-sm text-[var(--muted-ink)]">친구가 공개 이름과 비밀번호로 자산, 계좌, 종목을 읽기 전용으로 볼 수 있습니다.</p></div>
              <button aria-pressed={viewerProfileDraft.sharing_enabled} className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${viewerProfileDraft.sharing_enabled ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line)] bg-[var(--surface-3)]'}`} onClick={() => onViewerProfileChange('sharing_enabled', !viewerProfileDraft.sharing_enabled)} type="button"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${viewerProfileDraft.sharing_enabled ? 'left-6' : 'left-1'}`} /></button>
            </label>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]">현재 상태: <span className="font-semibold text-[var(--ink)]">{viewerProfile.sharing_enabled ? '활성화됨' : '비활성화됨'}</span></div>
          </div>
        )}
        {viewerProfileError && <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{viewerProfileError}</div>}
        {viewerProfileMessage && <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{viewerProfileMessage}</div>}
      </SettingsSection>

      <SettingsSection>
        <h2 className="text-lg font-semibold">친구 포트폴리오</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">친구의 공개 이름과 보기 비밀번호를 한 번만 입력하면, 이후 상단 메뉴에서 바로 전환할 수 있습니다.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">공개 이름</span><input className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]" onChange={(event) => onFriendChange('public_name', event.target.value)} placeholder="친구의 공개 이름" value={friendDraft?.public_name ?? ''} /></label>
          <label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">보기 비밀번호</span><input className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]" onChange={(event) => onFriendChange('viewer_password', event.target.value)} placeholder="보기 비밀번호" type="password" value={friendDraft?.viewer_password ?? ''} /></label>
          <button className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60" disabled={!viewerProfileSchemaReady || friendSaving || !friendDraft?.public_name?.trim() || !friendDraft?.viewer_password} onClick={onAddFriend} type="button">{friendSaving ? '추가 중' : '친구 추가'}</button>
        </div>
        {friendError && <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{friendError}</div>}
        <div className="mt-4 grid gap-2">{friends.length === 0 ? <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]">아직 추가한 친구가 없습니다.</p> : friends.map((friend) => <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3" key={friend.owner_user_id}><p className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{friend.owner_public_name || '이름 없는 친구'}</p><button aria-label={`${friend.owner_public_name || '친구'} 해제`} className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted-ink)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60" disabled={friendSaving} onClick={() => onRemoveFriend(friend.owner_user_id)} type="button">해제</button></div>)}</div>
      </SettingsSection>

      <SettingsSection>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">에이전트에 MCP로 연결</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">에이전트가 포트폴리오 MCP에 연결할 토큰을 관리합니다.</p></div><button className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60" disabled={agentTokenSaving} onClick={onAgentTokenCreate} type="button">{agentTokenSaving ? '발급 중' : '에이전트 연결하기'}</button></div>
        <div className="mt-4 min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]"><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">에이전트</span><select className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]" onChange={(event) => setVendor(event.target.value)} value={selectedExample.name}>{examples.map((example) => <option key={example.name} value={example.name}>{example.name}</option>)}</select></label><p className="text-xs font-medium text-[var(--muted-ink)]">{selectedExample.target}</p></div><pre className="mt-3 max-h-44 max-w-full overflow-x-auto rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.22)] p-3 text-xs leading-5 text-[var(--ink)]"><code>{selectedExample.body}</code></pre>{issuedAgentToken && <div className="mt-3 grid gap-2"><div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"><p className="font-semibold">새 토큰</p><p className="mt-2 break-all font-mono text-xs">{issuedAgentToken}</p></div><button className="justify-self-start rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" onClick={onAgentTokenDismiss} type="button">토큰 숨기기</button></div>}</div>
        {agentTokenError && <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{agentTokenError}</div>}
        <div className="mt-4 grid gap-2"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[var(--ink)]">연결 토큰</h3><span className="text-xs text-[var(--muted-ink)]">{agentTokensLoading ? '불러오는 중' : `${agentTokens.length}개`}</span></div>{!agentTokensLoading && agentTokens.length === 0 && <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]">아직 발급한 에이전트 토큰이 없습니다.</p>}{agentTokens.map((token) => <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={token.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[var(--ink)]">{token.name}</p><span className={`rounded-full border px-2 py-0.5 text-xs ${token.revoked_at ? 'border-red-400/40 text-red-100' : 'border-emerald-400/40 text-emerald-100'}`}>{token.revoked_at ? '폐기됨' : '활성'}</span></div><p className="mt-1 truncate font-mono text-xs text-[var(--muted-ink)]">{token.token_prefix}</p><p className="mt-1 text-xs text-[var(--muted-ink)]">발급 {formatActionTime(token.created_at)}{token.last_used_at ? ` · 최근 사용 ${formatActionTime(token.last_used_at)}` : ''}</p></div>{!token.revoked_at && <button className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60" disabled={agentTokenSaving} onClick={() => onAgentTokenRevoke(token.id)} type="button">폐기</button>}</div>)}</div>
      </SettingsSection>

      <SettingsSection><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">가격 동기화</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">서버 함수에서 최신 가격을 가져와 보유 평가 금액을 갱신합니다.</p></div><button className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60" disabled={syncingPrices} onClick={onSyncPrices} type="button">{syncingPrices ? '동기화 중' : '가격 동기화'}</button></div>{syncMessage && <p className="mt-4 rounded-2xl bg-[var(--surface-2)] px-3 py-3 text-sm text-[var(--muted-ink)]">{syncMessage}</p>}</SettingsSection>

      <SettingsSection><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">태그 관리</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">종목마다 태그 하나를 연결할 수 있습니다.</p></div><button className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" onClick={onCreateTag} type="button">태그 추가</button></div><div className="mt-4 grid gap-2">{tags.map((tag) => <button className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3 text-left transition hover:bg-[var(--surface-2)]" key={tag.id} onClick={() => onEditTag(tag)} type="button"><span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: tagColorMap[tag.color] ?? tag.color ?? '#8a8e96' }} /><span className="min-w-0 text-sm font-medium">{tag.name}</span><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">{tag.sort_order}</span></button>)}</div></SettingsSection>
    </section>
  )
}
