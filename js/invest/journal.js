/* ================= 매매원칙 · 매매일지 =================
   원칙은 손실 중인 종목을 보면서 만들면 안 된다. 그래서 규칙을 화면에 고정해 두고,
   매매일지는 "어느 규칙으로 샀고 팔았는지"를 반드시 적게 만든다.
   규칙에 없는 매매가 쌓이면, 수익률보다 그 사실이 먼저 보여야 한다. */

const TR_BUY_RULES = [
  ['BUY-1', '3줄 메모를 썼다', '① 왜 사는가 ② 언제 파는가(사건·지표) ③ 무엇이 보이면 내가 틀린 것인가'],
  ['BUY-2', '최소 매수 금액 충족', '전체 자산의 0.5% 이상. 그보다 작으면 사지 않는다'],
  ['BUY-3', '월간 점검일에 산다', '그 외에는 관심종목에 적어두고 한 달 기다린다'],
  ['BUY-X', '규칙 밖 매수', '원칙에 없는 매수 — 그래도 적는다. 안 적으면 고칠 수 없다']
];

const TR_SELL_RULES = [
  ['SELL-1', '비중 상한 초과', '개별 15% · 테마 5% 위반 → 초과분만. 익절이 아니라 리밸런싱이다'],
  ['SELL-2', '② 번이 실현됨', '계속 보유하려면 새 3줄 메모를 써야 하고, 못 쓰면 판다'],
  ['SELL-3', '그 돈이 실제로 필요함', '원래는 돈 A(활주로 자금)에 있어야 했던 돈'],
  ['SELL-4', '③ 번이 현실이 됨', '유일하고 진짜인 손절 사유. 손실률 무관 — −5%여도 팔고 −60%여도 판다'],
  ['SELL-5', '왜 샀는지 설명 못 함', '3줄 메모가 없거나 스스로 납득이 안 되는 종목. 논리 없는 보유는 방치다'],
  ['SELL-6', '더 나은 곳에 자본이 필요', '연 2~3회 제한. 갈아탈 종목의 3줄 메모를 먼저 쓴 뒤에만'],
  ['SELL-7', '연말 손익통산 (12월)', '해외주식 양도세 연 250만원 공제. 단 SELL-4/5 해당 종목만'],
  ['SELL-P', '가격 손절선 −25%', '논리를 세울 수 없는 테마·모멘텀 종목 전용. 대신 개별 비중 1% 이하'],
  ['SELL-X', '규칙 밖 매도', '7가지 중 어디에도 안 맞는 매도 — 그래도 적는다']
];

const TR_EMOTIONS = ['많이 떨어져서', '많이 올라서', '내부자가 팔아서', '뉴스가 무서워서',
  '남들이 파니까', '본전 오면 팔려고', '지루해서'];

const TR_RULE_LABEL = (() => {
  const m = {};
  [...TR_BUY_RULES, ...TR_SELL_RULES].forEach(([k, l]) => { m[k] = l; });
  return m;
})();

function renderRulesPage(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const sec = (n, title, body) => `
    <div class="panel s12 rl-sec">
      <div class="rl-hd"><span class="no">${n}</span><h3>${title}</h3></div>
      ${body}
    </div>`;
  const ruleList = (rules, cls) => `<div class="rl-rules ${cls}">${rules.map(([k, l, d]) => `
    <div class="rl-rule" data-rule="${k}">
      <span class="k">${k}</span>
      <span class="l">${l}</span>
      <span class="d">${d}</span>
      <button class="rl-log" data-logrule="${k}" title="이 규칙으로 매매일지 쓰기">일지 쓰기</button>
    </div>`).join('')}</div>`;

  host.innerHTML = `
    <div class="g"><div class="panel s12 rl-top">
      <div class="rl-toplead">
        <h2>매매원칙</h2>
        <p>투자는 목적이 아니라 <b>창작으로 먹고살 자유를 사는 수단</b>이다.
           자산 목표는 숫자가 아니라 “돈 때문에 하기 싫은 일을 하지 않아도 되는 기간”으로
           환산될 때만 의미가 있다. 계좌를 보는 시간이 창작 시간을 갉아먹으면,
           수익률과 무관하게 규칙이 잘못된 것이다.</p>
      </div>
      <div class="rl-money">
        <div class="rl-mcell a"><span class="t">돈 A — 활주로 자금</span>
          <p>전세 보증금 + 창작 기간 생활비. 목적은 수익률이 아니라 <b>잃지 않는 것</b>.
             예금·MMF·단기채로 분리한다. <b>주식 계좌에 두지 않는다.</b></p></div>
        <div class="rl-mcell b"><span class="t">돈 B — 증식 자금</span>
          <p>현재 주식 계좌. <b>10년 안 건드려도 되는 돈</b>일 때만 고위험 종목이 값을 한다.</p></div>
      </div>
    </div></div>

    <div class="g">
      ${sec('01', '매수', ruleList(TR_BUY_RULES.filter(r => r[0] !== 'BUY-X'), 'buy'))}
    </div>

    <div class="g">
      ${sec('02', '비중', `
        <div class="rl-size">
          <div><span class="n">15%</span><span class="l">개별 종목 상한</span></div>
          <div><span class="n">5%</span><span class="l">테마 상한 — 같이 움직이는 묶음은 하나의 베팅<br><i>양자 · 우주 · 원자력 · 레버리지</i></span></div>
          <div class="wide"><span class="n">초과분만</span><span class="l">상한을 넘으면 넘은 만큼만 판다. 전량 매도 금지.</span></div>
        </div>`)}
    </div>

    <div class="g">
      ${sec('03', '매도 — 이 7개에 해당하지 않으면 팔지 않는다', `
        <p class="rl-note">익절이 정당한 3가지 · 손절이 정당한 4가지. 그 밖은 매도가 아니라 충동이다.</p>
        ${ruleList(TR_SELL_RULES.filter(r => /^SELL-\d$/.test(r[0])), 'sell')}
        <div class="rl-exc">
          <span class="t">예외 — 논리를 세울 수 없는 종목</span>
          <p>테마·모멘텀으로 산 종목은 ③번을 쓸 수 없다. 그래서 <b>가격 손절선 −25%</b>를 기계적으로 건다.
             대신 개별 비중은 <b>1% 이하</b>로 묶는다. 일지에는 <code>SELL-P</code>로 적는다.</p>
          <button class="rl-log" data-logrule="SELL-P">일지 쓰기</button>
        </div>
        <div class="rl-emo">
          <span class="t">팔면 안 되는 이유 — 이 중 하나가 떠올랐다면 그날은 아무것도 하지 않는다</span>
          <div class="chips">${TR_EMOTIONS.map(e => `<span>${e}</span>`).join('')}</div>
        </div>`)}
    </div>

    <div class="g">
      ${sec('04', '점검 — 매월 첫째 주 토요일, 30분', `
        <ol class="rl-steps">
          <li>비중부터 본다 (15% / 5% 초과 여부)</li>
          <li>지난달 실적 발표가 있었던 종목만 연다 → ②③ 확인</li>
          <li>3줄 메모가 없는 종목 목록 확인 → 이번 달에 쓰거나 판다 (월 3개씩)</li>
          <li>매수 후보 검토 (아직도 사고 싶은 것만)</li>
          <li>30분이 지나면 덮는다. 결론이 안 나면 다음 달로.</li>
        </ol>
        <p class="rl-note">그 외의 날에는 계좌를 열지 않는다.</p>`)}
    </div>

    <div class="g"><div class="panel s12 rl-foot">
      <p>규칙은 고쳐도 되지만 <b>손실 중인 종목을 보면서 고치지는 않는다.</b>
         개정은 월간 점검일에만, 이유를 함께 적는다.</p>
      <p class="dim">개인 투자 원칙 정리이며 투자 자문이 아닙니다. 최종 판단과 책임은 본인에게 있습니다.</p>
    </div></div>`;

  host.querySelectorAll('[data-logrule]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    TJ.seedRule = b.dataset.logrule;
    TJ.formOpen = true;
    state.invSub = 'journal';
    renderPage();
  }));
}

/* ---------------- 매매일지 ---------------- */
const TJ = { rows: null, loading: false, formOpen: false, seedRule: null, openId: null, filter: 'all' };

function tjSideOf(rule) { return String(rule || '').startsWith('SELL') ? 'sell' : 'buy'; }

async function tjLoad(force) {
  if (TJ.rows && !force) return TJ.rows;
  const sb = await enClient();
  const { data, error } = await sb.from('trade_log').select('*')
    .order('traded_on', { ascending: false }).order('id', { ascending: false }).limit(500);
  TJ.rows = error ? [] : (data || []);
  return TJ.rows;
}

async function renderJournalPage(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = '<div class="g"><div class="panel s12"><div class="en-empty">매매일지를 불러오는 중…</div></div></div>';
  const rows = await tjLoad();
  if (!document.getElementById(hostId)) return;

  const F = ['all', 'buy', 'sell', 'nomemo'].includes(TJ.filter) ? TJ.filter : 'all';
  const shown = rows.filter(r =>
    F === 'all' ? true : F === 'nomemo' ? !(r.why || '').trim() : r.side === F);

  /* --- 규율 지표: 수익률보다 이게 먼저다 --- */
  const buys = rows.filter(r => r.side === 'buy');
  const sells = rows.filter(r => r.side === 'sell');
  const memoOk = buys.filter(r => (r.why || '').trim() && (r.exit_when || '').trim() && (r.falsify || '').trim()).length;
  const offRule = rows.filter(r => !r.rule || r.rule.endsWith('-X')).length;
  const emoCnt = rows.filter(r => (r.emotion || '').trim()).length;
  const realized = sells.reduce((a, r) => a + (Number(r.realized) || 0), 0);
  const pct = (n, tot) => (tot > 0 ? Math.round((n / tot) * 100) : null);

  host.innerHTML = `
    <div class="g">
      <div class="stat-grid s12" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:0;">
        <div class="stat-card">
          <div class="label">기록한 매매</div>
          <div class="value">${rows.length}건</div>
          <div class="sub">매수 ${buys.length} · 매도 ${sells.length}</div>
        </div>
        <div class="stat-card">
          <div class="label">3줄 메모를 쓴 매수</div>
          <div class="value" style="color:${memoOk === buys.length ? 'var(--income-text)' : 'var(--expense-text)'}">${buys.length ? `${pct(memoOk, buys.length)}%` : '—'}</div>
          <div class="sub">${buys.length ? `${buys.length}건 중 ${memoOk}건` : 'BUY-1'}</div>
        </div>
        <div class="stat-card">
          <div class="label">규칙 밖 매매</div>
          <div class="value" style="color:${offRule ? 'var(--expense-text)' : 'var(--income-text)'}">${offRule}건</div>
          <div class="sub">${rows.length ? `전체의 ${pct(offRule, rows.length)}%` : '원칙에 없는 매매'}</div>
        </div>
        <div class="stat-card">
          <div class="label">감정이 끼어든 날</div>
          <div class="value" style="color:${emoCnt ? 'var(--expense-text)' : 'var(--text)'}">${emoCnt}건</div>
          <div class="sub">적어둔 감정 신호</div>
        </div>
        <div class="stat-card">
          <div class="label">기록된 실현손익</div>
          <div class="value" style="color:${realized >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${realized >= 0 ? '+' : ''}${formatCompactWon(realized)}원</div>
          <div class="sub">매도 ${sells.length}건 합계</div>
        </div>
      </div>
    </div>

    <div class="g"><div class="panel s12">
      <div class="panel-title">
        <div>매매일지<span class="p-note">산 이유와 판 이유를 그 자리에서 남긴다</span></div>
        <div style="display:flex;gap:6px;align-items:center;">
          <div class="range-toggle" id="tj-filter">
            ${[['all', '전체'], ['buy', '매수'], ['sell', '매도'], ['nomemo', '메모 없음']].map(([v, l]) =>
              `<button data-f="${v}" class="${F === v ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <button class="bk-add" id="tj-new">${TJ.formOpen ? '접기' : '+ 새 기록'}</button>
        </div>
      </div>
      <div id="tj-form">${TJ.formOpen ? tjFormHTML() : ''}</div>
      <div id="tj-list">${tjListHTML(shown)}</div>
    </div></div>`;

  document.getElementById('tj-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    TJ.filter = b.dataset.f;
    renderJournalPage(hostId);
  });
  document.getElementById('tj-new').addEventListener('click', () => {
    TJ.formOpen = !TJ.formOpen;
    if (!TJ.formOpen) TJ.seedRule = null;
    renderJournalPage(hostId);
  });
  if (TJ.formOpen) tjBindForm(hostId);
  tjBindList(hostId, shown);
}

function tjFormHTML() {
  const seed = TJ.seedRule;
  const side = seed ? tjSideOf(seed) : 'buy';
  const opts = (list) => list.map(([k, l]) =>
    `<option value="${k}" ${k === seed ? 'selected' : ''}>${k} — ${l}</option>`).join('');
  return `
    <div class="tj-form" data-side="${side}">
      <div class="tj-frow">
        <label><span>날짜</span><input class="en-in" type="date" data-t="traded_on" value="${enToday()}"></label>
        <label><span>구분</span>
          <select class="en-in" data-t="side">
            <option value="buy" ${side === 'buy' ? 'selected' : ''}>매수</option>
            <option value="sell" ${side === 'sell' ? 'selected' : ''}>매도</option>
          </select></label>
        <label class="grow"><span>종목</span><input class="en-in" data-t="name" placeholder="예: 로켓 랩" autocomplete="off"></label>
        <label><span>티커</span><input class="en-in" data-t="ticker" placeholder="RKLB" autocomplete="off"></label>
      </div>
      <div class="tj-frow">
        <label><span>수량</span><input class="en-in mono" data-t="quantity" inputmode="decimal" placeholder="0"></label>
        <label><span>단가</span><input class="en-in mono" data-t="price" inputmode="decimal" placeholder="0"></label>
        <label><span>통화</span>
          <select class="en-in" data-t="currency"><option>KRW</option><option>USD</option></select></label>
        <label class="grow"><span>체결금액 (원)</span><input class="en-in mono" data-t="amount" inputmode="numeric" placeholder="비우면 수량×단가"></label>
        <label class="tj-sellonly"><span>실현손익 (원)</span><input class="en-in mono" data-t="realized" inputmode="numeric" placeholder="0"></label>
      </div>
      <div class="tj-frow">
        <label class="grow"><span>규칙 — 어느 원칙으로 하는가</span>
          <select class="en-in" data-t="rule">
            <optgroup label="매수" data-g="buy">${opts(TR_BUY_RULES)}</optgroup>
            <optgroup label="매도" data-g="sell">${opts(TR_SELL_RULES)}</optgroup>
          </select></label>
        <label class="grow"><span>감정 신호 — 있으면 오늘은 아무것도 하지 않는다</span>
          <select class="en-in" data-t="emotion">
            <option value="">없음</option>
            ${TR_EMOTIONS.map(e => `<option value="${e}">${e}</option>`).join('')}
          </select></label>
      </div>
      <div class="tj-memo">
        <div class="tj-memohd">3줄 메모 <i>BUY-1 — 이걸 못 쓰면 사지 않는다</i></div>
        <label><span>① 왜 사는가 (한 문장)</span><textarea class="en-in" data-t="why" rows="2"></textarea></label>
        <label><span>② 언제 파는가 (사건·지표 — 가격 금지)</span><textarea class="en-in" data-t="exit_when" rows="2"></textarea></label>
        <label><span>③ 무엇이 보이면 내가 틀린 것인가</span><textarea class="en-in" data-t="falsify" rows="2"></textarea></label>
      </div>
      <p class="tj-warn" id="tj-warn" hidden></p>
      <div class="tj-ffoot">
        <span class="tj-hint" id="tj-hint"></span>
        <button class="lg-addsave" id="tj-save">기록하기</button>
      </div>
    </div>`;
}

function tjListHTML(rows) {
  if (!rows.length) return '<div class="empty-state">아직 기록이 없습니다. 첫 매매부터 적어두면 규율이 눈에 보입니다.</div>';
  return `<div class="tj-cols"><span class="dt">날짜</span><span class="sd">구분</span>
      <span class="nm">종목</span><span class="rl">규칙</span><span class="wy">왜</span>
      <span class="am">금액</span><span class="pl">실현</span><span class="x"></span></div>
    <div class="lg-card">${rows.map(r => {
    const sell = r.side === 'sell';
    const noMemo = !(r.why || '').trim();
    const off = !r.rule || r.rule.endsWith('-X');
    const open = TJ.openId === r.id;
    return `<div class="tj-row ${sell ? 'sell' : 'buy'} ${open ? 'open' : ''}" data-tj="${r.id}">
      <span class="dt">${String(r.traded_on || '').slice(2).replace(/-/g, '.')}</span>
      <span class="sd"><i class="tj-kd ${sell ? 'sell' : 'buy'}">${sell ? '매도' : '매수'}</i></span>
      <span class="nm">${enEsc(r.name || '')}${r.ticker ? `<em>${enEsc(r.ticker)}</em>` : ''}</span>
      <span class="rl">${r.rule ? `<i class="tj-rule ${off ? 'off' : ''}" title="${enEsc(TR_RULE_LABEL[r.rule] || '')}">${enEsc(r.rule)}</i>` : '<i class="tj-rule off">없음</i>'}</span>
      <span class="wy ${noMemo ? 'none' : ''}">${noMemo ? '3줄 메모 없음' : enEsc(r.why)}</span>
      <span class="am">${r.amount ? formatCompactWon(Number(r.amount)) : '—'}</span>
      <span class="pl">${r.realized === null || r.realized === undefined || r.realized === '' ? '—'
        : `<b class="${Number(r.realized) >= 0 ? 'up' : 'dn'}">${Number(r.realized) >= 0 ? '+' : ''}${formatCompactWon(Number(r.realized))}</b>`}</span>
      <button class="x" data-tjx="${r.id}" aria-label="삭제" tabindex="-1">×</button>
    </div>
    ${open ? `<div class="tj-detail" data-tjd="${r.id}">
      ${r.emotion ? `<div class="tj-emo">⚠️ 감정 신호를 적어둔 매매 — <b>${enEsc(r.emotion)}</b></div>` : ''}
      <div class="tj-3">
        <div><span>① 왜</span><p>${r.why ? enEsc(r.why) : '<i>비어 있음</i>'}</p></div>
        <div><span>② 언제 판다</span><p>${r.exit_when ? enEsc(r.exit_when) : '<i>비어 있음</i>'}</p></div>
        <div><span>③ 틀렸다는 신호</span><p>${r.falsify ? enEsc(r.falsify) : '<i>비어 있음</i>'}</p></div>
      </div>
      <div class="tj-rv">
        <span>복기 — 지나고 보니</span>
        <textarea class="en-in" data-tjrv="${r.id}" rows="2" placeholder="이 판단은 맞았나? 다음에 무엇을 다르게 할까?">${enEsc(r.review || '')}</textarea>
        <button class="btn small" data-tjrvsave="${r.id}">복기 저장</button>
      </div>
    </div>` : ''}`;
  }).join('')}</div>`;
}

function tjBindForm(hostId) {
  const form = document.querySelector('.tj-form');
  if (!form) return;
  const val = (k) => { const el = form.querySelector(`[data-t="${k}"]`); return el ? el.value.trim() : ''; };
  const sideSel = form.querySelector('[data-t="side"]');
  const ruleSel = form.querySelector('[data-t="rule"]');
  const warn = document.getElementById('tj-warn');
  const hint = document.getElementById('tj-hint');

  /* 구분을 바꾸면 그쪽 규칙만 고를 수 있게 한다 — 매수인데 SELL-4 를 고르는 일이 없게 */
  const syncSide = () => {
    const sd = sideSel.value;
    form.dataset.side = sd;
    ruleSel.querySelectorAll('optgroup').forEach(og => { og.disabled = og.dataset.g !== sd; });
    const cur = ruleSel.selectedOptions[0];
    if (!cur || cur.parentElement.dataset.g !== sd) {
      const first = ruleSel.querySelector(`optgroup[data-g="${sd}"] option`);
      if (first) ruleSel.value = first.value;
    }
    form.querySelectorAll('.tj-sellonly').forEach(el => { el.style.display = sd === 'sell' ? '' : 'none'; });
    const memo = form.querySelector('.tj-memo');
    memo.classList.toggle('opt', sd === 'sell');
    memo.querySelector('.tj-memohd i').textContent = sd === 'sell'
      ? 'SELL-2 로 계속 보유하려면 새 3줄 메모가 필요하다 — 매도에서는 선택'
      : 'BUY-1 — 이걸 못 쓰면 사지 않는다';
    check();
  };
  const check = () => {
    const sd = sideSel.value;
    const emo = val('emotion');
    const msgs = [];
    if (emo) msgs.push(`감정 신호(${emo})를 골랐습니다. 원칙대로라면 <b>오늘은 아무것도 하지 않습니다.</b> 그래도 적어둘 수는 있습니다.`);
    if (sd === 'buy' && !(val('why') && val('exit_when') && val('falsify')))
      msgs.push('BUY-1 — 3줄 메모 세 칸이 다 차야 매수입니다.');
    warn.hidden = !msgs.length;
    warn.innerHTML = msgs.join('<br>');
    hint.textContent = ruleSel.value ? `${ruleSel.value} — ${TR_RULE_LABEL[ruleSel.value] || ''}` : '';
  };
  sideSel.addEventListener('change', syncSide);
  ruleSel.addEventListener('change', check);
  form.querySelectorAll('[data-t]').forEach(el => el.addEventListener('input', check));
  syncSide();

  document.getElementById('tj-save').addEventListener('click', async () => {
    const name = val('name');
    if (!name) { warn.hidden = false; warn.innerHTML = '종목 이름은 있어야 합니다.'; return; }
    const num = (k) => { const t = val(k).replace(/[^\d.\-]/g, ''); return t === '' ? null : Number(t); };
    const qty = num('quantity'), price = num('price');
    let amount = num('amount');
    if (amount === null && qty !== null && price !== null && val('currency') === 'KRW') amount = Math.round(qty * price);
    const rec = {
      traded_on: val('traded_on') || enToday(),
      side: sideSel.value,
      name, ticker: val('ticker') || null,
      quantity: qty, price, currency: val('currency') || 'KRW', amount,
      rule: ruleSel.value || null,
      why: val('why') || null, exit_when: val('exit_when') || null, falsify: val('falsify') || null,
      emotion: val('emotion') || null,
      realized: sideSel.value === 'sell' ? num('realized') : null
    };
    const btn = document.getElementById('tj-save');
    btn.disabled = true; btn.textContent = '저장 중…';
    const { error } = await (await enClient()).from('trade_log').insert(rec);
    btn.disabled = false; btn.textContent = '기록하기';
    if (error) { warn.hidden = false; warn.innerHTML = '저장하지 못했습니다. 다시 시도하세요.'; return; }
    enToast(`${rec.side === 'sell' ? '매도' : '매수'} 기록을 남겼습니다`);
    TJ.rows = null; TJ.formOpen = false; TJ.seedRule = null;
    renderJournalPage(hostId);
  });
}

function tjBindList(hostId, shown) {
  const list = document.getElementById('tj-list');
  if (!list) return;
  list.querySelectorAll('.tj-row').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('[data-tjx]')) return;
    const id = Number(row.dataset.tj);
    TJ.openId = TJ.openId === id ? null : id;
    renderJournalPage(hostId);
  }));
  list.querySelectorAll('[data-tjx]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('이 매매 기록을 지울까요?')) return;
    await (await enClient()).from('trade_log').delete().eq('id', Number(b.dataset.tjx));
    enToast('지웠습니다');
    TJ.rows = null;
    renderJournalPage(hostId);
  }));
  list.querySelectorAll('[data-tjrvsave]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = Number(b.dataset.tjrvsave);
    const ta = list.querySelector(`[data-tjrv="${id}"]`);
    const { error } = await (await enClient()).from('trade_log')
      .update({ review: ta.value.trim() || null }).eq('id', id);
    if (error) { enToast('저장하지 못했습니다'); return; }
    enToast('복기를 저장했습니다');
    TJ.rows = null;
    renderJournalPage(hostId);
  }));
  list.querySelectorAll('.tj-detail').forEach(el => el.addEventListener('click', (e) => e.stopPropagation()));
}

const INV_VIEWS = {
  ovGrowth:     { label: '자산 성장률', note: '넣은 돈 대비 몇 % 불었나' },
  ovTransfer:   { label: '투자 이체',   note: '원금이 쌓여온 과정' },
  ovRealized:   { label: '실현 수익',   note: '확정된 수익 — 판매수익 + 배당' },
  ovUnrealized: { label: '평가손익',    note: '평가액과 원금의 간격 = 미실현 손익' }
};

const INV_SUBS = [
  ['ovGrowth', '자산 성장률'],
  ['ovTransfer', '투자 이체'],
  ['ovRealized', '실현 수익'],
  ['ovUnrealized', '평가손익'],
  ['book', '종목'],
  ['bench', '벤치마크'],
  ['tax', '세금'],
  ['rules', '매매원칙'],
  ['journal', '매매일지']
];

function renderInvestmentPage(container, data, d) {
  const SUB = INV_SUBS.some(s => s[0] === state.invSub) ? state.invSub : 'ovGrowth';
  const VIEW = INV_VIEWS[SUB] || null;
  if (VIEW && !state.invSeriesBySub[SUB]) state.invSeriesBySub[SUB] = { ...state.invSeries };
  const SER = VIEW ? state.invSeriesBySub[SUB] : state.invSeries;
  const subnav = '';
  const _unusedInvSubs = `${INV_SUBS.map(([v, l]) =>
    `<button data-sub="${v}" class="${v === SUB ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  const invCategories = ['투자 자산'];
  const byMonthCat = {};
  data.assetRows.forEach(r => {
    if (!invCategories.includes(r.category) || r.amount === null) return;
    byMonthCat[r.date] = byMonthCat[r.date] || {};
    byMonthCat[r.date]['투자 자산'] = (byMonthCat[r.date]['투자 자산'] || 0) + r.amount;
  });
  const months = d.assetMonths;
  const latestMonth = d.latestMonth;
  const latestInv = (byMonthCat[latestMonth] && byMonthCat[latestMonth]['투자 자산']) || 0;

  const latestTransferIdx = d.latestPivotIdx;
  const investTransfer = (data.transferCategories['투자 자산'] || [])[latestTransferIdx] || 0;

  const transferSeries = data.transferCategories['투자 자산'] || [];
  let cum = 0;
  const cumByPivotKey = {};
  data.months.forEach((m, i) => { cum += transferSeries[i] || 0; cumByPivotKey[pivotMonthKey(m)] = cum; });
  const cumSeries = months.map(am => {
    const k = assetMonthKey(am);
    let val = cumByPivotKey[k];
    if (val === undefined) {
      const keys = Object.keys(cumByPivotKey).map(Number).filter(pk => pk <= k).sort((a, b) => b - a);
      val = keys.length ? cumByPivotKey[keys[0]] : 0;
    }
    return { month: am, cumContribution: val, balance: (byMonthCat[am] && byMonthCat[am]['투자 자산']) || 0 };
  });
  const latestGain = cumSeries.length ? cumSeries[cumSeries.length - 1].balance - cumSeries[cumSeries.length - 1].cumContribution : 0;

  /* 납입 원금(순 이체 누적) 대비 현재 평가액 — 자산 스냅샷 최신월 기준으로 두 값을 맞춘다 */
  const latestCumContrib = cumSeries.length ? cumSeries[cumSeries.length - 1].cumContribution : cum;
  const latestBalance = cumSeries.length ? cumSeries[cumSeries.length - 1].balance : latestInv;
  const roiPct = latestCumContrib > 0 ? (latestGain / latestCumContrib) * 100 : null;
  const valueRatioPct = latestCumContrib > 0 ? (latestBalance / latestCumContrib) * 100 : null;
  /* 월별 수익률 추이 (평가액 / 누적 원금 − 1) */
  const roiSeries = cumSeries.map(s => ({
    month: s.month,
    roi: s.cumContribution > 0 ? ((s.balance - s.cumContribution) / s.cumContribution) * 100 : null
  }));
  const fmtPct = (v) => (v === null || v === undefined || isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);

  const accounts = {};
  data.assetRows.filter(r => r.date === latestMonth && invCategories.includes(r.category)).forEach(r => {
    accounts[r.account] = { amount: r.amount, category: r.category };
  });
  const accountList = Object.entries(accounts).sort((a, b) => b[1].amount - a[1].amount);
  const investLedger = data.ledger.filter(r => r.minor === '투자 자산' || r.minor === '투자 수익');

  const hasTags = data.investmentTags && data.investmentTags.length > 0;
  const stockProfit = hasTags
    ? (() => { const m = {}; data.investmentTags.forEach(r => { m[r.stock] = (m[r.stock] || 0) + r.total; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); })()
    : getStockProfit(data.ledger);
  const stockProfitFiltered = stockProfit.filter(([, v]) => v !== 0).slice(0, 30);
  const tagAgg = hasTags ? aggregateByTag(data.investmentTags) : [];


  const stockCategoryMap = data.stockCategoryMap || {};
  /* 한 종목이 '우주, 레버리지'처럼 여러 테마를 가지면 각 테마에 모두 집계한다(합계는 중복). */
  const stockTags = (name) => String(stockCategoryMap[name] || '').split(',').map(x => x.trim()).filter(Boolean);
  const stockCatAgg = (() => {
    const m = {};
    stockProfit.forEach(([name, amt]) => {
      const tags = stockTags(name);
      if (!tags.length) { m['미분류'] = (m['미분류'] || 0) + amt; return; }
      tags.forEach(t => { m[t] = (m[t] || 0) + amt; });
    });
    return Object.entries(m).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  })();

  const returnsDataFull0 = getInvestmentIncomeMonthly(data.ledger);
  let cumInvestmentIncome = 0;
  returnsDataFull0.months.forEach(m => {
    returnsDataFull0.items.forEach(it => {
      cumInvestmentIncome += (returnsDataFull0.byMonthItem[m] && returnsDataFull0.byMonthItem[m][it]) || 0;
    });
  });

  container.innerHTML = subnav + `
    ${VIEW ? `
    <div class="g">
      <div class="stat-grid s12" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:0;">
        <div class="stat-card">
          <div class="label">평가액</div>
          <div class="value">${formatCompactWon(latestInv)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">누적 원금</div>
          <div class="value">${formatCompactWon(latestCumContrib)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">평가손익</div>
          <div class="value" style="color:${latestGain >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${latestGain >= 0 ? '+' : ''}${formatCompactWon(latestGain)}원<span class="v-note">(원금 대비 ${roiPct === null ? '—' : fmtPct(roiPct)})</span></div>
        </div>
        <div class="stat-card">
          <div class="label">누적 실현수익</div>
          <div class="value" style="color:${cumInvestmentIncome >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${cumInvestmentIncome >= 0 ? '+' : ''}${formatCompactWon(cumInvestmentIncome)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">총자산 대비 비중</div>
          <div class="value">${d.totalAssets ? (latestInv / d.totalAssets * 100).toFixed(0) : '—'}%</div>
        </div>
      </div>
    </div>

    <div class="g">
      <div class="panel s12">
        <div class="panel-title">
          <div>${VIEW ? VIEW.label : '투자 추이'}${VIEW ? `<span style="margin-left:9px;font-size:var(--fs-tiny);color:var(--text-faint);font-weight:400;">${VIEW.note}</span>` : ''}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <div class="range-toggle" id="inv-period-toggle">
              <button data-period="month" class="${(state.invPeriod || 'month') === 'month' ? 'active' : ''}">월</button>
              <button data-period="year" class="${state.invPeriod === 'year' ? 'active' : ''}">연</button>
            </div>
            <div class="range-toggle" id="inv-range-toggle"></div>
          </div>
        </div>
        <div class="series-toggles" id="inv-series-toggles">
          ${INV_SERIES.map(sr => `<label class="series-chk ${SER[sr.key] ? 'on' : ''}">
            <input type="checkbox" data-key="${sr.key}" ${SER[sr.key] ? 'checked' : ''} />
            <i style="background:${sr.color}"></i>${sr.label}
          </label>`).join('')}
        </div>
        <div class="chart-wrap tall" style="min-height:300px;"><canvas id="chart-inv-main"></canvas></div>
      </div>
    </div>` : ''}

    ${SUB === 'bench' ? `
    <div class="g">
      <div class="panel s12" id="panel-bench"></div>
    </div>
    <div class="g">
      <div class="panel s7" id="panel-discipline"></div>
      <div class="panel s5" id="panel-idle-invest"></div>
    </div>` : ''}

    ${SUB === 'tax' ? `
    <div class="g">
      <div class="panel s12" id="panel-cgt"></div>
    </div>` : ''}

    ${SUB === 'book' ? `<div id="panel-book"></div>` : ''}

    ${SUB === 'rules' ? `<div id="panel-rules"></div>` : ''}
    ${SUB === 'journal' ? `<div id="panel-journal"></div>` : ''}

  `;

  if (SUB === 'bench') {
    renderBenchmarkPanel('panel-bench', data, d);
    renderDisciplinePanel('panel-discipline', data);
    renderIdlePanel('panel-idle-invest', data, d, ['투자 자산'], '방치된 증권 계좌');
  }
  if (SUB === 'tax') renderCapitalGainsPanel('panel-cgt', data.ledger);
  if (SUB === 'book') renderBookPage('panel-book', data, d);
  if (SUB === 'rules') renderRulesPage('panel-rules');
  if (SUB === 'journal') renderJournalPage('panel-journal');

  if (VIEW) {

  const returnsDataFull = getInvestmentIncomeMonthly(data.ledger);
  /* --- 통합 추이 차트 --- */
  const amToYM = (am) => {
    const pk = assetMonthToPivotKey(am);
    if (!pk) return null;
    const ym = pivotYearMonth(pk);
    return ym.year ? `${ym.year}-${String(ym.month).padStart(2, '0')}` : null;
  };
  const transferByYM = {};
  data.months.forEach((pm, i) => {
    const ym = pivotYearMonth(pm);
    if (!ym.year) return;
    transferByYM[`${ym.year}-${String(ym.month).padStart(2, '0')}`] = (data.transferCategories['투자 자산'] || [])[i] || 0;
  });
  const returnsByYM = {};
  Object.keys(returnsDataFull.byMonthItem).forEach(k => {
    returnsByYM[k] = Object.values(returnsDataFull.byMonthItem[k]).reduce((a, v) => a + v, 0);
  });
  /* 누적 실현수익은 흐름이 아니라 잔액성이다 — 연 단위로 볼 때도 그 해 합이 아니라
     그 시점까지의 누적을 집어야 한다. 그래서 flowAgg 가 아니라 별도 조회를 쓴다. */
  const cumReturnsByYM = {};
  (() => {
    let acc = 0;
    Object.keys(returnsByYM).sort().forEach(k => { acc += returnsByYM[k]; cumReturnsByYM[k] = acc; });
  })();
  const cumReturnsKeys = Object.keys(cumReturnsByYM).sort();
  const cumReturnsAt = (am) => {
    const ym = amToYM(am);
    if (!ym) return null;
    if (cumReturnsByYM[ym] !== undefined) return cumReturnsByYM[ym];
    let v = 0;
    for (let i = 0; i < cumReturnsKeys.length; i++) {
      if (cumReturnsKeys[i] <= ym) v = cumReturnsByYM[cumReturnsKeys[i]]; else break;
    }
    return v;
  };

  const drawInvMain = () => {
    const ctx = document.getElementById('chart-inv-main');
    if (!ctx) return;
    if (state.charts.invMain) state.charts.invMain.destroy();
    const period = state.invPeriod || 'month';
    const src = period === 'year' ? months : sliceByRange(months, state.invRange);

    let labels, pick;
    if (period === 'year') {
      const byYear = {};
      months.forEach(am => { byYear[assetMonthYear(am)] = am; });   /* 연말 스냅샷 */
      const years = Object.keys(byYear).sort();
      labels = years.map(y => y + '년');
      pick = years.map(y => byYear[y]);
      /* 연 단위 흐름 항목(이체·실현)은 그 해 합계 */
      var flowAgg = (mapByYM) => years.map(y => months.filter(am => assetMonthYear(am) === y)
        .reduce((a, am) => a + ((mapByYM[amToYM(am)] || 0)), 0));
    } else {
      labels = src.map(assetMonthLabel);
      pick = src;
      var flowAgg = (mapByYM) => src.map(am => mapByYM[amToYM(am)] || 0);
    }

    const cumMap = {}; cumSeries.forEach(x => { cumMap[x.month] = x; });
    const roiMap = {}; roiSeries.forEach(x => { roiMap[x.month] = x.roi; });

    const S = SER;
    const ds = [];
    if (S.transfer) ds.push({ type: 'bar', label: '투자 이체', data: flowAgg(transferByYM), backgroundColor: 'rgba(57,168,189,0.7)', borderRadius: 3, yAxisID: 'yFlow', labelColor: '#a8e6f0', order: 4 });
    if (S.returns) ds.push({ type: 'bar', label: '실현 수익', data: flowAgg(returnsByYM), backgroundColor: 'rgba(224,138,95,0.85)', borderRadius: 3, yAxisID: 'yFlow', labelColor: '#f0b795', order: 3 });
    if (S.returnsCum) ds.push({ type: 'line', label: '누적 실현수익', data: pick.map(cumReturnsAt), borderColor: '#c56a3a', backgroundColor: 'rgba(197,106,58,0.12)', fill: true, tension: 0.3, pointRadius: 2, spanGaps: true, yAxisID: 'y', labelColor: '#f0b795', labelOffset: -18, order: 2 });
    if (S.balance) ds.push({ type: 'line', label: '평가액', data: pick.map(am => (cumMap[am] ? cumMap[am].balance : 0)), borderColor: '#4c8c6b', backgroundColor: 'rgba(76,140,107,0.10)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y', labelColor: '#a8d8bf', labelOffset: -18, order: 1 });
    if (S.contrib) ds.push({ type: 'line', label: '누적 원금', data: pick.map(am => (cumMap[am] ? cumMap[am].cumContribution : 0)), borderColor: '#e0c766', borderDash: [5, 4], backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, yAxisID: 'y', labelColor: '#efdfa0', labelOffset: 16, order: 2 });
    if (S.roi) ds.push({ type: 'line', label: '원금 대비 수익률', data: pick.map(am => (roiMap[am] === undefined ? null : roiMap[am])), borderColor: '#9b7fc2', backgroundColor: 'transparent', borderDash: [3, 3], tension: 0.3, pointRadius: 0, spanGaps: true, yAxisID: 'yRoi', order: 0,
      labelColor: '#c0a8e0', labelOffset: -14, labelFormatter: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%` });
    if (S.share) ds.push({ type: 'line', label: '총자산 대비 비중', data: pick.map(am => {
      const tot = d.byMonth[am] || 0;
      const bal = cumMap[am] ? cumMap[am].balance : 0;
      return tot > 0 ? +((bal / tot) * 100).toFixed(1) : null;
    }), borderColor: '#5b8fc7', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 1.6, spanGaps: true, yAxisID: 'yRoi', order: 0,
      labelColor: '#9dc2e8', labelOffset: 14, labelFormatter: (v) => `${v.toFixed(0)}%` });

    state.charts.invMain = new Chart(ctx, {
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 28 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.dataset.yAxisID === 'yRoi' ? (c.raw === null ? '—' : (c.dataset.label === '총자산 대비 비중' ? c.raw + '%' : fmtPct(c.raw))) : formatWon(c.raw)}` } }
        },
        scales: {
          x: { ticks: { ...MONO_TICK, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
          /* 좌축 = 잔액성(평가액·원금), 우축 = 흐름성(이체·실현수익) — 자릿수가 달라 축을 나눈다 */
          y: { display: !!(S.balance || S.contrib || S.returnsCum), position: 'left', ticks: { ...MONO_TICK, color: '#7fc0a0', callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT, title: { display: true, text: '잔액', color: '#7fc0a0', font: { family: 'IBM Plex Mono', size: 9 } } },
          yFlow: { display: S.transfer || S.returns, position: 'right', beginAtZero: true, ticks: { ...MONO_TICK, color: '#e0c766', callback: (v) => formatCompactWon(v) }, grid: { display: false }, title: { display: true, text: '월/연 흐름', color: '#e0c766', font: { family: 'IBM Plex Mono', size: 9 } } },
          yRoi: { display: !!(S.roi || S.share), position: 'right', ticks: { ...MONO_TICK, color: '#c0a8e0', callback: (v) => `${v}%` }, grid: { display: false } }
        }
      },
      plugins: [valueLabelPlugin]
    });
  };
  drawInvMain();

  function onInvRangePick(v) {
    state.invRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('inv-range-toggle', RANGE_OPTIONS, state.invRange, onInvRangePick);
    drawInvMain();
  }
  bindRangeToggle('inv-range-toggle', RANGE_OPTIONS, state.invRange, onInvRangePick);
  document.getElementById('inv-period-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.invPeriod = btn.dataset.period;
    document.querySelectorAll('#inv-period-toggle button').forEach(b => b.classList.toggle('active', b === btn));
    drawInvMain();
  });
  document.getElementById('inv-series-toggles').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    SER[cb.dataset.key] = cb.checked;
    cb.closest('.series-chk').classList.toggle('on', cb.checked);
    drawInvMain();
  });
  }

}


/* 저축 / 연금 탭 공통 렌더러.
   scope = 'saving' | 'pension' — 카테고리·이체 채널·색만 다르고 구조는 같다. */
const SAV_SCOPES = {
  saving: {
    cat: '저축 자산', label: '저축', color: '#c2749b',
    transfers: ['비상금'], transferLabel: { '비상금': '저축(CMA 등)' },
    minors: ['저축 자산', '비상금']
  },
  pension: {
    cat: '연금 자산', label: '연금', color: '#9b7fc2',
    transfers: ['연금 자산'], transferLabel: { '연금 자산': '연금 이체' },
    minors: ['연금 자산']
  }
};

function renderSavingsPage(container, data, d, scopeKey) {
  const S = SAV_SCOPES[scopeKey] || SAV_SCOPES.saving;
  const byMonth = {};
  data.assetRows.forEach(r => {
    if (r.category !== S.cat || r.amount === null) return;
    byMonth[r.date] = (byMonth[r.date] || 0) + r.amount;
  });
  const months = d.assetMonths;
  const latestMonth = d.latestMonth;
  const total = byMonth[latestMonth] || 0;
  const prevMonth = months[months.indexOf(latestMonth) - 1];
  const prev = prevMonth ? (byMonth[prevMonth] || 0) : null;
  const delta = prev === null ? null : total - prev;
  const sharePct = d.totalAssets ? (total / d.totalAssets) * 100 : 0;

  const latestTransferIdx = d.latestPivotIdx;
  const transferNames = S.transfers.filter(n => data.transferCategories[n]);
  const monthTransfer = transferNames.reduce((a, n) => a + ((data.transferCategories[n] || [])[latestTransferIdx] || 0), 0);
  const yearTransfer = transferNames.reduce((a, n) => a + (data.transferCategories[n] || []).slice(-12).reduce((x, v) => x + (v || 0), 0), 0);

  const accounts = {};
  data.assetRows.filter(r => r.date === latestMonth && r.category === S.cat).forEach(r => {
    accounts[r.account] = (accounts[r.account] || 0) + r.amount;
  });
  const accountList = Object.entries(accounts).sort((a, b) => b[1] - a[1]);

  const scopeLedger = data.ledger.filter(r => S.minors.includes(r.minor));

  /* 저축: 비상금 목표 / 연금: 세액공제 한도 */
  let gaugeHtml = '';
  if (scopeKey === 'saving') {
    const cma = accounts['NH-CMA'] !== undefined ? accounts['NH-CMA'] : (accounts['NH(CMA)'] || 0);
    const tgt = state.goals.emergencyFundTarget || 0;
    const pct = tgt ? Math.min((cma / tgt) * 100, 100) : 0;
    gaugeHtml = `
      <div class="stat-card">
        <div class="label">비상금 (NH-CMA)</div>
        <div class="value" style="color:${tgt && cma >= tgt ? 'var(--income-text)' : 'var(--accent-text)'}">${formatCompactWon(cma)}원</div>
        <div class="allow-track" style="margin-top:8px;height:7px;"><div class="allow-fill" style="width:${pct}%;${tgt && cma >= tgt ? '' : 'background:linear-gradient(90deg,var(--gold),var(--gold-soft));'}"></div></div>
        <div class="allow-legend"><span>목표 ${formatCompactWon(tgt)}원</span><span>${tgt ? Math.round((cma / tgt) * 100) : 0}%</span></div>
      </div>`;
  } else {
    const annPension = (data.transferCategories['연금 자산'] || []).slice(-12).reduce((a, v) => a + (v || 0), 0);
    const pct = Math.max(0, Math.min((annPension / PENSION_LIMIT) * 100, 100));
    gaugeHtml = `
      <div class="stat-card">
        <div class="label">세액공제 한도</div>
        <div class="value" style="color:${pct >= 100 ? 'var(--income-text)' : annPension <= 0 ? 'var(--expense-text)' : 'var(--accent-text)'}">${pct.toFixed(0)}%</div>
        <div class="allow-track" style="margin-top:8px;height:7px;"><div class="allow-fill" style="width:${pct}%;${pct >= 100 ? '' : 'background:linear-gradient(90deg,var(--gold),var(--gold-soft));'}"></div></div>
        <div class="allow-legend"><span>최근 12개월 ${formatCompactWon(annPension)}원</span><span>한도 ${formatCompactWon(PENSION_LIMIT)}원</span></div>
      </div>`;
  }

  container.innerHTML = `
    <div class="g">
      <div class="stat-grid s5" style="grid-template-columns:1fr 1fr;">
        <div class="stat-card">
          <div class="label">${S.label} 자산</div>
          <div class="value" style="color:${S.color}">${formatCompactWon(total)}원</div>
          <div class="sub ${delta === null ? '' : delta >= 0 ? 'good' : 'warn'}">${delta === null ? latestMonth || '' : `전월 ${delta >= 0 ? '▲' : '▼'} ${formatCompactWon(Math.abs(delta))}원`}</div>
        </div>
        <div class="stat-card">
          <div class="label">총자산 비중</div>
          <div class="value">${sharePct.toFixed(0)}%</div>
          <div class="sub">총자산 ${formatCompactWon(d.totalAssets)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">이번 달 이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatCompactWon(monthTransfer)}원</div>
          <div class="sub">최근 12개월 ${formatCompactWon(yearTransfer)}원</div>
        </div>
        ${gaugeHtml}
      </div>
      <div class="panel s7">
        <div class="panel-title"><div>계좌별 잔액</div><span class="ptag">${latestMonth || ''}</span></div>
        ${accountList.map(([name, amt]) => {
          const pct = total ? (amt / total) * 100 : 0;
          return `<div class="acct-row">
            <span class="alloc-swatch" style="background:${S.color}"></span>
            <span class="acct-name">${name}</span>
            <span class="acct-amt">${amtPct(amt, pct)}</span>
          </div>`;
        }).join('') || '<div class="empty-state">계좌 데이터가 없어요.</div>'}
      </div>
    </div>
    ${scopeKey === 'pension' ? '<div class="g"><div class="panel s12" id="panel-idle-pension"></div></div>' : ''}
    <div class="g">
      <div class="panel s6">
        <div class="panel-title">
          <div>${S.label} 자산 추이</div>
          <div class="range-toggle" id="sav-trend-range-toggle"></div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart-sav-trend"></canvas></div>
      </div>
      <div class="panel s6">
        <div class="panel-title">
          <div>월별 ${S.label} 이체</div>
          <div class="range-toggle" id="sav-contrib-range-toggle"></div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart-sav-contrib"></canvas></div>
      </div>
    </div>
  `;

  if (scopeKey === 'pension') renderIdlePanel('panel-idle-pension', data, d, ['연금 자산'], '연금 운용 점검');

  const drawSavTrend = () => {
    const monthsSlice = sliceByRange(months, state.savTrendRange);
    if (state.charts.savTrend) state.charts.savTrend.destroy();
    state.charts.savTrend = new Chart(document.getElementById('chart-sav-trend'), {
      type: 'line',
      data: {
        labels: monthsSlice.map(assetMonthLabel),
        datasets: [
          { label: `${S.label} 자산`, data: monthsSlice.map(m => byMonth[m] || 0), borderColor: S.color, backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, labelColor: S.color }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      },
      plugins: [valueLabelPlugin]
    });
  };
  function onSavTrendRangePick(v) {
    state.savTrendRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('sav-trend-range-toggle', RANGE_OPTIONS, state.savTrendRange, onSavTrendRangePick);
    drawSavTrend();
  }
  bindRangeToggle('sav-trend-range-toggle', RANGE_OPTIONS, state.savTrendRange, onSavTrendRangePick);
  drawSavTrend();

  const drawSavContrib = () => {
    const monthsSlice = sliceByRange(data.months, state.savContribRange);
    const n = monthsSlice.length;
    if (state.charts.savContrib) state.charts.savContrib.destroy();
    state.charts.savContrib = new Chart(document.getElementById('chart-sav-contrib'), {
      type: 'bar',
      data: {
        labels: monthsSlice.map(pivotMonthLabel),
        datasets: transferNames.map(name => ({
          label: S.transferLabel[name] || name,
          data: (data.transferCategories[name] || []).slice(-n).map(v => v || 0),
          backgroundColor: S.color, stack: 's'
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: { x: { stacked: true, ticks: MONO_TICK, grid: { display: false } }, y: { stacked: true, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      },
      plugins: [stackTotalLabelPlugin]
    });
  };
  function onSavContribRangePick(v) {
    state.savContribRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('sav-contrib-range-toggle', RANGE_OPTIONS, state.savContribRange, onSavContribRangePick);
    drawSavContrib();
  }
  bindRangeToggle('sav-contrib-range-toggle', RANGE_OPTIONS, state.savContribRange, onSavContribRangePick);
  drawSavContrib();
}

/* 분류별 예산은 예전에 window.storage 에 넣었는데, GitHub Pages 에는 그 API 가 없어
   실제로는 한 번도 저장되지 않았다. Supabase app_settings 로 옮긴다. */
async function loadBudgets() {
  try {
    const sb = await enClient();
    const { data } = await sb.from('app_settings').select('key,value')
      .in('key', ['budget_categories', 'transfer_goals']);
    (data || []).forEach(r => {
      if (r.key === 'budget_categories') state.budgets = budgetNorm(r.value);
      if (r.key === 'transfer_goals') state.transferGoals = r.value || {};
    });
  } catch (e) { /* 아직 저장된 값이 없다 */ }
  state.budgetsLoaded = true;
}
