/* ── 설정 › 적립 ──────────────────────────────────────────
   예산이 "이만큼 넘지 마라"면 적립은 "이만큼은 보내라"다. 방향만 반대고 구조는 같다.
   이체 대상은 세부분류(증권 계좌·CMA 같은 계좌 이름)가 들고 있다. */
function renderSavingPlanSettings(container, data, d) {
  const ledger = data.ledger || [];
  const mk = thisMonthKey();
  const isMove = r => r.major.includes('이체') || r.major.includes('자산');

  const trAvg = {};
  for (let i = 1; i <= 3; i++) {
    const k = shiftMonthKey(mk, -i);
    ledger.filter(r => ledgerMonthKey(r.date) === k && isMove(r))
      .forEach(r => { const t = r.item || r.minor || '기타';
        trAvg[t] = (trAvg[t] || 0) + Math.abs(r.amount) / 3; });
  }
  const trNow = {};
  ledger.filter(r => ledgerMonthKey(r.date) === mk && isMove(r))
    .forEach(r => { const t = r.item || r.minor || '기타';
      trNow[t] = (trNow[t] || 0) + Math.abs(r.amount); });

  const trSet = state.transferGoals || {};
  const dests = [...new Set([...Object.keys(trAvg), ...Object.keys(trNow), ...Object.keys(trSet)])]
    .sort((a, b) => (trAvg[b] || 0) - (trAvg[a] || 0));
  const goalSum = dests.reduce((a, c) => a + (Number(trSet[c]) || 0), 0);
  const doneSum = dests.reduce((a, c) => a + (trNow[c] || 0), 0);

  container.innerHTML = `
    <div class="narrow-page">

    <div class="bud-card">
      <div class="bud-row" style="margin-bottom:14px;">
        <div class="bud-lab">
          <b>이체 대상별 월 기댓값</b>
          <span>비워 두면 최근 3개월 평균을 기준선으로 씁니다</span>
        </div>
        <button class="nav-act" id="budt-avg">전부 평균으로 채우기</button>
      </div>
      <div class="budc">
        ${dests.length ? dests.map(c => {
          const base = Math.round(trAvg[c] || 0);
          const exp = Number(trSet[c]) || 0;
          const done = trNow[c] || 0;
          const goal = exp || base;
          const pct = goal ? (done / goal) * 100 : 0;
          return `<div class="budc-row">
            <span class="c">${enEsc(c)}</span>
            <span class="bar"><i class="${pct >= 100 ? 'done' : 'tr'}" style="width:${Math.min(100, pct)}%"></i></span>
            <span class="now mono">${enComma(Math.round(done))}</span>
            <input class="budc-in budt-in mono" data-dest="${enEsc(c)}" type="text" inputmode="numeric"
              value="${exp ? enComma(exp) : ''}" placeholder="${enComma(base)}">
          </div>`;
        }).join('') : '<div class="hm-none">이체 기록이 아직 없어요.</div>'}
      </div>
      <div class="bud-note">
        ${goalSum ? `이번 달 <b>${enComma(Math.round(doneSum))}</b> / 기댓값 <b>${enComma(goalSum)}</b>원`
                  : '아직 기댓값을 정하지 않았습니다.'}
        · 왼쪽 숫자는 이번 달 실제 이체액이고, 막대가 꽉 차면 그 달 몫을 다 보낸 것입니다.
        이체는 쓴 돈이 아니라 옮긴 돈이라 순자산에서는 그대로 남습니다.
      </div>
      <div class="bud-acts"><button class="nav-act accent" id="budt-save">저장</button></div>
    </div>
    </div>`;

  container.querySelectorAll('.budt-in').forEach(el => el.addEventListener('input', () => {
    const raw = el.value.replace(/[^\d]/g, '');
    el.value = raw ? enComma(raw) : '';
  }));
  document.getElementById('budt-avg').addEventListener('click', () => {
    container.querySelectorAll('.budt-in').forEach(el => { if (!el.value) el.value = el.placeholder; });
    enToast('저장을 눌러야 반영됩니다');
  });
  document.getElementById('budt-save').addEventListener('click', () => {
    const v = {};
    container.querySelectorAll('.budt-in').forEach(el => {
      const n = Number(el.value.replace(/[^\d]/g, ''));
      if (n) v[el.dataset.dest] = n;
    });
    transferGoalSave(v);
  });
}

async function transferGoalSave(map) {
  const btn = document.getElementById('budt-save');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    const sb = await enClient();
    const { error } = await sb.from('app_settings')
      .upsert({ key: 'transfer_goals', value: map, updated_at: new Date().toISOString() },
              { onConflict: 'owner_id,key' });
    if (error) throw error;
    state.transferGoals = map;
    enToast(`이체 기댓값 ${Object.keys(map).length}건을 저장했습니다`);
    renderPage();
  } catch (e) {
    enToast('저장하지 못했습니다 — ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  }
}

/* 목표의 "월 지출 상한" 한 줄을 고친다. 이제 분류별 예산 저장이 합계를 넘겨 부르는
   내부 함수라, 버튼 상태는 호출한 쪽이 관리한다. */
async function budgetSave(raw, quiet) {
  const v = String(raw).replace(/[^\d]/g, '');
  try {
    const sb = await enClient();
    const { data: row } = await sb.from('goals').select('id')
      .eq('metric_source', 'monthly_expense').neq('status', '중단').limit(1).maybeSingle();
    if (!v) {
      if (row) await sb.from('goals').update({ status: '중단' }).eq('id', row.id);
      if (!quiet) enToast('예산을 해제했습니다');
    } else if (row) {
      await sb.from('goals').update({ target_amount: Number(v), status: '진행중' }).eq('id', row.id);
      if (!quiet) enToast('예산을 저장했습니다');
    } else {
      await sb.from('goals').insert({ item: '지출', kind: '지출', frequency: '월', categories: [GOAL_CATEGORY],
        metric_source: 'monthly_expense', target_amount: Number(v), status: '진행중' });
      if (!quiet) enToast('예산을 저장했습니다');
    }
    if (!quiet) await fetchLive(true);
  } catch (e) {
    if (!quiet) enToast('저장하지 못했습니다 — ' + (e.message || e));
    else throw e;
  }
}

async function budgetCatSave(map, total) {
  const btn = document.getElementById('budc-save');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    const sb = await enClient();
    const { error } = await sb.from('app_settings')
      .upsert({ key: 'budget_categories', value: map, updated_at: new Date().toISOString() },
              { onConflict: 'owner_id,key' });
    if (error) throw error;
    state.budgets = map;
    /* 합계를 목표의 월 지출 상한에도 그대로 반영한다 */
    if (total !== undefined) await budgetSave(String(total), true);
    const n = Object.values(map).filter(g => budgetCatAmount(g) > 0).length;
    enToast(`분류 ${n}개 · 총액 ${enComma(total || 0)}원을 저장했습니다`);
    return true;
  } catch (e) {
    enToast('저장하지 못했습니다 — ' + (e.message || e));
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  }
}

/* 값에 따라 칩 색을 고른다 — 종류·자산분류·시장처럼 눈으로 갈라 봐야 하는 것들 */
const DBM_TINT = {
  '수입': 'c-in', '지출': 'c-out', '이체': 'c-tr', '자산': 'c-as',
  '현금 자산': 'c-cash', '투자 자산': 'c-inv', '저축 자산': 'c-sav', '연금 자산': 'c-pen',
  'US': 'c-us', 'KR': 'c-kr'
};
function dbmTintOf(v) { return DBM_TINT[String(v || '')] || ''; }

/* 칩 목록 — 네이티브 드롭다운 대신 눌러서 고른다.
   options: [{v, label, cls, on}], onPick(v) */
let DBM_POP = null;
function dbmClosePop() {
  if (!DBM_POP) return;
  DBM_POP.el.remove(); DBM_POP = null;
  document.removeEventListener('mousedown', dbmPopOutside, true);
  document.removeEventListener('keydown', dbmPopKey, true);
}
function dbmPopOutside(e) { if (DBM_POP && !DBM_POP.el.contains(e.target) && e.target !== DBM_POP.anchor) dbmClosePop(); }
function dbmPopKey(e) { if (e.key === 'Escape') { e.stopPropagation(); dbmClosePop(); } }
function dbmOpenPop(anchor, opts, onPick, o) {
  dbmClosePop();
  const cfg = o || {};
  const el = document.createElement('div');
  el.className = 'dbm-pop';
  const draw = (q) => {
    const t = (q || '').trim().toLowerCase();
    const hit = opts.filter(x => !t || (x.label + ' ' + (x.group || '')).toLowerCase().includes(t));
    let last = null;
    el.querySelector('.opts').innerHTML = hit.length ? hit.map(x => {
      const lab = (x.group && x.group !== last) ? `<div class="glab">${enEsc(x.group)}</div>` : '';
      last = x.group || last;
      return lab + `<button class="dbm-chip ${x.cls || ''} ${x.on ? 'on' : ''}" data-v="${enEsc(x.v)}">${enEsc(x.label)}</button>`;
    }).join('') : '<div class="empty">일치하는 값이 없습니다.</div>';
    el.querySelectorAll('.opts [data-v]').forEach(b => b.addEventListener('click', () => {
      onPick(b.dataset.v);
      if (!cfg.multi) dbmClosePop();
    }));
    /* 찾는 값이 없으면 그 자리에서 새로 만든다 — 창을 닫고 딴 데 가서 만들 필요 없이 */
    const mk = el.querySelector('.mk');
    if (mk) {
      const raw = (q || '').trim();
      const dup = opts.some(x => [x.v, x.label].some(s =>
        String(s == null ? '' : s).trim().toLowerCase() === raw.toLowerCase()));
      if (raw && !dup) {
        mk.hidden = false;
        mk.innerHTML = `<button type="button">＋ ‘${enEsc(raw)}’ ${enEsc(cfg.create)}</button>`;
        mk.querySelector('button').addEventListener('click', () => {
          onPick(raw);
          if (!cfg.multi) dbmClosePop();
        });
      } else { mk.hidden = true; mk.innerHTML = ''; }
    }
  };
  el.innerHTML = (cfg.search ? '<input class="q" placeholder="' + (cfg.ph || '검색') + '">' : '')
    + (cfg.create ? '<div class="mk" hidden></div>' : '') + '<div class="opts"></div>';
  document.body.appendChild(el);
  draw('');
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 12)) + 'px';
  const below = window.innerHeight - r.bottom;
  el.style.top = (below > el.offsetHeight + 12 ? r.bottom + 5 : Math.max(8, r.top - el.offsetHeight - 5)) + 'px';
  const q = el.querySelector('.q');
  if (q) {
    q.addEventListener('input', () => draw(q.value));
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const pick = el.querySelector('.opts [data-v]') || el.querySelector('.mk button');
      if (pick) pick.click();
    });
    setTimeout(() => q.focus(), 10);
  }
  DBM_POP = { el, anchor, draw };
  setTimeout(() => {
    document.addEventListener('mousedown', dbmPopOutside, true);
    document.addEventListener('keydown', dbmPopKey, true);
  }, 0);
}

/* 필터 값 읽기 — 켜고 끄는 기준을 한 곳에 모아 둔다 */
function dbmFilterVal(r, k) {
  const v = r[k];
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v == null || v === '' ? '__none' : v);
}
function dbmFilterOpts(fl, all) {
  if (!fl.dyn) return fl.opts.map(o => Array.isArray(o) ? o : [o, o]);
  const cnt = {};
  all.forEach(r => { const v = dbmFilterVal(r, fl.k); cnt[v] = (cnt[v] || 0) + 1; });
  /* 비어 있는 값은 찾으러 들어가는 게 아니라 맨 앞에 보이게 둔다 */
  const keys = Object.keys(cnt).filter(v => v !== '__none')
    .sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b, 'ko'));
  if (cnt.__none) keys.unshift('__none');
  return keys.map(v => [v, v === '__none' ? (fl.noneLabel || '(없음)') : v]);
}

async function dbmRenderPane() {
  const host = document.getElementById('dbm-body');
  if (!host) return;

  const view = dbmView();
  const agg = dbmAggSpec();
  const tabId = agg ? agg.base : dbmEffTab();
  const vkey = dbmVKey();
  const subset = DBM_SUBSET[vkey];

  try {
    await dbmLoad(tabId, false);
    /* 종목의 테마 칩은 테마 목록에서 고른다 */
    if (tabId === 'stock') await dbmLoad('theme', false).catch(() => {});
  }
  catch (e) { host.innerHTML = `<div class="en-empty">불러오지 못했습니다 — ${enEsc(e.message || e)}</div>`; return; }

  const base = DBM.rows[tabId] || [];
  const all = agg ? agg.build(base) : (subset && subset.filter ? base.filter(subset.filter) : base);
  if (agg) agg._rows = all;   /* 저장할 때 대표 줄을 다시 찾으려고 */
  let cols = agg ? agg.cols : DBM_COLS[tabId];
  if (subset && subset.cols) cols = cols.filter(c => subset.cols.includes(c.k));
  const fls = agg ? [] : (DBM_FILTER[tabId] || []);
  const fvs = DBM.filter[tabId] || (DBM.filter[tabId] = {});
  const q = DBM.q.trim().toLowerCase();

  const catText = (id) => { const c = EN.catById[id]; return c ? c.category + ' › ' + c.subcategory : ''; };

  let rows = all.filter(r => {
    for (const fl of fls) {
      const cur = fvs[fl.k] || 'all';
      if (cur !== 'all' && dbmFilterVal(r, fl.k) !== cur) return false;
    }
    if (!q) return true;
    return cols.some(c => String(
      c.t === 'tags' ? dbmTagsToText(r[c.k])
      : c.t === 'cat' ? catText(r[c.k])
      : (r[c.k] == null ? '' : r[c.k])).toLowerCase().includes(q));
  });

  /* 정렬 — 머리글을 눌러 바꾼다. 기본은 탭마다 정해둔 순서. */
  const sort = DBM.sort[vkey] || (agg ? null : DBM_SORT0[tabId]);
  if (sort) {
    const c = cols.find(x => x.k === sort.k) || {};
    const val = (r) => c.t === 'tags' ? dbmTagsToText(r[sort.k])
      : c.t === 'bool' ? (r[sort.k] ? 1 : 0)
      : c.t === 'cat' ? catText(r[sort.k])
      : (c.t === 'num' || c.num) ? (typeof r[sort.k] === 'string' ? r[sort.k] : (Number(r[sort.k]) || 0))
      : String(r[sort.k] == null ? '' : r[sort.k]);
    rows = rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      const n = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return sort.dir === 'desc' ? -n : n;
    });
  }

  const themeList = (DBM.rows.theme || []).map(x => x.name);
  const views = DBM_VIEWS[DBM.tab] || [];
  const mGroups = [...new Set((DBM.rows.merch || []).map(x => x.merchant_group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const catOpts = [...EN.cats].sort((a, b) =>
    ({ '지출': 0, '수입': 1, '이체': 2 }[a.kind] ?? 9) - ({ '지출': 0, '수입': 1, '이체': 2 }[b.kind] ?? 9) || a.sort_order - b.sort_order);

  const roCell = (c, r) => {
    if (c.chip) { const v = String(r[c.k] || ''); return `<span class="dbm-chip ${dbmTintOf(v)}">${enEsc(v || '—')}</span>`; }
    if (c.k === '_last') return r._last ? String(r._last).slice(2).replace(/-/g, '.') : '—';
    if (c.num) return enComma(Number(r[c.k]) || 0);
    return enEsc(r[c.k] == null ? '' : r[c.k]);
  };

  const tdCls = (c) => {
    const out = [];
    if (c.mid) out.push('mid');
    if (c.tone) out.push('col-' + c.tone);
    return out.length ? ` class="${out.join(' ')}"` : '';
  };
  /* 값을 고르는 칸은 칩으로 보여준다 — 사이트 다른 화면과 같은 모양 */
  const chipHtml = (c, r) => {
    const v = r[c.k];
    if (c.t === 'cat') {
      const cc = EN.catById[v];
      return `<div class="dbm-cell"><button class="dbm-chip ${cc ? dbmTintOf(cc.kind) : 'none'}" data-pick="${c.k}">${
        cc ? enEsc(cc.category + ' › ' + cc.subcategory) : '분류 없음'}</button></div>`;
    }
    if (c.t === 'sel') {
      const t = String(v || '');
      return `<div class="dbm-cell"><button class="dbm-chip ${t ? dbmTintOf(t) : 'none'}" data-pick="${c.k}">${
        enEsc(t || '—')}</button></div>`;
    }
    if (c.t === 'grp') {
      const t = String(v || '').trim();
      const em = t ? mgEmojiSet(t) : '';
      return `<div class="dbm-cell"><button class="dbm-chip ${t ? 'c-tag' : 'none'}" data-pick="${c.k}">${
        t ? enEsc((em ? em + ' ' : '') + t) : '그룹 없음'}</button></div>`;
    }
    /* tags — 여러 개, 눌러서 넣고 뺀다 */
    const list = Array.isArray(v) ? v : dbmTextToTags(v);
    return `<div class="dbm-cell">${list.slice(0, 3).map(t =>
      `<span class="dbm-chip c-tag" data-tag="${enEsc(t)}">${enEsc(t)}<i class="x">×</i></span>`).join('')}${
      list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : ''}
      <button class="dbm-chip add" data-pick="${c.k}" title="추가">＋</button></div>`;
  };
  const inner = (c, r, id) => {
    const v = r[c.k];
    if (c.t === 'bool') return `<input type="checkbox" id="${id}" data-k="${c.k}" ${v ? 'checked' : ''}>`;
    if (c.t === 'cat' || c.t === 'sel' || c.t === 'tags' || c.t === 'grp') return chipHtml(c, r);
    return `<input class="en-in" id="${id}" data-k="${c.k}"
      ${c.t === 'num' ? 'inputmode="numeric"' : ''} ${c.list ? `list="${c.list}"` : ''}
      value="${enEsc(v == null ? '' : v)}" placeholder="${enEsc(c.mid ? '—' : c.l)}">`;   /* 좁은 가운데 칸은 머리글 대신 — (잘려 보이지 않게) */
  };
  const cell = (c, r, idPrefix) => {
    const id = `${idPrefix}-${c.k}`;
    if (c.t === 'ro') return `<td class="col-meta${c.mid ? ' mid' : ''}"><div class="dbm-ro${c.num ? ' num' : ''}">${roCell(c, r)}</div></td>`;
    return `<td${tdCls(c)}>${inner(c, r, id)}</td>`;
  };

  const optsFor = (c) => {
    if (c.t === 'cat') return [{ v: '', label: '분류 없음', cls: 'none' }].concat(
      catOpts.map(o => ({ v: String(o.id), label: o.category + ' › ' + o.subcategory, cls: dbmTintOf(o.kind), group: o.kind })));
    if (c.t === 'sel') return c.o.map(o => ({ v: o, label: o || '—', cls: dbmTintOf(o) }));
    if (c.t === 'grp') return [{ v: '', label: '그룹 없음', cls: 'none' }]
      .concat(mGroups.map(g => {
        const em = mgEmojiSet(g);
        return { v: g, label: (em ? em + ' ' : '') + g, cls: 'c-tag' };
      }));
    return themeList.map(t => ({ v: t, label: t, cls: 'c-tag' }));
  };
  function bindChips(scope, c, rec, onSet) {
    const set = (val) => {
      rec[c.k] = val;
      if (onSet) onSet(val);
      const cellEl = scope.querySelector('.dbm-cell');
      if (!cellEl) return;
      cellEl.outerHTML = chipHtml(c, rec);
      bindChips(scope, c, rec, onSet);
    };
    scope.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const cur = rec[c.k];
      if (c.t === 'tags') {
        const list = Array.isArray(cur) ? cur.slice() : dbmTextToTags(cur);
        dbmOpenPop(b, optsFor(c).map(o => ({ ...o, on: list.includes(o.v) })), (v) => {
          const at = list.indexOf(v);
          if (at >= 0) list.splice(at, 1); else list.push(v);
          set(list.slice());
          if (DBM_POP) DBM_POP.draw('');
        }, { multi: true, search: true });
      } else {
        dbmOpenPop(b, optsFor(c).map(o => ({ ...o, on: String(cur == null ? '' : cur) === o.v })),
          (v) => set(c.t === 'cat' ? (Number(v) || null) : v),
          { search: c.t === 'cat' || c.t === 'grp',
            ph: c.t === 'grp' ? '그룹 찾기 · 새 그룹 이름' : '검색',
            create: c.t === 'grp' ? '새 그룹으로' : '' });
      }
    }));
    scope.querySelectorAll('[data-tag] .x').forEach(x => x.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = x.parentElement.dataset.tag;
      const list = (Array.isArray(rec[c.k]) ? rec[c.k] : dbmTextToTags(rec[c.k])).filter(t => t !== tag);
      set(list);
    }));
  }
  const draft = DBM.draft || { ...(DBM_NEW[tabId] || {}) };
  const dirtyN = Object.keys(DBM.dirty).length;
  const arrow = (k) => sort && sort.k === k ? `<b class="ar">${sort.dir === 'asc' ? '▲' : '▼'}</b>` : '';

  /* 새 항목은 표 밖에 따로 둔다 — 표 안에 빈 줄이 섞여 있으면 자료처럼 보인다 */
  const addCols = cols.filter(c => c.t !== 'ro');
  const addField = (c) => {
    const id = 'dbmn-' + c.k;
    const wide = (c.w === 'auto' || parseInt(c.w, 10) >= 150) ? ' wide' : (parseInt(c.w, 10) <= 90 ? ' narrow' : '');
    if (c.t === 'bool') return `<label>${enEsc(c.l)}<input type="checkbox" id="${id}" data-k="${c.k}" ${draft[c.k] ? 'checked' : ''}></label>`;
    if (c.t === 'cat' || c.t === 'sel' || c.t === 'tags' || c.t === 'grp')
      return `<label data-add="${c.k}">${enEsc(c.l)}${chipHtml(c, draft)}</label>`;
    return `<label>${enEsc(c.l)}<input class="en-in${wide}" id="${id}" data-k="${c.k}"
      ${c.t === 'num' ? 'inputmode="numeric"' : ''} ${c.list ? `list="${c.list}"` : ''}
      value="${enEsc(draft[c.k] == null ? '' : draft[c.k])}" placeholder="${enEsc(c.l)}"></label>`;
  };

  host.innerHTML = `
    <datalist id="dbm-themes">${themeList.map(x => `<option value="${enEsc(x)}">`).join('')}</datalist>
    <datalist id="dbm-mgroups">${mGroups.map(x => `<option value="${enEsc(x)}">`).join('')}</datalist>

    <div class="dbm-tools" id="dbm-tools">
      ${views.length ? `<div class="dbm-views" id="dbm-views">${views.map(([v, l]) =>
        `<button data-v="${v}" class="${view === v ? 'on' : ''}">${enEsc(l)}</button>`).join('')}</div>` : ''}
      <div class="dbm-bar">
        <input class="en-in grow" id="dbm-q" placeholder="검색" value="${enEsc(DBM.q)}">
        ${fls.map(fl => {
          const cur = fvs[fl.k] || 'all';
          const opts = dbmFilterOpts(fl, all);
          return `<select class="en-in dbm-fsel" data-fk="${enEsc(fl.k)}">${
            [['all', fl.l + ' 전체']].concat(opts).map(([v, l]) =>
              `<option value="${enEsc(v)}" ${cur === v ? 'selected' : ''}>${enEsc(l)} (${
                v === 'all' ? all.length : all.filter(r => dbmFilterVal(r, fl.k) === v).length})</option>`).join('')}</select>`;
        }).join('')}
        ${fls.filter(fl => fl.noneQuick && all.some(r => dbmFilterVal(r, fl.k) === '__none')).map(fl =>
          `<button class="dbm-btn ${(fvs[fl.k] || 'all') === '__none' ? 'on' : ''}" data-nonek="${enEsc(fl.k)}">${
            enEsc(fl.noneQuick)} ${all.filter(r => dbmFilterVal(r, fl.k) === '__none').length}</button>`).join('')}
        <span class="dbm-count">${rows.length}개</span>
        ${agg ? '' : `<button class="dbm-btn ${DBM.adding ? 'on' : ''}" id="dbm-newtoggle">＋ 새 항목</button>`}
        <button class="dbm-btn" id="dbm-reload">다시 읽기</button>
        <button class="dbm-btn go" id="dbm-save" ${dirtyN ? '' : 'disabled'}>변경 저장${dirtyN ? ` (${dirtyN})` : ''}</button>
      </div>

      ${DBM.adding && !agg ? `<div class="dbm-addbox">
        <div class="dbm-addhead">새 ${enEsc(dbmTab(tabId).label)} 추가<span class="sp"></span>
          <button class="dbm-btn go" id="dbm-add">추가</button>
          <button class="dbm-btn" id="dbm-addx">닫기</button></div>
        <div class="dbm-addgrid">${addCols.map(addField).join('')}</div>
      </div>` : ''}

      <table class="dbm-table head">
        <colgroup>${cols.map(c => `<col style="width:${c.w}">`).join('')}<col style="width:34px"></colgroup>
        <thead><tr>
          ${cols.map(c => `<th data-s="${c.k}" class="${c.mid ? 'mid ' : ''}${sort && sort.k === c.k ? 'on' : ''}">${enEsc(c.l)}${arrow(c.k)}</th>`).join('')}
          <th class="mid"></th>
        </tr></thead>
      </table>
    </div>

    <table class="dbm-table body">
      <colgroup>${cols.map(c => `<col style="width:${c.w}">`).join('')}<col style="width:34px"></colgroup>
      <tbody>
        ${rows.length ? rows.map((r, i) => `<tr data-id="${enEsc(r.id)}" class="${DBM.dirty[r.id] ? 'dirty' : ''}">
          ${cols.map(c => cell(c, r, 'dbm' + i)).join('')}
          <td class="mid col-meta">${
            agg ? (agg.canDel && agg.canDel(r) ? `<button class="dbm-x" data-del="${enEsc(r.id)}" title="그룹 지우기">×</button>` : '')
                : `<button class="dbm-x" data-del="${enEsc(r.id)}" title="삭제">×</button>`}</td>
        </tr>`).join('')
        : `<tr><td class="none" colspan="${cols.length + 1}">항목이 없습니다.</td></tr>`}
      </tbody>
    </table>`;

  /* 도구 + 머리글이 함께 붙어 있도록 머리글의 sticky 위치를 도구 높이만큼 내린다 */
  const tools = document.getElementById('dbm-tools');
  const setTop = () => {
    const hEl = document.querySelector('.site-header');
    const hdr = hEl ? Math.round(hEl.getBoundingClientRect().height) : 0;
    const th = tools.querySelector('thead');
    const barH = tools.querySelector('.dbm-bar').offsetHeight;
    tools.style.top = hdr + 'px';
    if (th) th.style.top = (hdr + barH + 18) + 'px';
    document.documentElement.style.setProperty('--hdr-h', hdr + 'px');
  };
  setTop();
  requestAnimationFrame(setTop);
  setTimeout(setTop, 200);
  if (!dbmRenderPane._resize) {
    dbmRenderPane._resize = true;
    window.addEventListener('resize', () => { if (document.getElementById('dbm-tools')) setTop(); });
  }

  /* 검색칸은 다시 그리지 않는다 — 한글 조합이 끊기지 않게 */
  const qEl = document.getElementById('dbm-q');
  let qt = null;
  const qSync = () => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      DBM.q = qEl.value;
      dbmRenderPane().then(() => {
        const el = document.getElementById('dbm-q');
        if (el && document.activeElement !== el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }, 220);
  };
  qEl.addEventListener('input', qSync);
  const vbar = document.getElementById('dbm-views');
  if (vbar) vbar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    DBM.view[DBM.tab] = b.dataset.v;
    DBM.dirty = {}; DBM.draft = null; DBM.adding = false; DBM.q = '';
    dbmRenderPane();
  });
  host.querySelectorAll('[data-nonek]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.nonek;
    DBM.filter[tabId][k] = (DBM.filter[tabId][k] || 'all') === '__none' ? 'all' : '__none';
    dbmRenderPane();
  }));
  host.querySelectorAll('select[data-fk]').forEach(sel => sel.addEventListener('change', () => {
    DBM.filter[tabId][sel.dataset.fk] = sel.value;
    dbmRenderPane();
  }));
  const newBtn = document.getElementById('dbm-newtoggle');
  if (newBtn) newBtn.addEventListener('click', () => { DBM.adding = !DBM.adding; dbmRenderPane(); });
  const addx = document.getElementById('dbm-addx');
  if (addx) addx.addEventListener('click', () => { DBM.adding = false; DBM.draft = null; dbmRenderPane(); });
  host.querySelectorAll('th[data-s]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.s;
    const cur = DBM.sort[vkey] || (agg ? null : DBM_SORT0[tabId]);
    DBM.sort[vkey] = (cur && cur.k === k)
      ? (cur.dir === 'asc' ? { k, dir: 'desc' } : { k, dir: 'asc' })
      : { k, dir: (cols.find(x => x.k === k) || {}).num ? 'desc' : 'asc' };
    dbmRenderPane();
  }));

  /* 표에서 바로 고친다 — 바뀐 값만 모았다가 '변경 저장'으로 한 번에 반영 */
  const orig = {};
  all.forEach(r => { orig[String(r.id)] = r; });
  const mark = (row, id, c, v) => {
    const base = orig[id] || {};
    const same = c.t === 'tags'
      ? dbmTagsToText(base[c.k]) === dbmTagsToText(v)
      : String(base[c.k] == null ? '' : base[c.k]) === String(v == null ? '' : v);
    DBM.dirty[id] = DBM.dirty[id] || {};
    if (same) { delete DBM.dirty[id][c.k]; if (!Object.keys(DBM.dirty[id]).length) delete DBM.dirty[id]; }
    else DBM.dirty[id][c.k] = v;
    row.classList.toggle('dirty', !!DBM.dirty[id]);
    const sv = document.getElementById('dbm-save');
    const n = Object.keys(DBM.dirty).length;
    sv.disabled = !n; sv.textContent = n ? `변경 저장 (${n})` : '변경 저장';
  };

  host.querySelectorAll('tbody tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    const rec = all.find(r => String(r.id) === id);
    if (!rec) return;
    const live = { ...rec };
    row.querySelectorAll('td').forEach((td, ci) => {
      const c = cols[ci];
      if (!c || c.t === 'ro') return;
      if (c.t === 'cat' || c.t === 'sel' || c.t === 'tags' || c.t === 'grp') {
        bindChips(td, c, live, (v) => mark(row, id, c, v));
        return;
      }
      const el = td.querySelector('[data-k]');
      if (!el) return;
      const read = () => c.t === 'bool' ? el.checked
        : c.t === 'num' ? (parseInt(String(el.value).replace(/[^0-9-]/g, ''), 10) || 0)
        : el.value.trim();
      el.addEventListener('change', () => mark(row, id, c, read()));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { el.blur(); dbmSave(); } });
    });
  });

  host.querySelectorAll('.dbm-x').forEach(b => b.addEventListener('click', () => dbmDelete(b.dataset.del)));
  document.getElementById('dbm-save').addEventListener('click', dbmSave);
  document.getElementById('dbm-reload').addEventListener('click', async () => {
    DBM.dirty = {}; await dbmLoad(tabId, true); dbmRender();
  });
  /* 묶어 보는 탭은 대표 줄 하나가 여러 기록을 가리킨다 */
  host.querySelectorAll('[data-add]').forEach(lab => {
    const c = cols.find(x => x.k === lab.dataset.add);
    if (c) bindChips(lab, c, draft, () => { DBM.draft = draft; });
  });
  const addBtn = document.getElementById('dbm-add');
  if (addBtn) addBtn.addEventListener('click', dbmAdd);
  host.querySelectorAll('.dbm-addgrid [data-k]').forEach(el =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) dbmAdd(); }));
}

function dbmReadDraft() {
  const tabId = dbmEffTab();
  const cols = DBM_COLS[tabId];
  const out = { ...(DBM.draft || DBM_NEW[tabId]) };
  cols.forEach(c => {
    const el = document.getElementById('dbmn-' + c.k);
    if (!el) return;   /* 칩으로 고르는 칸은 DBM.draft 에 이미 들어 있다 */
    out[c.k] = c.t === 'bool' ? el.checked
      : c.t === 'num' ? (parseInt(String(el.value).replace(/[^0-9-]/g, ''), 10) || 0)
      : el.value.trim();
  });
  return out;
}

async function dbmAdd() {
  if (DBM.busy) return;
  const tabId = dbmEffTab(), t = dbmTab(tabId);
  const rec = dbmReadDraft();
  if (tabId === 'merch') {
    const nm = String(rec.name || '').trim();
    if (!nm) { enToast('사용처 이름을 입력하세요'); return; }
    DBM.busy = true;
    try {
      const sb = await enClient();
      const { error } = await sb.from('merchants').upsert(
        { name: nm, merchant_group: String(rec.merchant_group || '').trim() || null, is_fixed: !!rec.is_fixed },
        { onConflict: 'owner_id,name' });
      if (error) throw new Error(error.message);
      DBM.draft = null; DBM.adding = false;
      await dbmLoad('merch', true);
      enToast(`'${nm}' 등록했습니다`);
      await dbmAfterChange('merch');
    } catch (e) { enToast('추가하지 못했습니다 — ' + (e.message || e)); }
    finally { DBM.busy = false; }
    return;
  }
  const keyCol = tabId === 'cat' ? 'category' : 'name';
  if (!String(rec[keyCol] || '').trim()) { enToast(`${tabId === 'cat' ? '분류' : '이름'}를 입력하세요`); return; }
  DBM.busy = true;
  try {
    const sb = await enClient();
    const { error } = await sb.from(t.table).insert([rec]);
    if (error) throw new Error(error.message);
    await dbmLoad(tabId, true);
    DBM.draft = null; DBM.adding = false;
    enToast('추가했습니다');
    await dbmAfterChange(tabId);
  } catch (e) { enToast('추가하지 못했습니다 — ' + (e.message || e)); }
  finally { DBM.busy = false; }
}

/* 사용처 저장은 다른 표와 다르다 — 이름·그룹·분류를 바꾸면 지난 기록까지 따라 바뀐다.
   그래서 무엇이 얼마나 바뀌는지 먼저 보여주고 묻는다. */
async function dbmSaveMerch() {
  const rows = DBM.rows.merch || [];
  const plan = Object.keys(DBM.dirty).map(k => ({
    rec: rows.find(r => String(r.id) === k), patch: DBM.dirty[k]
  })).filter(x => x.rec);
  if (!plan.length) return;

  const lines = plan.map(({ rec, patch }) => {
    const bits = [];
    if ('name' in patch) bits.push(`이름 → ${patch.name}`);
    if ('merchant_group' in patch) bits.push(`그룹 → ${patch.merchant_group || '없음'}`);
    if ('category_id' in patch) {
      const c = EN.catById[patch.category_id];
      bits.push(`분류 → ${c ? c.category + ' › ' + c.subcategory : '없음'}`);
    }
    if ('is_fixed' in patch) bits.push(patch.is_fixed ? '고정비로 지정' : '고정비 해제');
    return `· ${rec.name} (기록 ${enComma(rec._cnt)}건) — ${bits.join(', ')}`;
  });
  if (!confirm(`아래대로 바꿉니다. 지난 기록도 함께 바뀝니다.\n\n${lines.join('\n')}\n\n계속할까요?`)) return;

  const sb = await enClient();
  for (const { rec, patch } of plan) {
    const tx = {};
    if ('name' in patch && patch.name) tx.merchant = patch.name;
    if ('merchant_group' in patch) tx.merchant_group = patch.merchant_group || null;
    if ('category_id' in patch) tx.category_id = patch.category_id || null;
    if ('is_fixed' in patch) tx.is_fixed = !!patch.is_fixed;
    if (Object.keys(tx).length) {
      const { error } = await sb.from('transactions').update(tx).eq('merchant', rec.name);
      if (error) throw new Error(error.message);
    }
    /* 등록표에도 같은 값을 남긴다 — 기록이 없는 사용처도 자동완성에 계속 뜨도록 */
    const reg = {
      name: ('name' in patch && patch.name) ? patch.name : rec.name,
      merchant_group: ('merchant_group' in patch ? patch.merchant_group : rec.merchant_group) || null,
      is_fixed: 'is_fixed' in patch ? !!patch.is_fixed : !!rec.is_fixed
    };
    const { error: e2 } = await sb.from('merchants').upsert(reg, { onConflict: 'owner_id,name' });
    if (e2) throw new Error(e2.message);
    if ('name' in patch && patch.name && patch.name !== rec.name) {
      await sb.from('merchants').delete().eq('name', rec.name);
    }
  }
  EN.loaded = false;
  await enEnsureRefs().catch(() => {});
}

/* 묶어 보는 탭 저장 — 대표 줄 하나가 그 아래 기록을 전부 바꾼다 */
async function dbmSaveAgg(spec) {
  const rows = spec._rows || [];
  const plan = Object.keys(DBM.dirty)
    .map(k => ({ rec: rows.find(r => String(r.id) === k), patch: DBM.dirty[k] }))
    .filter(x => x.rec);
  if (!plan.length) return;
  const lines = plan.map(({ rec, patch }) => spec.line(rec, patch));
  if (!confirm(`아래대로 바꿉니다. 묶여 있는 기록이 함께 바뀝니다.\n\n${lines.join('\n')}\n\n계속할까요?`)) {
    throw new Error('__cancel');
  }
  const sb = await enClient();
  for (const { rec, patch } of plan) await spec.apply(sb, rec, patch);
}

async function dbmSave() {
  if (DBM.busy) return;
  const agg = dbmAggSpec();
  const tabId = agg ? agg.base : dbmEffTab(), t = dbmTab(tabId);
  const ids = Object.keys(DBM.dirty);
  if (!ids.length) return;
  DBM.busy = true;
  const btn = document.getElementById('dbm-save');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    const sb = await enClient();
    if (agg) await dbmSaveAgg(agg);
    else if (tabId === 'merch') await dbmSaveMerch();
    else for (const id of ids) {
      const { error } = await sb.from(t.table).update(DBM.dirty[id]).eq('id', Number(id));
      if (error) throw new Error(error.message);
    }
    DBM.dirty = {};
    if (tabId === 'cat') { EN.loaded = false; }
    await dbmLoad(tabId, true);
    enToast(`${ids.length}건 저장했습니다`);
    await dbmAfterChange(tabId);
  } catch (e) {
    if (String(e.message) !== '__cancel') enToast('저장하지 못했습니다 — ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = `변경 저장 (${ids.length})`; }
  } finally { DBM.busy = false; }
}

async function dbmDelete(id) {
  /* 묶어 보는 탭(사용처 그룹 등)은 표의 한 줄이 아니라 '묶음' 을 지운다 */
  const aggSpec = dbmAggSpec();
  if (aggSpec) {
    if (DBM.busy) return;
    const rec = (aggSpec._rows || []).find(r => String(r.id) === String(id));
    if (!rec || !aggSpec.canDel || !aggSpec.canDel(rec) || !aggSpec.del) return;
    if (!confirm(aggSpec.delText(rec))) return;
    DBM.busy = true;
    try {
      const sb = await enClient();
      await aggSpec.del(sb, rec);
      delete DBM.dirty[String(id)];
      EN.loaded = false;
      await dbmLoad(aggSpec.base, true);
      enToast('그룹을 지웠습니다');
      await dbmAfterChange(aggSpec.base);
    } catch (e) { enToast('지우지 못했습니다 — ' + (e.message || e)); }
    finally { DBM.busy = false; }
    return;
  }
  const tabId = dbmEffTab(), t = dbmTab(tabId);
  const rec = (DBM.rows[tabId] || []).find(r => String(r.id) === String(id));
  const nm = rec ? (rec.name || `${rec.category || ''} ${rec.subcategory || ''}`.trim()) : '';
  if (tabId === 'merch') {
    if (!rec) return;
    if (rec._cnt) { enToast(`'${nm}' 은(는) 기록 ${enComma(rec._cnt)}건에 쓰이고 있어 지울 수 없어요`); return; }
    if (!confirm(`'${nm}' 을(를) 사용처 목록에서 지울까요?`)) return;
    try {
      const sb = await enClient();
      const { error } = await sb.from('merchants').delete().eq('name', rec.name);
      if (error) throw new Error(error.message);
      delete DBM.dirty[id];
      EN.loaded = false;
      await dbmLoad('merch', true);
      enToast('삭제했습니다');
      await dbmAfterChange('merch');
    } catch (e) { enToast('삭제하지 못했습니다 — ' + (e.message || e)); }
    return;
  }
  if (!confirm(`'${nm}' 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
  try {
    const sb = await enClient();
    const { error } = await sb.from(t.table).delete().eq('id', Number(id));
    if (error) throw new Error(error.message);
    delete DBM.dirty[id];
    await dbmLoad(tabId, true);
    enToast('삭제했습니다');
    await dbmAfterChange(tabId);
  } catch (e) {
    enToast(/foreign key|violates/i.test(e.message || '')
      ? '이미 쓰이고 있는 항목이라 지울 수 없어요. 먼저 이 항목을 쓰는 기록을 옮기세요.'
      : '삭제하지 못했습니다 — ' + (e.message || e));
  }
}

/* 고친 목록이 화면에 바로 반영되게 한다 */
async function dbmAfterChange(tabId) {
  if (tabId === 'cat' || tabId === 'merch') { EN.loaded = false; await enEnsureRefs().catch(() => {}); }
  if (tabId === 'acct') { SNAP.accountsLoaded = false; await snapLoadAccounts(true).catch(() => {}); }
  if (tabId === 'stock' || tabId === 'theme') {
    try {
      await dbmLoad('stock', true);
      applyStocksToData(state.data, DBM.rows.stock || []);
    } catch (e) {}
  }
  renderPage();
}

/* 종목 테마(DB)를 화면 데이터에 얹는다 — 시트 값보다 DB가 우선이다. */
function applyStocksToData(data, stocks) {
  if (!data || !stocks || !stocks.length) return;
  const th = {};
  stocks.forEach(x => { if (Array.isArray(x.themes) && x.themes.length) th[x.name] = x.themes; });
  if (!Object.keys(th).length) { data.stocks = stocks; return; }
  data.investmentTags = (data.investmentTags || []).map(r => th[r.stock] ? { ...r, tags: th[r.stock] } : r);
  const map = { ...(data.stockCategoryMap || {}) };
  Object.entries(th).forEach(([n, t]) => { map[n] = t.join(', '); });
  data.stockCategoryMap = map;
  data.stocks = stocks;
}

async function fetchStocksFromDB() {
  const sb = await enClient();
  const { data, error } = await sb.from('stocks').select('id,name,ticker,market,category,themes,is_active').order('name');
  if (error) throw new Error(error.message);
  DBM.rows.stock = data || [];
  return data || [];
}
