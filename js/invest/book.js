/* ================= 투자 › 종목 : 하나의 표 =================
   보유 현황(토스, 15분마다)과 실현수익(가계부)을 한 표에 붙인다.
   볼 것은 세 가지뿐 — 얼마 들고 있나, 비중이 상한을 넘었나, 벌었나 잃었나. */

/* 매매원칙: 개별 종목 상한 15% (투자 › 매매원칙) */
const BK_CAP = 15;
const BK = { q: '', filter: 'all', theme: 'all', sort: 'value', dir: 'desc', realized: {} };

/* 테마 앞 그림 — 목록이 길어지면 글자만으로는 훑기 어렵다 */
const BK_THEME_EMOJI = {
  '우주': '🛰️', '항공우주': '🛰️', 'AI': '🤖', '인공지능': '🤖', '양자': '⚛️', '양자컴퓨팅': '⚛️',
  '반도체': '💾', '에너지': '⚡', '원자력': '☢️', '자동차': '🚗', '전기차': '🔋', '금융': '🏦',
  '건설': '🏗️', '레버리지': '🎢', '바이오': '🧬', '헬스케어': '🏥', '제약': '💊', '방산': '🛡️',
  '보안': '🔒', '클라우드': '☁️', '소프트웨어': '💻', '로봇': '🦾', '드론': '🚁', '소비재': '🛒',
  '유통': '🏬', '식품': '🥬', '통신': '📡', '미디어': '🎬', '게임': '🎮', '조선': '🚢',
  '물류': '📦', '리츠': '🏢', '배당': '💰', '인프라': '🌉', '소재': '⚗️', '광물': '⛏️',
  '농업': '🌾', '환경': '♻️', '핀테크': '💳', '전력': '🔌', '데이터센터': '🖥️'
};
function bkThemeEmoji(t) {
  if (!t) return '';
  if (BK_THEME_EMOJI[t]) return BK_THEME_EMOJI[t];
  const head = String(t).split(/[,·/]/)[0].trim();
  return BK_THEME_EMOJI[head] || '🏷️';
}
const BK_SORTDIR = { name: 'asc', theme: 'asc', value: 'desc', weight: 'desc', gain: 'desc', pl: 'desc', realized: 'desc' };

function bkRows(data) {
  const hold = ((data.toss && data.toss.holdings) || []);
  const total = hold.reduce((a, h) => a + h.value, 0) || 1;
  /* 실현수익은 가계부의 '투자 수익'(판매수익·배당·이자)을 종목별로 모은 값 */
  BK.realized = {};
  (data.ledger || []).filter(r => r.minor === '투자 수익').forEach(r => {
    let nm = r.vendor || '';
    if (nm.includes('›')) nm = nm.split('›').pop().trim();
    if (!nm) return;
    BK.realized[nm] = (BK.realized[nm] || 0) + r.amount;
  });
  const seen = {};
  const out = [];
  hold.forEach(h => {
    seen[h.name] = 1;
    out.push(bkMake(h.name, h.symbol, h, (h.value / total) * 100, data));
  });
  /* 이미 판 종목도 실현수익이 남아 있으면 표에 남긴다 — 기록이 사라지지 않게 */
  Object.keys(BK.realized).forEach(nm => {
    if (seen[nm] || nm === '예탁금' || nm === '기타') return;
    seen[nm] = 1;
    out.push(bkMake(nm, '', null, null, data));
  });
  return out;
}

/* 테마는 stocks.themes 가 원본 (설정 › 종목에서도 고친다) */
function bkThemes(name, data) {
  return String((data.stockCategoryMap || {})[name] || '')
    .split(',').map(x => x.replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean);
}
function bkAllThemes(data) {
  const set = {};
  Object.values(data.stockCategoryMap || {}).forEach(v =>
    String(v).split(',').map(x => x.replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean)
      .forEach(t => { set[t] = 1; }));
  return Object.keys(set).sort((a, b) => a.localeCompare(b, 'ko'));
}

function bkMake(name, symbol, h, weight, data) {
  return {
    name, symbol: symbol || '',
    held: !!h, value: h ? h.value : null, weight,
    pl: h ? h.pl : null, plRate: h ? h.plRate : null,
    over: weight != null ? weight - BK_CAP : null,
    themes: bkThemes(name, data),
    realized: BK.realized[name] != null ? BK.realized[name] : null
  };
}

function renderBookPage(hostId, data, d) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const t = data.toss || {};
  const s = t.summary || null;
  const fresh = s ? tossFreshness(s.asOf) : null;
  const allRows = bkRows(data);
  let rows = allRows.slice();

  const cnt = {
    all: rows.length,
    held: rows.filter(r => r.held).length,
    sold: rows.filter(r => !r.held).length,
    over: rows.filter(r => r.over != null && r.over > 0).length
  };
  const themeList = bkAllThemes(data);
  const q = BK.q.trim().toLowerCase();
  rows = rows.filter(r => {
    if (q && !(r.name.toLowerCase().includes(q) || (r.symbol || '').toLowerCase().includes(q)
      || r.themes.join(' ').toLowerCase().includes(q))) return false;
    if (BK.theme !== 'all') {
      const hit = BK.theme === '(없음)' ? !r.themes.length : r.themes.includes(BK.theme);
      if (!hit) return false;
    }
    if (BK.filter === 'held') return r.held;
    if (BK.filter === 'sold') return !r.held;
    if (BK.filter === 'over') return r.over != null && r.over > 0;
    return true;
  });
  const active = (BK.filter !== 'all' ? 1 : 0) + (BK.theme !== 'all' ? 1 : 0) + (q ? 1 : 0);

  const num = (v) => (v == null ? -Infinity : v);
  const sorts = {
    name: (a, b) => (b.held ? 1 : 0) - (a.held ? 1 : 0) || a.name.localeCompare(b.name, 'ko'),
    value: (a, b) => num(b.value) - num(a.value),
    weight: (a, b) => num(b.weight) - num(a.weight),
    theme: (a, b) => (a.themes[0] || 'ㅎㅎㅎ').localeCompare(b.themes[0] || 'ㅎㅎㅎ', 'ko') || a.name.localeCompare(b.name, 'ko'),
    gain: (a, b) => num(b.pl) - num(a.pl),
    realized: (a, b) => num(b.realized) - num(a.realized),
    pl: (a, b) => num(b.plRate) - num(a.plRate)
  };
  const base = sorts[BK.sort] || sorts.value;
  const flip = BK.dir !== (BK_SORTDIR[BK.sort] || 'desc');
  rows.sort((a, b) => (flip ? -1 : 1) * base(a, b));

  const arrow = (k) => BK.sort === k ? `<b class="ar">${BK.dir === 'asc' ? '▲' : '▼'}</b>` : '';
  const chips = [['all', '전체', cnt.all], ['held', '보유', cnt.held], ['sold', '정리한 종목', cnt.sold],
    ['over', `상한(${BK_CAP}%) 초과`, cnt.over]];
  const themeCnt = {};
  allRows.forEach(r => r.themes.forEach(t => { themeCnt[t] = (themeCnt[t] || 0) + 1; }));
  const noThemeCnt = allRows.filter(r => !r.themes.length).length;
  const pick = (id, label, cur, opts) => `
    <div class="bk-pick" data-pick="${id}">
      <button class="bk-pickbtn ${cur !== 'all' ? 'on' : ''}">
        <span class="l">${label}</span><span class="v">${cur === 'all' ? '전체' : enEsc(cur)}</span><i>▾</i>
      </button>
      <div class="lg-catdrop bk-pickdrop" hidden>
        <div class="lg-catopt ${cur === 'all' ? 'on' : ''}" data-v="all"><span class="tx">전체</span></div>
        ${opts.map(o => `<div class="lg-catopt ${cur === o[0] ? 'on' : ''}" data-v="${enEsc(o[0])}">
          <span class="tx">${o[1]}</span>${o[2] != null ? `<span class="cnt">${o[2]}</span>` : ''}</div>`).join('')}
      </div>
    </div>`;

  host.innerHTML = `
    <div class="bk-wrap">
    <div class="bk-stick">
      <div class="bk-top">
        ${s ? `<div class="bk-stats">
          <div class="bk-stat"><span class="k">합계</span><b>${formatCompactWon(s.total)}원</b></div>
          <div class="bk-stat"><span class="k">평가손익</span><b class="${s.pl >= 0 ? 'up' : 'down'}">${s.pl >= 0 ? '+' : '−'}${formatCompactWon(Math.abs(s.pl))}원</b></div>
          <div class="bk-stat"><span class="k">수익률</span><b class="${s.plRate >= 0 ? 'up' : 'down'}">${s.plRate >= 0 ? '+' : '−'}${Math.abs(s.plRate || 0).toFixed(1)}%</b></div>
        </div>` : ''}
        <div class="bk-controls">
          <div class="bk-bar">
            <input class="en-in bk-q" id="bk-q" placeholder="종목 · 티커 검색" value="${enEsc(BK.q)}">
            ${pick('theme', '테마', BK.theme, themeList.map(t => [t, bkThemeEmoji(t) + ' ' + enEsc(t), themeCnt[t] || 0])
              .concat([['(없음)', '테마 없음', noThemeCnt]]))}
            <span class="bk-spacer"></span>
            ${s ? `<span class="bk-fresh ${fresh.stale ? 'stale' : ''}" title="15분마다 자동 갱신">마지막 확인 ${s.asOf.slice(11)} · ${fresh.text}${fresh.stale ? ' ⚠️' : ''}</span>` : ''}
          </div>
          <div class="bk-bar2">
            <div class="sdb-strip">${chips.map(([k, l, n]) =>
              `<button class="sdb-chip ${BK.filter === k ? 'on' : ''}" data-fil="${k}"><span class="l">${l}</span><span class="n">${n}</span></button>`).join('')}</div>
            <span class="bk-spacer"></span>
            ${active ? `<button class="bk-clear" id="bk-clear">필터 ${active}개 해제</button>` : ''}
          </div>
        </div>
      </div>
    <div class="bk-cols" id="bk-cols">
      <span class="grp g1">
        <span class="nm" data-s="name">종목${arrow('name')}</span>
        <span class="th" data-s="theme">테마${arrow('theme')}</span>
        <span class="va" data-s="value">평가액${arrow('value')}</span>
        <span class="we" data-s="weight">비중${arrow('weight')}</span>
        <span class="gn" data-s="gain">평가손익${arrow('gain')}</span>
        <span class="pl" data-s="pl">수익률${arrow('pl')}</span>
        <span class="rz" data-s="realized">실현수익${arrow('realized')}</span>
      </span>
    </div>
    </div>
    <div class="bk-card">${rows.length ? rows.map(r => bkRowHTML(r)).join('')
      : '<div class="empty-state">조건에 맞는 종목이 없습니다.</div>'}</div>
    <div class="lg-meta"><span>${rows.length}개 종목 · 테마 칸을 누르면 테마를 고칠 수 있어요</span></div>
    </div>`;

  host.querySelectorAll('[data-fil]').forEach(b => b.addEventListener('click', () => {
    BK.filter = b.dataset.fil; renderBookPage(hostId, data, d);
  }));
  const clr = host.querySelector('#bk-clear');
  if (clr) clr.addEventListener('click', () => {
    BK.filter = 'all'; BK.theme = 'all'; BK.q = '';
    renderBookPage(hostId, data, d);
  });
  host.querySelectorAll('.bk-pick').forEach(wrap => {
    const btn = wrap.querySelector('.bk-pickbtn');
    const drop = wrap.querySelector('.bk-pickdrop');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = !drop.hidden;
      host.querySelectorAll('.bk-pickdrop').forEach(x => { x.hidden = true; });
      if (wasOpen) return;
      drop.hidden = false;
      setTimeout(() => document.addEventListener('mousedown', () => { drop.hidden = true; }, { once: true }), 0);
    });
    drop.querySelectorAll('[data-v]').forEach(el => el.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      BK[wrap.dataset.pick] = el.dataset.v;
      renderBookPage(hostId, data, d);
    }));
  });
  host.querySelectorAll('#bk-cols [data-s]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.s;
    if (BK.sort === k) BK.dir = BK.dir === 'asc' ? 'desc' : 'asc';
    else { BK.sort = k; BK.dir = BK_SORTDIR[k] || 'desc'; }
    renderBookPage(hostId, data, d);
  }));
  let t2 = null;
  const qi = host.querySelector('#bk-q');
  qi.addEventListener('input', () => {
    clearTimeout(t2);
    t2 = setTimeout(() => {
      BK.q = qi.value;
      renderBookPage(hostId, data, d);
      const n = document.getElementById('bk-q');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 250);
  });
  host.querySelectorAll('.bk-th').forEach(cell => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    bkThemeMenu(cell, hostId, data, d);
  }));
  const nav = document.getElementById('inv-subnav');
  if (nav) document.documentElement.style.setProperty('--inv-nav-h', nav.offsetHeight + 'px');
}

function bkRowHTML(r) {
  return `<div class="bk-row" data-nm="${enEsc(r.name)}">
      <span class="grp g1">
        <span class="nm ${r.held ? '' : 'off'}" title="${r.held ? '보유 중' : '정리한 종목'}">
          <i class="bk-dot ${r.held ? 'y' : 'n'}"></i><b>${enEsc(r.name)}</b>${r.symbol ? `<i class="tk">${enEsc(r.symbol)}</i>` : ''}</span>
        <span class="th bk-th" title="눌러서 테마 변경">${r.themes.length
          ? r.themes.map(t => `<i class="bk-tag">${bkThemeEmoji(t)} ${enEsc(t)}</i>`).join('')
          : '<i class="bk-tag none">＋ 테마</i>'}</span>
        <span class="va">${r.value != null ? enComma(Math.round(r.value)) : '—'}</span>
        <span class="we">${r.weight != null ? r.weight.toFixed(2) + '%' : '—'}${r.over != null && r.over > 0 ? `<b class="over" title="상한 ${BK_CAP}% 대비 +${r.over.toFixed(1)}%p">!</b>` : ''}</span>
        <span class="gn ${r.pl == null ? '' : r.pl >= 0 ? 'up' : 'down'}">${r.pl == null ? '—'
          : `${r.pl >= 0 ? '+' : '−'}${enComma(Math.abs(Math.round(r.pl)))}`}</span>
        <span class="pl ${r.plRate == null ? '' : r.plRate >= 0 ? 'up' : 'down'}">${r.plRate == null ? '—'
          : `${r.plRate >= 0 ? '+' : '−'}${Math.abs(r.plRate).toFixed(1)}%`}</span>
        <span class="rz ${r.realized == null ? '' : r.realized >= 0 ? 'up' : 'down'}">${r.realized == null ? '—'
          : `${r.realized >= 0 ? '+' : '−'}${enComma(Math.abs(Math.round(r.realized)))}`}</span>
      </span>
    </div>`;
}

/* 테마 편집 — 여러 개 붙일 수 있고, 없는 이름은 그 자리에서 만든다. stocks.themes 에 저장 */
async function bkSaveThemes(name, themes, data) {
  const sb = await haedalSupabase();
  const { error } = await sb.from('stocks').upsert({ name, themes }, { onConflict: 'owner_id,name' });
  if (error) { enToast('테마를 저장하지 못했어요'); return false; }
  if (themes.length) data.stockCategoryMap[name] = themes.join(', ');
  else delete data.stockCategoryMap[name];
  return true;
}

function bkThemeMenu(cell, hostId, data, d) {
  const name = cell.closest('.bk-row').dataset.nm;
  const cur = bkThemes(name, data).slice();
  document.querySelectorAll('.bk-thmenu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'lg-catdrop bk-thmenu';
  const paint = () => {
    menu.innerHTML = `<div class="bk-thnew"><input class="lg-ed" placeholder="새 테마 이름 + Enter" autocomplete="off"></div>`
      + bkAllThemes(data).concat(cur.filter(t => !bkAllThemes(data).includes(t))).map(t =>
        `<div class="lg-catopt ${cur.includes(t) ? 'on' : ''}" data-t="${enEsc(t)}"><span class="tx">${enEsc(t)}</span>${cur.includes(t) ? '<b class="ck">✓</b>' : ''}</div>`).join('')
      + `<div class="bk-thsave"><button data-save>적용</button></div>`;
    menu.querySelectorAll('[data-t]').forEach(el => el.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = el.dataset.t;
      const i = cur.indexOf(t);
      if (i >= 0) cur.splice(i, 1); else cur.push(t);
      paint();
    }));
    const inp = menu.querySelector('.bk-thnew input');
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const v = inp.value.trim();
      if (!v) return;
      if (!cur.includes(v)) cur.push(v);
      paint();
    });
    menu.querySelector('[data-save]').addEventListener('mousedown', async (e) => {
      e.preventDefault(); e.stopPropagation();
      menu.remove();
      if (await bkSaveThemes(name, cur, data)) renderBookPage(hostId, data, d);
    });
  };
  paint();
  cell.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', () => menu.remove(), { once: true }), 0);
}
