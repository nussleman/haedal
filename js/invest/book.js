/* ================= 자산 > 투자 > 종목 : 하나의 표 =================
   보유 현황(토스)과 판정(스터디 카드)을 한 표에 붙인다.
   한 줄에 다 못 넣는 것은 그 종목을 더블클릭했을 때 아래로 펼쳐진다. */

const BK = { q: '', filter: 'all', theme: 'all', grade: 'all', verdict: 'all', watch: 'all',
  sort: 'value', dir: 'desc', open: null, realized: {} };

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
const BK_SORTDIR = {
  name: 'asc', theme: 'asc', value: 'desc', weight: 'desc', watch: 'asc',
  gain: 'desc', pl: 'desc', realized: 'desc', grade: 'desc', score: 'desc', verdict: 'asc', check: 'asc'
};

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
  const facts = data.stockFacts || {};
  const seen = {};
  const out = [];

  hold.forEach(h => {
    seen[h.name] = 1;
    out.push(bkMake(h.name, h.symbol, h, (h.value / total) * 100, data));
  });
  SDX.rows.forEach(r => {
    if (seen[r.name]) return;
    seen[r.name] = 1;
    out.push(bkMake(r.name, r.ticker || '', null, null, data));
  });
  Object.keys(facts).forEach(nm => {
    if (seen[nm]) return;
    seen[nm] = 1;
    out.push(bkMake(nm, '', null, null, data));
  });
  /* 이미 판 종목도 실현수익이 남아 있으면 표에 남긴다 — 기록이 사라지지 않게 */
  Object.keys(BK.realized).forEach(nm => {
    if (seen[nm] || nm === '예탁금' || nm === '기타') return;
    seen[nm] = 1;
    out.push(bkMake(nm, '', null, null, data));
  });
  return out;
}

/* 테마는 스터디 카드에 저장한 값이 우선, 없으면 시트의 주식_카테고리를 쓴다 */
function bkThemes(name, card, data) {
  const own = card && Array.isArray(card.themes) ? card.themes : [];
  if (own.length) return own;
  return String((data.stockCategoryMap || {})[name] || '')
    .split(',').map(x => x.replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean);
}
function bkAllThemes(data) {
  const set = {};
  SDX.rows.forEach(r => (Array.isArray(r.themes) ? r.themes : []).forEach(t => { set[t] = 1; }));
  Object.values(data.stockCategoryMap || {}).forEach(v =>
    String(v).split(',').map(x => x.replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean)
      .forEach(t => { set[t] = 1; }));
  return Object.keys(set).sort((a, b) => a.localeCompare(b, 'ko'));
}

function bkMake(name, symbol, h, weight, data) {
  const card = sdxRow(name);
  const fact = (data.stockFacts || {})[name] || null;
  const sc = sdxScore(card);
  const g0 = sdxG0State(card);
  const gr = sdxGrade(sc.score);
  const graded = g0 !== 'fail' && sc.answered > 0;
  const capSrc = (card && card.grade_override)
    ? ((SD_GRADE.find(x => x[2] === card.grade_override) || [])[3] || null)
    : (graded ? gr[3] : null);
  const cap = capSrc && capSrc !== '—' ? Number(String(capSrc).split('~')[0].replace('%', '')) : null;
  return {
    name, symbol: symbol || (card && card.ticker) || '',
    held: !!h, value: h ? h.value : null, weight,
    pl: h ? h.pl : null, plRate: h ? h.plRate : null,
    country: h ? h.country : null,
    card, fact,
    score: sc.score, answered: sc.answered, full: sc.full,
    g0, grade: (card && card.grade_override) || (g0 === 'fail' ? '탈락' : (graded ? gr[2] : null)),
    capText: (card && card.grade_override)
      ? ((SD_GRADE.find(x => x[2] === card.grade_override) || [])[3] || null)
      : (g0 === 'fail' ? '0%' : (graded ? gr[3] : null)),
    over: (weight != null && cap != null) ? weight - cap : null,
    type: (card && card.type) || (fact && fact.type) || null,
    verdict: card && card.verdict || null,
    check: card && card.check_date || null,
    watch: (card && card.watch_level) || null,
    watchFlag: sdxWatchFlag(card),
    themes: bkThemes(name, card, data),
    realized: BK.realized[name] != null ? BK.realized[name] : null
  };
}

function bkStatus(r) {
  const man = r.card && r.card.grade_override;
  if (man) return { k: man === '매수 금지' ? 'fail' : 'pass', label: man };
  if (r.g0 === 'fail') return { k: 'fail', label: '탈락' };
  if (!r.answered) return { k: 'none', label: '미검토' };
  if (!r.full) return { k: 'wip', label: '검토 중' };
  return { k: r.grade === '매수 금지' ? 'fail' : 'pass', label: r.grade };
}

function renderBookPage(hostId, data, d) {
  const host = document.getElementById(hostId);
  if (!host) return;
  if (!SDX.loaded) {
    host.innerHTML = '<div class="empty-state">판정 카드를 불러오는 중…</div>';
    sdxLoad().then(() => renderBookPage(hostId, data, d));
    return;
  }

  const t = data.toss || {};
  const s = t.summary || null;
  const fresh = s ? tossFreshness(s.asOf) : null;
  let rows = bkRows(data);

  const cnt = {
    all: rows.length,
    held: rows.filter(r => r.held).length,
    todo: rows.filter(r => r.held && !r.answered && r.g0 !== 'fail').length,
    act: rows.filter(r => r.verdict && r.verdict !== 'hold').length,
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
    if (BK.grade !== 'all') {
      const g = r.g0 === 'fail' ? '탈락' : (r.grade || '미검토');
      if (g !== BK.grade) return false;
    }
    if (BK.verdict !== 'all') {
      if (BK.verdict === '(미정)') { if (r.verdict) return false; }
      else if (r.verdict !== BK.verdict) return false;
    }
    if (BK.watch !== 'all') {
      if (BK.watch === '(없음)') { if (r.watch) return false; }
      else if (r.watch !== BK.watch) return false;
    }
    if (BK.filter === 'held') return r.held;
    if (BK.filter === 'none') return !r.held;
    if (BK.filter === 'todo') return r.held && !r.answered && r.g0 !== 'fail';
    if (BK.filter === 'act') return !!r.verdict && r.verdict !== 'hold';
    if (BK.filter === 'over') return r.over != null && r.over > 0;
    if (BK.filter === 'due') return !!r.check && String(r.check) <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    return true;
  });
  const active = (BK.filter !== 'all' ? 1 : 0) + (BK.theme !== 'all' ? 1 : 0)
    + (BK.grade !== 'all' ? 1 : 0) + (BK.verdict !== 'all' ? 1 : 0)
    + (BK.watch !== 'all' ? 1 : 0) + (q ? 1 : 0);

  const gradeRank = { '우량': 5, '성장': 4, '턴어라운드': 3, '옵션형': 2, '매수 금지': 1, '탈락': 0 };
  const vRank = {}; SD_VERDICT.forEach(([v], i) => { vRank[v] = i; });
  const num = (v) => (v == null ? -Infinity : v);
  const sorts = {
    name: (a, b) => (b.held ? 1 : 0) - (a.held ? 1 : 0) || a.name.localeCompare(b.name, 'ko'),
    value: (a, b) => num(b.value) - num(a.value),
    weight: (a, b) => num(b.weight) - num(a.weight),
    theme: (a, b) => (a.themes[0] || 'ㅎㅎㅎ').localeCompare(b.themes[0] || 'ㅎㅎㅎ', 'ko') || a.name.localeCompare(b.name, 'ko'),
    gain: (a, b) => num(b.pl) - num(a.pl),
    realized: (a, b) => num(b.realized) - num(a.realized),
    pl: (a, b) => num(b.plRate) - num(a.plRate),
    grade: (a, b) => (gradeRank[b.grade] ?? -1) - (gradeRank[a.grade] ?? -1) || num(b.value) - num(a.value),
    score: (a, b) => (b.answered ? b.score : -1) - (a.answered ? a.score : -1),
    verdict: (a, b) => (a.verdict ? vRank[a.verdict] : 99) - (b.verdict ? vRank[b.verdict] : 99) || num(b.value) - num(a.value),
    check: (a, b) => String(a.check || '9999').localeCompare(String(b.check || '9999')),
    /* 같은 레벨 안에서는 확인해야 할 날짜가 가까운 것이 위로 */
    watch: (a, b) => String(a.watch || 'Z').localeCompare(String(b.watch || 'Z'))
      || String((a.card && a.card.watch_date) || '9999').localeCompare(String((b.card && b.card.watch_date) || '9999'))
      || num(b.value) - num(a.value)
  };
  const base = sorts[BK.sort] || sorts.value;
  const flip = BK.dir !== (BK_SORTDIR[BK.sort] || 'desc');
  rows.sort((a, b) => (flip ? -1 : 1) * base(a, b));

  const arrow = (k) => BK.sort === k ? `<b class="ar">${BK.dir === 'asc' ? '▲' : '▼'}</b>` : '';
  const dueCut = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const allRows = bkRows(data);
  cnt.none = allRows.filter(r => !r.held).length;
  cnt.due = allRows.filter(r => r.check && String(r.check) <= dueCut).length;
  const chips = [['all', '전체', cnt.all], ['held', '보유', cnt.held], ['none', '미보유', cnt.none],
    ['todo', '미검토 보유', cnt.todo], ['act', '조치 필요', cnt.act],
    ['over', '상한 초과', cnt.over], ['due', '확인 임박', cnt.due]];
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
  const wCnt = sdxWatchCount();
  const themeCnt = {};
  allRows.forEach(r => r.themes.forEach(t => { themeCnt[t] = (themeCnt[t] || 0) + 1; }));
  const noThemeCnt = allRows.filter(r => !r.themes.length).length;

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
            ${pick('grade', '등급', BK.grade, ['우량', '성장', '턴어라운드', '옵션형', '매수 금지', '탈락', '미검토'].map(g => [g, g, null]))}
            ${pick('verdict', '결론', BK.verdict, SD_VERDICT.map(v => [v[0], v[1], null]).concat([['(미정)', '미정', null]]))}
            ${pick('watch', '관심', BK.watch, SD_WATCH.map(w => [w[0], `${w[0]} ${w[1]}`, wCnt[w[0]]])
              .concat([['(없음)', '관심 아님', allRows.length - wCnt.L1 - wCnt.L2 - wCnt.L3]]))}
            <span class="bk-spacer"></span>
            <span class="sd-saved" id="sd-saved">${enEsc(SDX.saved)}</span>
            ${s ? `<span class="bk-fresh ${fresh.stale ? 'stale' : ''}" title="15분마다 자동 갱신">마지막 확인 ${s.asOf.slice(11)} · ${fresh.text}${fresh.stale ? ' ⚠️' : ''}</span>` : ''}
          </div>
          <div class="bk-bar2">
            <div class="sdb-strip">${chips.map(([k, l, n]) =>
              `<button class="sdb-chip ${BK.filter === k ? 'on' : ''}" data-fil="${k}"><span class="l">${l}</span><span class="n">${n}</span></button>`).join('')}</div>
            <span class="bk-spacer"></span>
            ${active ? `<button class="bk-clear" id="bk-clear">필터 ${active}개 해제</button>` : ''}
            <button class="bk-add" id="bk-new">+ 종목 추가</button>
          </div>
        </div>
      </div>
      ${bkWatchAlert(allRows, wCnt)}
      <div class="bk-groups">
        <span class="g1"><i>기본</i></span><span class="g2"><i>판단</i></span><span class="g3"><i>히스토리</i></span>
      </div>
    <div class="bk-cols" id="bk-cols">
      <span class="grp g1">
        <span class="nm" data-s="name">종목${arrow('name')}</span>
        <span class="th" data-s="theme">테마${arrow('theme')}</span>
        <span class="va" data-s="value">평가액${arrow('value')}</span>
        <span class="we" data-s="weight">비중${arrow('weight')}</span>
        <span class="gn" data-s="gain">평가손익${arrow('gain')}</span>
        <span class="pl" data-s="pl">수익률${arrow('pl')}</span>
      </span>
      <span class="grp g2">
        <span class="wl" data-s="watch">관심${arrow('watch')}</span>
        <span class="gd" data-s="grade">등급${arrow('grade')}</span>
        <span class="sc" data-s="score">점수${arrow('score')}</span>
        <span class="vd" data-s="verdict">결론${arrow('verdict')}</span>
        <span class="ck" data-s="check">확인일${arrow('check')}</span>
      </span>
      <span class="grp g3">
        <span class="rz" data-s="realized">실현수익${arrow('realized')}</span>
      </span>
    </div>
    </div>
    <div class="bk-card">${rows.length ? rows.map(r => bkRowHTML(r)).join('')
      : '<div class="empty-state">조건에 맞는 종목이 없습니다.</div>'}</div>
    <div class="lg-meta"><span>${rows.length}개 종목 · 줄을 더블클릭하면 판정 카드가 열립니다</span></div>
    </div>
    ${BK.open ? `<div class="bk-modal" id="bk-modal">
      <div class="bk-sheet" role="dialog" aria-modal="true">
        <button class="bk-x" id="bk-close" aria-label="닫기">×</button>
        <div class="bk-sheetbody" id="bk-detail">${sdxCard(
          (() => { const it = rows.find(x => x.name === BK.open) || bkRows(data).find(x => x.name === BK.open);
            return it ? { name: it.name, symbol: it.symbol, weight: it.weight, plRate: it.plRate, row: it.card } : null; })()
        )}</div>
      </div>
    </div>` : ''}`;

  host.querySelectorAll('[data-fil]').forEach(b => b.addEventListener('click', () => {
    BK.filter = b.dataset.fil; renderBookPage(hostId, data, d);
  }));
  const clr = host.querySelector('#bk-clear');
  if (clr) clr.addEventListener('click', () => {
    BK.filter = 'all'; BK.theme = 'all'; BK.grade = 'all'; BK.verdict = 'all'; BK.watch = 'all'; BK.q = '';
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
  host.querySelector('#bk-new').addEventListener('click', async () => {
    const nm = (prompt('검토할 종목 이름 — 예: 크레인 NXT') || '').trim();
    if (!nm) return;
    if (!sdxRow(nm)) await sdxPatch(nm, {});
    BK.open = nm;
    renderBookPage(hostId, data, d);
  });

  host.querySelectorAll('.bk-row').forEach(row => {
    row.addEventListener('dblclick', () => {
      BK.open = BK.open === row.dataset.nm ? null : row.dataset.nm;
      renderBookPage(hostId, data, d);
    });
  });
  /* 결론은 표에서 바로 바꾼다 — 가장 자주 손대는 칸이라 상세까지 안 들어가게 */
  host.querySelectorAll('.bk-vd').forEach(cell => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    bkVerdictMenu(cell, hostId, data, d);
  }));
  host.querySelectorAll('.bk-th').forEach(cell => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    bkThemeMenu(cell, hostId, data, d);
  }));
  host.querySelectorAll('.bk-gdc').forEach(cell => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    bkGradeMenu(cell, hostId, data, d);
  }));
  host.querySelectorAll('.bk-ckc').forEach(cell => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    bkCheckEdit(cell, hostId, data, d);
  }));
  host.querySelectorAll('.bk-wlc').forEach(cell => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    bkWatchMenu(cell, hostId, data, d);
  }));
  /* 하위 탭도 같이 고정되도록 높이를 재서 넘겨준다 */
  const nav = document.getElementById('inv-subnav');
  if (nav) document.documentElement.style.setProperty('--inv-nav-h', nav.offsetHeight + 'px');
  if (BK.open) {
    bkBindDetail(host, hostId, data, d);
    const close = () => { BK.open = null; renderBookPage(hostId, data, d); };
    host.querySelector('#bk-close').addEventListener('click', close);
    host.querySelector('#bk-modal').addEventListener('mousedown', (e) => {
      if (e.target.id === 'bk-modal') close();
    });
    if (!BK.escBound) {
      BK.escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && BK.open && document.getElementById('bk-modal')) {
          BK.open = null;
          const h = document.getElementById('panel-book');
          if (h) renderBookPage('panel-book', state.data, state.derived || {});
        }
      });
    }
  }
}

function bkRowHTML(r) {
  const st = bkStatus(r);
  const vd = r.verdict ? (SD_VERDICT.find(v => v[0] === r.verdict) || [])[1] : null;
  return `<div class="bk-row" data-nm="${enEsc(r.name)}">
      <span class="grp g1">
        <span class="nm ${r.held ? '' : 'off'}" title="${r.held ? '보유 중' : '보유하지 않음'}">
          <i class="bk-dot ${r.held ? 'y' : 'n'}"></i><b>${enEsc(r.name)}</b>${r.symbol ? `<i class="tk">${enEsc(r.symbol)}</i>` : ''}</span>
        <span class="th bk-th" title="클릭해서 테마 변경">${r.themes.length
          ? r.themes.map(t => `<i class="bk-tag">${bkThemeEmoji(t)} ${enEsc(t)}</i>`).join('')
          : '<i class="bk-tag none">＋ 테마</i>'}</span>
        <span class="va">${r.value != null ? enComma(Math.round(r.value)) : '—'}</span>
        <span class="we">${r.weight != null ? r.weight.toFixed(2) + '%' : '—'}${r.over != null && r.over > 0 ? `<b class="over" title="상한 대비 +${r.over.toFixed(1)}%p">!</b>` : ''}</span>
        <span class="gn ${r.pl == null ? '' : r.pl >= 0 ? 'up' : 'down'}">${r.pl == null ? '—'
          : `${r.pl >= 0 ? '+' : '−'}${enComma(Math.abs(Math.round(r.pl)))}`}</span>
        <span class="pl ${r.plRate == null ? '' : r.plRate >= 0 ? 'up' : 'down'}">${r.plRate == null ? '—'
          : `${r.plRate >= 0 ? '+' : '−'}${Math.abs(r.plRate).toFixed(1)}%`}</span>
      </span>
      <span class="grp g2">
        <span class="wl bk-wlc" title="클릭해서 관심 레벨 변경">${r.watch
          ? `<i class="bk-wl w-${r.watch}${r.watchFlag ? ' f-' + r.watchFlag.k : ''}" title="${r.watchFlag ? enEsc(r.watchFlag.msg) : ''}">${r.watch}</i>`
          : '<i class="bk-wl none">—</i>'}</span>
        <span class="gd bk-gdc" title="클릭해서 등급 지정">
          <i class="bk-gd ${st.k}">${st.label}${r.card && r.card.grade_override ? '<b class="man">*</b>' : ''}</i>${r.capText ? `<em>${r.capText}</em>` : ''}</span>
        <span class="sc">${r.answered ? `${r.score}<em>/14</em>` : '—'}</span>
        <span class="vd bk-vd" title="클릭해서 결론 변경">${vd ? `<i class="bk-vdi v-${r.verdict}">${vd}</i>` : '<i class="bk-vdi none">—</i>'}</span>
        <span class="ck bk-ckc" title="클릭해서 확인일 지정">${r.check ? String(r.check).slice(2).replace(/-/g, '.') : '—'}</span>
      </span>
      <span class="grp g3">
        <span class="rz ${r.realized == null ? '' : r.realized >= 0 ? 'up' : 'down'}">${r.realized == null ? '—'
          : `${r.realized >= 0 ? '+' : '−'}${enComma(Math.abs(Math.round(r.realized)))}`}</span>
      </span>
    </div>`;
}

function bkBindDetail(host, hostId, data, d) {
  SDX.sel = BK.open;
  const detail = host.querySelector('#bk-detail');
  if (!detail) return;
  detail.addEventListener('dblclick', (e) => e.stopPropagation());
  sdxBind(detail);
  /* 카드 안에서 게이트를 바꾸면 표의 등급·점수도 같이 움직여야 한다 */
  const repaint = () => renderBookPage(hostId, data, d);
  detail.querySelectorAll('[data-g],[data-g1],[data-vd],[data-wl]').forEach(b =>
    b.addEventListener('click', () => setTimeout(repaint, 260)));
  detail.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => { BK.open = null; setTimeout(repaint, 260); }));
}

/* 테마 편집 — 여러 개 붙일 수 있고, 없는 이름은 그 자리에서 만든다.
   시트의 주식_카테고리는 읽기만 하고, 여기서 고친 값은 스터디 카드에 남는다. */
function bkThemeMenu(cell, hostId, data, d) {
  const name = cell.closest('.bk-row').dataset.nm;
  const card = sdxRow(name);
  const cur = bkThemes(name, card, data).slice();
  document.querySelectorAll('.bk-vmenu,.bk-thmenu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'lg-catdrop bk-thmenu';
  const paint = () => {
    menu.innerHTML = `<div class="bk-thnew"><input class="lg-ed" placeholder="새 테마 이름 + Enter" autocomplete="off"></div>`
      + bkAllThemes(data).map(t =>
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
      await sdxPatch(name, { themes: cur });
      renderBookPage(hostId, data, d);
    });
  };
  paint();
  cell.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', () => menu.remove(), { once: true }), 0);
}

/* 등급은 점수에서 자동으로 나오지만, 내가 알고 있는 게 있으면 손으로 덮어쓴다.
   덮어쓴 등급에는 * 를 붙여 자동값과 구분한다. */
function bkGradeMenu(cell, hostId, data, d) {
  const name = cell.closest('.bk-row').dataset.nm;
  const cur = (sdxRow(name) || {}).grade_override || null;
  document.querySelectorAll('.bk-vmenu,.bk-thmenu,.bk-gmenu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'lg-catdrop bk-vmenu bk-gmenu';
  menu.innerHTML = `<div class="lg-catopt ${!cur ? 'on' : ''}" data-v=""><span class="tx dim">자동 (점수 기준)</span></div>`
    + SD_GRADE.map(g => `<div class="lg-catopt ${cur === g[2] ? 'on' : ''}" data-v="${g[2]}">
        <span class="tx">${g[2]}</span><span class="cnt">${g[3]}</span></div>`).join('');
  cell.appendChild(menu);
  menu.querySelectorAll('[data-v]').forEach(el => el.addEventListener('mousedown', async (e) => {
    e.preventDefault(); e.stopPropagation();
    menu.remove();
    await sdxPatch(name, { grade_override: el.dataset.v || null });
    renderBookPage(hostId, data, d);
  }));
  setTimeout(() => document.addEventListener('mousedown', () => menu.remove(), { once: true }), 0);
}

function bkCheckEdit(cell, hostId, data, d) {
  if (cell.querySelector('input')) return;
  const name = cell.closest('.bk-row').dataset.nm;
  const prev = cell.innerHTML;
  const inp = document.createElement('input');
  inp.type = 'date';
  inp.className = 'lg-ed bk-ckin';
  inp.value = (sdxRow(name) || {}).check_date || '';
  cell.innerHTML = '';
  cell.appendChild(inp);
  inp.focus();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (!commit) { cell.innerHTML = prev; return; }
    await sdxPatch(name, { check_date: inp.value || null });
    renderBookPage(hostId, data, d);
  };
  inp.addEventListener('change', () => finish(true));
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
}

/* 정원 초과와 기한 경과는 카드 안에만 두면 안 본다. 표 위에 한 줄로 세운다. */
function bkWatchAlert(rows, wCnt) {
  const msg = [];
  SD_WATCH.forEach(([v, l, q]) => {
    if (q && wCnt[v] > q) msg.push(`${v} 정원 초과 ${wCnt[v]}/${q}`);
  });
  const bad = rows.filter(r => r.watchFlag && r.watchFlag.k === 'bad').length;
  const due = rows.filter(r => r.watchFlag && r.watchFlag.k === 'due').length;
  if (due) msg.push(`트리거 도달 ${due}건`);
  if (bad) msg.push(`기한 경과 · 방치 ${bad}건`);
  if (!msg.length) return '';
  return `<div class="bk-wlalert"><b>관심 목록</b>${msg.join(' · ')}
    <em>내릴 것을 먼저 정하지 않으면 새로 올릴 수 없다</em></div>`;
}

/* 표에서 바로 레벨을 바꾼다. 정원이 찬 레벨은 눌리지 않는다 —
   경고만 띄우고 통과시키면 정원은 없는 것과 같다. */
function bkWatchMenu(cell, hostId, data, d) {
  const name = cell.closest('.bk-row').dataset.nm;
  const card = sdxRow(name);
  const cur = (card || {}).watch_level || null;
  const blocked = sdxG0State(card) === 'fail';
  const cnt = sdxWatchCount();
  document.querySelectorAll('.bk-vmenu,.bk-thmenu,.bk-wlmenu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'lg-catdrop bk-wlmenu';
  if (blocked) {
    menu.innerHTML = '<div class="lg-catopt"><span class="tx dim">게이트 0 탈락 — 올릴 수 없다</span></div>';
  } else {
    menu.innerHTML = SD_WATCH.map(([v, l, q]) => {
      const c = cnt[v], full = q && c >= q && cur !== v;
      return `<div class="lg-catopt ${cur === v ? 'on' : ''} ${full ? 'off' : ''}" ${full ? '' : `data-v="${v}"`}>
        <span class="tx">${v} ${l}</span><span class="cnt">${c}${q ? '/' + q : ''}</span></div>`;
    }).join('') + '<div class="lg-catopt" data-v=""><span class="tx dim">관심 아님</span></div>';
  }
  cell.appendChild(menu);
  const close = () => menu.remove();
  menu.querySelectorAll('[data-v]').forEach(el => el.addEventListener('mousedown', async (e) => {
    e.preventDefault(); e.stopPropagation();
    close();
    await sdxSetWatch(name, el.dataset.v || null);
    renderBookPage(hostId, data, d);
  }));
  setTimeout(() => document.addEventListener('mousedown', close, { once: true }), 0);
}

function bkVerdictMenu(cell, hostId, data, d) {
  const name = cell.closest('.bk-row').dataset.nm;
  const cur = (sdxRow(name) || {}).verdict || null;
  document.querySelectorAll('.bk-vmenu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'lg-catdrop bk-vmenu';
  menu.innerHTML = SD_VERDICT.map(([v, l]) =>
    `<div class="lg-catopt ${cur === v ? 'on' : ''}" data-v="${v}"><span class="tx">${l}</span></div>`).join('')
    + '<div class="lg-catopt" data-v=""><span class="tx dim">지우기</span></div>';
  cell.appendChild(menu);
  const close = () => menu.remove();
  menu.querySelectorAll('[data-v]').forEach(el => el.addEventListener('mousedown', async (e) => {
    e.preventDefault(); e.stopPropagation();
    close();
    await sdxPatch(name, { verdict: el.dataset.v || null });
    renderBookPage(hostId, data, d);
  }));
  setTimeout(() => document.addEventListener('mousedown', close, { once: true }), 0);
}

/* 요약 하위 4개 화면. "한 차트로 보면 좋은 것끼리"를 화면마다 기본값으로 켜 둔다. */
