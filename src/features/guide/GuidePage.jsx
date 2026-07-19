const steps = [
  ['1', '자산 구조 만들기', '자산 탭에서 계좌, 태그, 종목을 만든 다음 보유 수량을 입력하세요. 태그는 자산 비중과 전략 목표를 묶는 기준입니다. 태그 기준은 자산 배분을, 계좌 기준은 증권사·연금·현금 계좌별 현황을, 종목 기준은 같은 종목을 보유한 계좌를 확인할 때 유용합니다.'],
  ['2', '보유자산 관리', '시장형 자산은 티커·수량·평균 매입가를, 평가형 자산은 매입금액·평가금액을, 현금은 평가금액을 관리합니다. 스프레드시트 보기에서는 여러 항목을 복사·붙여넣기하거나 한 번에 수정할 수 있고, 저장 내용은 하나의 활동 기록으로 남습니다.'],
  ['3', '전략 세우기', '전략 탭에서 태그별 목표 비중, 월 적립금, 허용 이탈 폭을 설정하세요. 버킷에 태그를 연결하고 목표 비중의 합계를 100%로 맞추면, 현재 비중과 비교해 적립금 배분과 리밸런싱 후보를 확인할 수 있습니다.'],
]

const features = [
  ['공유와 친구', '설정에서 공개 이름과 보기 비밀번호를 설정하면 비로그인 공유 보기를 제공할 수 있습니다. 친구는 비밀번호를 한 번 확인한 뒤 지속적으로 읽기 전용 접근을 받으며, 공유를 끄거나 친구를 삭제하면 접근 권한은 즉시 사라집니다.'],
  ['활동 기록', '계좌, 종목, 보유자산을 만들거나 수정·삭제한 이력을 활동 탭에서 확인할 수 있습니다. 변경 전후 데이터와 작업 시점을 함께 보므로 포트폴리오가 어떻게 달라졌는지 추적하기 좋습니다.'],
  ['가격 동기화', '설정의 가격 동기화는 시장형 종목의 최신 가격을 갱신합니다. 보유자산을 추가할 때는 종목 조회로 티커와 기본 정보를 확인할 수 있으며, 평가형·현금 자산은 직접 입력한 평가금액을 사용합니다.'],
  ['에이전트 연결', '설정에서 발급한 연결 토큰으로 Codex 등 MCP 클라이언트가 포트폴리오를 읽고 관리할 수 있습니다. 토큰은 자동화 도구에만 전달하고, 더 이상 필요하지 않으면 설정에서 즉시 폐기하세요.'],
]

export default function GuidePage() {
  return (
    <section className="mt-8 grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Quick start</p>
        <h2 className="mt-3 text-2xl font-semibold">포트폴리오를 한눈에, 계획대로 관리하세요</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted-ink)]">이 앱은 여러 계좌의 보유자산을 모으고, 태그 기준으로 비중을 파악하며, 목표 전략과 실제 자산의 차이를 관리하도록 돕습니다.</p>
      </article>

      <section className="grid gap-4 lg:grid-cols-3">
        {steps.map(([number, title, body]) => (
          <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]" key={number}>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-white">{number}</span>
            <h2 className="mt-4 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{body}</p>
          </article>
        ))}
      </section>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Strategy workflow</p>
          <h2 className="mt-2 text-lg font-semibold">시장 판단을 수동으로 전략에 반영하는 순서</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">뉴스와 시장 정보를 검토한 뒤, 판단을 기록하고 모드를 선택하세요. 앱은 선택한 목표 비중과 현재 비중의 차이를 보여 주며, 실제 비중 조절과 매매는 본인이 세운 원칙 안에서 직접 결정합니다.</p>
        </div>
        <ol className="mt-5 grid gap-3 md:grid-cols-5">
          {[
            ['1', '뉴스 분석', '시장·경제·정책 뉴스의 핵심 변화와 내 자산에 미칠 영향을 대화로 정리합니다.'],
            ['2', '신호 기록', '추세·변동성·금리·경기 등 판단 근거와 결론을 짧게 남깁니다.'],
            ['3', '모드 선택', '위험선호·중립·위험회피 등 현재 판단에 맞는 모드 프리셋을 선택합니다.'],
            ['4', '비중 확인', '선택한 모드의 목표 비중과 현재 비중을 비교해 적립금 또는 리밸런싱 대상을 확인합니다.'],
            ['5', '원칙 안에서 실행', '위험자산 한도, 현금 하한, 태그별 한도, 1회 조정 한도를 확인한 뒤 직접 실행합니다.'],
          ].map(([number, title, body]) => (
            <li className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4" key={number}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--accent)]">{number}</span>
                <h3 className="text-sm font-semibold">{title}</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-2xl border border-[var(--line)] px-4 py-3 text-sm leading-6 text-[var(--muted-ink)]"><span className="font-semibold text-[var(--ink)]">핵심:</span> 신호는 모드를 선택하는 근거이고, 모드는 실행 목표 비중을 정합니다. 원칙은 모든 비중 조절과 실제 매매에 적용되는 가드레일입니다.</p>
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">주요 기능</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {features.map(([title, body]) => (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4" key={title}>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{body}</p>
            </div>
          ))}
        </div>
      </article>

      <p className="text-center text-sm text-[var(--muted-ink)]">처음에는 계좌, 태그, 종목, 보유자산 순서로 입력하면 가장 빠르게 시작할 수 있습니다.</p>
    </section>
  )
}
