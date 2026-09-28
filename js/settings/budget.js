/* ── 설정 › 예산 ──────────────────────────────────────────
   총액은 목표의 "월 지출 N만원" 한 줄이 원본이다. 별도 저장소를 만들면 목표와 예산이
   따로 놀아 둘 중 뭘 믿을지 모르게 되므로 저장할 때 목표도 같이 고친다.
   분류·세부분류별 금액과 메모는 app_settings 에 둔다 (형식은 budgetNorm 참고).

   화면은 Finder 목록 보기처럼 분류를 누르면 세부분류가 펼쳐진다.
   세부분류에 금액을 적으면 분류 칸은 그 합계(Σ)로 바뀌고, 세부분류를 비우면 다시 직접 적을 수 있다.
   고치는 동안은 BUD.draft 에만 쌓아 두고, 저장을 눌러야 DB 에 간다. */
const BUD = { draft: null, dirty: false, open: {}, memo: {} };

function renderBudgetSettings(container, data, d) {
  /* 세부분류 목록은 categories 표가 원본 — 아직 안 불러왔으면 받은 뒤 다시 그린다 */
  if (!EN.loaded) {
    enEnsureRefs().then(() => { if (container.isConnected && EN.loaded) renderBudgetSettings(container, data, d); })
      .catch(() => {});
  }
  const ledger = data.ledger || [];
  const mk = thisMonthKey();
  const cur = monthlyExpenseTarget(data, ledger, mk);
  if (!BUD.draft || !BUD.dirty) BUD.draft = budgetNorm(JSON.parse(JSON.stringify(state.budgets || {})));
  const B = BUD.draft;

  /* 기준선 = 마감된 최근 3개월 실지출 평균, 왼쪽 숫자 = 이번 달 실지출. 키는 '분류' 와 '분류|세부분류' */
  const avg = {}, spent = {}, tree = {};
  const bump = (o, c, i, v) => { o[c] = (o[c] || 0) + v; const k = c + '|' + i; o[k] = (o[k] || 0) + v; };
  const node = (c, i) => { const t = tree[c] || (tree[c] = new Set()); if (i) t.add(i); };
  const prev = [1, 2, 3].map(i => shiftMonthKey(mk, -i));
  ledger.forEach(r => {
    if (!r.major.includes('지출')) return;
    const k = ledgerMonthKey(r.date);
    const c = r.minor || '기타', i = r.item || '기타';
    if (prev.includes(k)) { bump(avg, c, i, netExpenseOf(r) / 3); node(c, i); }
    else if (k === mk) { bump(spent, c, i, netExpenseOf(r)); node(c, i); }
  });
  (EN.cats || []).filter(x => x.kind === '지출').forEach(x => node(x.category, x.subcategory));
  Object.entries(B).forEach(([c, g]) => { node(c); Object.keys(g.items).forEach(i => node(c, i)); });

  const byAvg = (ka, kb, a, b) => (avg[kb] || 0) - (avg[ka] || 0) || a.localeCompare(b, 'ko');
  const cats = Object.keys(tree).sort((a, b) => byAvg(a, b, a, b));
  const itemsOf = (c) => [...tree[c]].sort((a, b) => byAvg(c + '|' + a, c + '|' + b, a, b));
  const grp = (c) => B[c] || (B[c] = { amount: 0, memo: '', items: {} });
  const esc = enEsc;
  const won = (n) => n ? enComma(Math.round(n)) : '–';
  const round1k = (n) => Math.round((n || 0) / 1000) * 1000;

  const barHtml = (used, lim) => {
    const pct = lim ? (used / lim) * 100 : 0;
    return `<span class="bt-bar"><i class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(100, pct)}%"></i></span>`;
  };
  const memoBtn = (key, memo) => `<button class="bt-mbtn ${memo ? 'has' : ''} ${BUD.memo[key] ? 'on' : ''}"
      data-memo="${esc(key)}" title="${memo ? esc(memo) : '예산 근거 메모'}" aria-label="메모">✎</button>`;
  const memoRow = (key, memo, item) => BUD.memo[key] ? `
      <div class="bt-memo ${item ? 'item' : ''}">
        <textarea class="bt-mta" data-key="${esc(key)}" rows="2"
          placeholder="이 금액의 근거 — 예) 주 2회 외식 × 3만원 × 4주">${esc(memo)}</textarea>
      </div>` : '';
  /* 분류의 예산 칸 — 세부분류 합계가 있으면 잠긴 Σ, 없으면 입력칸 */
  const catCell = (c) => {
    const g = grp(c), s = budgetItemSum(g);
    if (s > 0) return `<span class="bt-sum mono" title="세부분류 합계 — 세부분류를 모두 비우면 직접 적을 수 있어요">Σ ${enComma(s)}</span>`;
    return `<input class="bt-in mono" data-c="${esc(c)}" type="text" inputmode="numeric"
      value="${g.amount ? enComma(g.amount) : ''}" placeholder="${avg[c] ? enComma(round1k(avg[c])) : ''}">`;
  };

  const rowsHtml = cats.map(c => {
    const g = grp(c), items = itemsOf(c), open = !!BUD.open[c];
    const lim = budgetCatAmount(g), used = spent[c] || 0;
    const head = `
      <div class="bt-row bt-cat ${open ? 'open' : ''} ${lim && used > lim ? 'over' : ''}" data-c="${esc(c)}">
        <span class="bt-nm">
          <span class="bt-caret ${items.length ? '' : 'none'}">▸</span>
          <span class="bt-tt"><b>${esc(c)}</b>${items.length ? `<em>${items.length}</em>` : ''}
            ${g.memo ? `<small class="bt-mprev">${esc(g.memo)}</small>` : ''}</span>
        </span>
        <span class="bt-now mono">${won(used)}${barHtml(used, lim)}</span>
        <span class="bt-avg mono">${won(avg[c])}</span>
        <span class="bt-cell" data-cell="${esc(c)}">${catCell(c)}</span>
        ${memoBtn(c, g.memo)}
      </div>${memoRow(c, g.memo)}`;
    if (!open) return head;
    return head + items.map(i => {
      const key = c + '|' + i, it = g.items[i] || { amount: 0, memo: '' };
      const u = spent[key] || 0;
      return `
      <div class="bt-row bt-item ${it.amount && u > it.amount ? 'over' : ''}">
        <span class="bt-nm"><span class="bt-tt">${esc(i)}
          ${it.memo ? `<small class="bt-mprev">${esc(it.memo)}</small>` : ''}</span></span>
        <span class="bt-now mono">${won(u)}${barHtml(u, it.amount)}</span>
        <span class="bt-avg mono">${won(avg[key])}</span>
        <span class="bt-cell"><input class="bt-in mono" data-c="${esc(c)}" data-i="${esc(i)}" type="text" inputmode="numeric"
          value="${it.amount ? enComma(it.amount) : ''}" placeholder="${avg[key] ? enComma(round1k(avg[key])) : ''}"></span>
        ${memoBtn(key, it.memo)}
      </div>${memoRow(key, it.memo, true)}`;
    }).join('');
  }).join('');

  const total = budgetMonthlyTotal(B);
  let avg3 = 0; cats.forEach(c => { avg3 += avg[c] || 0; });
  container.innerHTML = `
    <div class="narrow-page bt-page">

    <div class="bud-card">
      <div class="bud-row">
        <div class="bud-lab">
          <b>월 지출 총액</b>
          <span>아래 분류별 예산을 더한 값입니다. 따로 적지 않습니다.</span>
        </div>
        <div class="bud-total mono" id="bud-total">${enComma(total)}<small>원</small></div>
      </div>
      <div class="bud-note">
        홈과 리포트의 예산 페이스가 이 값을 기준으로 계산됩니다.
        ${avg3 ? `최근 3개월 실지출 평균은 ${enComma(Math.round(avg3))}원입니다.` : ''}
        ${cur && cur.amount !== total && !BUD.dirty ? `<br>저장된 기준은 아직 ${enComma(cur.amount)}원입니다 — 아래에서 저장하면 맞춰집니다.` : ''}
      </div>
    </div>

    <div class="bud-card">
      <div class="bud-row" style="margin-bottom:12px;">
        <div class="bud-lab">
          <b>분류별 예산</b>
          <span>분류를 누르면 세부분류가 펼쳐집니다. 세부분류에 적으면 그 합계가 분류 예산이 돼요.</span>
        </div>
        <button class="nav-act" id="budc-avg">빈 분류 평균으로 채우기</button>
      </div>
      <div class="bt">
        <div class="bt-row bt-head">
          <span class="bt-nm">이름</span><span class="bt-now">이번 달</span><span class="bt-avg">3개월 평균</span>
          <span class="bt-cell">예산</span><span></span>
        </div>
        ${rowsHtml || '<div class="hm-none">지출 기록이 아직 없어요.</div>'}
      </div>
      <div class="bud-note">✎ 를 누르면 그 예산의 근거를 적을 수 있어요. 막대는 이번 달 실지출 ÷ 예산입니다.</div>
      <div class="bud-acts">
        <span class="bt-dirty" id="bt-dirty" ${BUD.dirty ? '' : 'hidden'}>저장하지 않은 변경이 있어요</span>
        <button class="nav-act" id="budc-reset" ${BUD.dirty ? '' : 'hidden'}>되돌리기</button>
        <button class="nav-act accent" id="budc-save">저장</button>
      </div>
    </div>
    </div>`;

  const redraw = () => renderBudgetSettings(container, data, d);
  const markDirty = () => {
    BUD.dirty = true;
    const t = document.getElementById('bud-total');
    if (t) t.innerHTML = enComma(budgetMonthlyTotal(B)) + '<small>원</small>';
    ['bt-dirty', 'budc-reset'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = false; });
  };
  const box = container.querySelector('.bt');

  box.addEventListener('click', (e) => {
    const mb = e.target.closest('.bt-mbtn');
    if (mb) {
      const k = mb.dataset.memo;
      BUD.memo[k] = !BUD.memo[k];
      redraw();
      const ta = container.querySelector(`.bt-mta[data-key="${CSS.escape(k)}"]`);
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    const row = e.target.closest('.bt-cat');
    if (!row || e.target.closest('input')) return;
    if (!tree[row.dataset.c].size) return;
    BUD.open[row.dataset.c] = !BUD.open[row.dataset.c];
    redraw();
  });

  box.addEventListener('input', (e) => {
    const el = e.target;
    if (el.classList.contains('bt-mta')) {
      const [c, i] = el.dataset.key.split('|');
      const g = grp(c);
      if (i === undefined) g.memo = el.value;
      else (g.items[i] = g.items[i] || { amount: 0, memo: '' }).memo = el.value;
      markDirty();
      return;
    }
    if (!el.classList.contains('bt-in')) return;
    const raw = el.value.replace(/[^\d]/g, '');
    el.value = raw ? enComma(raw) : '';
    const n = Number(raw) || 0, c = el.dataset.c, g = grp(c);
    if (el.dataset.i === undefined) g.amount = n;
    else {
      (g.items[el.dataset.i] = g.items[el.dataset.i] || { amount: 0, memo: '' }).amount = n;
      /* 세부분류를 고치면 분류 칸이 Σ 합계 ↔ 입력칸으로 바뀐다 (포커스는 세부분류에 있으니 갈아끼워도 된다) */
      const cell = box.querySelector(`.bt-cell[data-cell="${CSS.escape(c)}"]`);
      if (cell) cell.innerHTML = catCell(c);
    }
    markDirty();
  });

  document.getElementById('budc-avg').addEventListener('click', () => {
    let n = 0;
    cats.forEach(c => {
      const g = grp(c);
      if (!g.amount && !budgetItemSum(g) && avg[c] > 0) { g.amount = round1k(avg[c]); n++; }
    });
    if (!n) { enToast('비어 있는 분류가 없어요'); return; }
    BUD.dirty = true;
    redraw();
    enToast(`${n}개 분류를 채웠어요 — 저장을 눌러야 반영됩니다`);
  });
  document.getElementById('budc-reset').addEventListener('click', () => {
    BUD.dirty = false; BUD.draft = null;
    redraw();
  });
  document.getElementById('budc-save').addEventListener('click', async () => {
    /* 빈 칸은 버리고, 세부분류가 있는 분류는 amount 에 합계를 같이 적어 둔다 */
    const clean = {};
    Object.entries(B).forEach(([c, g]) => {
      const items = {};
      Object.entries(g.items).forEach(([i, x]) => {
        const memo = (x.memo || '').trim();
        if (x.amount || memo) items[i] = { amount: x.amount || 0, memo };
      });
      const memo = (g.memo || '').trim();
      const amount = budgetCatAmount({ amount: g.amount, items });
      if (amount || memo || Object.keys(items).length) clean[c] = { amount, memo, items };
    });
    const ok = await budgetCatSave(clean, budgetMonthlyTotal(clean));
    if (ok) { BUD.dirty = false; BUD.draft = null; renderPage(); }
  });
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
