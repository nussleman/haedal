/* ================= 추가 기능: 증감 분해 · 목표 배분 · 데이터 품질 · 부채 · 운용 점검 · 후회 소비 · 흐름표 ================= */


/* ---------------- 목표 자산배분 + 갭 (자산 배분 패널 안에 붙는다) ---------------- */

/* 추천 목표 배분
   - 안전자산(현금+저축) = 생활비 N개월치가 차지하는 비중 (최소 5%)
   - 연금 = 55세까지 못 빼는 강제 저축이라 현재 비중을 그대로 존중
   - 투자 = 나머지 전부
   5% 단위로 반올림하고 합계를 100%로 맞춘다. */
function suggestTargetAlloc(d, extra) {
  const total = d.totalAssets || 0;
  if (!total) return null;
  const cfList = (d.cashflow || []).filter(c => c.expense > 0).slice(-6);
  const monthlyExp = cfList.length ? cfList.reduce((a, c) => a + c.expense, 0) / cfList.length : 0;
  const living = monthlyExp + monthlyDebtPayment();
  const months = state.settings.emergencyMonths || 6;

  const pensionPct = ((d.allocation || {})['연금 자산'] || 0) / total * 100;
  let safePct = living > 0 ? Math.min((living * months) / total * 100, 45) : 10;
  safePct = Math.max(safePct, 5);
  /* 현금은 한 달치, 나머지는 저축(CMA·청약) */
  let cashPct = living > 0 ? Math.min((living / total) * 100, safePct) : 2;
  let savePct = Math.max(safePct - cashPct, 0);
  let pen = Math.round(pensionPct / 5) * 5;
  let cash = Math.max(Math.round(cashPct / 5) * 5, 0);
  let save = Math.max(Math.round(savePct / 5) * 5, 0);
  let inv = 100 - pen - cash - save;
  if (inv < 0) { save = Math.max(save + inv, 0); inv = 100 - pen - cash - save; }
  return {
    alloc: { '현금 자산': cash, '저축 자산': save, '투자 자산': inv, '연금 자산': pen },
    why: `생활비 ${formatCompactWon(Math.round(living))}원 × ${months}개월 = 안전자산 ${cash + save}% · 연금은 인출 제한이 있어 현재 비중(${pensionPct.toFixed(0)}%) 유지 · 나머지 투자`
  };
}

function allocVerdict(rows, d) {
  const total = d.totalAssets || 0;
  const risky = ((d.allocation['투자 자산'] || 0) + (d.allocation['연금 자산'] || 0)) / (total || 1) * 100;
  const cash = ((d.allocation['현금 자산'] || 0) + (d.allocation['저축 자산'] || 0)) / (total || 1) * 100;
  const notes = [];
  if (risky >= 85) notes.push(`위험자산 ${risky.toFixed(0)}% — 시장이 20% 빠지면 자산도 거의 그대로 빠집니다`);
  if (cash < 10) notes.push(`안전자산 ${cash.toFixed(0)}% — 생활비 완충이 얇습니다`);
  const big = rows.filter(r => r.gapPct !== null).sort((a, b) => Math.abs(b.gapWon) - Math.abs(a.gapWon))[0];
  if (big && Math.abs(big.gapPct) > 3) {
    notes.push(big.gapPct > 0
      ? `${big.cat.replace(' 자산', '')}가 목표보다 ${formatCompactWon(Math.abs(big.gapWon))} 많아요 — 다음 이체를 다른 칸으로`
      : `${big.cat.replace(' 자산', '')}가 목표보다 ${formatCompactWon(Math.abs(big.gapWon))} 부족해요 — 다음 이체는 여기로`);
  }
  if (!notes.length) notes.push('목표 배분 안에 잘 들어와 있어요');
  return notes;
}

function renderTargetAllocPanel(hostId, d) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const total = d.totalAssets || 0;
  const target = state.settings.targetAlloc;
  const sug = suggestTargetAlloc(d);
  const tol = 3;

  const rows = ALLOC_CATS.map(c => {
    const cur = d.allocation[c] || 0;
    const cp = total ? (cur / total) * 100 : 0;
    const tp = target ? (Number(target[c]) || 0) : (sug ? sug.alloc[c] : null);
    return { cat: c, cur, cp, tp, gapPct: tp === null ? null : cp - tp, gapWon: tp === null ? null : cur - total * tp / 100 };
  }).filter(r => r.cur > 0 || (r.tp || 0) > 0);

  const locked = d.allocation['연금 자산'] || 0;
  const notes = allocVerdict(rows, d);

  host.innerHTML = `
    <div class="al-split">
      <div class="al-donut"><canvas id="chart-alloc"></canvas></div>
      <table class="al">
        <thead><tr>
          <th class="c-nm"></th>
          <th class="h-cur">현재</th>
          <th class="h-tgt">${target ? '목표' : '추천'}</th>
          <th class="h-gap">갭</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const cls = r.gapPct === null ? '' : (Math.abs(r.gapPct) <= tol ? 'fit' : 'off');
            return `<tr>
              <td class="c-nm"><i style="background:${CAT_COLORS[r.cat] || '#888'}"></i>${r.cat.replace(' 자산', '')}</td>
              <td class="c-cur">${r.cp.toFixed(0)}<span>%</span><em>${formatCompactWon(r.cur)}</em></td>
              <td class="c-tgt ${target ? '' : 'sug'}">${r.tp === null ? '—' : r.tp + '%'}</td>
              <td class="c-gap ${cls}">${r.gapWon === null ? '—' : `${r.gapPct >= 0 ? '+' : '−'}${Math.abs(r.gapPct).toFixed(0)}%p<em>${formatCompactWon(Math.abs(r.gapWon))}</em>`}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <ul class="al-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>
    <div class="al-foot">
      <span>지금 쓸 수 있는 돈 <b>${formatCompactWon(total - locked)}</b> · 연금 잠김 <b>${total ? Math.round(locked / total * 100) : 0}%</b></span>
      ${target ? '' : `<button class="btn small primary" id="alloc-apply-sug">추천값으로 설정</button>`}
    </div>
    ${sug && !target ? `<div class="settings-note">추천 근거 — ${sug.why}</div>` : ''}
  `;
  const b = document.getElementById('alloc-apply-sug');
  if (b && sug) b.addEventListener('click', async () => {
    state.settings.targetAlloc = sug.alloc;
    await saveSettings();
    renderPage();
  });
}

function openAllocEditor(d) {
  const total = d.totalAssets || 0;
  const cur = state.settings.targetAlloc || {};
  const suggest = {};
  ALLOC_CATS.forEach(c => { suggest[c] = total ? Math.round((d.allocation[c] || 0) / total * 100) : 0; });
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head"><b>목표 자산배분</b><button class="btn small" data-act="close">닫기</button></div>
      <div class="modal-body">
        ${ALLOC_CATS.map(c => `
          <div class="fld-row" style="align-items:flex-end;">
            <label class="fld"><span>${c}</span>
              <input type="number" min="0" max="100" step="1" data-cat="${c}" value="${cur[c] !== undefined ? cur[c] : suggest[c]}" />
            </label>
            <div style="font-family:var(--mono);font-size:11px;color:var(--text-faint);padding-bottom:10px;white-space:nowrap;">현재 ${suggest[c]}%</div>
          </div>`).join('')}
        <div class="ge-link" id="alloc-sum"></div>
        <div class="settings-note">합계가 100%가 되어야 저장돼요. 값은 이 브라우저에 저장됩니다.</div>
      </div>
      <div class="modal-foot">
        ${state.settings.targetAlloc ? '<button class="btn small danger" data-act="reset">목표 삭제</button>' : '<span></span>'}
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  const inputs = () => Array.from(back.querySelectorAll('input[data-cat]'));
  const sumBox = back.querySelector('#alloc-sum');
  const refresh = () => {
    const sum = inputs().reduce((a, i) => a + (Number(i.value) || 0), 0);
    sumBox.className = 'ge-link ' + (sum === 100 ? 'good' : 'bad');
    sumBox.innerHTML = `합계 <b>${sum}%</b>${sum === 100 ? '' : ` — 100%에서 ${sum > 100 ? sum - 100 + '%p 초과' : 100 - sum + '%p 부족'}`}`;
  };
  inputs().forEach(i => i.addEventListener('input', refresh));
  refresh();
  back.addEventListener('click', async (e) => {
    if (e.target === back) { back.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'close') back.remove();
    if (a === 'reset') { state.settings.targetAlloc = null; await saveSettings(); back.remove(); renderPage(); }
    if (a === 'save') {
      const obj = {};
      inputs().forEach(i => { obj[i.dataset.cat] = Number(i.value) || 0; });
      const sum = Object.values(obj).reduce((x, y) => x + y, 0);
      if (sum !== 100) { refresh(); return; }
      state.settings.targetAlloc = obj;
      await saveSettings();
      back.remove();
      renderPage();
    }
  });
}

/* ---------------- 부채 편집 ---------------- */
function openDebtEditor() {
  const debts = JSON.parse(JSON.stringify(state.settings.debts || []));
  const back = document.createElement('div');
  back.className = 'modal-back';
  const rowHtml = (x) => `
    <div class="ge-link" data-row="${x.id}" style="display:flex;flex-direction:column;gap:8px;">
      <div class="fld-row">
        <label class="fld"><span>이름</span><input type="text" data-f="name" value="${(x.name || '').replace(/"/g, '&quot;')}" placeholder="예) 학자금 대출" /></label>
        <label class="fld"><span>잔액 (원)</span><input type="text" inputmode="numeric" data-f="balance" value="${x.balance ? wonComma(x.balance) : ''}" /></label>
      </div>
      <div class="fld-row">
        <label class="fld"><span>월 상환액 (원)</span><input type="text" inputmode="numeric" data-f="monthly" value="${x.monthly ? wonComma(x.monthly) : ''}" /></label>
        <label class="fld"><span>금리 (%)</span><input type="text" inputmode="decimal" data-f="rate" value="${x.rate || ''}" /></label>
      </div>
      <label class="fld"><span>메모</span><input type="text" data-f="memo" value="${(x.memo || '').replace(/"/g, '&quot;')}" /></label>
      <div style="text-align:right;"><button class="btn small danger" data-del="${x.id}">이 부채 삭제</button></div>
    </div>`;
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head"><b>부채</b><button class="btn small" data-act="close">닫기</button></div>
      <div class="modal-body" id="debt-body">
        <div id="debt-rows">${debts.map(rowHtml).join('') || '<div class="empty-state">등록된 부채가 없어요. 없으면 순자산 = 총자산입니다.</div>'}</div>
        <button class="fm-add" data-act="add">+ 부채 추가</button>
      </div>
      <div class="modal-foot"><span></span>
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  const rowsBox = back.querySelector('#debt-rows');
  back.addEventListener('click', async (e) => {
    if (e.target === back) { back.remove(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const el = rowsBox.querySelector(`[data-row="${del.dataset.del}"]`);
      if (el) el.remove();
      if (!rowsBox.querySelector('[data-row]')) rowsBox.innerHTML = '<div class="empty-state">등록된 부채가 없어요.</div>';
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') back.remove();
    if (act.dataset.act === 'add') {
      if (!rowsBox.querySelector('[data-row]')) rowsBox.innerHTML = '';
      rowsBox.insertAdjacentHTML('beforeend', rowHtml({ id: uid() }));
    }
    if (act.dataset.act === 'save') {
      const out = [];
      rowsBox.querySelectorAll('[data-row]').forEach(el => {
        const g = (f) => (el.querySelector(`[data-f="${f}"]`) || {}).value || '';
        const num = (f) => Number(String(g(f)).replace(/[^0-9.-]/g, '')) || 0;
        const name = g('name').trim();
        if (!name && !num('balance')) return;
        out.push({ id: el.dataset.row, name: name || '이름 없음', balance: num('balance'), monthly: num('monthly'), rate: num('rate'), memo: g('memo').trim() });
      });
      state.settings.debts = out;
      await saveSettings();
      back.remove();
      renderPage();
    }
  });
}

/* ---------------- 운용 점검 (연금·미운용 계좌) ---------------- */
function computeIdleAccounts(data, d, cats) {
  const names = state.settings.idleAccounts || [];
  const months = d.assetMonths || [];
  const nowKey = thisMonthKey();
  const monthDiff = (a, b) => {
    const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
  };
  const out = [];
  names.forEach(name => {
    const rows = (data.assetRows || []).filter(r => r.account === name && r.amount !== null);
    if (!rows.length) return;
    const cat = rows[rows.length - 1].category;
    if (cats && cats.indexOf(cat) < 0) return;
    const byM = {};
    rows.forEach(r => { byM[r.date] = r.amount; });
    const seq = months.filter(m => byM[m] !== undefined);
    const latest = seq[seq.length - 1];
    const bal = byM[latest] || 0;

    /* 실제 '돈을 넣었는가' = 그 계좌로의 이체 기록 */
    const trfMonths = (data.ledger || [])
      .filter(r => r.major.includes('이체') && (r.item || '').trim() === name && r.amount > 0)
      .map(r => ledgerMonthKey(r.date)).filter(Boolean).sort();
    const lastTrf = trfMonths.length ? trfMonths[trfMonths.length - 1] : null;
    const sinceTrf = lastTrf ? monthDiff(lastTrf, nowKey) : null;

    /* 잔액이 사실상 안 움직인 연속 개월 수 (변동 0.5% 미만) */
    let flat = 0;
    for (let i = seq.length - 1; i > 0; i--) {
      const a = byM[seq[i]], b = byM[seq[i - 1]];
      if (!b) break;
      if (Math.abs(a - b) / Math.abs(b) < 0.005) flat++; else break;
    }
    const checked = (state.settings.idleCheck || {})[name] || null;
    const severity = sinceTrf === null ? 99 : sinceTrf;
    out.push({ name, cat, bal, latest, flat, lastTrf, sinceTrf, severity, checked });
  });
  return out.sort((a, b) => b.severity - a.severity || b.bal - a.bal);
}

function renderIdlePanel(hostId, data, d, cats, title) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const list = computeIdleAccounts(data, d, cats);
  const mk = thisMonthKey();
  const sum = list.reduce((a, x) => a + x.bal, 0);
  host.style.display = '';
  host.innerHTML = `
    <div class="panel-title">
      <div>${title || '운용 점검'}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="ptag">${formatCompactWon(sum)}원 · ${list.length}개 계좌</span>
        <button class="btn small" data-idle-edit="1">대상 계좌</button>
      </div>
    </div>
    ${!list.length ? '<div class="empty-state">점검 대상 계좌가 없어요. <b>대상 계좌</b>에서 골라 주세요.</div>' : ''}
    ${list.map(x => {
      const done = x.checked === mk;
      const st = done ? 'ok' : (x.severity >= 3 ? 'bad' : x.severity >= 1 ? 'warn' : 'ok');
      const label = done ? '이번 달 매수 완료'
        : x.sinceTrf === null ? '입금 기록 없음'
        : x.sinceTrf === 0 ? '이번 달 입금 있음'
        : `${x.sinceTrf}개월째 입금 없음`;
      const subtle = x.flat >= 2 ? ` · 잔액 ${x.flat}개월 정체` : '';
      return `<div class="idle-row">
        <span class="alloc-swatch" style="background:${CAT_COLORS[x.cat] || '#888'}"></span>
        <span class="nm">${x.name}<em style="font-style:normal;color:var(--text-faint);font-family:var(--mono);font-size:10.5px;"> ${formatCompactWon(x.bal)}${subtle}</em></span>
        <span class="st ${st}">${label}</span>
        <button class="btn small ${done ? '' : 'primary'}" data-idle="${x.name}">${done ? '해제' : '매수함'}</button>
      </div>`;
    }).join('')}
    ${(() => {
      const todo = list.filter(x => x.checked !== mk && x.severity >= 1);
      if (!todo.length) return '<div class="today-verdict good" style="margin-top:10px;">이번 달 모든 계좌 점검 완료.</div>';
      return `<div class="today-verdict warn" style="margin-top:10px;">
        <b>이번 달 할 일:</b> ${todo.map(x => x.name).join(' · ')} 에 지수 ETF 매수 — 합계 ${formatCompactWon(todo.reduce((a, x) => a + x.bal, 0))}원이 방치돼 있어요.
      </div>`;
    })()}
    <div class="settings-note">'입금 없음' = 가계부 이체 내역에 그 계좌로 들어간 돈이 없는 기간. 매수하고 나서 <b>매수함</b>을 누르면 이번 달 점검 완료로 기록돼요.</div>
  `;
  if (host.dataset.idleBound !== '1') {
    host.dataset.idleBound = '1';
    host.addEventListener('click', async (e) => {
    if (e.target.closest('[data-idle-edit]')) { openIdleAccountPicker(data, d); return; }
    const btn = e.target.closest('[data-idle]');
    if (!btn) return;
    const n = btn.dataset.idle;
    state.settings.idleCheck = state.settings.idleCheck || {};
    if (state.settings.idleCheck[n] === mk) delete state.settings.idleCheck[n];
    else state.settings.idleCheck[n] = mk;
    await saveSettings();
    renderIdlePanel(hostId, data, d, cats, title);
    });
  }
}

function openIdleAccountPicker(data, d) {
  const all = {};
  (data.assetRows || []).filter(r => r.date === d.latestMonth && r.amount !== null).forEach(r => {
    all[r.account] = { amt: (all[r.account] ? all[r.account].amt : 0) + r.amount, cat: r.category };
  });
  const chosen = new Set(state.settings.idleAccounts || []);
  const rows = Object.entries(all).sort((a, b) => b[1].amt - a[1].amt);
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head"><b>운용 점검 대상 계좌</b><button class="btn small" data-act="close">닫기</button></div>
      <div class="modal-body">
        ${rows.map(([n, v]) => `<label class="idle-row" style="cursor:pointer;">
          <input type="checkbox" data-acct="${n.replace(/"/g, '&quot;')}" ${chosen.has(n) ? 'checked' : ''} style="accent-color:var(--accent-text);width:14px;height:14px;" />
          <span class="alloc-swatch" style="background:${CAT_COLORS[v.cat] || '#888'}"></span>
          <span class="nm">${n}</span>
          <span class="st">${formatCompactWon(v.amt)}</span>
        </label>`).join('')}
        <div class="settings-note">직접 굴려야 하는데 손이 잘 안 가는 계좌를 골라 두세요. 매달 매수 여부를 추적합니다.</div>
      </div>
      <div class="modal-foot"><span></span>
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener('click', async (e) => {
    if (e.target === back) { back.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') { back.remove(); return; }
    if (act.dataset.act === 'save') {
      state.settings.idleAccounts = Array.from(back.querySelectorAll('input[data-acct]:checked')).map(i => i.dataset.acct);
      await saveSettings();
      back.remove();
      renderPage();
    }
  });
}
