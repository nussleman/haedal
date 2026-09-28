/* ================= 현황 › 자산 스냅샷 =================
   달마다 계좌 잔액을 한 번 적어 두는 자리. Supabase asset_snapshots 가 유일한 원본이고,
   여기서 저장하면 자산·흐름·목표 화면이 같은 값을 그대로 쓴다. (시트는 더 이상 쓰지 않는다) */

const SNAP = { rows: [], accounts: [], accountsLoaded: false, month: null, uid: null, loaded: false, saving: false, extra: [], err: null };

/* 계좌 목록은 accounts 테이블이 원본이다 (목록 관리 › 계좌에서 고친다).
   과거 스냅샷에만 있고 목록에는 없는 계좌도 빠뜨리지 않고 함께 보여준다. */
async function snapLoadAccounts(force) {
  if (SNAP.accountsLoaded && !force) return;
  const sb = await enClient();
  const { data, error } = await sb.from('accounts')
    .select('id,name,asset_class,sort_order,is_active').order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  SNAP.accounts = data || [];
  SNAP.accountsLoaded = true;
}

function snapNowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function snapMonthKeyOf(v) { return String(v || '').slice(0, 7); }          /* '2026-09-01' → '2026-09' */
function snapMonthLabel(k) { return `${String(k).slice(2, 4)}년 ${String(k).slice(5, 7)}월`; }
function snapMonthShift(k, n) {
  const y = parseInt(k.slice(0, 4), 10), m = parseInt(k.slice(5, 7), 10);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/* DB 행 → 화면 곳곳이 쓰는 자산 행 모양 ('26년 09월') */
function snapRowToAssetRow(r) {
  return {
    date: snapMonthLabel(snapMonthKeyOf(r.month)),
    category: r.asset_class,
    account: r.account,
    amount: Number(r.amount) || 0
  };
}

async function snapLoad(force) {
  if (SNAP.loaded && !force) return;
  const sb = await enClient();
  if (!SNAP.uid) {
    const { data } = await sb.auth.getUser();
    SNAP.uid = data && data.user ? data.user.id : null;
  }
  const { data, error } = await sb.from('asset_snapshots')
    .select('id,month,asset_class,account,amount')
    .order('month', { ascending: true });
  if (error) throw new Error(error.message);
  SNAP.rows = (data || []).map(r => ({
    id: r.id, mk: snapMonthKeyOf(r.month), cls: r.asset_class,
    account: r.account, amount: Number(r.amount) || 0
  }));
  SNAP.loaded = true;
}

/* 입력 칸의 계좌 목록 = accounts 테이블 + 과거 스냅샷에 남아 있는 계좌 */
function snapAccounts() {
  const map = new Map();
  SNAP.accounts.filter(a => a.is_active !== false).forEach((a, i) =>
    map.set(a.name, { cls: a.asset_class, so: a.sort_order == null ? (i + 1) * 10 : a.sort_order }));
  SNAP.rows.forEach(r => { if (!map.has(r.account)) map.set(r.account, { cls: r.cls, so: 9000 }); });
  SNAP.extra.forEach(e => { if (!map.has(e.account)) map.set(e.account, { cls: e.cls, so: 9500 }); });
  const list = [...map.entries()].map(([account, v]) => ({ account, cls: v.cls, so: v.so }));
  const rank = (c) => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };
  return list.sort((a, b) => rank(a.cls) - rank(b.cls) || a.so - b.so || a.account.localeCompare(b.account, 'ko'));
}
function snapMonthRows(mk) {
  const m = {};
  SNAP.rows.forEach(r => { if (r.mk === mk) m[r.account] = r; });
  return m;
}
function snapMonthTotal(mk) {
  return SNAP.rows.reduce((a, r) => a + (r.mk === mk ? r.amount : 0), 0);
}
function snapMonthList() {
  const set = new Set(SNAP.rows.map(r => r.mk));
  set.add(snapNowMonth());
  if (SNAP.month) set.add(SNAP.month);
  return [...set].sort().reverse();
}
const snapNum = (v) => {
  const t = String(v == null ? '' : v).replace(/[^0-9-]/g, '');
  if (t === '' || t === '-') return null;
  const n = parseInt(t, 10);
  return isNaN(n) ? null : n;
};

/* 화면 전체가 같은 값을 보게 맞춘다 — 저장 직후 자산·흐름·목표가 바로 따라온다. */
function snapPushToDashboard() {
  if (!state.data) return;
  state.data = { ...state.data, assetRows: SNAP.rows.map(r => snapRowToAssetRow({
    month: r.mk + '-01', asset_class: r.cls, account: r.account, amount: r.amount
  })), assetSource: 'db' };
  applySuggestedGoals(state.data);
}
