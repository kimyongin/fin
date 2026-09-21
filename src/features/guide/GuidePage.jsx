import { useState } from 'react'

import { writeClipboard } from '../../lib/clipboard'
import { SUPABASE_URL } from '../../lib/config'

const oauthMcpEndpoint = `${SUPABASE_URL}/functions/v1/portfolio-mcp-oauth`
const reviewPrompt = '오늘 내 포트폴리오 점검하고 저장해줘'

const quickSteps = [
  {
    number: '1',
    title: '현재 자산부터 입력',
    body: '과거 거래를 복원하지 않아도 됩니다. 자산에서 계좌와 종목을 만들고 지금 수량과 평균가만 기준점으로 입력하세요.',
    action: { label: '자산 입력하기', target: 'overview' },
  },
  {
    number: '2',
    title: 'ChatGPT에 Portfolio 연결',
    body: 'ChatGPT 설정에서 개발자 모드를 켠 뒤 MCP 앱 만들기 화면에 아래 주소를 입력합니다. 처음 도구를 사용할 때 Portfolio 로그인과 OAuth 승인을 진행합니다.',
    copy: { label: 'OAuth MCP 주소 복사', value: oauthMcpEndpoint },
  },
  {
    number: '3',
    title: '첫 점검 요청',
    body: '연결한 Portfolio 앱을 선택하고 아래 문장을 보냅니다. ChatGPT가 조사·판단을 돕고, 명시한 요청 범위의 결과만 Portfolio에 저장합니다.',
    copy: { label: '첫 점검 문구 복사', value: reviewPrompt },
  },
  {
    number: '4',
    title: '오늘에서 저장 결과 확인',
    body: 'ChatGPT가 저장 성공을 알린 뒤 Portfolio의 오늘 화면을 새로고침합니다. 분석 시각, 조사 범위, 당시 결론과 연결 과제를 확인하세요.',
    action: { label: '오늘 화면으로', target: 'today' },
  },
]

const boundaries = [
  ['분석', 'ChatGPT가 최신 자료와 Portfolio 문맥을 바탕으로 설명합니다. 분석만 요청하면 저장하지 않습니다.'],
  ['저장', '“저장해줘”라고 명시한 결과만 기록합니다. 성공 응답을 받기 전에는 저장됐다고 간주하지 않습니다.'],
  ['실제 매매', '앱은 주문하지 않습니다. 이미 체결한 매매를 사용자가 알려준 경우에만 미리보기 후 기록합니다.'],
  ['잔고 확인', '증권사 실제 값과 대조한 시점·범위를 별도로 남깁니다. 매일 확인하거나 과거 원장을 완전히 복원할 필요는 없습니다.'],
]

const troubleshooting = [
  ['연결 메뉴가 보이지 않음', 'ChatGPT 계정·워크스페이스 정책에 따라 개발자 모드 제공 여부가 다를 수 있습니다. 웹의 설정 → 보안 및 로그인에서 개발자 모드를 확인하세요.'],
  ['로그인 또는 승인을 취소함', 'Portfolio 데이터는 바뀌지 않습니다. ChatGPT의 앱 관리 화면에서 다시 연결하고 OAuth 승인을 완료하세요.'],
  ['도구나 설명이 예전 상태임', 'ChatGPT 앱 관리 화면에서 연결을 새로고침한 뒤 새 대화에서 다시 시도하세요.'],
  ['저장 결과가 오늘에 안 보임', 'ChatGPT 응답에서 저장 성공 여부를 먼저 확인하고 오늘 화면을 새로고침하세요. 오류가 있었다면 같은 요청을 임의로 반복하지 말고 오류 내용을 확인하세요.'],
  ['자산이 비어 있음', 'ChatGPT 연결보다 현재 잔고 기준점을 먼저 입력하세요. 계좌·종목·수량·평균가만으로 시작할 수 있습니다.'],
]

export default function GuidePage({ onNavigate }) {
  const [copied, setCopied] = useState('')

  async function copy(label, value) {
    await writeClipboard(value)
    setCopied(label)
    window.setTimeout(() => setCopied(''), 1200)
  }

  return (
    <section className="grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Quick start</p>
        <h2 className="mt-3 text-2xl font-semibold">현재 자산을 입력하고, ChatGPT에서 첫 점검을 저장하세요</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted-ink)]">ChatGPT는 조사하고 생각하고 설명하며, Portfolio는 기억하고 계산하고 검증합니다. 긴 설정이나 과거 거래 복원 없이 아래 네 단계로 시작할 수 있습니다.</p>
      </article>

      <ol className="grid gap-4 lg:grid-cols-2">
        {quickSteps.map((step) => (
          <li className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]" key={step.number}>
            <div className="flex items-start gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-white">{step.number}</span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{step.body}</p>
              </div>
            </div>
            {step.copy && <code className="mt-4 block break-all rounded-2xl bg-[var(--surface-2)] p-3 text-xs leading-5">{step.copy.value}</code>}
            {step.copy && <button className="mt-3 min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => copy(step.copy.label, step.copy.value)} type="button">{copied === step.copy.label ? '복사했어요' : step.copy.label}</button>}
            {step.action && <button className="mt-4 min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => onNavigate?.(step.action.target)} type="button">{step.action.label}</button>}
          </li>
        ))}
      </ol>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">무엇이 기록되고 무엇은 기록되지 않나요?</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {boundaries.map(([title, body]) => <div className="rounded-2xl bg-[var(--surface-2)] p-4" key={title}><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{body}</p></div>)}
        </div>
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">연결이 안 될 때</h2>
        <div className="mt-4 divide-y divide-[var(--line)]">
          {troubleshooting.map(([title, body]) => <details className="py-3" key={title}><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{title}</summary><p className="pb-2 text-sm leading-6 text-[var(--muted-ink)]">{body}</p></details>)}
        </div>
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
        <h2 className="text-base font-semibold text-[var(--ink)]">지원 범위와 고급 연결</h2>
        <p className="mt-2">OpenAI 공식 문서 기준으로 개발자 모드 제공 여부는 계정과 워크스페이스 정책에 따라 달라질 수 있습니다. 이 프로젝트에서는 2026-09-20에 소유자 계정의 ChatGPT 웹에서 OAuth 연결·저장을 확인했고 같은 계정의 모바일에서 연결 상태가 이어지는 것도 관찰했지만, 모든 계정·요금제·모바일 환경을 보장하지는 않습니다.</p>
        <p className="mt-3">Codex CLI나 다른 MCP 클라이언트의 수동 토큰 방식은 설정의 “에이전트에 MCP로 연결”에서 계속 제공합니다. 처음 사용하는 지인에게는 위 OAuth 흐름을 기본으로 안내하세요.</p>
        <a className="mt-3 inline-flex min-h-11 items-center text-[var(--accent)] underline" href="https://developers.openai.com/plugins/deploy/connect-chatgpt" rel="noreferrer" target="_blank">OpenAI 공식 연결 문서</a>
      </article>
    </section>
  )
}
