// Mobile-first presentation of the same fictional v2 data. No network or persistence.
const v2Assets = assets, v2Holdings = holdingTable, v2Modal = modal;
const expandedGroups = new Set(), pageScroll = new Map();
const quantity = p => p.id === 'b1' && filled ? 10 : p.quantity;
const delta = c => total() ? `${diff(c) > 0 ? '+' : ''}${diff(c).toFixed(1)}%p` : '산정 불가';
const percent = v => total() ? `${pct(v)}%` : '—';
const group = (key, title, subtitle, content) => `<details class="card group-card" data-group="${esc(key)}" ${expandedGroups.has(key) ? 'open' : ''}><summary><span><strong>${title}</strong><span class="asset-sub">${subtitle}</span></span><span class="expand-icon" aria-hidden="true">＋</span></summary><div class="group-body">${content}</div></details>`;

holdingTable = function(rows) {
  return `<div class="holdings-desktop">${v2Holdings(rows)}</div><div class="holdings-mobile">${rows.map(p => `<div class="holding-row"><div><button class="linkbtn" data-position="${p.id}">${esc(p.name)} →</button><span class="asset-sub">${esc(p.account)}${p.category === 'cash' ? '' : ` · ${quantity(p)}주`}</span></div><div class="holding-value"><strong>${won(value(p))}</strong><span class="asset-sub">${p.category === 'cash' ? '기록된 잔액' : `평균 ${won(p.average)}`}</span></div></div>`).join('')}</div>`;
};

function allocationSummary() {
  return `<div class="allocation-v2" aria-hidden="true">${categories.map(c => `<span style="width:${total() ? pct(categoryValue(c.id)) : 0}%;background:${c.color}"></span>`).join('')}</div><div class="allocation-legend">${categories.map(c => `<span><i style="background:${c.color}"></i>${c.name} ${percent(categoryValue(c.id))}</span>`).join('')}</div>`;
}

assets = function() {
  if (assetView === 'sheet') return `<div class="editing-view">${v2Assets()}</div>`;
  const rows = filtered();
  const filters = `<details class="filters card" ${categoryFilter !== 'all' || assetAccount !== 'all' ? 'open' : ''}><summary>보유 목록 필터 · ${categoryFilter === 'all' ? '전체 카테고리' : categories.find(c => c.id === categoryFilter).name} / ${assetAccount === 'all' ? '전체 계좌' : esc(assetAccount)}</summary><div class="toolbar asset-toolbar"><label>카테고리<select id="category-filter"><option value="all">전체</option>${categories.map(c => `<option value="${c.id}" ${categoryFilter === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label><label>계좌<select id="account-filter"><option value="all">전체 계좌</option>${['종합계좌','ISA','연금저축'].map(a => `<option ${assetAccount === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div></details>`;
  let body;
  if (assetView === 'categories') {
    body = categories.filter(c => (categoryFilter === 'all' || c.id === categoryFilter) && rows.some(p => p.category === c.id)).map(c => {
      const list = rows.filter(p => p.category === c.id);
      return group(`category-${c.id}`, `<i class="dot" style="background:${c.color}"></i>${c.name}<span class="category-percent">${percent(categoryValue(c.id))}</span>`, `목표 ${c.target}% · 차이 ${delta(c)}${total() && Math.abs(diff(c)) > 5 ? ' · 허용폭 밖' : ''}`, `<p class="muted tiny">선택한 보유 목록 · ${won(list.reduce((s,p) => s + value(p), 0))}</p>${holdingTable(list)}<button class="linkbtn" data-category-detail="${c.id}">전체 계좌 구성과 관련 판단 →</button>`);
    }).join('');
  } else {
    const key = assetView === 'accounts' ? 'account' : 'name';
    body = [...new Set(rows.map(p => p[key]))].map(name => {
      const list = rows.filter(p => p[key] === name);
      return group(`${assetView}-${name}`, esc(name), `${won(list.reduce((s,p) => s + value(p), 0))} · ${assetView === 'accounts' ? `${list.length}개 보유 항목` : `${new Set(list.map(p => p.account)).size}개 계좌`}`, holdingTable(list));
    }).join('');
  }
  return heading('MY ALLOCATION', '내 자산 배분', '여러 계좌를 하나의 기준으로 봅니다.', '<button class="primary" data-modal="trade">완료한 매매 기록</button>') +
    `<article class="card allocation-overview"><div class="section-label"><div><span class="muted tiny">기록 기반 추정 평가액</span><div class="number">${won(total())}</div></div><span class="pill gray">3계좌 · 4종 자산</span></div>${allocationSummary()}<p class="tiny muted">가상 시세 · 9월 18일 종가 / 전체 계좌 기준</p><div class="overview-links"><button class="linkbtn" data-page="principles">목표·원칙 →</button><button class="linkbtn" data-modal="category-management">카테고리·태그 관리 →</button></div></article>` +
    `<div class="tabs asset-tabs" aria-label="자산 보기 전환">${[['categories','카테고리'],['accounts','계좌별'],['instruments','종목별'],['sheet','표 편집']].map(([id,label]) => `<button data-asset-view="${id}" class="${assetView === id ? 'active' : ''}" aria-pressed="${assetView === id}">${label}</button>`).join('')}</div>${filters}<p class="tiny muted">비중은 전체 계좌 기준입니다. 필터는 보유 목록에만 적용됩니다.</p><div class="asset-groups">${rows.length ? body : '<div class="card blank">선택한 범위에 보유 항목이 없습니다.</div>'}</div><p class="caption">카드를 펼쳐 종목과 계좌별 보유를 확인하세요. 목표 이탈 허용폭은 ±5%p입니다.</p>`;
};

today = function() {
  const states = {
    review: ['확인할 변화 1개', '보유 이유를 다시 확인할 변화가 있어요.', 'A기업의 전망 하향이 ‘실적 개선 기대’에 영향을 주는지 확인이 필요합니다.'],
    quiet: ['확인한 범위 내 변화 없음', '새로 판단할 변화는 없어요.', '확인한 자료에서는 기존 판단을 바꿀 새 근거를 찾지 못했습니다. 매매를 추가로 제안하지 않습니다.'],
    partial: ['일부 자료 미확인', '아직 결론 내리지 않은 부분이 있어요.', 'A기업의 최신 발표를 확인하지 못했습니다. 이전 의견을 오늘의 의견으로 갱신하지 않았습니다.']
  };
  const header = heading('DAILY REVIEW', '오늘의 점검', '저장된 분석을 읽고, 다음 판단으로 이어가세요.', '<button class="primary" data-modal="start">새 점검 시작 안내</button>');
  const stateControl = `<details class="demo-states"><summary>시안 상태 바꿔보기</summary><label for="scenario">분석 상태 </label><select id="scenario">${[['review','확인할 변화'],['quiet','변화 없음'],['partial','자료 부족'],['empty','분석 없음']].map(([v,t]) => `<option value="${v}" ${todayState === v ? 'selected' : ''}>${t}</option>`).join('')}</select></details>`;
  if (todayState === 'empty') return header + `<article class="card blank"><h2>아직 저장된 분석이 없어요.</h2><p class="muted">현재 보유와 짧은 원칙으로 시작할 수 있어요.<br>모든 과거 거래를 입력할 필요는 없습니다.</p><button data-modal="entry">현재 잔고 등록 안내</button><p class="caption">위 ‘새 점검 시작 안내’에서 요청 문구를 확인하세요.</p></article>` + stateControl;
  const s = states[todayState];
  return header + `<div class="layout"><section><article class="card hero review-hero"><p class="tiny muted">최근 저장 · 9월 21일 08:10 · ChatGPT 작성</p>${pill(s[0], todayState === 'partial' ? 'amber' : '')}<h2>${s[1]}</h2><p>${s[2]}</p><button class="linkbtn" data-modal="brief">근거와 전체 브리핑 →</button></article><article class="card"><div class="section-label"><h2>이어서 확인할 질문</h2>${pill(taskPaused ? '보류' : '자료 대기','gray')}</div><h3>A기업의 수요 둔화는 일시적일까?</h3><p class="muted">9월 18일에 남긴 질문입니다. 다음 실적 발표에서 신규 주문 회복을 확인합니다.</p><button class="linkbtn" data-modal="research">질문의 진행과 근거 →</button></article><article class="card"><h2>실행 중인 계획</h2><p>채권 ETF 매수 · ${filled ? '10 / 10주 체결' : '6 / 10주 체결'}</p><button class="linkbtn" data-modal="execution">실제 체결과 진행 확인 →</button></article></section><aside><article class="card"><h2>내 자산 배분</h2>${allocationSummary()}<p>${total() ? `현금이 목표보다 ${Math.abs(diff(categories[3])).toFixed(1)}%p ${diff(categories[3]) <= 0 ? '낮아요' : '높아요'}.` : '기록된 평가액이 없어 비중을 계산할 수 없어요.'}</p><p class="tiny muted">기록과 9월 18일 가상 종가 기준</p><button class="linkbtn" data-page="assets">전체 배분·계좌 확인 →</button></article><details class="card context-details"><summary>적용 원칙과 기록의 시점</summary><div class="group-body"><p>${esc(principle)}</p><p class="tiny muted">종합계좌 실제 잔고 확인 · 9월 18일<br>ISA·연금저축 잔고 · 아직 미확인<br>마지막 매매 기록 · ${filled ? '9월 21일' : '9월 19일'}</p><button class="linkbtn" data-page="principles">투자 원칙 →</button></div></details></aside></div><p class="footnote">이 화면은 저장된 결과입니다. 새 분석은 ChatGPT에서 요청할 때 작성됩니다.</p>` + stateControl;
};

modal = function(id) {
  if (id !== 'trade') return v2Modal(id);
  const p = positions.find(p => p.id === 'b1');
  const nextQuantity = p.quantity + 4;
  const nextAverage = (p.quantity * p.average + 40000) / nextQuantity;
  return `<h2 id="sheet-title">완료한 매매 기록 · 흐름 예시</h2><p>증권사에서 이미 체결한 거래를 기록합니다.</p><div class="quote">ISA에서 채권 ETF 4주를 10,000원에 샀어.</div><h3>변경 미리보기</h3><p>수량 ${p.quantity} → ${nextQuantity}주<br>평균가 ${won(p.average)} → ${won(nextAverage)}</p><p class="muted">이 시안에서는 기본 보유값(6주·평균가 10,000원)일 때만 대표 체결 흐름을 시험합니다.</p><button class="primary" data-action="fill" ${filled || p.quantity !== 6 || p.average !== 10000 ? 'disabled' : ''}>${filled ? '시안에 반영됨' : '가상 체결 반영'}</button><p class="caption">실제 계정·원장에는 저장되지 않습니다.</p>`;
};

// Preserve the page context and allow returning from nested detail panels.
let detailHistory = [];
const originalOpen = openModal, originalClose = closeModal;
const back = document.createElement('button');
back.id = 'detail-back'; back.textContent = '← 이전 상세'; back.hidden = true;
document.querySelector('.sheet-top').prepend(back);
openModal = function(id) {
  const panel = document.querySelector('.sheet-panel');
  if (document.querySelector('#sheet').hidden) detailHistory = [];
  if (detailHistory.length) detailHistory.at(-1).scroll = panel.scrollTop;
  if (detailHistory.at(-1)?.id !== id) detailHistory.push({id, scroll: 0});
  originalOpen(id); back.hidden = detailHistory.length < 2;
  document.querySelector('main').inert = true;
  document.querySelector('.sidebar').inert = true;
  document.querySelector('.mobile-nav').inert = true;
};
closeModal = function() {
  document.querySelector('main').inert = false;
  document.querySelector('.sidebar').inert = false;
  document.querySelector('.mobile-nav').inert = false;
  originalClose(); detailHistory = []; back.hidden = true;
};
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'detail-back') {
    e.stopImmediatePropagation(); detailHistory.pop();
    const previous = detailHistory.at(-1);
    originalOpen(previous.id); document.querySelector('.sheet-panel').scrollTop = previous.scroll;
    back.hidden = detailHistory.length < 2; document.querySelector(back.hidden ? '#close' : '#detail-back').focus();
  }
  if (b.dataset.page) {
    e.stopImmediatePropagation();
    const target = b.dataset.page;
    const nextScroll = target === current ? window.scrollY : (pageScroll.get(target) || 0);
    pageScroll.set(current, window.scrollY); closeModal(); current = target; render();
    window.scrollTo(0, nextScroll);
    document.querySelector(`${window.innerWidth <= 850 ? '.mobile-nav' : '.nav'} [aria-current="page"]`)?.focus({preventScroll:true});
  }
}, true);
document.addEventListener('toggle', e => {
  const key = e.target.dataset?.group;
  if (key) e.target.open ? expandedGroups.add(key) : expandedGroups.delete(key);
}, true);
document.addEventListener('keydown', e => {
  if (document.querySelector('#sheet').hidden || e.key !== 'Tab') return;
  e.stopImmediatePropagation();
  const nodes = [...document.querySelectorAll('#sheet button:not([disabled]),#sheet input,#sheet textarea,#sheet select,#sheet summary')].filter(el => el.getClientRects().length);
  if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1).focus(); }
  else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0].focus(); }
}, true);

const responsiveStyle = document.createElement('style');
responsiveStyle.textContent = `
:root{--muted:#57665d;--line:#d6ddd3}button,select,input,summary{min-height:44px}button,select{min-width:44px}button:disabled{opacity:.6;cursor:not-allowed}button[hidden]{display:none}.eyebrow,.pill,.demo{font-size:12px}.eyebrow{letter-spacing:1px}summary{cursor:pointer;align-content:center}summary:focus-visible{outline:3px solid #8a601d;outline-offset:4px}.demo-states{margin:12px 0 30px;color:var(--muted);font-size:12px}.demo-states select{padding:8px;border:1px solid var(--line);border-radius:8px;background:white}.hero.review-hero{min-height:0}.hero.review-hero h2{font-size:28px;margin:12px 0}.review-hero>.tiny{margin-bottom:10px}.review-hero .linkbtn{margin-top:8px}.group-card{padding:0;overflow:hidden}.group-card>summary{list-style:none;display:flex;justify-content:space-between;gap:16px;padding:20px 24px}.group-card>summary::-webkit-details-marker{display:none}.group-card>summary>span:first-child{flex:1;min-width:0}.group-card strong{display:block;font-size:17px}.category-percent{float:right;margin-left:12px;font-variant-numeric:tabular-nums}.group-card .asset-sub{margin-top:8px}.expand-icon{font-size:22px;color:var(--green)}.group-card[open] .expand-icon{transform:rotate(45deg)}.group-body{padding:16px 24px;border-top:1px solid var(--line)}.context-details .group-body{padding:16px 0 0}.filters{padding:8px 20px;margin-bottom:12px}.asset-groups{display:grid;grid-template-columns:1fr;gap:0 20px}.overview-links{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.allocation-overview .allocation-v2{margin-top:8px}.holdings-mobile{display:none}.holding-row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.holding-row>div{min-width:0}.holding-value{text-align:right;flex-shrink:0;padding-top:8px}.holding-row strong{font-size:14px}.holding-row .linkbtn{padding:4px 0}.holdings-desktop table{min-width:0;font-size:13px}.holdings-desktop td,.holdings-desktop th{padding:12px 6px}.sheet-panel .holdings-desktop{display:none}.sheet-panel .holdings-mobile{display:block}.sheet-top>.eyebrow{display:none}.sheet-top{justify-content:flex-end;gap:12px}.sheet-top #detail-back{margin-right:auto}.editing-view .table-wrap{max-width:100%}.editing-view #sheet-form:before{content:'표 편집 · 좁은 화면에서는 표 안을 좌우로 움직여 입력하세요.';display:block;color:var(--muted);font-size:12px;margin:12px 0}.editing-view .pagehead>.primary{display:none}.asset-toolbar label{flex-wrap:wrap}.row>div{min-width:0}.row>button{flex-shrink:0}main,.layout>section,.layout>aside{min-width:0}.asset-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.asset-tabs button{padding:10px 6px}.number{font-variant-numeric:tabular-nums}.sheet-panel{overscroll-behavior:contain}
@media(min-width:1300px){.asset-groups{grid-template-columns:repeat(2,minmax(0,1fr))}.asset-groups .holdings-desktop{display:none}.asset-groups .holdings-mobile{display:block}}
@media(min-width:851px) and (max-width:1200px){.layout{grid-template-columns:1fr}.layout>aside{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}}
@media(max-width:850px){body{font-size:16px}main{padding:0 16px calc(110px + env(safe-area-inset-bottom))}.topbar{min-height:64px}.topbar .demo{font-size:12px;max-width:135px}.topbar .actions{gap:6px}.topbar .mobile-more{padding:8px}.pagehead{margin:22px 0 18px}.pagehead h1{font-size:27px}.pagehead p{font-size:14px}.pagehead>.primary{width:100%}.card{padding:18px;margin-bottom:14px}h2{font-size:19px}.hero.review-hero h2{font-size:23px}.hero.review-hero p:not(.tiny){font-size:15px}.linkbtn{font-size:14px}.pill{white-space:normal}.layout{gap:0}.holdings-desktop{display:none}.holdings-mobile{display:block}.group-card{padding:0}.group-card>summary{padding:18px 16px}.group-body{padding:12px 16px}.group-card strong{font-size:16px}.group-card .asset-sub{font-size:12px}.holding-row strong{font-size:14px}.holding-row .linkbtn{font-size:14px}.filters{padding:6px 14px;font-size:13px}.asset-tabs button{font-size:14px}.allocation-legend{font-size:12px;display:grid;grid-template-columns:1fr 1fr}.overview-links .linkbtn{font-size:13px}.sheet-panel{padding:18px}.sheet-top{top:-18px}.sheet h2{font-size:23px}.sheet .table-wrap{margin:0}.table-wrap{margin-right:0}.sheet .number{font-size:26px}.summary-grid{grid-template-columns:1fr}.summary-grid .card{padding:14px}.editing-view>.card:has(.allocation-v2){display:none}.editing-view .table-wrap table{min-width:580px}.editing-view .table-wrap{border:1px solid var(--line);padding:0 8px}.editing-view .toolbar{font-size:14px}.row{gap:12px}.row>span{min-width:0}.section-label{align-items:start}.tiny,.caption,.asset-sub{font-size:12px}.demo-states{font-size:12px}.mobile-nav button{font-size:12px;min-height:52px}.mobile-nav{padding-bottom:max(8px,env(safe-area-inset-bottom))}.footnote{font-size:12px}.holdings-mobile .asset-sub{overflow-wrap:anywhere}}
`;
document.head.append(responsiveStyle);
document.querySelector('.demo').textContent = 'v3 · 가상 데이터';
current = 'today'; render();
