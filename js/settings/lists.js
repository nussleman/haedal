/* ================= 목록 관리 (데이터베이스 기본 항목) =================
   분류 · 사용처 · 계좌 · 종목 · 테마를 한 곳에서 보고 고친다.
   전부 Supabase 가 원본이고, 여기서 고치면 기록·화면 전체가 같은 값을 쓴다. */

const DBM_TABS = [
  { id: 'cat',   label: '분류',   table: 'categories', desc: '수입 · 지출 · 이체 · 자산의 분류와 세부분류' },
  { id: 'merch', label: '사용처', table: 'merchants',  desc: '가계부에 쓰는 사용처와 그룹' },
  { id: 'acct',  label: '계좌',   table: 'accounts',   desc: '자산 스냅샷에 적는 계좌 목록' },
  { id: 'stock', label: '종목',   table: 'stocks',     desc: '주식 종목과 테마 (투자 화면의 테마 집계가 이 값을 씁니다)' },
  { id: 'theme', label: '테마',   table: 'themes',     desc: '종목에 붙이는 테마', hidden: true }
];

/* 하위 메뉴 안의 탭 — 같은 자료를 층별로 묶어서 관리한다.
   'all' 은 있는 그대로의 표, 나머지는 그 층만 모아 놓고 고치면 아래가 따라 바뀐다. */
const DBM_VIEWS = {
  cat:   [['all', '전체'], ['kind', '종류'], ['group', '분류'], ['sub', '세부분류']],
  merch: [['all', '전체'], ['group', '사용처 그룹'], ['fixed', '고정비']],
  stock: [['all', '전체'], ['theme', '테마']]
};
/* 다른 표를 그대로 빌려 쓰는 탭 */
const DBM_DELEGATE = { 'stock:theme': 'theme' };
/* 같은 표를 열만 줄이거나 행만 걸러 보여 주는 탭 */
const DBM_SUBSET = {
  'cat:sub': { cols: ['kind', 'category', 'emoji_category', 'subcategory', 'sort_order', 'is_active'] },
  'merch:fixed': { filter: (r) => !!r.is_fixed }
};

const DBM_COLS = {
  cat: [
    { k: 'kind', l: '종류', t: 'sel', o: ['수입', '지출', '이체', '자산'], w: '96px', tint: 'self' },
    { k: 'emoji_kind', l: '이모지', t: 'txt', w: '64px', mid: true, tone: 'meta' },
    { k: 'category', l: '분류', t: 'txt', w: 'auto', tone: 'key' },
    { k: 'emoji_category', l: '이모지', t: 'txt', w: '64px', mid: true, tone: 'meta' },
    { k: 'subcategory', l: '세부분류', t: 'txt', w: 'auto', tone: 'key' },
    { k: 'sort_order', l: '순서', t: 'num', w: '70px', tone: 'meta' },
    { k: 'is_active', l: '사용', t: 'bool', w: '56px', mid: true, tone: 'meta' }
  ],
  merch: [
    { k: 'merchant_group', l: '그룹', t: 'grp', w: '170px' },
    { k: 'name', l: '사용처', t: 'txt', w: 'auto', tone: 'key' },
    { k: 'is_fixed', l: '고정비', t: 'bool', w: '68px', mid: true, tone: 'meta' },
    { k: 'category_id', l: '주로 쓰는 분류', t: 'cat', w: '236px', tint: 'cat' },
    { k: '_cnt', l: '건수', t: 'ro', num: true, w: '74px' },
    { k: '_sum', l: '합계', t: 'ro', num: true, w: '112px' },
    { k: '_last', l: '최근', t: 'ro', num: true, w: '86px' }
  ],
  acct: [
    { k: 'name', l: '계좌', t: 'txt', w: 'auto', tone: 'key' },
    { k: 'asset_class', l: '분류', t: 'sel', o: ['현금 자산', '투자 자산', '저축 자산', '연금 자산'], w: '128px', tint: 'self' },
    { k: 'sort_order', l: '순서', t: 'num', w: '70px', tone: 'meta' },
    { k: 'note', l: '메모', t: 'txt', w: 'auto' },
    { k: 'is_active', l: '사용', t: 'bool', w: '56px', mid: true, tone: 'meta' }
  ],
  stock: [
    { k: 'name', l: '종목', t: 'txt', w: 'auto', tone: 'key' },
    { k: 'ticker', l: '티커', t: 'txt', w: '96px', tone: 'meta' },
    { k: 'market', l: '시장', t: 'sel', o: ['', 'US', 'KR'], w: '82px', tint: 'self' },
    { k: 'themes', l: '테마', t: 'tags', w: 'auto' },
    { k: 'category', l: '유형', t: 'txt', w: '110px' },
    { k: 'is_active', l: '보유', t: 'bool', w: '56px', mid: true, tone: 'meta' }
  ],
  theme: [
    { k: 'name', l: '테마', t: 'txt', w: '180px', tone: 'key' },
    { k: 'note', l: '메모', t: 'txt', w: 'auto' },
    { k: 'sort_order', l: '순서', t: 'num', w: '70px', tone: 'meta' }
  ]
};

/* 탭마다 두는 빠른 필터 — 화면 생김새는 모두 같고 항목만 다르다.
   dyn:true 면 지금 목록에 실제로 들어 있는 값에서 항목을 만든다. */
const DBM_FILTER = {
  cat: [{ k: 'kind', l: '종류', opts: ['수입', '지출', '이체', '자산'] }],
  merch: [
    { k: 'merchant_group', l: '그룹', dyn: true, noneLabel: '그룹 없음', noneQuick: '그룹 없음' },
    { k: 'is_fixed', l: '고정비', opts: [['1', '📌 고정비'], ['0', '일반']] }
  ],
  acct: [{ k: 'asset_class', l: '분류', opts: ['현금 자산', '투자 자산', '저축 자산', '연금 자산'] }],
  stock: [{ k: 'market', l: '시장', opts: ['US', 'KR'] }]
};

const DBM_ORDER = {
  cat: [['kind', true], ['sort_order', true]],
  acct: [['sort_order', true]],
  stock: [['name', true]],
  theme: [['sort_order', true]]
};
const DBM_NEW = {
  cat: { kind: '지출', emoji_kind: '', category: '', emoji_category: '', subcategory: '', sort_order: 0, is_active: true },
  merch: { merchant_group: '', name: '', is_fixed: false, category_id: null },
  acct: { name: '', asset_class: '현금 자산', sort_order: 0, note: '', is_active: true },
  stock: { name: '', ticker: '', market: '', themes: [], category: '', is_active: true },
  theme: { name: '', note: '', sort_order: 0 }
};
/* 기본 정렬 — 사용처는 많이 쓴 순이 제일 쓸모 있다 */
const DBM_SORT0 = { merch: { k: '_cnt', dir: 'desc' } };

/* ---- 층을 묶어 보는 탭 ----
   한 줄이 여러 기록을 대표한다. 여기서 이름·이모지를 고치면 그 아래가 전부 따라 바뀐다. */
const KIND_ORDER = ['수입', '지출', '이체', '자산'];
const DBM_AGG = {
  'cat:kind': {
    base: 'cat', noAdd: true, noDel: true,
    cols: [
      { k: 'kind', l: '종류', t: 'ro', chip: true, w: '120px' },
      { k: 'emoji_kind', l: '이모지', t: 'txt', w: '90px', mid: true },
      { k: '_cats', l: '분류', t: 'ro', num: true, w: '90px' },
      { k: '_subs', l: '세부분류', t: 'ro', num: true, w: '100px' }
    ],
    build(all) {
      const map = {};
      KIND_ORDER.forEach(k => { map[k] = { id: k, kind: k, emoji_kind: '', _c: {}, _subs: 0 }; });
      all.forEach(r => {
        const m = map[r.kind] || (map[r.kind] = { id: r.kind, kind: r.kind, emoji_kind: '', _c: {}, _subs: 0 });
        if (!m.emoji_kind && r.emoji_kind) m.emoji_kind = r.emoji_kind;
        m._c[r.category] = 1; m._subs++;
      });
      return KIND_ORDER.concat(Object.keys(map).filter(k => !KIND_ORDER.includes(k)))
        .map(k => map[k]).filter(Boolean)
        .map(m => ({ ...m, _cats: Object.keys(m._c).length }));
    },
    line: (rec, patch) => `· ${rec.kind} (세부분류 ${enComma(rec._subs)}개) — 이모지 → ${patch.emoji_kind || '없음'}`,
    async apply(sb, rec, patch) {
      const { error } = await sb.from('categories')
        .update({ emoji_kind: patch.emoji_kind || null }).eq('kind', rec.kind);
      if (error) throw new Error(error.message);
    }
  },
  'cat:group': {
    base: 'cat', noAdd: true, noDel: true,
    cols: [
      { k: 'kind', l: '종류', t: 'ro', chip: true, w: '110px' },
      { k: 'emoji_category', l: '이모지', t: 'txt', w: '84px', mid: true },
      { k: 'category', l: '분류', t: 'txt', w: 'auto' },
      { k: '_subs', l: '세부분류', t: 'ro', num: true, w: '100px' },
      { k: '_order', l: '순서', t: 'ro', num: true, w: '80px' }
    ],
    build(all) {
      const map = {};
      all.forEach(r => {
        const key = r.kind + '\u0000' + r.category;
        const m = map[key] || (map[key] = {
          id: key, kind: r.kind, category: r.category, emoji_category: '', _subs: 0, _order: r.sort_order
        });
        if (!m.emoji_category && r.emoji_category) m.emoji_category = r.emoji_category;
        m._subs++;
        if (r.sort_order < m._order) m._order = r.sort_order;
      });
      return Object.values(map).sort((a, b) => (a._order - b._order) || a.category.localeCompare(b.category, 'ko'));
    },
    line: (rec, patch) => `· ${rec.kind} › ${rec.category} (세부분류 ${enComma(rec._subs)}개) — ${
      [('category' in patch) ? `이름 → ${patch.category}` : '',
       ('emoji_category' in patch) ? `이모지 → ${patch.emoji_category || '없음'}` : ''].filter(Boolean).join(', ')}`,
    async apply(sb, rec, patch) {
      const up = {};
      if ('category' in patch) up.category = patch.category;
      if ('emoji_category' in patch) up.emoji_category = patch.emoji_category || null;
      if (!Object.keys(up).length) return;
      const { error } = await sb.from('categories').update(up)
        .eq('kind', rec.kind).eq('category', rec.category);
      if (error) throw new Error(error.message);
    }
  },
  'merch:group': {
    base: 'merch', noAdd: true, noDel: true,
    cols: [
      { k: 'emoji', l: '이모지', t: 'txt', w: '84px', mid: true },
      { k: 'merchant_group', l: '그룹', t: 'txt', w: '220px' },
      { k: '_n', l: '사용처', t: 'ro', num: true, w: '90px' },
      { k: '_cnt', l: '기록', t: 'ro', num: true, w: '90px' },
      { k: '_sum', l: '합계', t: 'ro', num: true, w: '130px' }
    ],
    build(all) {
      const map = {};
      all.forEach(r => {
        const g = r.merchant_group || '';
        const m = map[g] || (map[g] = {
          id: g || '__none', merchant_group: g, emoji: g ? mgEmojiSet(g) : '',
          _raw: g, _n: 0, _cnt: 0, _sum: 0
        });
        m._n++; m._cnt += (r._cnt || 0); m._sum += (r._sum || 0);
      });
      return Object.values(map).sort((a, b) => b._n - a._n || String(a._raw).localeCompare(String(b._raw), 'ko'));
    },
    line: (rec, patch) => `· ${rec._raw || '(그룹 없음)'} (사용처 ${enComma(rec._n)}곳 · 기록 ${enComma(rec._cnt)}건) — ${
      [('merchant_group' in patch) ? `이름 → ${patch.merchant_group || '없음'}` : '',
       ('emoji' in patch) ? `이모지 → ${patch.emoji || '없음'}` : ''].filter(Boolean).join(', ')}`,
    /* 그룹은 따로 저장된 표가 아니라 사용처에 붙은 이름표다 —
       지운다는 건 그 이름표를 떼는 것이고, 사용처와 기록은 그대로 남는다. */
    canDel: (rec) => !!rec._raw,
    delText: (rec) => `‘${rec._raw}’ 그룹을 지웁니다.\n\n`
      + `· 사용처 ${enComma(rec._n)}곳이 '그룹 없음'이 됩니다\n`
      + `· 기록 ${enComma(rec._cnt)}건에 붙어 있던 그룹 표시가 사라집니다\n`
      + `· 사용처와 기록 자체는 그대로 남습니다\n\n계속할까요?`,
    async del(sb, rec) { return this.apply(sb, rec, { merchant_group: '' }); },
    async apply(sb, rec, patch) {
      const old = rec._raw;
      const rename = ('merchant_group' in patch);
      const to = rename ? (String(patch.merchant_group || '').trim() || null) : (old || null);

      if (rename) {
        let q1 = sb.from('merchants').update({ merchant_group: to });
        let q2 = sb.from('transactions').update({ merchant_group: to });
        q1 = old ? q1.eq('merchant_group', old) : q1.is('merchant_group', null);
        q2 = old ? q2.eq('merchant_group', old) : q2.is('merchant_group', null);
        const a = await q1; if (a.error) throw new Error(a.error.message);
        const b = await q2; if (b.error) throw new Error(b.error.message);
        /* 이름을 바꾸면 그림표도 따라간다. 그룹을 없애면 그림표에서도 지운다. */
        if (old) {
          if (to) {
            const mv = await sb.from('merchant_groups').update({ name: to }).eq('name', old).select('id');
            /* 기본 그림만 쓰고 있던 그룹이라 지정표에 줄이 없으면, 새 이름으로 하나 만들어 준다 */
            if (!mv.error && !(mv.data || []).length) {
              const keep = mgEmojiSet(old);
              if (keep) await sb.from('merchant_groups').upsert({ name: to, emoji: keep }, { onConflict: 'owner_id,name' });
            }
          } else await sb.from('merchant_groups').delete().eq('name', old);
        }
      }
      if ('emoji' in patch && to) {
        const em = String(patch.emoji == null ? '' : patch.emoji).trim();
        const { error } = await sb.from('merchant_groups')
          .upsert({ name: to, emoji: em }, { onConflict: 'owner_id,name' });
        if (error) throw new Error(error.message);
      }
    }
  }
};

const DBM = { tab: 'cat', view: {}, rows: {}, q: '', filter: {}, sort: {}, dirty: {}, draft: null, busy: false, adding: false };

const dbmView = (t) => DBM.view[t || DBM.tab] || 'all';
const dbmVKey = () => DBM.tab + ':' + dbmView();
const dbmAggSpec = () => DBM_AGG[dbmVKey()] || null;
/* 실제로 다루는 표 — '종목 › 테마' 처럼 다른 표를 빌려 쓰는 탭이 있다 */
const dbmEffTab = () => DBM_DELEGATE[dbmVKey()] || DBM.tab;

const dbmTab = (id) => DBM_TABS.find(t => t.id === id);
const dbmTagsToText = (v) => Array.isArray(v) ? v.join(', ') : (v || '');
const dbmTextToTags = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

/* 목록 관리는 다른 메뉴와 똑같이 메뉴바 아래 한 화면을 쓴다 (모달 아님) */
function dbmOpen(tab) {
  if (tab) DBM.tab = tab;
  window.scrollTo({ top: 0 });
  goTo('set', 'cat');
}

async function dbmLoad(tabId, force) {
  if (DBM.rows[tabId] && !force) return;
  /* 사용처는 등록표(merchants)와 실제 기록에서 함께 모은다 — 등록만 해 둔 곳도,
     기록에만 있는 곳도 한 표에서 다뤄야 하니까. 건수·합계·최근은 계산 값이다. */
  if (tabId === 'merch') {
    await enEnsureRefs();
    if (force) MG.rows = null;
    const list = await mgLoad();
    DBM.rows.merch = list.map(r => ({
      id: r.name, name: r.name, merchant_group: r.group || '',
      is_fixed: !!r.fixed, category_id: r.catId || null,
      _cnt: r.cnt, _sum: Math.round(r.sum), _last: r.last || '',
      _gap: r.fixedGap, _mixedCat: r.mixedCat, _mixedGroup: r.mixedGroup
    }));
    return;
  }
  const t = dbmTab(tabId);
  const sb = await enClient();
  let q = sb.from(t.table).select('*');
  (DBM_ORDER[tabId] || []).forEach(([col, asc]) => { q = q.order(col, { ascending: asc }); });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  DBM.rows[tabId] = data || [];
}

/* 목록은 예전엔 자기만의 좌측 레일을 갖고 있었다. 이제 사이트 레일이 그 일을 하므로
   레일 없이 본문만 그린다 — 화면 전체가 같은 틀을 쓰게 된다. */
function dbmRender(host) {
  const el = host || document.getElementById('page-content');
  if (!el) return;
  enSyncHeaderOffset();
  el.innerHTML = `<div class="dbm-page">
      <div class="dbm-main">
        <div class="dbm-body" id="dbm-body"><div class="en-empty">불러오는 중…</div></div>
      </div>
    </div>`;
  dbmRenderPane();
}

/* 좌측 메뉴에서 고른 탭으로 목록을 연다. '고정비 지정'은 사용처 탭의 고정비 보기다. */
function dbmRenderFor(host, sub) {
  const map = { cat: ['cat', null], merch: ['merch', null], acct: ['acct', null],
                stock: ['stock', null], fixedm: ['merch', 'fixed'] };
  const [tab, view] = map[sub] || ['cat', null];
  if (DBM.tab !== tab || (view && dbmView(tab) !== view)) {
    DBM.q = ''; DBM.draft = null; DBM.dirty = {}; DBM.adding = false;
  }
  DBM.tab = tab;
  if (view) DBM.view[tab] = view;
  dbmRender(host);
}
