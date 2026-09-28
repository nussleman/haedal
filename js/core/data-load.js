/* ---------------- fetch & init ---------------- */

/* 목표: goals 테이블 중 '자산관리' 카테고리 + 구분(kind)이 있는 것만 대시보드 목표로 쓴다.
   (같은 테이블에 노션에서 온 인생 목표도 있다.) 화면 코드가 시트 시절 모양
   {시기, 구분, 항목, …, __row} 을 기대하므로 그 모양으로 맞추고, __row 에는 goals.id 를 넣는다. */
const GOAL_CATEGORY = '자산관리';
function goalRowToSheetShape(r) {
  const amt = r.target_ratio != null ? `${r.target_ratio}%` : (r.target_amount != null ? String(r.target_amount) : '');
  return {
    '시기': r.period || '', '구분': r.kind || '', '항목': r.item || '', '기간': r.frequency || '',
    '금액 or 비율': amt, '상태': r.status || '', '달성한 날': r.achieved_on || '', '메모': r.note || '',
    __row: r.id, __metric: r.metric_source || null
  };
}
async function fetchGoalsFromDB() {
  const sb = await enClient();
  const { data, error } = await sb.from('goals')
    .select('id,period,kind,item,frequency,target_amount,target_ratio,status,achieved_on,note,metric_source,position')
    .contains('categories', [GOAL_CATEGORY]).not('kind', 'is', null)
    .order('position', { ascending: true, nullsFirst: false }).order('id');
  if (error) throw new Error(error.message);
  return (data || []).map(goalRowToSheetShape);
}

/* 벤치마크 지수(S&P500 월말 종가). index_prices 는 공용 시장 데이터 테이블이다. */
async function fetchIndexFromDB() {
  const sb = await enClient();
  const { data, error } = await sb.from('index_prices').select('month,close')
    .eq('symbol', 'SPX').order('month');
  if (error) throw new Error(error.message);
  const out = {};
  (data || []).forEach(r => { out[String(r.month).slice(0, 7)] = Number(r.close); });
  return out;
}
/* 지난달 종가가 아직 없으면 index-refresh 함수로 채운다 (하루 한 번만 시도). 결과는 다음 로딩부터 반영. */
function maybeRefreshIndex(prices) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const need = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  if (prices && prices[need]) return;
  const key = 'haedal:index-refresh-tried';
  const today = now.toISOString().slice(0, 10);
  try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch (e) {}
  enClient().then(sb => sb.functions.invoke('index-refresh', { body: {} })).catch(() => {});
}

/* 가계부 원장은 Supabase 가 유일한 원본이다.
   전체 내역에서 고치거나 새로 넣은 것이 흐름·현황·목표까지 그대로 흘러가야 하므로,
   시트의 가계부(D) 탭은 더 이상 읽지 않는다. (자산·목표·지수는 아직 시트) */
/* 1000행씩 끊어 주는 PostgREST 를 전부 읽는다.
   첫 쪽을 받으면서 전체 개수를 알아내고, 나머지 쪽은 한꺼번에(병렬로) 요청한다. */
async function sbFetchAll(table, columns, orderCol, label) {
  const sb = await enClient();
  const PAGE = 1000;
  const q = (from) => sb.from(table).select(columns, from === 0 ? { count: 'exact' } : undefined)
    .order(orderCol, { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
  const first = await q(0);
  if (first.error) throw new Error(label + '를 불러오지 못했습니다: ' + first.error.message);
  const rows = [...(first.data || [])];
  const total = typeof first.count === 'number' ? first.count : rows.length;
  if (rows.length >= PAGE && total > PAGE) {
    const rest = [];
    for (let from = PAGE; from < total; from += PAGE) rest.push(q(from));
    for (const r of await Promise.all(rest)) {
      if (r.error) throw new Error(label + '를 불러오지 못했습니다: ' + r.error.message);
      rows.push(...(r.data || []));
    }
  }
  return rows;
}

async function fetchLedgerFromDB() {
  const raw = await sbFetchAll('v_transactions',
    'id,category_id,date,kind,category,subcategory,emoji_category,amount,merchant_group,merchant,note,good_bad,company_paid,is_fixed',
    'date', '가계부');
  /* 시트 파서가 내주던 모양 그대로 맞춘다 — 아래 집계 코드를 건드리지 않기 위해서 */
  return raw.map(r => {
    const d = String(r.date).split('-');
    const amount = Number(r.amount) || 0;
    return {
      id: r.id,                       /* transactions.id — 화면에서 바로 고치기 위해 들고 다닌다 */
      catId: r.category_id,
      dayKey: String(r.date),
      date: `${d[0]}. ${Number(d[1])}. ${Number(d[2])}`,
      major: r.kind, minor: r.category, item: r.subcategory,
      amount,
      vendor: r.merchant || r.merchant_group || '',
      merch: r.merchant || '',        /* 편집용 원본 (vendor 는 표시용 대체값이 섞인다) */
      mgroup: r.merchant_group || '',
      emoji: r.emoji_category || '',
      memo: r.note || '',
      fixed: !!r.is_fixed,
      good: r.good_bad === 'Good',
      regret: r.good_bad === 'Bad',
      refund: r.company_paid ? amount : 0
    };
  }).filter(r => r.amount);
}

/* 자산 스냅샷도 Supabase 가 유일한 원본이다.
   현황 › 자산 스냅샷에서 넣은 값이 자산·흐름·목표 화면까지 그대로 흘러가야 하므로,
   시트의 '자산 스냅샷' 탭은 DB를 못 읽었을 때의 예비로만 남긴다. */
async function fetchAssetsFromDB() {
  const raw = await sbFetchAll('asset_snapshots', 'id,month,asset_class,account,amount', 'month', '자산 스냅샷');
  /* 시트 파서가 내주던 모양 그대로 맞춘다 — 아래 집계 코드를 건드리지 않기 위해서 */
  return raw.map(snapRowToAssetRow);
}

async function fetchAllTabsAndMerge() {
  /* 토스 탭 조회는 실패해도 대시보드 전체를 막지 않도록 병렬로 따로 돌린다. */
  /* 토스·종목_팩트(아직 시트)는 느려서 여기서 기다리지 않는다 — loadSheetExtras() 가 나중에 채운다 */
  const [dbLedger, dbAssets, dbStocks, dbGoals, dbIndex] = await Promise.all([
    fetchLedgerFromDB().catch((e) => { console.error('ledger from DB failed', e); return null; }),
    fetchAssetsFromDB().catch((e) => { console.error('assets from DB failed', e); return null; }),
    fetchStocksFromDB().catch((e) => { console.error('stocks from DB failed', e); return null; }),
    fetchGoalsFromDB().catch((e) => { console.error('goals from DB failed', e); return null; }),
    fetchIndexFromDB().catch((e) => { console.error('index from DB failed', e); return null; })
  ]);
  const warn = [];
  if (!dbGoals) warn.push('목표');
  if (!dbIndex) warn.push('지수');

  /* 가계부·자산 스냅샷은 Supabase 가 유일한 원본 — 못 읽으면 예비 없이 실패로 알린다 */
  if (!dbLedger) throw new Error('가계부를 불러오지 못했습니다');
  if (!dbAssets || !dbAssets.length) throw new Error('자산 스냅샷을 불러오지 못했습니다');
  const assetRows = dbAssets, ledger = dbLedger;
  const ledgerSource = 'db';
  const assetSource = 'db';
  const goals = dbGoals || [];
  const indexPrices = dbIndex || {};
  /* 종목 → 테마 문자열. stocks.themes 가 원본 (예전 시트 '분류' 탭의 주식_카테고리를 옮겨 둠) */
  const stockCategoryMap = {};
  (dbStocks || []).forEach(x => {
    const th = Array.isArray(x.themes) ? x.themes.filter(Boolean) : [];
    if (th.length) stockCategoryMap[x.name] = th.join(', ');
    else if (x.category) stockCategoryMap[x.name] = x.category;
  });
  const investmentTags = [];   /* 시트 '분류' 탭의 종목별 판매수익 표 — 비어 있어 폐기 */

  // 가계부(M) 피벗 탭은 폐기되어, 정상 파싱된 가계부(D) 원장에서 월별 카테고리 요약을 직접 집계한다.
  const pivot = buildPivotFromLedger(ledger);

  if (!pivot) throw new Error('가계부 원장에서 카테고리 요약을 계산하지 못했습니다');

  const data = {
    months: pivot.months, incomeTotal: pivot.incomeTotal, expenseTotal: pivot.expenseTotal,
    expenseCategories: pivot.expenseCategories, incomeCategories: pivot.incomeCategories, transferCategories: pivot.transferCategories,
    assetRows, assetSource, ledger, ledgerSource, investmentTags, goals, stockCategoryMap, stocks: dbStocks || [],
    toss: (state.data && state.data.toss) || null,
    stockFacts: (state.data && state.data.stockFacts) || {},
    indexPrices,
    indexSource: 'db'
  };
  if (warn.length) data._partialWarning = `${warn.join('·')} 데이터를 못 불러왔지만, 나머지로 표시 중이에요.`;
  maybeRefreshIndex(indexPrices);
  return data;
}

function applySuggestedGoals(data) {
  const d0 = computeDerived(data);
  const sug = computeSuggestedGoals(data, d0);
  state.goals.savingsRateTarget = sug.suggestedSavings;
  state.goals.emergencyFundTarget = sug.suggestedEmergency;
}

/* 마지막으로 받은 데이터를 이 브라우저에 보관해 두고, 다음에 열 때 먼저 보여준다.
   로그아웃하면 지운다. 개인 기기 전용 — 공용 PC 에서는 로그아웃할 것. */
const DATA_CACHE_KEY = 'haedal:data-cache:v1';
function cacheSave(data, uid) {
  try {
    const { _partialWarning, ...rest } = data;
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ uid, at: Date.now(), data: rest }));
  } catch (e) { /* 용량 초과 등 — 캐시 없이 동작 */ }
}
function cacheLoad(uid) {
  try {
    const c = JSON.parse(localStorage.getItem(DATA_CACHE_KEY) || 'null');
    if (c && c.uid === uid && c.data && Array.isArray(c.data.ledger)) return c;
  } catch (e) {}
  return null;
}
function cacheClear() { try { localStorage.removeItem(DATA_CACHE_KEY); } catch (e) {} }

/* 토스·종목_팩트는 따로 받아서, 오면 끼워 넣고 투자 화면이면 다시 그린다 */
async function loadSheetExtras() {
  const [toss, facts] = await Promise.all([fetchTossData().catch(() => null), fetchStockFacts().catch(() => null)]);
  if (!state.data) return;
  if (toss) state.data.toss = toss;
  if (facts) state.data.stockFacts = facts;
  if (state.page === 'invest') renderPage();
  cacheSave(state.data, state.uid);
}

async function fetchLive(manual, ready) {
  setSyncState('loading');
  try {
    const [data] = await Promise.all([fetchAllTabsAndMerge(), ready]);
    state.data = data;
    state.source = 'live';
    state.lastError = data._partialWarning || null;
    state.lastSync = new Date();
    applySuggestedGoals(state.data);
    renderAll();
    cacheSave(state.data, state.uid);
    loadSheetExtras();
  } catch (e) {
    console.error('live sync failed', e);
    state.lastError = e.message || String(e);
    renderAll();
  }
}

async function init(uid) {
  state.uid = uid || null;
  routeApply();          /* 주소에 적힌 화면이 있으면 거기서 시작한다 */
  renderShell();
  /* 설정·예산·스터디 카드와 가계부·자산을 동시에 받는다 (예전엔 설정을 다 받은 뒤에야 가계부를 요청했다) */
  const ready = Promise.all([loadBudgets(), loadSettings(), sdxLoad(true)]);
  const cached = cacheLoad(state.uid);
  if (cached) {
    ready.then(() => {
      if (state.source === 'live') return;          /* 그새 새 데이터가 먼저 왔으면 그대로 둔다 */
      state.data = cached.data;
      state.source = 'cache';
      applySuggestedGoals(state.data);
      renderAll();
    });
  } else {
    renderAll();                 /* 데이터 오기 전: '불러오는 중' 자리만 */
  }
  /* 분류 표(순서·이름)는 화면 곳곳에서 쓰므로 미리 받아 둔다 */
  enEnsureRefs().catch(() => {});
  fetchLive(false, ready);
}
