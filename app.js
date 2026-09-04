/* =========================================================
   MY 자산 통장 — 대시보드 로직
   데이터 원본: 사용자 가계부 Google Sheet (실시간 CSV 동기화)
   ========================================================= */

const SPREADSHEET_ID = '1tT7p4brwpOZyGojQfxyUb1WHNiDXn-6uH4I7B4oUMPA';
const GID_LEDGER_D = '1990449957';   // 가계부(D) - raw daily transaction ledger
const GID_ASSETS = '1458451221';     // 자산 스냅샷 - monthly asset balances
const GID_GOALS = '384376571';       // 목표 - goals / roadmap
const GID_CLASSIFY = '701072426';    // 분류 - 사용처/종목 분류표 (주식_카테고리 매핑 포함)
const GID_INDEX = '772931342';       // 지수_S&P500 - 월별 지수 종가 (벤치마크 반사실 계산용)
const TAB_GIDS = [GID_LEDGER_D, GID_ASSETS, GID_GOALS, GID_CLASSIFY, GID_INDEX];

/* 지수_S&P500 탭을 못 불러왔을 때만 쓰는 씨앗 데이터.
   시트가 단일 소스이고, 이 상수는 오프라인/권한오류 시 패널이 빈 화면이
   되지 않게 하는 백업일 뿐이다. 시트에 값이 있으면 항상 시트가 이긴다. */
const INDEX_SEED = {
  '2023-03': 3968.56, '2023-04': 4121.47, '2023-05': 4146.17, '2023-06': 4345.37,
  '2023-07': 4508.08, '2023-08': 4426.24, '2023-09': 4409.10, '2023-10': 4258.98,
  '2023-11': 4460.06, '2023-12': 4685.05, '2024-01': 4804.49, '2024-02': 5011.96,
  '2024-03': 5170.57, '2024-04': 5095.46, '2024-05': 5235.23, '2024-06': 5415.14,
  '2024-07': 5542.89, '2024-08': 5502.17, '2024-09': 5626.12, '2024-10': 5792.32,
  '2024-11': 5929.92, '2024-12': 6010.91, '2025-01': 5979.52, '2025-02': 6038.69,
  '2025-03': 5683.98, '2025-04': 5369.50, '2025-05': 5810.92, '2025-06': 6029.95,
  '2025-07': 6296.50, '2025-08': 6408.95, '2025-09': 6584.02, '2025-10': 6735.69,
  '2025-11': 6740.89, '2025-12': 6853.03, '2026-01': 6929.12, '2026-02': 6893.81,
  '2026-03': 6654.42, '2026-04': 6957.01, '2026-05': 7412.55, '2026-06': 7450.03,
  '2026-07': 7513.50, '2026-08': 7851.30
};
const csvUrlFor = (gid) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
/* 토스 탭은 수집기가 자동 생성하므로 gid를 미리 알 수 없다.
   gviz는 sheet= 파라미터로 탭 이름 조회도 지원하니 그걸 쓴다. */
const csvUrlForSheet = (name) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
const TOSS_TABS = { summary: '토스_계좌요약', holdings: '토스_보유종목', daily: '토스_일별' };
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${GID_LEDGER_D}#gid=${GID_LEDGER_D}`;

const CAT_COLORS = {
  '현금 자산': '#c9a227',
  '투자 자산': '#4c8c6b',
  '저축 자산': '#c2749b',
  '연금 자산': '#7b7fd0'
};
const CAT_ORDER = ['현금 자산', '투자 자산', '저축 자산', '연금 자산'];
const ACCT_BOARD_ORDER = ['현금 자산', '투자 자산', '연금 자산', '저축 자산'];
const DISPLAY_GROUP = { '현금 자산': '현금', '투자 자산': '투자', '저축 자산': '저축', '연금 자산': '저축' };
const DISPLAY_COLORS = { '현금': '#c9a227', '투자': '#4c8c6b', '저축': '#c2749b' };
const DISPLAY_ORDER = ['현금', '투자', '저축'];
const CAT_PIE_PALETTE_INV = ['#c9a227', '#4c8c6b', '#c2749b', '#7b7fd0', '#c1483f', '#e0c766', '#39a8bd', '#5b8fc7', '#9b7fc2', '#d9884f'];

const state = {
  data: null,
  source: null,        // 'live' | 'snapshot'
  lastSync: null,
  lastError: null,
  goals: { savingsRateTarget: 40, emergencyFundTarget: 5000000 },
  range: 12,
  page: 'home',
  homeMainSub: 'main',    // 홈 하위 탭: main 하나뿐
  ledgerFilter: { q: '', major: 'all', page: 1, pageSize: 50 },
  charts: {},
  budgets: {},          // 카테고리별 사용자 지정 예산 (window.storage에 저장)
  budgetsLoaded: false,
  incomeRange: 12,
  incomeTotalMode: 'category',
  incomeCatFilter: 'all',
  incomePeriod: 'month',
  expenseRange: 12,
  expenseTrendMode: 'total',
  expenseAvgExpenseRange: 12,
  expenseAvgFixedRange: 12,
  fixedMonthKey: null,
  fixedRange: 12,
  vendorRange: 12,
  invRange: 12,
  benchRange: 'all',
  benchMode: 'amount',   // 'amount' | 'excess'
  invPeriod: 'month',
  invSeries: { balance: true, contrib: true, transfer: false, returns: false, roi: false, share: false },
  invCumMode: 'amount',    // 'amount' | 'roi' (원금 대비 수익률)
  invPickType: 'stock',
  invPickName: null,
  assetTrendRange: 12,
  assetTrendMode: 'total',
  assetTrendFilter: 'all',
  incomePieRange: 12,
  savTrendRange: 12,
  savContribRange: 12,
  flowSub: 'today',        // 흐름 하위 탭: today | now | year | calendar | flowmap
  expSub: 'summary',       // 지출 하위: summary | fixed | budget
  nowSub: 'summary',       // 이번달 하위: summary | income | expense
  nowExpFilter: 'all',     // 이번달>지출 내역 필터: all | fixed | var | good | regret
  nowIncOpen: null,        // 이번달>수입 차트에서 펼친 분류
  nowIncSel: null,         // 이번달>수입 차트에서 고른 항목 ('분류' 또는 '분류 › 항목')
  nowExpOpen: null,        // 이번달>지출 차트에서 펼친 분류
  nowExpSel: null,         // 이번달>지출 차트에서 고른 항목 ('분류' 또는 '분류 › 항목')
  nowMonthPinned: false,   // 사람이 달을 직접 골랐는지 (false면 늘 이번 달로 맞춘다)
  nowAxis: 'expense',      // 페이스 차트 축: income | expense | net (하나만)
  nowOpts: { budget: true, daily: false },
  yearAxis: 'expense',
  yearOpts: { budget: true, prevYear: true },
  yearSeries: { expense: true, budget: true, prevExpense: true, income: false, net: false },
  assetSub: 'overview',    // 자산 하위 탭: overview | investment | savings
  todoSub: 'goals',        // 할 일 하위 탭: goals | structure
  dataSub: 'ledger',       // 데이터 하위 탭: ledger | snapshot | dbm
  goalMoves: {},           // 드래그로 옮긴 목표 시기 (시트 반영 전 로컬 오버라이드)
  goalMetric: {},          // 목표 행별 수동 연동 지표 key
  goalTarget: {},          // 목표 행별 수동 목표값 (문구 대신 이 값을 씀)
  simLevers: {},           // 증식 구조 시뮬레이터 레버 입력
  simYears: 10,
  yearKey: null,
  yearMode: 'pace',
  yearSub: 'summary',      // 올해 하위: summary | income | expense | saving
  nowMonthKey: null,       // '이번달' 탭에서 보고 있는 달 (YYYY-MM)
  nowWeekIdx: null,        // null = 그 달 전체, 0.. = 해당 주차만
  nowGranularity: 'week',  // 'week' | 'day'
  todayDayKey: null,       // '오늘' 탭에서 보고 있는 날 (YYYY-MM-DD), null = 실제 오늘
  todayTrendRange: 14,     // '오늘' 탭 일별 추이 기간 (일)
  calMonthKey: null,       // '캘린더' 탭에서 보고 있는 달 (YYYY-MM)
  calMode: 'all',
  calHeat: false,         // 지출 진하기(히트맵) — 기본 끔
  calSelDay: null,         // 캘린더에서 선택한 날 (YYYY-MM-DD)
  invSub: 'overview',      // 투자 하위: overview | book | holdings | perf
  study: { name: '', step: 0, ans: {}, chk: {}, memo: {}, stop: '', take: '', weight: '', crit: [], val: {}, price: '', editId: null },
  bookFilter: 'all',       // 내 종목 필터: all | due | action | none
  bookOpen: null,          // 내 종목에서 펼친 행 (종목명)
  bookCcy: 'won'           // 내 종목 표시 통화: won | local
};

/* ---------------- 로컬 저장소 shim ----------------
   GitHub Pages에는 window.storage가 없어서 예산·체크리스트가 저장되지 않고 있었다.
   localStorage로 같은 인터페이스를 채운다. */
if (!window.storage) {
  const P = 'haedal:';
  window.storage = {
    async get(k) { const v = localStorage.getItem(P + k); if (v === null) throw new Error('not found: ' + k); return { key: k, value: v, shared: false }; },
    async set(k, v) { localStorage.setItem(P + k, v); return { key: k, value: v, shared: false }; },
    async delete(k) { localStorage.removeItem(P + k); return { key: k, deleted: true, shared: false }; },
    async list(prefix) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (!kk || kk.indexOf(P) !== 0) continue;
        const k = kk.slice(P.length);
        if (!prefix || k.indexOf(prefix) === 0) keys.push(k);
      }
      return { keys, prefix, shared: false };
    }
  };
}

/* ---------------- 사용자 설정 (목표 배분·부채·미운용 계좌·흐름표) ---------------- */
const SETTINGS_KEY = 'haedal-settings';
const ALLOC_CATS = ['현금 자산', '저축 자산', '투자 자산', '연금 자산'];
const DEFAULT_SETTINGS = {
  targetAlloc: null,        // { '투자 자산': 55, ... } · null = 미설정
  debts: [],                // { id, name, balance, monthly, rate, memo }
  emergencyMonths: 6,       // 비상금 목표 = 월 지출 × N개월
  idleAccounts: ['NH-연금저축펀드', 'NH-퇴직연금(개인IRP)', '하나-확정기여형(DC)', '신한 증권'],
  idleCheck: {},            // { 계좌명: 'YYYY-MM' } 마지막 운용 점검 월
  hiddenRecs: [],           // 안 보고 싶은 추천 목표 지표 키
  flowmap: null             // { income:[], expense:[], asset:[], liability:[] }
};
state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

async function loadSettings() {
  try {
    const res = await window.storage.get(SETTINGS_KEY, false);
    if (res && res.value) state.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(res.value));
  } catch (e) { /* 아직 저장된 설정 없음 */ }
}
async function saveSettings() {
  try { await window.storage.set(SETTINGS_KEY, JSON.stringify(state.settings), false); } catch (e) {}
}
function totalDebt() {
  return (state.settings.debts || []).reduce((a, x) => a + (Number(x.balance) || 0), 0);
}
function monthlyDebtPayment() {
  return (state.settings.debts || []).reduce((a, x) => a + (Number(x.monthly) || 0), 0);
}
function uid() { return Math.random().toString(36).slice(2, 9); }

/* ---------------- helpers ---------------- */

function cleanLabel(s) {
  if (!s) return '';
  s = s.replace(/^\[merged\]\s*/, '');
  s = s.replace(/^[^\uAC00-\uD7A3A-Za-z0-9]+/, '');
  return s.trim();
}

function parseWon(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (s === '' || s === '-' || s === '₩ -' || s === '₩-') return 0;
  if (!/[\d]/.test(s)) return null;
  const neg = s.includes('(') || /^-/.test(s.replace(/[₩\s]/g, ''));
  /* 통화기호·공백·천단위 콤마만 제거하고 소수점은 남긴다.
     예전에는 [^\d]를 전부 제거해서 "17857.14286"이 1,785,714,286원이 됐다. */
  const cleaned = s.replace(/[^\d.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const v = parseFloat(cleaned);
  if (isNaN(v)) return null;
  return Math.round(neg ? -v : v);
}

function formatWon(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  return (neg ? '-₩' : '₩') + abs.toLocaleString('ko-KR');
}

function formatCompactWon(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const neg = n < 0;
  const abs = Math.abs(n);
  let out;
  if (abs >= 100000000) out = (abs / 100000000).toFixed(2).replace(/\.?0+$/, '') + '억';
  /* 100만 미만은 소수 한 자리를 남긴다. 4.5만을 5만으로 반올림해 버리면
     한 건짜리 지출을 볼 때 오차가 10%를 넘는다. */
  else if (abs >= 1000000) out = Math.round(abs / 10000).toLocaleString() + '만';
  else if (abs >= 10000) out = (abs / 10000).toFixed(1).replace(/\.0$/, '') + '만';
  else out = Math.round(abs).toLocaleString();
  return (neg ? '−' : '') + out;
}

/* KPI 카드용 — 만원/억 축약에 '원'까지 붙인 최종 표기. */
function formatKrw(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return formatCompactWon(n) + '원';
}

function wonComma(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  /* 이전 구현은 Math.abs로 부호를 버려서 마이너스가 플러스로 보였다. */
  const v = Math.round(n);
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ko-KR');
}

function pivotMonthKey(s) {
  const m = s.match(/(\d{4})-(\d{1,2})월/);
  if (!m) return 0;
  return parseInt(m[1]) * 100 + parseInt(m[2]);
}
function assetMonthKey(s) {
  const m = s.match(/(\d{2})년\s*(\d{2})월/);
  if (!m) return 0;
  return (2000 + parseInt(m[1])) * 100 + parseInt(m[2]);
}
function assetMonthLabel(s) {
  const m = s.match(/(\d{2})년\s*(\d{2})월/);
  if (!m) return s;
  return `'${m[1]}.${m[2]}`;
}
function pivotMonthLabel(s) {
  const m = s.match(/(\d{4})-(\d{1,2})월/);
  if (!m) return s;
  return `'${m[1].slice(2)}.${String(m[2]).padStart(2, '0')}`;
}
function assetMonthYear(s) {
  const m = (s || '').match(/(\d{2})년/);
  return m ? String(2000 + parseInt(m[1])) : '';
}
function ledgerDateKey(s) {
  const m = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!m) return 0;
  return parseInt(m[1]) * 10000 + parseInt(m[2]) * 100 + parseInt(m[3]);
}

/* ---------------- CSV parsing (live sync) ---------------- */

function parseAssetsFromRows(rows) {
  const dateRe = /^\d{2}년\s*\d{2}월$/;
  const assetRows = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let j = 0; j < row.length; j++) {
      const cell = (row[j] || '').trim();
      if (dateRe.test(cell)) {
        if (j + 3 < row.length) {
          const cat = cleanLabel(row[j + 1] || '');
          const acct = (row[j + 2] || '').trim();
          const amt = parseWon(row[j + 3]);
          if (cat && amt !== null) {
            assetRows.push({ date: cell, category: cat, account: acct, amount: amt });
          }
        }
        break;
      }
    }
  }
  return assetRows;
}

/* 지수_S&P500 탭: 년월 / 종가 두 컬럼.
   구글 시트가 "2023-03"을 날짜로 해석해버리므로 gviz/tq CSV에서는
   "2023. 3. 1" 형태로 내려온다. 원문 문자열/날짜/한글표기 모두 받는다.
   컬럼은 항상 헤더명으로 찾는다 — 컬럼이 추가돼도 안 깨지게. */
function normIndexMonthKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[.\-/년]\s*(\d{1,2})/);          // 2023-03 / 2023. 3. 1 / 2023년 3월
  if (m) return `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, '0')}`;
  m = s.match(/^(\d{2})년\s*(\d{1,2})월/);                   // 23년 03월
  if (m) return `${2000 + parseInt(m[1], 10)}-${String(parseInt(m[2], 10)).padStart(2, '0')}`;
  return null;
}

function parseIndexFromRows(rows) {
  let headerRowIdx = -1, monthCol = -1, closeCol = -1;
  for (let r = 0; r < rows.length && r < 30; r++) {
    const row = (rows[r] || []).map(c => cleanLabel(c || ''));
    const mi = row.findIndex(c => c === '년월' || c === '월' || c === '기준월');
    const ci = row.findIndex(c => c === '종가' || c === '지수' || c === '가격');
    if (mi !== -1 && ci !== -1) { headerRowIdx = r; monthCol = mi; closeCol = ci; break; }
  }
  if (headerRowIdx === -1) return {};

  const out = {};
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const key = normIndexMonthKey(row[monthCol]);
    if (!key) continue;
    const v = parseFloat(String(row[closeCol] || '').replace(/[^0-9.\-]/g, ''));
    if (!isFinite(v) || v <= 0) continue;
    out[key] = v;
  }
  return out;
}

/* 목표 탭: 시기 / 구분 / 목표 / 상태 / 달성한 날 / 메모 컬럼 구조.
   "시기"와 "상태"가 함께 있는 행만 헤더로 인정한다 — 가계부(D)의
   헤더(날짜,대분류,소분류,항목,사용처,금액,메모,Good/Bad,회사 환급,고정비)에는
   이 두 단어가 없어서, 다른 탭을 잘못 목표로 오인할 위험이 없다. */
function parseGoalsFromRows(rows) {
  let headerRowIdx = -1, headerCols = [];
  for (let r = 0; r < rows.length; r++) {
    const row = (rows[r] || []).map(c => cleanLabel(c || ''));
    if (row.includes('시기') && row.includes('상태')) { headerRowIdx = r; headerCols = row; break; }
  }
  if (headerRowIdx === -1) return [];

  const colIdxs = [];
  headerCols.forEach((name, i) => { if (name) colIdxs.push({ name, i }); });

  const goals = [];
  for (let r = headerRowIdx + 1; r < rows.length && r < headerRowIdx + 500; r++) {
    const row = rows[r] || [];
    const obj = {};
    let hasAny = false;
    colIdxs.forEach(({ name, i }) => {
      const v = (row[i] || '').trim();
      if (v) hasAny = true;
      obj[name] = v;
    });
    if (!hasAny) continue;
    obj.__row = r + 1;   /* 시트 실제 행 번호 (쓰기 반영용) */
    goals.push(obj);
  }
  return goals;
}

const GOAL_FIELD_ALIASES = {
  period: ['시기', '연도', '일정', '분기', '목표시기'],
  category: ['구분', '분류', '카테고리'],
  title: ['항목', '목표', '내용', '제목'],
  freq: ['기간', '주기'],
  amount: ['금액 or 비율', '금액/비율', '금액', '목표값', '목표 수치', '비율'],
  status: ['상태', '진행상태', '진행'],
  doneDate: ['달성한 날', '달성일'],
  memo: ['메모', '비고', '노트'],
  priority: ['우선순위']
};

/* '10,000,000' · '₩ 1,000만' · '40%' 등 → 숫자 */
function parseGoalAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const t = String(raw).trim();
  if (/%$/.test(t)) { const v = parseFloat(t.replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v; }
  let m = t.match(/^([\d.]+)\s*억/);
  if (m) return parseFloat(m[1]) * 100000000;
  m = t.match(/^([\d,.]+)\s*만/);
  if (m) return parseFloat(m[1].replace(/,/g, '')) * 10000;
  const v = parseFloat(t.replace(/[^0-9.-]/g, ''));
  return isNaN(v) ? null : v;
}

function pickGoalField(goal, key) {
  const names = GOAL_FIELD_ALIASES[key] || [];
  for (const n of names) {
    if (goal[n] !== undefined && goal[n] !== '') return goal[n];
  }
  return null;
}

function goalStatusClass(status) {
  if (!status) return '';
  const s = String(status);
  if (/(완료|달성|✅|done|complete)/i.test(s)) return 'ok';
  if (/(지연|실패|❌|미달|보류)/i.test(s)) return 'no';
  if (/(진행)/i.test(s)) return 'active';
  if (/(대기|예정)/i.test(s)) return 'pending';
  return '';
}

/* ── 목표 지표 정의 ──────────────────────────────────────────────
   시트 '목표' 탭이 [시기 | 구분 | 항목 | 기간 | 금액 or 비율 | 상태 | 달성한 날 | 메모]
   구조로 바뀌면서, 목표 문구를 정규식으로 긁는 대신 (구분 + 항목)으로 지표를 찾고
   목표값은 '금액 or 비율' 칸에서 그대로 읽는다.
   freq('월'|'연'|'')은 흐름형 지표에서 월평균/연합계 중 무엇과 비교할지를 정한다. */
const GOAL_METRIC_DEFS = [
  /* --- 자산 (스톡) --- */
  { key: 'emergency', name: '비상금 (NH-CMA)', cat: /자산|저축/, item: /비상금/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => d.emergencyFund },
  { key: 'totalAssets', name: '총자산', cat: /자산/, item: /총\s*자산|전체\s*자산/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => d.totalAssets },
  { key: 'netWorth', name: '순자산', cat: /자산/, item: /순\s*자산/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => d.totalAssets - totalDebt() },
  { key: 'investAssets', name: '투자 자산', cat: /자산/, item: /투자/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => (d.allocation || {})['투자 자산'] || 0 },
  { key: 'pensionAssets', name: '연금 자산', cat: /자산/, item: /연금/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => (d.allocation || {})['연금 자산'] || 0 },
  { key: 'savingAssets', name: '저축 자산', cat: /자산/, item: /저축/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d) => (d.allocation || {})['저축 자산'] || 0 },
  { key: 'debt', name: '부채 잔액', cat: /부채/, item: /./, unit: 'won', dir: 'down', type: 'cap',
    current: () => totalDebt() },
  { key: 'investPct', name: '투자 비중', cat: /자산/, item: /투자\s*비[중율]/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d) => d.totalAssets ? (((d.allocation || {})['투자 자산'] || 0) / d.totalAssets) * 100 : 0 },
  { key: 'cashPct', name: '현금 비율', cat: null, item: /현금\s*비[중율]/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d) => d.totalAssets ? (d.emergencyFund / d.totalAssets) * 100 : 0 },

  /* --- 지출 (플로우) --- */
  { key: 'fixed', name: '고정비', cat: /지출/, item: /고정비/, unit: 'won', dir: 'down', type: 'cap',
    current: (d, e, f) => f === '연' ? e.sumFixed12 : e.avgFixed12 },
  { key: 'regret', name: '아낄 수 있었던 소비', cat: /지출/, item: /후회|아낄|bad/i, unit: 'won', dir: 'down', type: 'cap',
    current: (d, e, f) => f === '연' ? e.sumRegret12 : e.avgRegret12 },
  { key: 'expense', name: '총지출', cat: /지출/, item: /지출|생활비/, unit: 'won', dir: 'down', type: 'cap',
    current: (d, e, f) => f === '연' ? e.sumExpense12 : e.avgExpense12 },

  /* --- 수입 (플로우) --- */
  { key: 'invIncome', name: '투자 수익', cat: /수입/, item: /투자\s*수익/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '월' ? e.avgInvIncome12 : e.sumInvIncome12 },
  { key: 'laborIncome', name: '근로소득', cat: /수입/, item: /근로|급여|월급/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '연' ? e.sumLabor12 : e.avgLabor12 },
  { key: 'income', name: '총수입', cat: /수입/, item: /수입/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '연' ? e.sumIncome12 : e.avgIncome12 },

  /* --- 비율·흐름 --- */
  { key: 'savingsRate', name: '저축률', cat: null, item: /저축률/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d, e) => e.savingsRate12 },
  { key: 'netSavings', name: '순저축', cat: null, item: /순\s*저축/, unit: 'won', dir: 'up', type: 'accumulation',
    current: (d, e, f) => f === '연' ? e.sumNetSavings12 : e.avgNetSavings12 },
  { key: 'passivePct', name: '근로 외 수입 비중', cat: null, item: /근로\s*외|패시브|비근로/, unit: 'pct', dir: 'up', type: 'ratio',
    current: (d, e) => e.passivePct12 }
];

function findGoalMetric(category, item) {
  const c = String(category || ''), t = String(item || '');
  if (!t) return null;
  /* 항목 정규식이 더 좁은(구체적인) 정의가 앞에 오도록 배열 순서를 유지한다 */
  for (const m of GOAL_METRIC_DEFS) {
    if (m.cat && !m.cat.test(c)) continue;
    if (!m.item.test(t)) continue;
    return m;
  }
  return null;
}

/* 목표 지표에 쓰는 파생값 — 마감된 최근 12개월 기준 */
function goalMetricExtra(data, d) {
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const fixedTrend = getFixedMonthlyTrend(data.ledger) || [];
  const f12 = fixedTrend.slice(-12).map(x => x.total);
  const cf12 = (d.cashflow || []).slice(-12);
  const exp12 = cf12.map(x => x.expense);
  const inc12 = cf12.map(x => x.income);
  const net12 = cf12.map(x => x.income - x.expense);

  const i = d.latestPivotIdx;
  const tail = (arr) => (arr || []).slice(Math.max(0, i - 11), i + 1).map(v => v || 0);
  const invInc12 = tail(data.incomeCategories && data.incomeCategories['투자 수익']);
  const labor12 = tail(data.incomeCategories && data.incomeCategories['근로소득']);

  /* 후회 소비 월별 */
  const rgByMonth = {};
  (data.ledger || []).filter(r => r.major.includes('지출') && r.regret).forEach(r => {
    const k = ledgerMonthKey(r.date);
    if (!k) return;
    rgByMonth[k] = (rgByMonth[k] || 0) + (r.amount - (r.refund || 0));
  });
  const rgKeys = Object.keys(rgByMonth).sort().slice(-12);
  const rg12 = rgKeys.map(k => rgByMonth[k]);

  const sumInc = sum(inc12), sumExp = sum(exp12), sumLabor = sum(labor12);

  return {
    latestFixed: fixedTrend.length ? fixedTrend[fixedTrend.length - 1].total : 0,
    avgFixed12: avg(f12), sumFixed12: sum(f12),
    avgExpense12: avg(exp12), sumExpense12: sumExp,
    avgIncome12: avg(inc12), sumIncome12: sumInc,
    avgLabor12: avg(labor12), sumLabor12: sumLabor,
    avgInvIncome12: avg(invInc12), sumInvIncome12: sum(invInc12),
    avgRegret12: avg(rg12), sumRegret12: sum(rg12),
    avgNetSavings12: avg(net12), sumNetSavings12: sum(net12),
    savingsRate12: sumInc > 0 ? ((sumInc - sumExp) / sumInc) * 100 : 0,
    passivePct12: sumInc > 0 ? ((sumInc - sumLabor) / sumInc) * 100 : 0
  };
}

/* 문구에서 목표값을 뽑는 구버전 폴백 ("2억" → 200000000 · "1,010만원" → 10100000 · "12.5%" → 12.5) */
function parseGoalTargetValue(title, unit) {
  const t = String(title || '');
  if (unit === 'pct') {
    const m = t.match(/([\d.]+)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }
  let m = t.match(/([\d.]+)\s*억/);
  if (m) return parseFloat(m[1]) * 100000000;
  m = t.match(/([\d,]+)\s*만/);
  if (m) return parseFloat(m[1].replace(/,/g, '')) * 10000;
  m = t.match(/([\d,]{4,})\s*원?/);
  if (m) return parseFloat(m[1].replace(/,/g, ''));
  return null;
}

/* 목표 행 하나 → 진행 상황.
   1순위: (구분+항목)으로 지표 결정 + '금액 or 비율' 칸 값이 목표
   2순위: 수동 지정 지표(state.goalMetric) / 수동 목표값(state.goalTarget)
   3순위: 항목 문구에서 숫자 추출 (구버전 호환) */
function goalProgressOf(g, d, extra) {
  if (!g) return null;
  const item = pickGoalField(g, 'title') || '';
  const category = pickGoalField(g, 'category') || '';
  const freq = (pickGoalField(g, 'freq') || '').trim();
  const forceKey = (state.goalMetric || {})[g.__row] || null;
  const manual = (state.goalTarget || {})[g.__row];

  const metric = forceKey
    ? GOAL_METRIC_DEFS.find(m => m.key === forceKey)
    : findGoalMetric(category, item);
  if (!metric) return null;

  let target = parseGoalAmount(pickGoalField(g, 'amount'));
  if (manual !== undefined && manual !== null && manual !== '' && !isNaN(Number(manual))) target = Number(manual);
  if (target === null || isNaN(target)) target = parseGoalTargetValue(item, metric.unit);
  if (target === null || isNaN(target)) return null;

  const isPct = metric.unit === 'pct';
  const current = metric.current(d, extra || {}, freq) || 0;
  const freqLabel = freq ? `${freq} 기준` : '';
  return {
    current, target, isPct,
    invert: metric.dir === 'down',
    type: metric.type, key: metric.key, dir: metric.dir,
    name: freqLabel ? `${metric.name} · ${freqLabel}` : metric.name,
    shortName: metric.name,
    freq,
    overridden: manual !== undefined && manual !== null && manual !== ''
  };
}

/* 목표값이 현재 수준과 자릿수가 어긋나면(오타 의심) 표시용 플래그 */
function goalSanityFlag(p) {
  if (!p || p.isPct || !p.current || !p.target) return null;
  const ratio = p.target / p.current;
  if (p.invert && ratio >= 3) return `목표가 현재의 ${ratio.toFixed(0)}배 — 자릿수 확인`;
  if (!p.invert && ratio > 0 && ratio <= 0.2 && p.type !== 'accumulation') return '목표가 현재보다 한참 낮아요';
  return null;
}



/* 시트의 체크 칸(회사 환급=🏢 · 고정비=📌 등)은 이모지로 들어온다.
   변이 셀렉터(U+FE0F)까지 붙어 오므로 '비어 있지 않고 명시적 거짓이 아니면 체크'로 본다. */
function isCheckMark(v) {
  const t = String(v === null || v === undefined ? '' : v).replace(/\uFE0F/g, '').trim();
  if (!t) return false;
  if (/^(false|0|n|no|아니오|-|—|x)$/i.test(t)) return false;
  return true;
}

function parseLedgerFromRows(rows) {
  let r0 = -1, c0 = -1, header = null;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length - 3; c++) {
      if ((row[c] || '').trim() === '날짜' && (row[c + 1] || '').trim() === '대분류'
        && (row[c + 2] || '').trim() === '소분류' && (row[c + 3] || '').trim() === '항목') {
        r0 = r; c0 = c; header = row; break;
      }
    }
    if (r0 !== -1) break;
  }
  if (r0 === -1) return [];

  /* 열 위치를 고정 오프셋이 아니라 헤더 이름으로 찾는다.
     (기존에는 고정비를 c0+9에서 읽었는데 시트에 '후회하는 소비'·'회사 환급' 열이
      추가되면서 실제 고정비는 c0+10으로 밀려 있었고, 그 결과 고정비가 항상 false였다.) */
  const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
  const findCol = (matchers, fallback) => {
    for (const m of matchers) {
      for (let c = c0; c < header.length; c++) {
        const h = norm(header[c]);
        if (!h) continue;
        if (typeof m === 'string' ? h === m : m.test(h)) return c;
      }
    }
    return fallback;
  };
  const COL = {
    amount: findCol(['금액'], c0 + 5),
    vendor: findCol([/^사용처/, /브랜드/], c0 + 6),
    memo: findCol(['내용', '메모'], c0 + 7),
    gb: findCol([/^good\/?bad$/i, /^후회/], -1),
    refund: findCol([/^회사환급/, /^환급/], -1),
    fixed: findCol([/^고정비/], -1)
  };

  const dateRe = /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}$/;
  const ledger = [];
  let missStreak = 0;
  for (let r = r0 + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateCell = (row[c0] || '').trim();
    if (!dateRe.test(dateCell)) {
      missStreak++;
      if (missStreak > 25) break;
      continue;
    }
    missStreak = 0;
    const major = cleanLabel(row[c0 + 1] || '');
    const minor = cleanLabel(row[c0 + 2] || '');
    const item = (row[c0 + 3] || '').trim();
    const amount = parseWon(row[COL.amount]);
    const vendor = cleanLabel(row[COL.vendor] || '');
    const memo = (row[COL.memo] || '').trim();
    const fixed = COL.fixed >= 0 ? isCheckMark(row[COL.fixed]) : false;   /* 📌 등 아무 표시나 체크로 */
    /* Good/Bad 열: 'Good'=잘한소비, 'Bad'=아낄 수 있었던 소비.
       (예전 방식대로 ✔️ 체크만 있으면 Bad로 간주 — 과거 데이터 호환) */
    const gbRaw = COL.gb >= 0 ? String(row[COL.gb] === null || row[COL.gb] === undefined ? '' : row[COL.gb]).trim() : '';
    const good = /good/i.test(gbRaw);
    const regret = /bad/i.test(gbRaw) || (!good && isCheckMark(gbRaw));
    /* 회사 환급 칸은 금액일 수도, 체크(=전액 환급)일 수도 있다 */
    let refund = 0;
    if (COL.refund >= 0) {
      const raw = row[COL.refund];
      const asWon = parseWon(raw);
      refund = (asWon !== null && asWon !== 0) ? asWon : (isCheckMark(raw) && amount !== null ? amount : 0);
    }
    if (amount === null || amount === 0) continue;
    ledger.push({ date: dateCell, major, minor, item, amount, vendor, memo, fixed, regret, good, refund });
  }
  return ledger;
}

/* 가계부(M) 피벗 탭은 Google Sheets 병합 셀이 gviz CSV export에서
   깨져 나오는 문제가 있어(월 헤더 행이 빈 문자열로 export됨),
   parsePivotFromRows가 못 찾을 때가 있다. 이미 정상 파싱되는
   가계부(D) 일별 원장(ledger)에서 동일한 모양의 요약을 직접
   집계해서 그 자리를 대체한다. */
function buildPivotFromLedger(ledger) {
  if (!ledger || !ledger.length) return null;

  const monthOf = (dateCell) => {
    const m = dateCell.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${parseInt(m[2], 10)}월`;
  };

  const monthSet = new Set();
  ledger.forEach(r => { const mk = monthOf(r.date); if (mk) monthSet.add(mk); });
  const months = Array.from(monthSet).sort((a, b) => pivotMonthKey(a) - pivotMonthKey(b));
  if (months.length === 0) return null;
  const monthIdx = {};
  months.forEach((m, i) => { monthIdx[m] = i; });
  const zeros = () => months.map(() => 0);

  const incomeTotal = zeros(), expenseTotal = zeros();
  const expenseCategories = {}, incomeCategories = {}, transferCategories = {};

  ledger.forEach(r => {
    const mk = monthOf(r.date);
    if (!mk) return;
    const idx = monthIdx[mk];
    if (idx === undefined) return;
    const amt = r.amount || 0;
    if (r.major === '지출') {
      if (!expenseCategories[r.minor]) expenseCategories[r.minor] = zeros();
      expenseCategories[r.minor][idx] += amt;
      expenseTotal[idx] += amt;
    } else if (r.major === '수입') {
      if (!incomeCategories[r.minor]) incomeCategories[r.minor] = zeros();
      incomeCategories[r.minor][idx] += amt;
      incomeTotal[idx] += amt;
    } else if (r.major === '이체') {
      if (!transferCategories[r.minor]) transferCategories[r.minor] = zeros();
      transferCategories[r.minor][idx] += amt;
    }
  });

  return { months, incomeTotal, expenseTotal, expenseCategories, incomeCategories, transferCategories };
}

/* 분류 탭: 구분,이름,,주식_카테고리,고정비 여부,수입,지출 같은 넓은 분류표.
   "이름"과 "주식_카테고리" 컬럼이 함께 있는 행을 찾아 종목명 → 주식 카테고리 매핑을 만든다. */
function parseStockCategoryFromRows(rows) {
  let headerRowIdx = -1, headerCols = [];
  for (let r = 0; r < rows.length; r++) {
    const row = (rows[r] || []).map(c => cleanLabel(c || ''));
    if (row.includes('이름') && row.includes('주식_카테고리')) { headerRowIdx = r; headerCols = row; break; }
  }
  if (headerRowIdx === -1) return {};
  const nameIdx = headerCols.indexOf('이름');
  const catIdx = headerCols.indexOf('주식_카테고리');
  const map = {};
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = (row[nameIdx] || '').trim();
    const cat = (row[catIdx] || '').trim();
    if (name && cat) map[name] = cat;
  }
  return map;
}

function parseInvestmentTagsFromRows(rows) {
  let r0 = -1, c0 = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length - 6; c++) {
      if (row[c] === '국내/해외' && row[c + 1] === '태그' && row[c + 2] === '종목' && row[c + 3] === '판매수익') {
        r0 = r; c0 = c; break;
      }
    }
    if (r0 !== -1) break;
  }
  if (r0 === -1) return [];
  const out = [];
  let missStreak = 0;
  for (let r = r0 + 1; r < rows.length && r < r0 + 500; r++) {
    const row = rows[r] || [];
    const stock = (row[c0 + 2] || '').trim();
    const total = parseWon(row[c0 + 6]);
    const pctCell = (row[c0 + 7] || '').trim();
    const looksValid = stock && total !== null && (pctCell === '' || /%$/.test(pctCell));
    if (!looksValid) {
      missStreak++;
      if (missStreak > 15) break;
      continue;
    }
    missStreak = 0;
    const tagRaw = cleanLabel(row[c0 + 1] || '');
    const tags = tagRaw ? tagRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    let stockName = cleanLabel(stock);
    if (stockName.includes('›')) stockName = stockName.split('›').pop().trim();
    out.push({
      stock: stockName, tags,
      sale: parseWon(row[c0 + 3]) || 0, dividend: parseWon(row[c0 + 4]) || 0, interest: parseWon(row[c0 + 5]) || 0,
      total
    });
  }
  return out;
}

function aggregateByTag(tagRows) {
  const map = {};
  tagRows.forEach(r => {
    const tags = r.tags.length ? r.tags : ['미분류'];
    tags.forEach(t => { map[t] = (map[t] || 0) + r.total; });
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

/* ---------------- derived analysis ---------------- */

function computeDerived(data) {
  /* 오늘 이후의 달은 자산 스냅샷에 행만 있고 금액이 비어 있는 경우가 있어 전부 제외한다 */
  const _now = new Date();
  const nowAssetKey = _now.getFullYear() * 100 + (_now.getMonth() + 1);
  data = { ...data, assetRows: (data.assetRows || []).filter(r => assetMonthKey(r.date) <= nowAssetKey) };

  const byMonth = {};
  data.assetRows.forEach(r => {
    if (r.amount === null) return;
    byMonth[r.date] = (byMonth[r.date] || 0) + r.amount;
  });
  const assetMonths = Object.keys(byMonth).sort((a, b) => assetMonthKey(a) - assetMonthKey(b));
  const latestMonth = assetMonths[assetMonths.length - 1];
  const prevMonth = assetMonths[assetMonths.length - 2];
  const totalAssets = byMonth[latestMonth] || 0;
  const prevTotalAssets = prevMonth ? byMonth[prevMonth] : null;
  const deltaAssets = prevTotalAssets !== null ? totalAssets - prevTotalAssets : null;
  const deltaPct = (prevTotalAssets && prevTotalAssets !== 0) ? (deltaAssets / Math.abs(prevTotalAssets)) * 100 : null;

  const allocation = {};
  data.assetRows.filter(r => r.date === latestMonth).forEach(r => {
    if (r.amount === null) return;
    allocation[r.category] = (allocation[r.category] || 0) + r.amount;
  });

  const cashLike = (allocation['현금 자산'] || 0) + (allocation['저축 자산'] || 0);
  const normAcct = s => (s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const cmaRow = data.assetRows.find(r => r.date === latestMonth && normAcct(r.account) === 'NHCMA');
  const emergencyFund = cmaRow ? cmaRow.amount : 0;

  const displayAllocation = {};
  Object.entries(allocation).forEach(([cat, amt]) => {
    const g = DISPLAY_GROUP[cat] || cat;
    displayAllocation[g] = (displayAllocation[g] || 0) + amt;
  });

  const cashflow = data.months.map((m, i) => {
    const income = data.incomeTotal[i];
    const expense = data.expenseTotal[i];
    if (!income || income <= 0) return null;
    const savingsRate = ((income - expense) / income) * 100;
    return { month: m, income, expense, savingsRate };
  }).filter(Boolean);

  const catNames = Object.keys(data.expenseCategories);
  const latestPivotIdx = (() => {
    for (let i = data.months.length - 1; i >= 0; i--) {
      if (data.incomeTotal[i] && data.incomeTotal[i] > 0) return i;
    }
    return data.months.length - 1;
  })();
  const catLatest = {};
  const catAvg3 = {};
  catNames.forEach(name => {
    const vals = data.expenseCategories[name];
    catLatest[name] = vals[latestPivotIdx] || 0;
    const window3 = [vals[latestPivotIdx - 1] || 0, vals[latestPivotIdx - 2] || 0, vals[latestPivotIdx - 3] || 0];
    catAvg3[name] = window3.reduce((a, b) => a + b, 0) / 3;
  });

  /* 자산 증감 분해
     투자 수익(판매수익·배당·이자)은 이미 증권계좌 안에 들어있는 '내부' 수익이라
     외부에서 새로 들어온 돈(순저축)에서 빼야 이중 계산이 안 된다.
       Δ총자산 = 순저축(외부) + 투자·평가손익 */
  const invIncomeSeries = data.incomeCategories['투자 수익'] || [];
  const cashByKey = {};
  data.months.forEach((m, i) => {
    const income = data.incomeTotal[i] || 0;
    const invIncome = invIncomeSeries[i] || 0;
    cashByKey[pivotMonthKey(m)] = { income, invIncome, extIncome: income - invIncome, expense: data.expenseTotal[i] || 0 };
  });
  const decomposition = [];
  for (let i = 1; i < assetMonths.length; i++) {
    const curM = assetMonths[i], prevM = assetMonths[i - 1];
    const totalDelta = byMonth[curM] - byMonth[prevM];
    const cf = cashByKey[assetMonthKey(curM)];
    const netSavings = cf ? (cf.extIncome - cf.expense) : null;   // 외부 순유입
    const marketOther = netSavings !== null ? totalDelta - netSavings : null;
    decomposition.push({
      month: curM, label: assetMonthLabel(curM), totalDelta, netSavings, marketOther,
      extIncome: cf ? cf.extIncome : null, invIncome: cf ? cf.invIncome : null, expense: cf ? cf.expense : null
    });
  }

  return {
    byMonth, assetMonths, latestMonth, prevMonth, totalAssets, prevTotalAssets, deltaAssets, deltaPct,
    allocation, displayAllocation, cashLike, emergencyFund, cashflow, catNames, catLatest, catAvg3, latestPivotIdx, decomposition
  };
}


function computeSuggestedGoals(data, d) {
  const last12 = d.cashflow.slice(-12);
  const avgRate = last12.length ? last12.reduce((a, c) => a + c.savingsRate, 0) / last12.length : 40;
  const suggestedSavings = Math.max(0, Math.round(avgRate / 5) * 5);
  const last3Expense = d.cashflow.slice(-3).map(c => c.expense);
  const avgExpense = last3Expense.length ? last3Expense.reduce((a, b) => a + b, 0) / last3Expense.length : 0;
  const suggestedEmergency = Math.max(500000, Math.round((avgExpense * 3) / 100000) * 100000);
  return { suggestedSavings, suggestedEmergency, avgRate, avgExpense };
}

function ledgerMonthKey(dateStr) {
  const m = (dateStr || '').match(/(\d{4})\.\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}`;
}


function getFixedMonthlyTrend(ledger) {
  const byMonth = {};
  ledger.filter(r => r.fixed && r.major.includes('지출')).forEach(r => {
    const key = ledgerMonthKey(r.date);
    if (!key) return;
    byMonth[key] = (byMonth[key] || 0) + r.amount;
  });
  return Object.keys(byMonth).sort().map(k => ({ month: k, total: byMonth[k] }));
}

function getStockProfit(ledger) {
  const map = {};
  ledger.filter(r => r.minor === '투자 수익').forEach(r => {
    let name = r.vendor || '기타';
    if (name.includes('›')) name = name.split('›').pop().trim();
    if (!name) name = '기타';
    map[name] = (map[name] || 0) + r.amount;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function getInvestmentIncomeMonthly(ledger) {
  const byMonthItem = {};
  const items = new Set();
  ledger.filter(r => r.minor === '투자 수익').forEach(r => {
    const key = ledgerMonthKey(r.date);
    if (!key) return;
    byMonthItem[key] = byMonthItem[key] || {};
    byMonthItem[key][r.item] = (byMonthItem[key][r.item] || 0) + r.amount;
    items.add(r.item);
  });
  const months = Object.keys(byMonthItem).sort();
  return { months, items: [...items], byMonthItem };
}





function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}



function amtPct(amt, pct) {
  return `${formatCompactWon(amt)}원 (${pct.toFixed(1)}%)`;
}




/* ---------------- rendering ---------------- */

/* ---------------- chart helpers ---------------- */

const valueLabelPlugin = {
  id: 'valueLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const horizontal = chart.options && chart.options.indexAxis === 'y';
    chart.data.datasets.forEach((dataset, dsIndex) => {
      if (dataset.hideLabel) return;
      const meta = chart.getDatasetMeta(dsIndex);
      if (!meta || meta.hidden) return;
      /* 점이 많으면 라벨이 서로 겹치므로 간격을 띄워 그린다 */
      const n = meta.data.length;
      const step = dataset.labelStep || (n > 30 ? Math.ceil(n / 8) : n > 16 ? Math.ceil(n / 10) : 1);
      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || value === 0) return;
        if (step > 1 && (n - 1 - index) % step !== 0) return;
        const pos = element.tooltipPosition ? element.tooltipPosition() : element;
        ctx.save();
        ctx.font = dataset.labelFont || "600 10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = (typeof dataset.labelColor === 'function' ? dataset.labelColor(index) : dataset.labelColor) || '#c7cddb';
        const fmtLabel = dataset.labelFormatter || formatCompactWon;
        if (horizontal) {
          ctx.textAlign = value >= 0 ? 'left' : 'right';
          ctx.textBaseline = 'middle';
          const offsetX = dataset.labelOffset !== undefined ? dataset.labelOffset : (value >= 0 ? 6 : -6);
          ctx.fillText(fmtLabel(value, index), pos.x + offsetX, pos.y);
        } else {
          ctx.textAlign = 'center';
          const isLine = chart.config.type === 'line' || dataset.type === 'line';
          const offset = dataset.labelOffset !== undefined ? dataset.labelOffset : (isLine ? -8 : (value >= 0 ? -6 : 14));
          ctx.fillText(fmtLabel(value, index), pos.x, pos.y + offset);
        }
        ctx.restore();
      });
    });
  }
};

const stackTotalLabelPlugin = {
  id: 'stackTotalLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    const meta0 = chart.getDatasetMeta(0);
    if (!meta0) return;
    data.labels.forEach((_, i) => {
      let sum = 0, topY = null;
      data.datasets.forEach((ds, dsIdx) => {
        const meta = chart.getDatasetMeta(dsIdx);
        if (!meta || meta.hidden) return;
        const v = ds.data[i] || 0;
        sum += v;
        const el = meta.data[i];
        if (el) {
          const pos = el.tooltipPosition ? el.tooltipPosition() : el;
          if (topY === null || pos.y < topY) topY = pos.y;
        }
      });
      if (!sum || topY === null) return;
      const xEl = meta0.data[i];
      if (!xEl) return;
      const xPos = xEl.tooltipPosition ? xEl.tooltipPosition() : xEl;
      ctx.save();
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = '#c7cddb';
      ctx.textAlign = 'center';
      ctx.fillText(formatCompactWon(sum), xPos.x, topY - 6);
      ctx.restore();
    });
  }
};

function avgOf(values) {
  const nums = (values || []).filter(v => v !== null && v !== undefined);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}




const MONO_TICK = { color: '#9aa3b6', font: { family: 'IBM Plex Mono', size: 10 } };
const GRID_FAINT = { color: 'rgba(255,255,255,0.05)' };

/* ---------------- shell & nav ---------------- */

function setSyncState(status) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;
  dot.className = 'sync-dot' + (status === 'live' ? ' live' : status === 'err' ? ' err' : status === 'loading' ? ' loading' : '');
  if (status === 'loading') label.textContent = '실시간 데이터 불러오는 중…';
  else if (status === 'live') label.textContent = `실시간 연동됨 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신`;
  else if (status === 'err') label.textContent = `실시간 연동 실패 · ${state.source === 'snapshot' ? '최근 스냅샷 표시 중' : ''}`;
  else label.textContent = '스냅샷 데이터';
}

/* 최상단 4탭 = 사용 빈도순 (매일 → 주/월 → 월 → 분기)
   각 탭의 하위는 SECTION_SUBS 에서 정의하고, 실제 렌더 함수로 매핑한다. */
const NAV_ITEMS = [
  { id: 'home', label: '홈', solo: true },
  { id: 'flow', label: '흐름' },
  { id: 'assets', label: '자산' },
  { id: 'todo', label: '할 일' },
  { id: 'data', label: '데이터' }
];

const SECTION_SUBS = {
  home: [
    ['main', '홈']
  ],
  flow: [
    ['today', '오늘'],
    ['now', '이번달'],
    ['year', '올해'],
    ['calendar', '캘린더'],
    ['flowmap', '흐름표']
  ],
  assets: [
    ['overview', '전체'],
    ['investment', '투자'],
    ['savings', '저축'],
    ['pension', '연금']
  ],
  todo: [
    ['goals', '목표'],
    ['fixed', '고정비 점검'],
    ['structure', '시뮬레이션']
  ],
  data: [
    ['ledger', '입출금'],
    ['snapshot', '자산 스냅샷'],
    ['dbm', '목록']
  ]
};

const SECTION_STATE_KEY = { home: 'homeMainSub', flow: 'flowSub', assets: 'assetSub', todo: 'todoSub', data: 'dataSub' };

function currentSub(section) {
  const subs = SECTION_SUBS[section] || [];
  const key = SECTION_STATE_KEY[section];
  const cur = state[key];
  return subs.some(x => x[0] === cur) ? cur : (subs[0] ? subs[0][0] : null);
}

function goTo(section, sub) {
  state.page = section;
  if (sub && SECTION_STATE_KEY[section]) state[SECTION_STATE_KEY[section]] = sub;
  renderPage();
}

/* ---------------- 주소 기억 ----------------
   새로고침하거나 링크를 다시 열었을 때 홈으로 튕기지 않고 보던 화면 그대로 열리게,
   지금 보는 섹션·하위탭을 주소(#현황/아낀돈)에 적어 둔다. */
let ROUTE_SILENT = false;
function routeWrite(section, sub) {
  const h = '#' + section + (sub ? '/' + sub : '');
  if (location.hash === h) return;
  ROUTE_SILENT = true;
  try { history.replaceState(null, '', location.pathname + location.search + h); }
  catch (e) { location.hash = h; }
  setTimeout(() => { ROUTE_SILENT = false; }, 0);
}
/* 메뉴 개편(현황·시스템 해체) 전에 만들어진 주소를 새 위치로 넘긴다.
   기존 북마크·뒤로가기 이력이 깨지지 않게 하기 위한 것. */
const LEGACY_ROUTE = {
  'status': 'todo/goals',
  'status/goals': 'todo/goals',
  'status/structure': 'todo/structure',
  'status/flowmap': 'flow/flowmap',
  'status/ledger': 'data/ledger',
  'status/snapshot': 'data/snapshot',
  'system': 'data/dbm',
  'system/dbm': 'data/dbm'
};

function routeRead() {
  let raw = String(location.hash || '').replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch (e) {}
  raw = raw.trim();
  if (!raw) return null;
  if (LEGACY_ROUTE[raw]) raw = LEGACY_ROUTE[raw];
  const [sec, sub] = raw.split('/');
  if (!NAV_ITEMS.some(n => n.id === sec)) return null;
  const subs = SECTION_SUBS[sec] || [];
  return { section: sec, sub: subs.some(x => x[0] === sub) ? sub : null };
}
function routeApply() {
  const r = routeRead();
  if (!r) return false;
  state.page = r.section;
  if (r.sub && SECTION_STATE_KEY[r.section]) state[SECTION_STATE_KEY[r.section]] = r.sub;
  return true;
}
window.addEventListener('hashchange', () => {
  if (ROUTE_SILENT) return;
  if (routeApply() && state.data) renderPage();
});

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


/* ---------------- 매매 규율 ---------------- */
function renderDisciplinePanel(hostId, data) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const sales = (data.ledger || []).filter(r => r.major.includes('수입') && (r.item || '').includes('판매수익'));
  if (!sales.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
  const byMonth = {};
  sales.forEach(r => {
    const k = ledgerMonthKey(r.date);
    if (!k) return;
    if (!byMonth[k]) byMonth[k] = { cnt: 0, names: new Set(), win: 0, sum: 0 };
    byMonth[k].cnt++;
    byMonth[k].sum += r.amount;
    if (r.amount > 0) byMonth[k].win++;
    byMonth[k].names.add((r.vendor || '').split('›').pop().trim());
  });
  const keys = Object.keys(byMonth).sort();
  const series = keys.slice(-12);
  const mk = thisMonthKey();
  const closed = series.filter(k => k !== mk);
  const avgCnt = closed.length ? closed.reduce((a, k) => a + byMonth[k].cnt, 0) / closed.length : 0;
  const cur = byMonth[mk] || { cnt: 0, names: new Set(), win: 0, sum: 0 };
  const allWin = sales.filter(r => r.amount > 0).length;
  const winRate = (allWin / sales.length) * 100;

  host.innerHTML = `
    <div class="panel-title"><div>매매 규율</div><span class="ptag">실현 매도 기준</span></div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;">
      <div class="stat-card">
        <div class="label">이번 달 매도</div>
        <div class="value" style="color:${cur.cnt > avgCnt * 1.5 ? 'var(--expense-text)' : 'var(--text)'}">${cur.cnt}건</div>
        <div class="sub">마감월 평균 ${avgCnt.toFixed(1)}건</div>
      </div>
      <div class="stat-card">
        <div class="label">이번 달 종목 수</div>
        <div class="value">${cur.names.size}개</div>
        <div class="sub">매도한 서로 다른 종목</div>
      </div>
      <div class="stat-card">
        <div class="label">누적 익절 비율</div>
        <div class="value" style="color:${winRate >= 50 ? 'var(--income-text)' : 'var(--expense-text)'}">${winRate.toFixed(0)}%</div>
        <div class="sub">${sales.length}건 중 ${allWin}건 플러스</div>
      </div>
    </div>
    <div class="chart-wrap" style="min-height:170px;margin-top:8px;"><canvas id="chart-disc"></canvas></div>
    <div class="settings-note">매수 기록이 가계부에 없어 <b>평균 보유기간</b>은 계산할 수 없어요. 매도 빈도가 평소보다 튀는 달이 "원칙이 흔들린 달"입니다.</div>
  `;
  if (state.charts.disc) state.charts.disc.destroy();
  const ctx = document.getElementById('chart-disc');
  if (!ctx) return;
  state.charts.disc = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: series.map(monthKeyLabel),
      datasets: [{ label: '매도 건수', data: series.map(k => byMonth[k].cnt), backgroundColor: series.map(k => byMonth[k].cnt > avgCnt * 1.5 ? 'rgba(193,72,63,.8)' : 'rgba(154,163,182,.55)'), borderRadius: 3, labelColor: '#c9cede' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` 매도 ${c.raw}건` } } },
      scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: MONO_TICK, grid: GRID_FAINT } }
    }
  });
}

/* ================= 돈의 흐름표 ================= */
const FM_QUADS = [
  { key: 'income', label: '수입', color: 'var(--income-text)' },
  { key: 'expense', label: '지출', color: 'var(--expense-text)' },
  { key: 'asset', label: '자산', color: 'var(--accent-text)' },
  { key: 'liability', label: '부채', color: '#c1483f' }
];

function flowmapData() {
  if (!state.settings.flowmap) state.settings.flowmap = { income: [], expense: [], asset: [], liability: [] };
  FM_QUADS.forEach(q => { if (!Array.isArray(state.settings.flowmap[q.key])) state.settings.flowmap[q.key] = []; });
  return state.settings.flowmap;
}

function renderFlowMapPage(container, data, d) {
  const fm = flowmapData();
  const sel = state.fmSel || null;
  const sum = (k) => fm[k].reduce((a, x) => a + (Number(x.amount) || 0), 0);

  container.innerHTML = `
    <div class="g">
      <div class="panel s8">
        <div class="panel-title">
          <div>돈의 흐름표</div>
          <div style="display:flex;gap:6px;">
            <button class="btn small" id="fm-seed">가계부에서 채우기</button>
          </div>
        </div>
        <div class="fm-wrap">
          ${['income', 'expense', 'asset', 'liability'].map(k => fmCell(k, fm[k], sum(k))).join('')}
        </div>
        <div class="settings-note">${FM_QUADS.every(q => !fm[q.key].length) ? '<b>가계부에서 채우기</b>를 누르면 최근 6개월 평균 수입·지출과 현재 계좌 잔액으로 초안이 만들어져요. 그 다음 직접 고치면 됩니다.' : '각 칸의 항목을 클릭하면 오른쪽에 상세가 뜹니다. 수입·지출은 월 기준, 자산·부채는 잔액 기준으로 적어두면 읽기 편해요.'}</div>
      </div>
      <div class="panel s4 fm-detail" id="fm-detail"></div>
    </div>
  `;

  renderFmDetail(data, d);

  const wrap = container.querySelector('.fm-wrap');
  if (wrap) wrap.addEventListener('click', (e) => {
    const add = e.target.closest('[data-fm-add]');
    if (add) { openFlowItemEditor(add.dataset.fmAdd, null); return; }
    const head = e.target.closest('[data-fm-quad-head]');
    if (head) {
      const k = head.dataset.fmQuadHead;
      const same = state.fmSel && state.fmSel.whole && state.fmSel.quad === k;
      state.fmSel = same ? null : { quad: k, whole: true, id: null };
      wrap.querySelectorAll('.fm-item').forEach(x => x.classList.remove('on'));
      wrap.querySelectorAll('.fm-h').forEach(x => x.classList.remove('on'));
      if (!same) head.classList.add('on');
      renderFmDetail(data, d);
      return;
    }
    const it = e.target.closest('[data-fm-item]');
    if (it) {
      const same = state.fmSel && state.fmSel.id === it.dataset.fmItem;
      state.fmSel = same ? null : { quad: it.dataset.fmQuad, id: it.dataset.fmItem };
      wrap.querySelectorAll('.fm-item').forEach(x => x.classList.remove('on'));
      wrap.querySelectorAll('.fm-h').forEach(x => x.classList.remove('on'));
      if (!same) it.classList.add('on');
      renderFmDetail(data, d);
      return;
    }
    if (state.fmSel) {
      state.fmSel = null;
      wrap.querySelectorAll('.fm-item').forEach(x => x.classList.remove('on'));
      wrap.querySelectorAll('.fm-h').forEach(x => x.classList.remove('on'));
      renderFmDetail(data, d);
    }
  });
  const seedBtn = container.querySelector('#fm-seed');
  if (seedBtn) seedBtn.addEventListener('click', () => seedFlowMap(data, d));

}

function fmCell(key, items, total) {
  const q = FM_QUADS.find(x => x.key === key);
  return `<div class="fm-cell" data-quad="${key}" style="--qc:${q.color}">
    <div class="fm-h ${(state.fmSel && state.fmSel.whole && state.fmSel.quad === key) ? 'on' : ''}" data-fm-quad-head="${key}">
      <b style="color:${q.color}">${q.label}</b><span>${total ? formatCompactWon(total) : ''}</span>
    </div>
    ${items.map(x => `<div class="fm-item ${(state.fmSel && state.fmSel.id === x.id) ? 'on' : ''}" data-fm-item="${x.id}" data-fm-quad="${key}">
      <span class="nm">${x.name}${x.linkedTo ? `<em style="font-style:normal;color:var(--text-faint);font-size:10.5px;"> → ${x.linkedTo}</em>` : ''}</span>
      <span class="vl">${x.amount ? formatCompactWon(x.amount) : '—'}</span>
    </div>`).join('') || '<div class="empty-state" style="padding:10px 0;font-size:11.5px;">항목 없음</div>'}
    <button class="fm-add" data-fm-add="${key}">+ ${q.label} 항목 추가</button>
  </div>`;
}

/* 흐름표 항목의 세부 내역 — 최근 6개월 월평균.
   '근로소득' 같은 소분류 이름이면 그 아래 세부 항목(급여·월급 외 …)을,
   세부 항목 이름이면 사용처를 쪼개서 보여준다. */
function flowBreakdown(data, d, quad, name) {
  const major = quad === 'income' ? '수입' : quad === 'expense' ? '지출' : null;
  if (!major) return null;
  const nm = String(name || '').trim();
  if (!nm) return null;

  const months = (data.months || []);
  const i = d.latestPivotIdx;
  const keys = new Set();
  for (let k = Math.max(0, i - 5); k <= i; k++) {
    const m = months[k];
    if (!m) continue;
    const pk = pivotMonthKey(m);
    keys.add(`${Math.floor(pk / 100)}-${String(pk % 100).padStart(2, '0')}`);
  }
  const nMonths = keys.size || 1;
  const strip = (v) => String(v || '').replace(/[^\p{L}\p{N}]/gu, '');
  const target = strip(nm);
  const inWindow = (r) => keys.has(ledgerMonthKey(r.date));
  const rows = (data.ledger || []).filter(r => r.major.includes(major) && inWindow(r));
  const net = (r) => major === '지출' ? (r.amount - (r.refund || 0)) : r.amount;

  let level = 'item', hits = rows.filter(r => strip(r.minor) === target);
  if (!hits.length) { level = 'vendor'; hits = rows.filter(r => strip(r.item) === target); }
  if (!hits.length) { level = 'vendor'; hits = rows.filter(r => strip(r.vendor).includes(target) || strip(r.memo).includes(target)); }
  if (!hits.length) return null;

  const agg = {};
  hits.forEach(r => {
    const raw = level === 'item' ? (r.item || '기타') : ((r.vendor || r.memo || r.item || '기타').split('›').pop().trim() || '기타');
    agg[raw] = (agg[raw] || 0) + net(r);
  });
  const list = Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, avg: v / nMonths }));
  const total = list.reduce((a, x) => a + x.avg, 0);
  return { level, months: nMonths, total, list: list.slice(0, 10), count: hits.length };
}

/* ================= 돈의 흐름표 인사이트 =================
   칸(수입/지출/자산/부채) 전체를 누르면 그 칸의 요약과 인사이트,
   개별 항목을 누르면 그 항목의 추이·비중·인사이트를 오른쪽에 띄운다. */

/* 최근 N개월 월별 시계열 (수입·지출) 또는 자산 계좌 잔액 시계열 */
function fmSeriesFor(data, d, quad, name) {
  const months = (data.months || []);
  const i = d.latestPivotIdx;
  const keys = [];
  for (let k = Math.max(0, i - 11); k <= i; k++) {
    const m = months[k];
    if (!m) continue;
    const pk = pivotMonthKey(m);
    keys.push(`${Math.floor(pk / 100)}-${String(pk % 100).padStart(2, '0')}`);
  }
  const strip = (v) => String(v || '').replace(/[^\p{L}\p{N}]/gu, '');

  if (quad === 'income' || quad === 'expense') {
    const major = quad === 'income' ? '수입' : '지출';
    const net = (r) => major === '지출' ? (r.amount - (r.refund || 0)) : r.amount;
    const target = name ? strip(name) : null;
    const map = {};
    keys.forEach(k => { map[k] = 0; });
    (data.ledger || []).forEach(r => {
      if (!r.major.includes(major)) return;
      const k = ledgerMonthKey(r.date);
      if (!(k in map)) return;
      if (target && strip(r.minor) !== target && strip(r.item) !== target
        && !strip(r.vendor).includes(target)) return;
      map[k] += net(r);
    });
    return { keys, values: keys.map(k => map[k]), unit: 'flow' };
  }

  /* 자산: 계좌(또는 전체) 월말 잔액 */
  const am = d.assetMonths || [];
  const slice = am.slice(-12);
  const byM = {};
  slice.forEach(m => { byM[m] = 0; });
  (data.assetRows || []).forEach(r => {
    if (r.amount === null || !(r.date in byM)) return;
    if (name && strip(r.account) !== strip(name)) return;
    byM[r.date] += r.amount;
  });
  return { keys: slice, values: slice.map(m => byM[m]), unit: 'stock', labels: slice.map(assetMonthLabel) };
}

/* 시계열 → 인사이트 문장들 */
function fmInsights(series, ctx) {
  const out = [];
  const v = series.values.filter(x => typeof x === 'number');
  if (v.length < 2) return out;
  const closed = series.unit === 'flow' ? v.slice(0, -1) : v;   /* 진행 중인 달은 추세에서 제외 */
  if (closed.length < 2) return out;

  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const avg = closed.reduce((a, x) => a + x, 0) / closed.length;
  const half = Math.floor(closed.length / 2);
  const firstHalf = closed.slice(0, half).reduce((a, x) => a + x, 0) / (half || 1);
  const lastHalf = closed.slice(half).reduce((a, x) => a + x, 0) / (closed.length - half || 1);

  const money = (x) => formatCompactWon(Math.abs(Math.round(x)));

  if (prev !== 0) {
    const dp = ((last - prev) / Math.abs(prev)) * 100;
    if (Math.abs(dp) >= 5) {
      out.push({ tone: (ctx.goodUp ? dp > 0 : dp < 0) ? 'good' : 'warn',
        text: `직전 대비 <b>${dp > 0 ? '+' : '−'}${Math.abs(dp).toFixed(0)}%</b> (${money(last - prev)}원 ${dp > 0 ? '증가' : '감소'})` });
    } else {
      out.push({ tone: '', text: `직전과 거의 같아요 (${dp > 0 ? '+' : '−'}${Math.abs(dp).toFixed(0)}%)` });
    }
  }

  if (avg > 0) {
    const vsAvg = ((last - avg) / avg) * 100;
    out.push({ tone: Math.abs(vsAvg) < 10 ? '' : ((ctx.goodUp ? vsAvg > 0 : vsAvg < 0) ? 'good' : 'warn'),
      text: `기간 평균 ${money(avg)}원 대비 <b>${vsAvg > 0 ? '+' : '−'}${Math.abs(vsAvg).toFixed(0)}%</b>` });
  }

  if (firstHalf > 0) {
    const trend = ((lastHalf - firstHalf) / Math.abs(firstHalf)) * 100;
    if (Math.abs(trend) >= 8) {
      out.push({ tone: (ctx.goodUp ? trend > 0 : trend < 0) ? 'good' : 'warn',
        text: `${trend > 0 ? '우상향' : '우하향'} 추세 — 후반 절반이 전반보다 <b>${Math.abs(trend).toFixed(0)}%</b> ${trend > 0 ? '높음' : '낮음'}` });
    } else {
      out.push({ tone: '', text: '뚜렷한 추세 없이 횡보 중' });
    }
  }

  /* 변동성 (플로우만) */
  if (series.unit === 'flow' && avg > 0) {
    const sd = Math.sqrt(closed.reduce((a, x) => a + (x - avg) ** 2, 0) / closed.length);
    const cv = (sd / avg) * 100;
    out.push({ tone: cv > 60 ? 'warn' : '',
      text: cv > 60 ? `월별 편차가 커요 (변동계수 ${cv.toFixed(0)}%) — 평균만 믿기 어려움`
                    : `매달 비교적 일정해요 (변동계수 ${cv.toFixed(0)}%)` });
  }
  return out;
}

function fmSpark(values, color, labels) {
  const v = values.map(x => (typeof x === 'number' ? x : 0));
  if (!v.length) return '';
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const range = (max - min) || 1;
  return `<div class="fm-spark">${v.map((x, i) => `
    <span class="fs-bar" title="${labels ? labels[i] : ''} ${formatCompactWon(x)}원">
      <i style="height:${Math.max(((x - min) / range) * 100, 2)}%;background:${color};opacity:${i === v.length - 1 ? 1 : .5}"></i>
    </span>`).join('')}</div>`;
}

/* 칸 전체(수입/지출/자산/부채) 요약 + 인사이트 */
function fmQuadPanel(data, d, quadKey) {
  const q = FM_QUADS.find(x => x.key === quadKey);
  const fm = flowmapData();
  const items = (fm[quadKey] || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  const total = items.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const isFlow = quadKey === 'income' || quadKey === 'expense';
  const goodUp = quadKey === 'income' || quadKey === 'asset';

  const mIn = fm.income.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const mOut = fm.expense.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const assetSum = fm.asset.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const liaSum = fm.liability.reduce((a, x) => a + (Number(x.amount) || 0), 0);

  const series = quadKey === 'liability' ? null : fmSeriesFor(data, d, quadKey, null);
  const ins = series ? fmInsights(series, { goodUp }) : [];

  /* 칸 고유 인사이트 */
  const extra = [];
  if (quadKey === 'income') {
    const labor = items.find(x => /근로/.test(x.name));
    if (labor && total) {
      const pct = (Number(labor.amount) || 0) / total * 100;
      extra.push({ tone: pct > 85 ? 'warn' : 'good',
        text: `근로소득 의존도 <b>${pct.toFixed(0)}%</b>${pct > 85 ? ' — 수입원이 사실상 하나예요' : ' — 근로 외 채널이 살아 있어요'}` });
    }
    if (mOut) extra.push({ tone: mIn > mOut ? 'good' : 'warn',
      text: `월 지출 ${formatCompactWon(mOut)}원의 <b>${(mIn / mOut).toFixed(1)}배</b>를 벌고 있어요` });
  }
  if (quadKey === 'expense') {
    if (mIn) extra.push({ tone: (mOut / mIn) < 0.7 ? 'good' : 'warn',
      text: `수입의 <b>${((mOut / mIn) * 100).toFixed(0)}%</b>를 쓰고 있어요 (저축률 ${(100 - (mOut / mIn) * 100).toFixed(0)}%)` });
    const top = items[0];
    if (top && total) extra.push({ tone: '',
      text: `가장 큰 칸은 <b>${top.name}</b> — 지출의 ${((Number(top.amount) || 0) / total * 100).toFixed(0)}%` });
  }
  if (quadKey === 'asset') {
    const net = assetSum - liaSum;
    extra.push({ tone: '', text: `순자산 <b>${formatCompactWon(net)}원</b> (자산 ${formatCompactWon(assetSum)} − 부채 ${formatCompactWon(liaSum)})` });
    const save = mIn - mOut;
    if (save > 0) extra.push({ tone: '', text: `현재 순저축 속도면 자산이 두 배 되는 데 <b>${Math.ceil(assetSum / save)}개월</b>` });
    const top = items[0];
    if (top && total) extra.push({ tone: ((Number(top.amount) || 0) / total) > 0.6 ? 'warn' : '',
      text: `<b>${top.name}</b> 한 곳에 ${((Number(top.amount) || 0) / total * 100).toFixed(0)}%가 몰려 있어요` });
  }
  if (quadKey === 'liability') {
    if (!total) extra.push({ tone: 'good', text: '등록된 부채가 없어요. 순자산 = 총자산입니다.' });
    else {
      if (mIn) extra.push({ tone: '', text: `월 수입 대비 부채 잔액 <b>${(total / mIn).toFixed(1)}개월치</b>` });
      if (assetSum) extra.push({ tone: (total / assetSum) > 0.4 ? 'warn' : '', text: `자산 대비 부채 비율 <b>${((total / assetSum) * 100).toFixed(0)}%</b>` });
    }
  }

  const all = extra.concat(ins);
  return `
    <div class="fm-dt-h"><b style="color:${q.color}">${q.label} 전체</b>
      <span class="ptag">${items.length}개 항목</span></div>
    <div class="fm-kv"><span>${isFlow ? '월 합계' : '잔액 합계'}</span><b style="color:${q.color}">${formatWon(total)}</b></div>
    ${series ? `<div class="fm-sub" style="margin-top:10px;">
      <div class="fm-sub-h">최근 ${series.values.length}개월 추이</div>
      ${fmSpark(series.values, q.color, series.labels || series.keys)}
    </div>` : ''}
    ${all.length ? `<ul class="fm-ins">${all.map(x => `<li class="${x.tone}">${x.text}</li>`).join('')}</ul>` : ''}
    ${items.length ? `<div class="fm-sub">
      <div class="fm-sub-h">구성</div>
      ${items.map(x => {
        const amt = Number(x.amount) || 0;
        const pct = total ? (amt / total) * 100 : 0;
        return `<div class="fm-sub-row">
          <span class="nm">${x.name}</span>
          <span class="bar"><i style="width:${pct}%;background:${q.color}"></i></span>
          <span class="vl">${formatCompactWon(amt)}<em style="font-style:normal;color:var(--text-faint);margin-left:5px;">${pct.toFixed(0)}%</em></span>
        </div>`;
      }).join('')}
    </div>` : '<div class="empty-state" style="padding:12px 0;">항목이 없어요.</div>'}
  `;
}

function renderFmDetail(data, d) {
  const host = document.getElementById('fm-detail');
  if (!host) return;
  const fm = flowmapData();
  const sel = state.fmSel;
  const item = (sel && sel.id) ? (fm[sel.quad] || []).find(x => x.id === sel.id) : null;

  const mIn = fm.income.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const mOut = fm.expense.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const assetSum = fm.asset.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const liaSum = fm.liability.reduce((a, x) => a + (Number(x.amount) || 0), 0);

  /* 칸 전체가 선택된 경우 */
  if (sel && sel.whole) { host.innerHTML = fmQuadPanel(data, d, sel.quad); return; }

  if (!item) {
    host.innerHTML = `
      <div class="fm-dt-h"><b>전체 요약</b></div>
      <div class="fm-sum">
        <div class="stat-card"><div class="label">월 현금흐름</div><div class="value" style="color:${mIn - mOut >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatCompactWon(mIn - mOut)}원</div><div class="sub">수입 ${formatCompactWon(mIn)} − 지출 ${formatCompactWon(mOut)}</div></div>
        <div class="stat-card"><div class="label">순자산</div><div class="value">${formatCompactWon(assetSum - liaSum)}원</div><div class="sub">자산 ${formatCompactWon(assetSum)} − 부채 ${formatCompactWon(liaSum)}</div></div>
      </div>
      <ul class="fm-ins">
        ${mIn ? `<li class="${mIn > mOut ? 'good' : 'warn'}">저축률 <b>${(((mIn - mOut) / mIn) * 100).toFixed(0)}%</b> — 버는 돈의 ${((mOut / mIn) * 100).toFixed(0)}%가 나갑니다</li>` : ''}
        ${mOut ? `<li>지금 자산으로 소득이 끊겨도 <b>${(assetSum / mOut).toFixed(1)}개월</b> 버팁니다</li>` : ''}
        ${liaSum ? `<li class="warn">부채 ${formatCompactWon(liaSum)}원 — 자산의 ${((liaSum / (assetSum || 1)) * 100).toFixed(0)}%</li>` : '<li class="good">부채 없음</li>'}
      </ul>
      <div class="settings-note">칸 제목을 누르면 그 칸 전체, 항목을 누르면 항목별 인사이트가 여기 뜹니다.</div>`;
    return;
  }
  const q = FM_QUADS.find(x => x.key === sel.quad);
  host.innerHTML = `
    <div class="fm-dt-h">
      <b style="color:${q.color}">${item.name}</b>
      <div style="display:flex;gap:6px;">
        <button class="btn small" id="fm-edit">편집</button>
        <button class="btn small danger" id="fm-del">삭제</button>
      </div>
    </div>
    <div class="fm-kv"><span>구분</span><b>${q.label}</b></div>
    <div class="fm-kv"><span>${sel.quad === 'income' || sel.quad === 'expense' ? '월 금액' : '잔액'}</span><b>${item.amount ? formatWon(item.amount) : '—'}</b></div>
    ${item.tag ? `<div class="fm-kv"><span>태그</span><b>${item.tag}</b></div>` : ''}
    ${item.linkedTo ? `<div class="fm-kv"><span>연결</span><b>${item.linkedTo}</b></div>` : ''}
    ${item.memo ? `<div class="fm-memo">${item.memo.replace(/</g, '&lt;')}</div>` : ''}
    ${(() => {
      const goodUp = sel.quad === 'income' || sel.quad === 'asset';
      const series = sel.quad === 'liability' ? null : fmSeriesFor(data, d, sel.quad, item.name);
      if (!series || !series.values.some(x => x)) return '';
      const ins = fmInsights(series, { goodUp });
      const shareOf = (() => {
        const tot = (fm[sel.quad] || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
        return tot ? ((Number(item.amount) || 0) / tot) * 100 : null;
      })();
      return `<div class="fm-sub">
        <div class="fm-sub-h">최근 ${series.values.length}개월 추이</div>
        ${fmSpark(series.values, q.color, series.labels || series.keys)}
      </div>
      <ul class="fm-ins">
        ${shareOf !== null ? `<li>${FM_QUADS.find(x => x.key === sel.quad).label} 안에서 비중 <b>${shareOf.toFixed(0)}%</b></li>` : ''}
        ${ins.map(x => `<li class="${x.tone}">${x.text}</li>`).join('')}
      </ul>`;
    })()}
    ${(() => {
      const bd = flowBreakdown(data, d, sel.quad, item.name);
      if (!bd) return sel.quad === 'income' || sel.quad === 'expense'
        ? '<div class="fm-sub"><div class="fm-sub-h">세부 항목</div><div class="empty-state" style="padding:10px 0;font-size:11.5px;">가계부에서 이 이름과 맞는 내역을 찾지 못했어요.</div></div>'
        : '';
      const max = Math.max(...bd.list.map(x => Math.abs(x.avg)), 1);
      return `<div class="fm-sub">
        <div class="fm-sub-h">세부 항목 · 최근 ${bd.months}개월 월평균 (${bd.level === 'item' ? '항목별' : '사용처별'})</div>
        ${bd.list.map(x => `<div class="fm-sub-row">
          <span class="nm">${x.name}</span>
          <span class="bar"><i style="width:${Math.min(Math.abs(x.avg) / max * 100, 100)}%;background:${q.color}"></i></span>
          <span class="vl">${formatCompactWon(Math.round(x.avg))}</span>
        </div>`).join('')}
        <div class="fm-sub-row" style="border-top:1px solid var(--border-strong);margin-top:2px;">
          <span class="nm" style="color:var(--text)">합계</span><span class="bar"></span>
          <span class="vl" style="color:${q.color}">${formatCompactWon(Math.round(bd.total))}</span>
        </div>
      </div>`;
    })()}
  `;
  const ed = document.getElementById('fm-edit');
  if (ed) ed.addEventListener('click', () => openFlowItemEditor(sel.quad, item.id));
  const dl = document.getElementById('fm-del');
  if (dl) dl.addEventListener('click', async () => {
    const fm2 = flowmapData();
    fm2[sel.quad] = fm2[sel.quad].filter(x => x.id !== item.id);
    state.fmSel = null;
    await saveSettings();
    renderPage();
  });
}

function openFlowItemEditor(quad, id) {
  const fm = flowmapData();
  const q = FM_QUADS.find(x => x.key === quad);
  const cur = id ? (fm[quad] || []).find(x => x.id === id) : null;
  const isFlow = quad === 'income' || quad === 'expense';
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head"><b>${q.label} — ${cur ? '항목 편집' : '항목 추가'}</b><button class="btn small" data-act="close">닫기</button></div>
      <div class="modal-body">
        <label class="fld"><span>이름</span><input type="text" id="fm-name" value="${cur ? (cur.name || '').replace(/"/g, '&quot;') : ''}" placeholder="${quad === 'income' ? '예) 급여' : quad === 'expense' ? '예) 신용카드 사용액' : quad === 'asset' ? '예) 토스 증권' : '예) 학자금 대출'}" /></label>
        <div class="fld-row">
          <label class="fld"><span>${isFlow ? '월 금액 (원)' : '잔액 (원)'}</span><input type="text" inputmode="numeric" id="fm-amount" value="${cur && cur.amount ? wonComma(cur.amount) : ''}" /></label>
          <label class="fld"><span>태그 (선택)</span><input type="text" id="fm-tag" value="${cur ? (cur.tag || '').replace(/"/g, '&quot;') : ''}" placeholder="예) 고정비 / 근로" /></label>
        </div>
        <label class="fld"><span>연결 (선택) — 이 항목이 어디로 흘러가는지</span><input type="text" id="fm-link" value="${cur ? (cur.linkedTo || '').replace(/"/g, '&quot;') : ''}" placeholder="예) 급여 → 토스 증권" /></label>
        <label class="fld"><span>상세</span><textarea id="fm-memo" rows="5" style="background:var(--panel-2);border:1px solid var(--border-strong);color:var(--text);font-family:var(--sans);font-size:13px;border-radius:7px;padding:8px 10px;width:100%;resize:vertical;">${cur ? (cur.memo || '') : ''}</textarea></label>
      </div>
      <div class="modal-foot">
        ${cur ? '<button class="btn small danger" data-act="delete">삭제</button>' : '<span></span>'}
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
    const a = act.dataset.act;
    if (a === 'close') { back.remove(); return; }
    if (a === 'delete') {
      fm[quad] = fm[quad].filter(x => x.id !== id);
      if (state.fmSel && state.fmSel.id === id) state.fmSel = null;
      await saveSettings(); back.remove(); renderPage(); return;
    }
    if (a === 'save') {
      const g = (i) => (document.getElementById(i) || {}).value || '';
      const name = g('fm-name').trim();
      if (!name) { back.remove(); return; }
      const obj = {
        id: id || uid(),
        name,
        amount: Number(String(g('fm-amount')).replace(/[^0-9.-]/g, '')) || 0,
        tag: g('fm-tag').trim(),
        linkedTo: g('fm-link').trim(),
        memo: g('fm-memo')
      };
      if (id) fm[quad] = fm[quad].map(x => x.id === id ? obj : x);
      else fm[quad].push(obj);
      state.fmSel = { quad, id: obj.id };
      await saveSettings();
      back.remove();
      renderPage();
    }
  });
}

/* 가계부·자산 스냅샷에서 흐름표 초안을 만들어 준다 (기존 항목은 유지, 이름이 겹치면 건너뜀) */
async function seedFlowMap(data, d) {
  const fm = flowmapData();
  const has = (k, n) => fm[k].some(x => x.name === n);
  const push = (k, name, amount, memo, tag) => { if (!has(k, name)) fm[k].push({ id: uid(), name, amount: Math.round(amount) || 0, tag: tag || '', linkedTo: '', memo: memo || '' }); };

  const i = d.latestPivotIdx;
  const last6 = (arr) => { const v = (arr || []).slice(Math.max(0, i - 5), i + 1).filter(x => x !== undefined); return v.length ? v.reduce((a, b) => a + (b || 0), 0) / v.length : 0; };

  Object.entries(data.incomeCategories || {}).forEach(([k, v]) => {
    const avg = last6(v);
    if (avg > 0) push('income', k, avg, `최근 6개월 월평균 ${formatWon(Math.round(avg))}`, '수입');
  });
  Object.entries(data.expenseCategories || {}).forEach(([k, v]) => {
    const avg = last6(v);
    if (avg > 0) push('expense', k, avg, `최근 6개월 월평균 ${formatWon(Math.round(avg))}`, '지출');
  });
  const accounts = {};
  (data.assetRows || []).filter(r => r.date === d.latestMonth && r.amount !== null).forEach(r => {
    accounts[r.account] = { amt: (accounts[r.account] ? accounts[r.account].amt : 0) + r.amount, cat: r.category };
  });
  Object.entries(accounts).sort((a, b) => b[1].amt - a[1].amt).forEach(([n, v]) => {
    push('asset', n, v.amt, `${d.latestMonth} 잔액`, v.cat);
  });
  (state.settings.debts || []).forEach(x => push('liability', x.name, x.balance, x.memo || '', '부채'));

  await saveSettings();
  renderPage();
}


function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="site-header" id="site-header">
      <div class="topbar">
        <div class="brand">
          <span class="mark">🦦</span>
          <h1>해달</h1>
          <span class="tagline">당신의 자산관리 파트너</span>
        </div>
        <div class="sync-box">
          <button class="hdr-btn" id="signout-btn">로그아웃</button>
        </div>
      </div>
      <div id="banner-slot"></div>
      <div class="navrow">
        <nav class="navbar" id="navbar"></nav>
        <div class="navacts">
          <button class="nav-act accent" id="entry-btn" title="가계부 기록 (N)">＋ 기록<kbd>N</kbd></button>
        </div>
      </div>
    </div>
    <div id="page-content"></div>
    <div class="footer"></div>
  `;
  document.getElementById('entry-btn').addEventListener('click', () => enOpen());
  document.getElementById('signout-btn').addEventListener('click', enSignOut);
  document.getElementById('navbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    goTo(btn.dataset.page, btn.dataset.sub);
  });
  renderNav();
  enSyncHeaderOffset();
}

function renderBanner() {
  const slot = document.getElementById('banner-slot');
  if (!slot) return;
  const tabLabels = { [GID_LEDGER_D]: '가계부(D)', [GID_ASSETS]: '자산 스냅샷', [GID_GOALS]: '목표', [GID_CLASSIFY]: '분류', [GID_INDEX]: '지수_S&P500' };
  const testLinks = TAB_GIDS.map(g => `<a href="${csvUrlFor(g)}" target="_blank" rel="noopener" style="color:var(--accent-text);">${tabLabels[g]}</a>`).join(' · ');

  if (state.source === 'snapshot' && state.lastError) {
    const isNetworkFail = /failed to fetch|시트 접근/i.test(state.lastError);
    slot.innerHTML = `
      <div class="banner err" style="align-items:flex-start;">
        <span>
          ⚠ 실시간 데이터를 불러오지 못해 저장된 스냅샷을 보여주고 있어요. (${state.lastError})
          ${isNetworkFail ? `
          <div style="margin-top:8px;font-size:12px;line-height:1.7;">
            1) 4개 탭 모두 <b>공유</b> → 일반 액세스를 <b>"링크가 있는 모든 사용자"</b> + 권한 <b>"뷰어"</b>로 설정 (탭마다 따로 안 해도 문서 전체 공유 설정 하나면 돼요)<br/>
            2) 시크릿 창(로그인 안 한 상태)에서 아래 탭별 링크가 로그인 없이 CSV로 열리는지 확인: ${testLinks}<br/>
            로그인 화면이 뜨는 탭이 있으면 그게 원인이에요.
          </div>` : `<div style="margin-top:6px;font-size:12px;">탭별 확인: ${testLinks}</div>`}
        </span>
        <button class="btn small" id="retry-btn" style="margin-left:auto;flex-shrink:0;">다시 시도</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => fetchLive(true));
  } else if (state.source === 'live' && state.lastError) {
    slot.innerHTML = `
      <div class="banner" style="align-items:flex-start;">
        <span>ℹ️ ${state.lastError}</span>
        <button class="btn small" id="retry-btn" style="margin-left:auto;flex-shrink:0;">다시 시도</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => fetchLive(true));
  } else {
    slot.innerHTML = '';
  }
}

function destroyPageCharts() {
  Object.values(state.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
  state.charts = {};
}

/* 이번 달 자산 스냅샷이 아직 비어 있으면 탭에 빨간 점을 띄운다.
   달이 바뀌면(1일부터) 자동으로 켜지고, 그 달 값을 한 줄이라도 넣으면 사라진다. */
function snapNeedsInput() {
  const rows = (state.data && state.data.assetRows) || [];
  if (!rows.length) return false;
  const now = new Date();
  const k = now.getFullYear() * 100 + (now.getMonth() + 1);
  return !rows.some(r => assetMonthKey(r.date) === k);
}
function navNeedsDot(section, sub) {
  return section === 'data' && sub === 'snapshot' && snapNeedsInput();
}

/* 상·하위 탭을 한 줄에 모두 노출한다. 그룹 라벨 + 알약 버튼 + 구분자. */
function renderNav() {
  const bar = document.getElementById('navbar');
  if (!bar) return;
  bar.innerHTML = NAV_ITEMS.map(n => {
    const on = n.id === state.page;
    const cur = currentSub(n.id);
    /* solo 그룹은 분류 라벨 없이 버튼 하나로만 그린다 (예: 홈) */
    if (n.solo) {
      const v = ((SECTION_SUBS[n.id] || [])[0] || ['main'])[0];
      return `<div class="nav-group${on ? ' on' : ''}">`
        + `<button class="nav-btn${on ? ' active' : ''}" data-page="${n.id}" data-sub="${v}">${n.label}</button>`
        + `</div>`;
    }
    return `<div class="nav-group${on ? ' on' : ''}">
      <span class="nav-group-label">${n.label}</span>
      ${(SECTION_SUBS[n.id] || []).map(([v, l]) =>
        `<button class="nav-btn${on && v === cur ? ' active' : ''}" data-page="${n.id}" data-sub="${v}">${l}${
          navNeedsDot(n.id, v) ? '<span class="nav-dot" title="이번 달 자산 스냅샷이 아직 비어 있어요"></span>' : ''}</button>`).join('')}
    </div>`;
  }).join('<span class="nav-div"></span>');
}

function renderPage() {
  const _now = new Date();
  const _nowKey = _now.getFullYear() * 100 + (_now.getMonth() + 1);
  const raw = state.data;
  /* 미래(오늘 이후) 자산 스냅샷 행은 화면 전체에서 제외 */
  const data = { ...raw, assetRows: (raw.assetRows || []).filter(r => assetMonthKey(r.date) <= _nowKey) };
  const d = computeDerived(data);
  destroyPageCharts();
  const body = document.getElementById('page-content');
  const section = NAV_ITEMS.some(n => n.id === state.page) ? state.page : 'home';
  state.page = section;
  const SUB = currentSub(section);
  routeWrite(section, SUB);
  renderNav();
  body.innerHTML = '';

  if (section === 'home') {
    renderHomePage(body, data, d);
  } else if (section === 'flow') {
    if (SUB === 'now') renderNowPage(body, data, d);
    else if (SUB === 'year') renderYearPage(body, data, d);
    else if (SUB === 'calendar') renderCalendarPage(body, data, d);
    else if (SUB === 'flowmap') renderFlowMapPage(body, data, d);
    else renderTodayPage(body, data, d);
  } else if (section === 'assets') {
    if (SUB === 'overview') renderAssetsPage(body, data, d);
    else if (SUB === 'investment') renderInvestmentPage(body, data, d);
    else if (SUB === 'pension') renderSavingsPage(body, data, d, 'pension');
    else renderSavingsPage(body, data, d, 'saving');
  } else if (section === 'todo') {
    if (SUB === 'structure') renderStructurePage(body, data, d);
    else if (SUB === 'fixed') renderFixedPage(body);
    else { body.innerHTML = '<div id="home-goals"></div>'; renderGoalBoard(data, d); }
  } else {
    if (SUB === 'snapshot') renderSnapshotPage(body);
    else if (SUB === 'dbm') dbmRender(body);
    else renderLedgerShell(body);
  }
}


/* ================= Supabase : 로그인 · 가계부 기록 · 전체 내역 ================= */
const SB_URL  = 'https://rjxmrpifrhybucexuvli.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqeG1ycGlmcmh5YnVjZXh1dmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjU1OTAsImV4cCI6MjEwMTE0MTU5MH0.xSzE02pjZYqbx9nPLb8RVsQF9w7hJHEx2cO0JDOLLSU';

const EN = {
  sb: null, cats: [], catById: {}, freq: {}, merchants: [], merchCat: {}, merchFixed: {},
  catId: null, neg: false, loaded: false,
  repeat: [],              // 이번 달 미기록 고정비 후보
  lg: { q: '', kind: 'all', cat: 'all', from: '', to: '', quick: '3m', sort: 'date_desc', page: 1, size: 60 },
  draft: []
};
const EN_WD = ['일', '월', '화', '수', '목', '금', '토'];

async function enClient() {
  if (EN.sb) return EN.sb;
  if (window.__SB_MOD) { EN.sb = window.__SB_MOD.createClient(SB_URL, SB_ANON); return EN.sb; }
  const mod = await import('https://esm.sh/@supabase/supabase-js@2');
  EN.sb = mod.createClient(SB_URL, SB_ANON);
  return EN.sb;
}
const enQS = (sel) => document.querySelector(sel);
const enComma = (n) => Number(n).toLocaleString('ko-KR');
const enEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function enToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function enToast(msg) {
  let t = document.getElementById('en-toast');
  if (!t) { t = document.createElement('div'); t.id = 'en-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 1700);
}

/* ---------------- 전체 로그인 게이트 ---------------- */
function enShowLock(msg) {
  let el = document.getElementById('lockscreen');
  if (!el) { el = document.createElement('div'); el.id = 'lockscreen'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="lock-card">
      <div class="lock-mark" aria-hidden="true">🦦</div>
      <h2>해달</h2>
      <p class="sub">${msg || '자산 현황을 보려면 로그인하세요.'}</p>
      <div>
        <label class="en-lab" for="lk-em">이메일</label>
        <input class="en-in" id="lk-em" type="email" autocomplete="username" inputmode="email">
      </div>
      <div>
        <label class="en-lab" for="lk-pw">비밀번호</label>
        <input class="en-in" id="lk-pw" type="password" autocomplete="current-password">
      </div>
      <p class="en-err" id="lk-err"></p>
      <button class="en-cta" id="lk-go">로그인</button>
    </div>`;
  const go = async () => {
    const email = enQS('#lk-em').value.trim(), password = enQS('#lk-pw').value;
    if (!email || !password) { enQS('#lk-err').textContent = '이메일과 비밀번호를 모두 입력하세요.'; return; }
    enQS('#lk-go').disabled = true; enQS('#lk-err').textContent = '';
    const { error } = await (await enClient()).auth.signInWithPassword({ email, password });
    enQS('#lk-go').disabled = false;
    if (error) { enQS('#lk-err').textContent = '로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요.'; return; }
    el.remove();
    init();
  };
  enQS('#lk-go').addEventListener('click', go);
  enQS('#lk-pw').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  enQS('#lk-em').focus();
}
async function enSignOut() {
  await (await enClient()).auth.signOut();
  location.reload();
}

/* 사용처 사전 — 거래에 쓰인 이름 + 직접 등록한 이름을 합쳐 둔다 */
async function enLoadAllMerchants() {
  if (EN.merchLoading) return;
  EN.merchLoading = true;
  try {
    const sb = await enClient();
    const seen = {};
    (EN.merchants || []).forEach(m => { seen[m] = 1; });
    for (let from = 0; from < 40000; from += 1000) {
      const { data, error } = await sb.from('v_transactions')
        .select('merchant,merchant_group')
        .not('merchant', 'is', null)
        .order('id', { ascending: false }).range(from, from + 999);
      if (error || !data || !data.length) break;
      data.forEach(r => {
        const m = String(r.merchant || '').trim();
        if (!m) return;
        if (!seen[m]) { seen[m] = 1; EN.merchants.push(m); }
        if (r.merchant_group && !EN.merchGroup[m]) EN.merchGroup[m] = r.merchant_group;
      });
      if (data.length < 1000) break;
    }
    /* 아직 거래가 없는, 직접 등록만 해 둔 사용처 */
    const { data: reg } = await sb.from('merchants').select('name,merchant_group,is_fixed');
    (reg || []).forEach(r => {
      const m = String(r.name || '').trim();
      if (!m) return;
      if (!seen[m]) { seen[m] = 1; EN.merchants.push(m); }
      if (r.merchant_group) EN.merchGroup[m] = r.merchant_group;
      if (r.is_fixed) EN.merchFixed[m] = true;
    });
    EN.merchants.sort((a, b) => a.localeCompare(b, 'ko'));
  } catch (e) { /* 다음 열 때 다시 시도된다 */ }
  EN.merchLoading = false;
}

/* ---------- 사용처 = 고정비 ----------
   고정비는 원래 기록 한 줄마다 손으로 찍던 값이었다. 그런데 '넷플릭스'가 고정비면
   넷플릭스로 찍힌 모든 줄이 고정비다 — 줄마다 판단할 일이 아니라 사용처의 성질이다.
   그래서 기준은 사용처에 두고, 기록은 그 기준을 따라간다. */
function enMerchFixed(name) {
  return !!(EN.merchFixed && EN.merchFixed[String(name || '').trim()]);
}

/* 지정/해제 + 과거 기록 일괄 반영. past 가 true 면 그 사용처의 기록 전체를 맞춘다. */
async function enSetMerchantFixed(name, on, past) {
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, moved: 0 };
  const sb = await enClient();
  const { error } = await sb.from('merchants')
    .upsert({ name: nm, is_fixed: !!on }, { onConflict: 'owner_id,name' });
  if (error) return { ok: false, moved: 0 };
  if (on) EN.merchFixed[nm] = true; else delete EN.merchFixed[nm];
  let moved = 0;
  if (past) {
    const { data, error: e2 } = await sb.from('transactions')
      .update({ is_fixed: !!on }).eq('merchant', nm).neq('is_fixed', !!on).select('id');
    if (!e2) moved = (data || []).length;
  }
  return { ok: true, moved };
}

/* 사용처를 사전에만 등록한다 — 거래 없이도 자동완성에 뜨게 */
async function enRegisterMerchant(name, group) {
  const nm = String(name || '').trim();
  if (!nm) return false;
  const sb = await enClient();
  const { error } = await sb.from('merchants')
    .upsert({ name: nm, merchant_group: group || null }, { onConflict: 'owner_id,name' });
  if (error) return false;
  if (!EN.merchants.includes(nm)) EN.merchants.push(nm);
  if (group) EN.merchGroup[nm] = group;
  EN.merchants.sort((a, b) => a.localeCompare(b, 'ko'));
  return true;
}

/* ---------------- 참조 데이터 ---------------- */
async function enEnsureRefs() {
  if (EN.loaded) return;
  const sb = await enClient();
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  const [catRes, recentRes, fixRes] = await Promise.all([
    sb.from('categories').select('id,kind,category,subcategory,emoji_category,sort_order')
      .neq('kind', '자산').eq('is_active', true).order('sort_order'),
    /* 여기서는 '자주 쓰는 분류' 계산용이라 최근 1000건이면 충분하다.
       전체 사용처 목록은 enLoadAllMerchants 가 따로 끝까지 읽는다. */
    sb.from('transactions').select('category_id,merchant,merchant_group').gte('date', since)
      .order('date', { ascending: false }).limit(1000),
    /* 고정비로 지정된 사용처는 많지 않다. 첫 그림부터 맞게 그리려면 여기서 같이 받아야 한다. */
    sb.from('merchants').select('name').eq('is_fixed', true)
  ]);
  EN.cats = catRes.data || [];
  EN.catById = {};
  EN.cats.forEach(c => { EN.catById[c.id] = c; });

  EN.freq = {};
  const mc = {};
  EN.merchGroup = {};
  (recentRes.data || []).forEach(r => {
    EN.freq[r.category_id] = (EN.freq[r.category_id] || 0) + 1;
    if (r.merchant) {
      mc[r.merchant] = mc[r.merchant] || {};
      mc[r.merchant][r.category_id] = (mc[r.merchant][r.category_id] || 0) + 1;
      if (r.merchant_group && !EN.merchGroup[r.merchant]) EN.merchGroup[r.merchant] = r.merchant_group;
    }
  });
  EN.merchFixed = {};
  (fixRes && fixRes.data || []).forEach(r => {
    const m = String(r.name || '').trim();
    if (m) EN.merchFixed[m] = true;
  });
  EN.merchants = Object.keys(mc);
  /* PostgREST 는 한 번에 1000행까지만 준다. limit 을 크게 줘도 소용없어서
     range 로 끝까지 넘겨 읽어야 오래된 사용처까지 자동완성에 나온다. */
  enLoadAllMerchants();
  EN.merchCat = {};
  Object.keys(mc).forEach(m => {
    let best = null, n = -1;
    Object.keys(mc[m]).forEach(cid => { if (mc[m][cid] > n) { n = mc[m][cid]; best = Number(cid); } });
    EN.merchCat[m] = best;
  });
  EN.loaded = true;
}

/* ---------------- 오버레이 ---------------- */
function enOverlay() {
  let ov = document.getElementById('en-ov');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'en-ov';
  ov.hidden = true;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', '가계부 기록');
  ov.addEventListener('click', e => { if (e.target === ov) enClose(); });
  document.body.appendChild(ov);
  return ov;
}
function enClose() {
  const ov = document.getElementById('en-ov');
  if (ov) ov.hidden = true;
  document.body.style.overflow = '';
  const b = document.getElementById('entry-btn');
  if (b) b.focus();
}
async function enOpen() {
  const ov = enOverlay();
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  ov.innerHTML = '<div class="en-modal"><div class="en-empty">불러오는 중…</div></div>';
  await enEnsureRefs();
  enRenderEntry();
}

function enRenderEntry() {
  const ov = document.getElementById('en-ov');
  ov.innerHTML = `
    <div class="en-modal">
      <div class="en-head">
        <h3>가계부 기록</h3>
        <button class="en-x" id="en-close" aria-label="닫기">×</button>
      </div>
      <div class="en-two">
        <div>
          <div class="en-fld" id="en-repwrap" hidden>
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 5px;">
              <span class="en-lab" style="margin:0;">이번 달 아직 안 넣은 고정비</span>
              <span class="en-sub" style="margin:0;" id="en-repcount"></span>
            </div>
            <div class="en-rep" id="en-repeat"></div>
          </div>

          <div class="en-fld">
            <label class="en-lab" for="en-merch">사용처</label>
            <input class="en-in" id="en-merch" autocomplete="off" placeholder="예: 매머드커피"
                   role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="en-ac">
            <div class="en-ac" id="en-ac" role="listbox" hidden></div>
          </div>

          <div class="en-fld">
            <label class="en-lab" for="en-amt">금액</label>
            <div class="en-money">
              <span class="en-kind-badge none" id="en-kind">분류 미선택</span>
              <input class="en-amt" id="en-amt" inputmode="numeric" placeholder="0" autocomplete="off">
              <span class="en-won">원</span>
            </div>
          </div>

          <div class="en-fld">
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 5px;">
              <span class="en-lab" style="margin:0;">분류</span>
              <button class="btn small" id="en-more">전체 보기</button>
            </div>
            <input class="en-catsearch" id="en-catq" placeholder="분류 검색 — 예: 카페, 택시" autocomplete="off">
            <div class="en-chips" id="en-top"></div>
            <div class="en-more" id="en-morebox"></div>
          </div>

          <div class="en-fld">
            <label class="en-lab" for="en-date">날짜</label>
            <input class="en-in" id="en-date" type="date" value="${enToday()}" style="color-scheme:dark;">
          </div>
          <div class="en-fld">
            <label class="en-lab" for="en-note">메모 <span style="color:var(--text-faint);">— 선택</span></label>
            <input class="en-in" id="en-note" autocomplete="off">
          </div>

          <div class="en-tgs">
            <button class="en-tg" id="en-co" aria-pressed="false">🏢 회사비</button>
            <button class="en-tg" id="en-fx" aria-pressed="false">📌 고정비</button>
            <button class="en-tg en-tg-good" id="en-good" aria-pressed="false">👍 Good</button>
            <button class="en-tg en-tg-bad" id="en-bad" aria-pressed="false">👎 Bad</button>
          </div>

          <p class="en-err" id="en-serr"></p>
          <button class="en-cta" id="en-save">기록하기 <kbd class="en-kbd">Ctrl</kbd><kbd class="en-kbd">Enter</kbd></button>
        </div>

        <div class="en-side">
          <span class="en-lab">방금 기록한 것</span>
          <p class="en-sub">최근 날짜순 8건</p>
          <div id="en-recent"><div class="en-empty">불러오는 중…</div></div>
        </div>
      </div>
    </div>`;

  enQS('#en-close').addEventListener('click', enClose);
  enQS('#en-more').addEventListener('click', () => {
    const box = enQS('#en-morebox');
    const open = box.classList.toggle('open');
    enQS('#en-more').textContent = open ? '접기' : '전체 보기';
    if (open && !box.dataset.built) { enBuildAllChips(); box.dataset.built = '1'; }
  });

  enSetupMerchant();
  enSetupCatSearch();
  enLoadRepeat();

  /* 금액 : 키보드 − 허용 */
  const amt = enQS('#en-amt');
  amt.addEventListener('input', () => {
    const t = amt.value;
    const minus = /^\s*[-−]/.test(t);
    const raw = t.replace(/[^\d]/g, '');
    if (minus !== EN.neg) { EN.neg = minus; amt.classList.toggle('neg', EN.neg); }
    amt.value = raw ? (EN.neg ? '−' : '') + enComma(raw) : (EN.neg ? '−' : '');
  });
  amt.addEventListener('keydown', e => { if (e.key === 'Enter') enSave(); });

  ['#en-co', '#en-fx'].forEach(sel => enQS(sel).addEventListener('click', () => {
    const el = enQS(sel);
    el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }));
  const pair = (x, y) => enQS(x).addEventListener('click', () => {
    const on = enQS(x).getAttribute('aria-pressed') === 'true';
    enQS(x).setAttribute('aria-pressed', String(!on));
    enQS(y).setAttribute('aria-pressed', 'false');
  });
  pair('#en-good', '#en-bad'); pair('#en-bad', '#en-good');

  enQS('#en-save').addEventListener('click', enSave);
  enQS('.en-modal').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); enSave(); }
  });
  enBuildTopChips();
  enSyncCat();
  enLoadRecent();
  enQS('#en-merch').focus();
}

/* 사용처 자동완성 : 분류까지 함께 보여준다.
   기록 창과 목록 화면이 같은 사용처 사전을 쓴다. */
function enAttachMerchantAC(inp, box, opt) {
  const o = opt || {};
  let list = [], cur = -1;

  const close = () => { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); cur = -1; };
  const pick = (name) => {
    const gp = (EN.merchGroup && EN.merchGroup[name]) || '';
    inp.value = o.withGroup ? ((gp ? gp + ' › ' : '') + name) : name;
    close();
    if (o.onPick) o.onPick(name);
  };
  const paint = () => {
    box.querySelectorAll('.en-ac-item').forEach((el, k) => el.classList.toggle('on', k === cur));
  };
  const open = () => {
    const rawv = inp.value.trim();
    const q = (rawv.includes('›') ? rawv.split('›').slice(1).join('›') : rawv).trim().toLowerCase();
    const pool = EN.merchants;
    const gOf = (m) => (EN.merchGroup && EN.merchGroup[m]) || '';
    list = (q ? pool.filter(m => m.toLowerCase().includes(q) || gOf(m).toLowerCase().includes(q)) : pool).slice(0, 40);
    if (!list.length) { close(); return; }
    box.innerHTML = list.map((m, k) => {
      const c = EN.catById[EN.merchCat[m]];
      const gp = gOf(m);
      let nm = enEsc(m);
      if (q) {
        const at = m.toLowerCase().indexOf(q);
        if (at >= 0) nm = enEsc(m.slice(0, at)) + '<mark>' + enEsc(m.slice(at, at + q.length)) + '</mark>' + enEsc(m.slice(at + q.length));
      }
      return `<div class="en-ac-item" role="option" data-k="${k}" aria-selected="false">
        ${gp ? `<span class="gp">${enEsc(gp)}</span>` : ''}
        <span class="nm">${nm}</span>
        <span class="ct">${c ? enEsc(c.category) + ' › ' + enEsc(c.subcategory) : '분류 없음'}</span>
      </div>`;
    }).join('');
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    cur = -1;
    box.querySelectorAll('.en-ac-item').forEach(el =>
      el.addEventListener('mousedown', e => { e.preventDefault(); pick(list[Number(el.dataset.k)]); }));
  };

  inp.addEventListener('mousedown', () => setTimeout(open, 0));
  inp.addEventListener('input', open);
  inp.addEventListener('blur', () => setTimeout(close, 120));
  inp.addEventListener('keydown', e => {
    if (box.hidden) {
      if (e.key === 'Enter') { e.preventDefault(); if (o.onNext) o.onNext(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0) pick(list[cur]);
      else { close(); if (o.onNext) o.onNext(); }
    } else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

function enSetupMerchant() {
  enAttachMerchantAC(enQS('#en-merch'), enQS('#en-ac'), {
    withGroup: true,
    onNext: () => enQS('#en-amt').focus(),
    onPick: (name) => {
      const cid = EN.merchCat[name];
      if (cid) { EN.catId = cid; enSyncCat(); }
      const fx = enQS('#en-fx');
      if (fx && enMerchFixed(name)) fx.setAttribute('aria-pressed', 'true');
      enQS('#en-amt').focus();
    }
  });
}

/* 분류 검색 */
function enSetupCatSearch() {
  const q = enQS('#en-catq');
  if (!q) return;
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    const box = enQS('#en-top');
    if (!t) { enBuildTopChips(); return; }
    const hit = EN.cats.filter(c =>
      (c.subcategory + ' ' + c.category + ' ' + c.kind).toLowerCase().includes(t)).slice(0, 8);
    box.innerHTML = hit.length ? hit.map(enChipHTML).join('')
      : '<div class="en-empty" style="grid-column:1/-1;">일치하는 분류가 없습니다.</div>';
    enBindChips(box);
  });
}

function enChipHTML(c) {
  return `<button class="en-chip" data-id="${c.id}" aria-pressed="${EN.catId === c.id}">
    <span class="k ${c.kind}" aria-hidden="true"></span>
    <span class="e" aria-hidden="true">${c.emoji_category || ''}</span>
    <span class="t">${enEsc(c.subcategory)}</span></button>`;
}
function enBindChips(scope) {
  scope.querySelectorAll('.en-chip').forEach(el => {
    el.addEventListener('click', () => {
      EN.catId = Number(el.dataset.id);
      enSyncCat();
      enQS('#en-serr').textContent = '';
      if (!enQS('#en-amt').value) enQS('#en-amt').focus();
    });
  });
}
function enBuildTopChips() {
  const top = [...EN.cats].sort((a, b) => (EN.freq[b.id] || 0) - (EN.freq[a.id] || 0)).slice(0, 8);
  const box = enQS('#en-top');
  box.innerHTML = top.map(enChipHTML).join('');
  enBindChips(box);
}
function enBuildAllChips() {
  const box = enQS('#en-morebox');
  box.innerHTML = ['지출', '수입', '이체'].map(k => {
    const list = EN.cats.filter(c => c.kind === k);
    if (!list.length) return '';
    return `<div class="en-grouplab">${k}</div><div class="en-chips">${list.map(enChipHTML).join('')}</div>`;
  }).join('');
  enBindChips(box);
}
function enSyncCat() {
  document.querySelectorAll('.en-chip').forEach(x =>
    x.setAttribute('aria-pressed', String(Number(x.dataset.id) === EN.catId)));
  const badge = enQS('#en-kind');
  if (!badge) return;
  const c = EN.catById[EN.catId];
  badge.className = 'en-kind-badge ' + (c ? c.kind : 'none');
  badge.textContent = c ? c.kind + ' · ' + c.subcategory : '분류 미선택';
}

/* ---------------- 반복(고정비) 칩 ----------------
   📌 고정비로 찍힌 과거 거래에서 사용처별 최신 1건을 뽑아,
   이번 달에 아직 같은 사용처 기록이 없는 것만 후보로 남긴다.
   한 번 누르면 사용처·금액·분류·날짜가 한꺼번에 채워진다. */
function enDayShift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

async function enLoadRepeat() {
  const wrap = enQS('#en-repwrap');
  if (!wrap) return;
  let rows = [];
  try {
    const { data } = await (await enClient()).from('transactions')
      .select('date,amount,category_id,merchant,merchant_group,note,company_paid')
      .eq('is_fixed', true)
      .gte('date', enDayShift(-120))
      .order('date', { ascending: false })
      .limit(1000);
    rows = data || [];
  } catch (e) { rows = []; }

  const today = enToday();
  const monthStart = today.slice(0, 8) + '01';
  const cutoff = enDayShift(-70);   // 70일 넘게 안 나온 건 끊긴 것으로 본다

  const doneThisMonth = {};
  const latest = {};
  rows.forEach(r => {
    const m = String(r.merchant || '').trim();
    if (!m) return;
    if (r.date >= monthStart) { doneThisMonth[m] = true; return; }
    if (!latest[m]) latest[m] = r;      // 이미 날짜 내림차순이라 첫 건이 최신
  });

  EN.repeat = Object.keys(latest)
    .filter(m => !doneThisMonth[m] && latest[m].date >= cutoff)
    .map(m => {
      const r = latest[m];
      const day = Number(r.date.slice(8, 10));
      /* 지난달과 같은 일자로 이번 달 날짜를 만든다. 미래면 오늘로 당긴다. */
      let date = today.slice(0, 8) + String(day).padStart(2, '0');
      if (date > today) date = today;
      return {
        merchant: m, group: r.merchant_group || null,
        amount: Number(r.amount) || 0, catId: r.category_id,
        note: r.note || '', co: !!r.company_paid, day, date
      };
    })
    .sort((a, b) => a.day - b.day);

  enRenderRepeat();
}

function enRenderRepeat() {
  const wrap = enQS('#en-repwrap');
  const box = enQS('#en-repeat');
  if (!wrap || !box) return;
  if (!EN.repeat.length) { wrap.hidden = true; box.innerHTML = ''; return; }
  wrap.hidden = false;
  enQS('#en-repcount').textContent = EN.repeat.length + '건 남음';
  box.innerHTML = EN.repeat.map((r, i) => {
    const abs = Math.abs(r.amount);
    return `<button class="en-repchip" data-i="${i}" title="${enEsc(r.merchant)} — 눌러서 채우기">
      <span class="m">${enEsc(r.merchant)}</span>
      <span class="v">${enComma(abs)}원</span>
      <span class="d">${r.day}일</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.en-repchip').forEach(el =>
    el.addEventListener('click', () => enApplyRepeat(EN.repeat[Number(el.dataset.i)])));
}

function enApplyRepeat(r) {
  if (!r) return;
  enQS('#en-merch').value = r.group ? (r.group + ' › ' + r.merchant) : r.merchant;
  const abs = Math.abs(r.amount);
  EN.neg = r.amount < 0;
  const amt = enQS('#en-amt');
  amt.value = (EN.neg ? '−' : '') + enComma(abs);
  amt.classList.toggle('neg', EN.neg);
  enQS('#en-date').value = r.date;
  enQS('#en-note').value = r.note || '';
  EN.catId = r.catId;
  enSyncCat();
  enQS('#en-fx').setAttribute('aria-pressed', 'true');       // 고정비니까 켜둔다
  enQS('#en-co').setAttribute('aria-pressed', String(!!r.co));
  enQS('#en-serr').textContent = '';
  amt.focus();
  amt.select();
}

async function enSave() {
  const amt = enQS('#en-amt');
  if (!amt) return;
  const n = Number(amt.value.replace(/[^\d]/g, ''));
  if (!n) { enQS('#en-serr').textContent = '금액을 입력하세요.'; amt.focus(); return; }
  if (!EN.catId) { enQS('#en-serr').textContent = '분류를 선택하세요.'; return; }
  enQS('#en-serr').textContent = '';
  enQS('#en-save').disabled = true;

  const raw = enQS('#en-merch').value.trim();
  let group = null, merchant = raw || null;
  if (raw.includes('›')) {
    const p = raw.split('›');
    group = p[0].trim() || null;
    merchant = p.slice(1).join('›').trim() || null;
  }
  const gb = enQS('#en-good').getAttribute('aria-pressed') === 'true' ? 'Good'
           : enQS('#en-bad').getAttribute('aria-pressed') === 'true' ? 'Bad' : null;

  const dupRow = {
    date: enQS('#en-date').value, amount: EN.neg ? -n : n,
    merchant: (raw.includes('›') ? raw.split('›').slice(1).join('›').trim() : raw) || null
  };
  if ((await lgDupes([dupRow])).length &&
      !confirm(`같은 날짜 · 금액 · 사용처의 기록이 이미 있습니다.
${dupRow.date} ${enComma(n)}원 ${dupRow.merchant || ''}

그래도 저장할까요?`)) {
    enQS('#en-save').disabled = false;
    return;
  }

  const { error } = await (await enClient()).from('transactions').insert({
    date: enQS('#en-date').value,
    category_id: EN.catId,
    amount: EN.neg ? -n : n,
    merchant_group: group,
    merchant: merchant,
    note: enQS('#en-note').value.trim() || null,
    good_bad: gb,
    company_paid: enQS('#en-co').getAttribute('aria-pressed') === 'true',
    is_fixed: enQS('#en-fx').getAttribute('aria-pressed') === 'true'
  });
  enQS('#en-save').disabled = false;
  if (error) { enQS('#en-serr').textContent = '저장하지 못했습니다. 다시 시도하세요.'; return; }

  if (merchant) EN.merchCat[merchant] = EN.catId;
  enToast(enComma(n) + '원 기록했습니다');
  lgTouched();
  amt.value = ''; enQS('#en-merch').value = ''; enQS('#en-note').value = '';
  EN.neg = false; EN.catId = null;
  amt.classList.remove('neg');
  ['#en-co', '#en-fx', '#en-good', '#en-bad'].forEach(x => enQS(x).setAttribute('aria-pressed', 'false'));
  enSyncCat();
  enQS('#en-merch').focus();
  enLoadRecent();
  enLoadRepeat();     // 방금 넣은 항목은 목록에서 빠진다
}

async function enLoadRecent() {
  const { data } = await (await enClient()).from('v_transactions')
    .select('id,date,kind,category,subcategory,emoji_category,amount,merchant,note,company_paid,is_fixed')
    .order('date', { ascending: false }).order('id', { ascending: false }).limit(8);
  const box = enQS('#en-recent');
  if (!box) return;
  if (!data || !data.length) { box.innerHTML = '<div class="en-empty">아직 기록이 없습니다.</div>'; return; }
  box.innerHTML = data.map(r => `
    <div class="en-row">
      <span aria-hidden="true">${r.emoji_category || ''}</span>
      <div class="m">
        <div class="l1">${enEsc(r.merchant || r.subcategory)}${r.company_paid ? ' 🏢' : ''}${r.is_fixed ? ' 📌' : ''}</div>
        <div class="l2">${String(r.date).slice(5).replace('-', '.')}<span class="dv">·</span>${enEsc(r.subcategory)}</div>
      </div>
      <span class="v ${r.kind}">${Number(r.amount) < 0 ? '−' : ''}${enComma(Math.abs(r.amount))}</span>
      <button class="en-del" data-id="${r.id}" aria-label="삭제">×</button>
    </div>`).join('');
  box.querySelectorAll('.en-del').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    await (await enClient()).from('transactions').delete().eq('id', Number(b.dataset.id));
    enToast('삭제했습니다');
    enLoadRecent();
  }));
}

/* ================= 전체 내역 (현황 › 전체 내역) ================= */
function enQuickRange(key) {
  const now = new Date();
  const p = (d) => { d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const y = now.getFullYear(), m = now.getMonth();
  if (key === 'tm') return [p(new Date(y, m, 1)), p(new Date(y, m + 1, 0))];
  if (key === 'lm') return [p(new Date(y, m - 1, 1)), p(new Date(y, m, 0))];
  if (key === '3m') return [p(new Date(y, m - 2, 1)), p(new Date(y, m + 1, 0))];
  if (key === 'ty') return [p(new Date(y, 0, 1)), p(new Date(y, 11, 31))];
  return ['', ''];
}

/* 사용처 관리는 상단 '목록' 버튼(목록 관리 › 사용처)으로 옮겼다. 여기는 내역만 본다. */
function renderLedgerShell(body) {
  body.innerHTML = '<div id="lg-body" class="lg-nosub"></div>';
  renderLedgerPage(document.getElementById('lg-body'));
}

async function renderLedgerPage(body) {
  body.innerHTML = '<div class="lg-wrap"><div class="en-empty">불러오는 중…</div></div>';
  await enEnsureRefs();
  const g = EN.lg;
  if (g.quick && !g.from && !g.to) { const [f, t] = enQuickRange(g.quick); g.from = f; g.to = t; }
  const cats = [...EN.cats].sort((a, b) => a.sort_order - b.sort_order);
  const yNow = new Date().getFullYear();
  const years = []; for (let y = yNow; y >= 2023; y--) years.push(y);

  body.innerHTML = `
    <div class="lg-wrap">
      <div class="lg-stick">
        <div class="lg-bar">
          <div class="lg-grp">
            <span class="lg-glab">기간</span>
            <div class="lg-gin">
              <div class="lg-quick" id="lg-quick">
                <button data-q="tm">이번달</button><button data-q="lm">지난달</button>
                <button data-q="3m">최근 3개월</button><button data-q="ty">올해</button><button data-q="all">전체</button>
              </div>
            </div>
          </div>
          <div class="lg-grp">
            <span class="lg-glab">연도 · 월</span>
            <div class="lg-gin">
              <select class="en-in" id="lg-y"><option value="">연도</option>${years.map(y => `<option value="${y}">${y}년</option>`).join('')}</select>
              <select class="en-in" id="lg-m"><option value="">월</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('')}</select>
            </div>
          </div>
          <div class="lg-grp">
            <span class="lg-glab">종류</span>
            <div class="lg-gin lg-kinds" id="lg-kinds">
              <button data-k="all">전체</button>
              <button data-k="지출" class="kd 지출">지출</button>
              <button data-k="수입" class="kd 수입">수입</button>
              <button data-k="이체" class="kd 이체">이체</button>
            </div>
          </div>
          <div class="lg-grp cat">
            <span class="lg-glab">분류</span>
            <div class="lg-gin lg-catpick">
              <input class="en-in grow" id="lg-catq" placeholder="분류 전체 — 입력해서 찾기" autocomplete="off"
                     role="combobox" aria-expanded="false" aria-controls="lg-catdrop">
              <button class="lg-catx" id="lg-catx" aria-label="분류 해제" hidden>×</button>
              <div class="lg-catdrop" id="lg-catdrop" role="listbox" hidden></div>
            </div>
          </div>
          <div class="lg-grp grow">
            <span class="lg-glab">검색</span>
            <div class="lg-gin"><input class="en-in grow" id="lg-q" placeholder="사용처 · 메모" value="${enEsc(g.q)}"></div>
          </div>
          <div class="lg-grp">
            <span class="lg-glab">정렬</span>
            <div class="lg-gin">
              <select class="en-in" id="lg-sort">
                <option value="date_desc">최신순</option><option value="date_asc">오래된순</option>
                <option value="amt_desc">금액 큰 순</option><option value="amt_asc">금액 작은 순</option>
                <option value="created_desc">입력한 순서</option></select>
            </div>
          </div>
          <div class="lg-grp">
            <span class="lg-glab">&nbsp;</span>
            <button class="lg-reset" id="lg-reset">초기화</button>
          </div>
        </div>
        <div class="lg-sum" id="lg-sum"></div>
        <div class="lg-cols">
          <span class="k">종류</span><span class="e"></span><span class="c">분류</span><span class="n">사용처</span>
          <span class="mm">메모</span><span class="f">회사·고정</span><span class="g">GOOD/BAD</span>
          <span class="v">금액</span><span class="x"></span>
        </div>
      </div>
      <div class="lg-add" id="lg-add"></div>
      <div class="lg-keys">
        <span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 칸 이동</span>
        <span><kbd>Shift</kbd>+이동·클릭 여러 칸 묶기</span>
        <span><kbd>Space</kbd> 한 행 통째로</span>
        <span><kbd>Enter</kbd> 고치기 (그냥 쳐도 시작)</span>
        <span><kbd>Tab</kbd> 오른쪽 칸</span>
        <span><kbd>⌘</kbd>+<kbd>C</kbd> 복사</span>
        <span><kbd>Esc</kbd> 해제</span>
      </div>
      <div id="lg-list"><div class="en-empty">불러오는 중…</div></div>
      <div class="lg-meta">
        <span id="lg-count"></span>
        <span class="lg-pager">
          <button id="lg-prev">‹ 이전</button><button id="lg-next">다음 ›</button>
        </span>
      </div>
    </div>`;

  enQS('#lg-sort').value = g.sort;
  document.querySelectorAll('#lg-quick button').forEach(b =>
    b.classList.toggle('on', b.dataset.q === g.quick));
  lgSetupKindCat(g, cats);
  lgRenderAdd();

  document.querySelectorAll('#lg-quick button').forEach(b => b.addEventListener('click', () => {
    g.quick = b.dataset.q;
    const [f, t] = enQuickRange(g.quick);
    g.from = f; g.to = t; g.page = 1;
    enQS('#lg-y').value = ''; enQS('#lg-m').value = '';
    document.querySelectorAll('#lg-quick button').forEach(x => x.classList.toggle('on', x === b));
    enLoadLedger();
  }));

  const applyYM = () => {
    const y = enQS('#lg-y').value, m = enQS('#lg-m').value;
    if (!y) return;
    g.quick = '';
    document.querySelectorAll('#lg-quick button').forEach(x => x.classList.remove('on'));
    if (m) {
      const mm = Number(m);
      g.from = `${y}-${String(mm).padStart(2, '0')}-01`;
      const last = new Date(Number(y), mm, 0).getDate();
      g.to = `${y}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    } else { g.from = `${y}-01-01`; g.to = `${y}-12-31`; }
    g.page = 1;
    enLoadLedger();
  };
  enQS('#lg-y').addEventListener('change', applyYM);
  enQS('#lg-m').addEventListener('change', applyYM);

  let timer = null;
  enQS('#lg-q').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { g.q = e.target.value.trim(); g.page = 1; enLoadLedger(); }, 300);
  });
  enQS('#lg-sort').addEventListener('change', e => { g.sort = e.target.value; g.page = 1; enLoadLedger(); });
  enQS('#lg-reset').addEventListener('click', () => {
    EN.lg = { q: '', kind: 'all', cat: 'all', from: '', to: '', quick: '3m', sort: 'date_desc', page: 1, size: 60 };
    renderLedgerPage(document.getElementById('lg-body'));
  });
  enQS('#lg-prev').addEventListener('click', () => { if (g.page > 1) { g.page--; enLoadLedger(); } });
  enQS('#lg-next').addEventListener('click', () => { g.page++; enLoadLedger(); });
  enSyncHeaderOffset();
  enLoadLedger();
}

/* 종류는 칩으로, 분류는 검색으로 — 고르는 순서가 생각의 순서와 같도록.
   종류를 먼저 좁히면 분류 후보도 같이 좁아진다. */
function lgSetupKindCat(g, cats) {
  const chips = document.getElementById('lg-kinds');
  const inp = enQS('#lg-catq');
  const drop = enQS('#lg-catdrop');
  const clear = enQS('#lg-catx');
  if (!chips || !inp || !drop) return;

  const catLabel = (c) => `${c.category} › ${c.subcategory}`;
  const paintChips = () => {
    chips.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.k === g.kind));
  };
  const paintCat = () => {
    const c = EN.catById[Number(g.cat)];
    if (g.cat !== 'all' && c) {
      inp.value = catLabel(c);
      inp.classList.add('picked');
      clear.hidden = false;
    } else {
      inp.value = '';
      inp.classList.remove('picked');
      clear.hidden = true;
    }
  };
  const pool = () => cats.filter(c => g.kind === 'all' || c.kind === g.kind);
  const close = () => { drop.hidden = true; inp.setAttribute('aria-expanded', 'false'); };

  let cur = -1, list = [];
  const paintCursor = () => drop.querySelectorAll('.lg-catopt').forEach((el, i) =>
    el.classList.toggle('on', i === cur));

  const open = () => {
    const q = inp.classList.contains('picked') ? '' : inp.value.trim().toLowerCase();
    list = pool().filter(c => !q ||
      (c.category + ' ' + c.subcategory + ' ' + c.kind).toLowerCase().includes(q)).slice(0, 60);
    if (!list.length) {
      drop.innerHTML = '<div class="lg-catempty">일치하는 분류가 없습니다.</div>';
    } else {
      let last = '';
      drop.innerHTML = list.map((c, i) => {
        const head = c.kind !== last ? `<div class="lg-cathead">${c.kind}</div>` : '';
        last = c.kind;
        return head + `<div class="lg-catopt" role="option" data-i="${i}">
          <span class="lg-kd ${c.kind}">${c.kind}</span>
          <span class="em">${c.emoji_category || ''}</span>
          <span class="tx">${enEsc(c.category)} › <b>${enEsc(c.subcategory)}</b></span>
        </div>`;
      }).join('');
    }
    drop.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    cur = -1;
    drop.querySelectorAll('.lg-catopt').forEach(el =>
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(list[Number(el.dataset.i)]); }));
  };
  const pick = (c) => {
    if (!c) return;
    g.cat = String(c.id);
    if (g.kind !== 'all' && g.kind !== c.kind) { g.kind = c.kind; paintChips(); }
    g.page = 1;
    paintCat(); close(); enLoadLedger();
  };

  chips.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    g.kind = b.dataset.k;
    /* 고른 종류와 안 맞는 분류는 자동으로 푼다 — 결과가 0건인 조합을 남기지 않는다 */
    const c = EN.catById[Number(g.cat)];
    if (g.kind !== 'all' && c && c.kind !== g.kind) g.cat = 'all';
    g.page = 1;
    paintChips(); paintCat(); enLoadLedger();
  }));

  inp.addEventListener('focus', () => { if (inp.classList.contains('picked')) { inp.value = ''; inp.classList.remove('picked'); } open(); });
  inp.addEventListener('input', open);
  inp.addEventListener('blur', () => setTimeout(() => { close(); paintCat(); }, 120));
  inp.addEventListener('keydown', (e) => {
    if (drop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.length - 1); paintCursor(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paintCursor(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[cur >= 0 ? cur : 0]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); paintCat(); inp.blur(); }
  });
  clear.addEventListener('click', () => { g.cat = 'all'; g.page = 1; paintCat(); enLoadLedger(); });

  paintChips(); paintCat();
}

/* 기존 sticky 헤더 높이만큼 아래에 붙인다 */
function enSyncHeaderOffset() {
  const set = () => {
    const el = document.querySelector('.site-header');
    if (!el) return;
    const px = Math.round(el.getBoundingClientRect().height);
    if (px > 0) document.documentElement.style.setProperty('--hdr-h', px + 'px');
  };
  set();
  requestAnimationFrame(set);
  setTimeout(set, 250);
  if (!enSyncHeaderOffset._bound) {
    enSyncHeaderOffset._bound = true;
    window.addEventListener('resize', set);
  }
}

function enLedgerQuery(sb, mode) {
  const g = EN.lg;
  let q;
  if (mode === 'count') q = sb.from('v_transactions').select('id', { count: 'exact', head: true });
  else if (mode === 'sum') q = sb.from('v_transactions').select('kind,amount');
  else q = sb.from('v_transactions').select('id,date,kind,category,subcategory,emoji_category,amount,merchant_group,merchant,note,good_bad,company_paid,is_fixed,category_id');
  if (g.kind !== 'all') q = q.eq('kind', g.kind);
  if (g.cat !== 'all') q = q.eq('category_id', Number(g.cat));
  if (g.from) q = q.gte('date', g.from);
  if (g.to) q = q.lte('date', g.to);
  if (g.q) { const t = g.q.replace(/[,%]/g, ' '); q = q.or(`merchant.ilike.%${t}%,note.ilike.%${t}%`); }
  return q;
}

async function enLoadLedger() {
  /* 전체 내역 화면이 떠 있을 때만 의미가 있다. 다른 탭에서 수정한 경우 헛돌지 않게 먼저 끊는다. */
  if (!enQS('#lg-list')) return;
  const sb = await enClient();
  const g = EN.lg;
  const sorts = {
    date_desc: ['date', false], date_asc: ['date', true],
    amt_desc: ['amount', false], amt_asc: ['amount', true],
    created_desc: ['id', false]
  };
  const [col, asc] = sorts[g.sort] || sorts.date_desc;
  const from = (g.page - 1) * g.size;

  const [rowsRes, cntRes, sumRes] = await Promise.all([
    enLedgerQuery(sb, 'rows').order(col, { ascending: asc }).range(from, from + g.size - 1),
    enLedgerQuery(sb, 'count'),
    enLedgerQuery(sb, 'sum').limit(20000)
  ]);
  const rows = rowsRes.data || [];
  const total = cntRes.count || 0;
  const agg = { 수입: 0, 지출: 0, 이체: 0 };
  (sumRes.data || []).forEach(r => { agg[r.kind] = (agg[r.kind] || 0) + Number(r.amount); });

  const sumBox = enQS('#lg-sum');
  if (sumBox) {
    const net = (agg['수입'] || 0) - (agg['지출'] || 0);
    sumBox.innerHTML =
      `<div><span class="k">수입</span><span class="v" style="color:var(--income-text);">${enComma(Math.round(agg['수입'] || 0))}</span></div>
       <div><span class="k">지출</span><span class="v" style="color:var(--expense-text);">${enComma(Math.round(agg['지출'] || 0))}</span></div>
       <div><span class="k">이체</span><span class="v" style="color:var(--transfer-text);">${enComma(Math.round(agg['이체'] || 0))}</span></div>
       <div><span class="k">수입 − 지출</span><span class="v" style="color:${net >= 0 ? 'var(--income-text)' : 'var(--expense-text)'};">${enComma(Math.round(net))}</span></div>`;
  }

  const box = enQS('#lg-list');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="en-empty">조건에 맞는 기록이 없습니다. 기간이나 필터를 넓혀보세요.</div>';
  } else {
    const groups = [];
    const idx = {};
    rows.forEach(r => {
      const d = String(r.date);
      if (idx[d] === undefined) { idx[d] = groups.length; groups.push({ date: d, items: [] }); }
      groups[idx[d]].items.push(r);
    });
    /* 같은 날 안에서는 수입 → 지출 → 이체, 그 다음 금액 큰 순.
       들어온 돈과 나간 돈이 섞여 있으면 하루가 어땠는지 한눈에 안 잡힌다. */
    if (g.sort === 'date_desc' || g.sort === 'date_asc') {
      const rank = { '수입': 0, '지출': 1, '이체': 2 };
      groups.forEach(grp => grp.items.sort((a, b) =>
        (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) ||
        Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))));
    }
    box.innerHTML = groups.map(grp => {
      const dt = new Date(grp.date + 'T00:00:00');
      const spend = grp.items.filter(x => x.kind === '지출').reduce((a, x) => a + Number(x.amount), 0);
      return `<div class="lg-dg" data-date="${grp.date}"><div class="lg-day">
          <span class="d">${grp.date.slice(2).replace(/-/g, '.')}</span>
          <span class="w">${EN_WD[dt.getDay()]}</span>
          <button class="lg-dayadd" data-add="${grp.date}" title="이 날짜로 행 추가" tabindex="-1">+</button>
          <span class="s">${grp.items.length}건${spend ? ' · 지출 ' + enComma(Math.round(spend)) : ''}</span>
        </div><div class="lg-card">` +
        grp.items.map(r => `<div class="lg-line k-${r.kind}" draggable="true" data-id="${r.id}" data-date="${r.date}"
          data-cat="${r.category_id}" data-amt="${r.amount}" data-mgroup="${enEsc(r.merchant_group || '')}"
          data-merch="${enEsc(r.merchant || '')}" data-note="${enEsc(r.note || '')}">
          <span class="k"><i class="lg-kd ${r.kind}">${r.kind}</i></span>
          <span class="e" aria-hidden="true">${r.emoji_category || ''}</span>
          <span class="c" data-ed="cat" title="더블클릭해서 분류 변경"><span class="ct">${enEsc(r.category)} › ${enEsc(r.subcategory)}</span></span>
          <span class="n" data-ed="merchant" title="더블클릭해서 수정">${r.merchant_group ? `<i class="lg-mg">${enEsc(r.merchant_group)}</i>` : ''}${enEsc(r.merchant || r.subcategory)}</span>
          <span class="mm" data-ed="note" title="더블클릭해서 메모 수정">${r.note ? enEsc(r.note) : '<i class="lg-ph">메모</i>'}</span>
          <span class="f">
            <button class="lg-tg ${r.company_paid ? 'on' : ''}" data-tg="company_paid" title="회사 환급" tabindex="-1">🏢</button>
            ${lgFixedBtn(r.merchant, r.is_fixed)}
          </span>
          <span class="g">${r.kind === '지출'
            ? `<button class="lg-gb ${r.good_bad === 'Good' ? 'good' : r.good_bad === 'Bad' ? 'bad' : ''}" data-gb tabindex="-1" title="클릭해서 Good → Bad → 해제">${r.good_bad === 'Good' ? 'GOOD' : r.good_bad === 'Bad' ? 'BAD' : '—'}</button>`
            : '<span class="lg-na" title="지출에만 매깁니다">·</span>'}</span>
          <span class="v ${r.kind}" data-ed="amount" title="더블클릭해서 수정">${Number(r.amount) < 0 ? '−' : ''}${enComma(Math.abs(r.amount))}</span>
          <button class="x" data-id="${r.id}" aria-label="삭제" tabindex="-1">×</button>
        </div>`).join('') + '</div></div>';
    }).join('');
    box.querySelectorAll('.x').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      await (await enClient()).from('transactions').delete().eq('id', Number(b.dataset.id));
      enToast('삭제했습니다');
      lgTouched();
      enLoadLedger();
    }));
    lgBindEdit(box);
    lgBindDrag(box);
    box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      lgDraftAdd(b.dataset.add);
    }));
  }
  lgGridInit(box);

  const last = Math.max(1, Math.ceil(total / g.size));
  enQS('#lg-count').textContent = total
    ? `${enComma(total)}건 중 ${enComma(from + 1)}–${enComma(Math.min(from + g.size, total))} · ${g.page}/${last}`
    : '0건';
  enQS('#lg-prev').disabled = g.page <= 1;
  enQS('#lg-next').disabled = g.page >= last;
}

/* ---------------- 전체 내역 : 칸을 더블클릭해서 그 자리에서 고친다 ----------------
   고친 값은 곧바로 transactions 테이블에 반영된다. 화면만 바뀌는 수정은 만들지 않는다. */
async function lgUpdate(id, patch) {
  const { error } = await (await enClient()).from('transactions').update(patch).eq('id', id);
  if (error) { enToast('저장하지 못했습니다'); return false; }
  return true;
}

function lgCellEdit(cell, opts) {
  if (cell.classList.contains('editing')) return;
  const seed = opts && opts.seed;
  const line = cell.closest('.lg-line');
  const id = Number(line.dataset.id);
  const what = cell.dataset.ed;
  const prev = cell.innerHTML;
  let done = false;
  LGK.editing = true;
  LGK.move = null;
  cell.classList.add('editing');

  let input;
  if (what === 'cat') {
    input = document.createElement('select');
    input.className = 'lg-ed sel';
    const cur = Number(line.dataset.cat);
    ['지출', '수입', '이체'].forEach(k => {
      const list = EN.cats.filter(c => c.kind === k);
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = k;
      list.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.category + ' › ' + c.subcategory;
        if (c.id === cur) o.selected = true;
        og.appendChild(o);
      });
      input.appendChild(og);
    });
  } else {
    input = document.createElement('input');
    input.className = 'lg-ed' + (what === 'amount' ? ' mono' : '');
    if (what === 'amount') {
      input.inputMode = 'numeric';
      const n = Number(line.dataset.amt);
      input.value = (n < 0 ? '−' : '') + enComma(Math.abs(n));
    } else if (what === 'merchant') {
      const gp = line.dataset.mgroup || '';
      input.value = (gp ? gp + ' › ' : '') + (line.dataset.merch || '');
    } else {
      input.value = line.dataset.note || '';
    }
  }

  if (seed != null && what !== 'cat') input.value = seed;

  cell.innerHTML = '';
  cell.appendChild(input);
  if (what === 'merchant') lgMerchantAC(input);
  input.focus();
  if (input.select && seed == null) input.select();
  if (seed != null && input.setSelectionRange) {
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) {}
  }

  /* 고치고 나면 어디에 서 있을지를 정해 둔다 — 화면을 다시 그려도 그 자리를 되찾게 */
  const inGrid = !!(cell.closest && cell.closest('#lg-list'));
  const land = (reloaded) => {
    const mv = LGK.move; LGK.move = null;
    LGK.editing = false;
    if (!inGrid) return;   /* '오늘' 탭에도 같은 행이 쓰인다 — 거긴 표가 아니다 */
    if (reloaded) { LGK.want = { id, col: what, move: mv }; return; }
    lgGridLand(cell, mv);
  };

  const finish = async (commit) => {
    if (done) return;
    done = true;
    cell.classList.remove('editing');
    const bail = () => { cell.innerHTML = prev; land(false); };
    if (!commit) { bail(); return; }
    const patch = {};
    if (what === 'cat') {
      const cid = Number(input.value);
      if (!cid || cid === Number(line.dataset.cat)) { bail(); return; }
      patch.category_id = cid;
    } else if (what === 'amount') {
      const t = input.value.trim();
      const neg = /^[-−]/.test(t);
      const n = Number(t.replace(/[^\d]/g, ''));
      if (!n) { bail(); return; }
      const v = neg ? -n : n;
      if (v === Number(line.dataset.amt)) { bail(); return; }
      patch.amount = v;
    } else if (what === 'merchant') {
      const v = input.value.trim();
      const was = (line.dataset.mgroup ? line.dataset.mgroup + ' › ' : '') + (line.dataset.merch || '');
      if (v === was) { bail(); return; }
      const parts = lgSplitMerchant(v);
      patch.merchant_group = parts.group;
      patch.merchant = parts.merchant;
    } else {
      const v = input.value.trim();
      if (v === (line.dataset.note || '')) { bail(); return; }
      patch.note = v || null;
    }
    const ok = await lgUpdate(id, patch);
    if (!ok) { bail(); return; }
    /* 입력칸을 반드시 걷어낸다 — 남겨두면 뒤따르는 화면 갱신이 '편집 중'으로 보고 건너뛴다 */
    cell.innerHTML = prev;
    land(true);
    enToast('수정했습니다');
    lgTouched();
    enLoadLedger();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); LGK.move = e.shiftKey ? 'up' : 'down'; finish(true); }
    else if (e.key === 'Tab') { e.preventDefault(); LGK.move = e.shiftKey ? 'left' : 'right'; finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); LGK.move = null; finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  if (what === 'cat') input.addEventListener('change', () => finish(true));
}

function lgBindEdit(box) {
  box.querySelectorAll('[data-ed]').forEach(cell =>
    cell.addEventListener('dblclick', () => lgCellEdit(cell)));

  box.querySelectorAll('[data-tg]').forEach(btn => btn.addEventListener('click', async () => {
    const line = btn.closest('.lg-line');
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    const patch = {}; patch[btn.dataset.tg] = on;
    const ok = await lgUpdate(Number(line.dataset.id), patch);
    if (!ok) { btn.classList.toggle('on', !on); return; }
    lgTouched();
    /* 사용처 기준과 어긋나면 그 자리에서 표시해 준다 — 예외인 줄 모르고 두는 일이 없게 */
    if (btn.dataset.tg === 'is_fixed') {
      const mfx = enMerchFixed(line.dataset.merch);
      btn.classList.toggle('auto', mfx && on);
      btn.classList.toggle('exc', mfx && !on);
      btn.title = mfx ? (on ? '고정비 — 사용처 기준' : '사용처는 고정비인데 이 줄만 예외') : '고정비';
    }
  }));

  box.querySelectorAll('[data-gb]').forEach(btn => btn.addEventListener('click', async () => {
    const line = btn.closest('.lg-line');
    const cur = btn.classList.contains('good') ? 'Good' : btn.classList.contains('bad') ? 'Bad' : null;
    const next = cur === null ? 'Good' : cur === 'Good' ? 'Bad' : null;
    btn.className = 'lg-gb ' + (next === 'Good' ? 'good' : next === 'Bad' ? 'bad' : '');
    btn.textContent = next === 'Good' ? 'GOOD' : next === 'Bad' ? 'BAD' : '—';
    const ok = await lgUpdate(Number(line.dataset.id), { good_bad: next });
    if (!ok) {
      btn.className = 'lg-gb ' + (cur === 'Good' ? 'good' : cur === 'Bad' ? 'bad' : '');
      btn.textContent = cur === 'Good' ? 'GOOD' : cur === 'Bad' ? 'BAD' : '—';
    }
  }));
}

/* 사용처가 고정비로 지정돼 있으면 왜 켜져 있는지가 보여야 한다.
   auto = 사용처 기준으로 켜진 것 · exc = 사용처는 고정비인데 이 줄만 뺀 것. */
function lgFixedBtn(merchant, on) {
  const mfx = enMerchFixed(merchant);
  const cls = ['lg-tg', on ? 'on' : '', mfx ? (on ? 'auto' : 'exc') : ''].filter(Boolean).join(' ');
  const tip = mfx
    ? (on ? '고정비 — 사용처 기준' : '사용처는 고정비인데 이 줄만 예외')
    : '고정비';
  return `<button class="${cls}" data-tg="is_fixed" title="${tip}" tabindex="-1">📌</button>`;
}

/* 분류를 셀렉트 대신 검색으로 고른다 — 소분류가 수십 개라 스크롤로는 못 찾는다.
   보이는 칸은 input, 실제 값은 옆의 hidden 이 들고 있다. */
function lgCatPick(input, hidden, onPick) {
  if (!input || input.dataset.cp) return;
  input.dataset.cp = '1';
  const rank = { '지출': 0, '수입': 1, '이체': 2 };
  const all = () => [...EN.cats].sort((a, b) =>
    (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.sort_order - b.sort_order);
  const box = document.createElement('div');
  box.className = 'lg-catdrop lg-cpdrop';
  box.hidden = true;
  (input.parentElement || document.body).appendChild(box);

  let list = [], cur = -1;
  const label = (c) => `${c.category} › ${c.subcategory}`;
  const close = () => { box.hidden = true; cur = -1; };
  const paint = () => box.querySelectorAll('.lg-catopt').forEach((el, i) => el.classList.toggle('on', i === cur));
  const restore = () => {
    const c = EN.catById[Number(hidden.value)];
    input.value = c ? label(c) : '';
  };
  const open = () => {
    const q = input.value.trim().toLowerCase();
    const chosen = EN.catById[Number(hidden.value)];
    const isLabel = chosen && input.value === label(chosen);
    list = all().filter(c => !q || isLabel ||
      (c.category + ' ' + c.subcategory + ' ' + c.kind).toLowerCase().includes(q)).slice(0, 60);
    if (!list.length) { box.innerHTML = '<div class="lg-catempty">일치하는 분류가 없습니다.</div>'; box.hidden = false; return; }
    let last = '';
    box.innerHTML = list.map((c, i) => {
      const head = c.kind !== last ? `<div class="lg-cathead">${c.kind}</div>` : '';
      last = c.kind;
      return head + `<div class="lg-catopt" data-i="${i}">
        <span class="lg-kd ${c.kind}">${c.kind}</span>
        <span class="em">${c.emoji_category || ''}</span>
        <span class="tx">${enEsc(c.category)} › <b>${enEsc(c.subcategory)}</b></span></div>`;
    }).join('');
    box.hidden = false;
    cur = -1;
    box.querySelectorAll('.lg-catopt').forEach(el =>
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(list[Number(el.dataset.i)]); }));
  };
  const pick = (c) => {
    if (!c) return;
    hidden.value = String(c.id);
    input.value = label(c);
    close();
    if (onPick) onPick(c);
    hidden.dispatchEvent(new Event('change'));
  };

  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('input', open);
  input.addEventListener('blur', () => setTimeout(() => { close(); restore(); }, 130));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(list[cur >= 0 ? cur : 0]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); restore(); }
  });
}

/* '그룹 › 사용처' 한 칸으로 다룬다 — 입력창을 늘리지 않고 둘 다 고칠 수 있게 */
function lgSplitMerchant(v) {
  const t = String(v || '').trim();
  if (!t) return { group: null, merchant: null };
  if (t.includes('›')) {
    const p = t.split('›');
    return { group: p[0].trim() || null, merchant: p.slice(1).join('›').trim() || null };
  }
  return { group: null, merchant: t };
}

/* 사용처 자동완성 — 어떤 그룹·분류로 쓰던 곳인지 같이 보여준다.
   고르면 분류까지 따라오게 onPick 으로 넘긴다. */
function lgMerchantAC(input, onPick) {
  if (!input || input.dataset.ac) return;
  input.dataset.ac = '1';
  input.setAttribute('autocomplete', 'off');
  /* 목록은 body 에 붙이고 화면 좌표로 띄운다.
     표 안에 넣으면 겹침·잘림 규칙에 걸려 안 보이는 경우가 생긴다. */
  const box = document.createElement('div');
  box.className = 'lg-acbox';
  box.hidden = true;
  document.body.appendChild(box);
  const place = () => {
    const r = input.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 310)) + 'px';
    box.style.minWidth = Math.max(r.width, 260) + 'px';
    /* 아래에 자리가 없으면 위로 편다 — 화면 밑에 붙은 일괄 수정바에서도 목록이 보여야 한다 */
    const room = window.innerHeight - r.bottom;
    if (room < 200 && r.top > room) {
      box.style.top = 'auto';
      box.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      box.style.maxHeight = Math.min(280, r.top - 12) + 'px';
    } else {
      box.style.bottom = 'auto';
      box.style.top = (r.bottom + 4) + 'px';
      box.style.maxHeight = Math.min(280, room - 12) + 'px';
    }
  };

  let list = [], cur = -1;
  const close = () => { box.hidden = true; cur = -1; };
  window.addEventListener('scroll', () => { if (!box.hidden) place(); }, true);
  const paint = () => box.querySelectorAll('.lg-acitem').forEach((el, i) => el.classList.toggle('on', i === cur));
  const groupOf = (m) => (EN.merchGroup && EN.merchGroup[m]) || '';
  const rows = () => box.querySelectorAll('.lg-acitem');

  const open = () => {
    const raw = input.value.trim();
    const q = (raw.includes('›') ? raw.split('›').slice(1).join('›') : raw).trim().toLowerCase();
    const pool = EN.merchants || [];
    list = (q ? pool.filter(m => m.toLowerCase().includes(q) || groupOf(m).toLowerCase().includes(q)) : pool).slice(0, 40);
    const exact = list.some(m => m.toLowerCase() === q);
    const canAdd = q && !exact;
    if (!list.length && !canAdd) { close(); return; }
    place();
    const raw2 = (raw.includes('›') ? raw.split('›').slice(1).join('›') : raw).trim();
    box.innerHTML = (canAdd ? `<div class="lg-acitem lg-acnew" data-new="1">
        <span class="gp">새로</span><span class="nm">＋ ${enEsc(raw2)} 사용처로 추가</span></div>` : '')
      + list.map((m, i) => {
      const c = EN.catById[EN.merchCat[m]];
      const gp = groupOf(m);
      let nm = enEsc(m);
      if (q) {
        const at = m.toLowerCase().indexOf(q);
        if (at >= 0) nm = enEsc(m.slice(0, at)) + '<mark>' + enEsc(m.slice(at, at + q.length)) + '</mark>' + enEsc(m.slice(at + q.length));
      }
      return `<div class="lg-acitem" data-i="${i}" title="${c ? enEsc(c.category + ' › ' + c.subcategory) : '분류 없음'}">
        ${gp ? `<span class="gp">${enEsc(gp)}</span>` : '<span class="gp none">그룹 없음</span>'}
        <span class="nm">${nm}</span>
      </div>`;
    }).join('');
    box.hidden = false;
    cur = -1;
    box.querySelectorAll('.lg-acitem').forEach(el =>
      el.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        if (el.dataset.new) {
          const gp0 = raw.includes('›') ? raw.split('›')[0].trim() : '';
          await enRegisterMerchant(raw2, gp0);
          input.value = (gp0 ? gp0 + ' › ' : '') + raw2;
          close();
          if (onPick) onPick(raw2, EN.merchCat[raw2] || null);
          enToast(`사용처 '${raw2}' 등록했습니다`);
          return;
        }
        pick(list[Number(el.dataset.i)]);
      }));
  };
  const pick = (m) => {
    if (!m) return;
    const gp = groupOf(m);
    input.value = (gp ? gp + ' › ' : '') + m;
    close();
    if (onPick) onPick(m, EN.merchCat[m] || null);
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 130));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, rows().length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); paint(); }
    else if (e.key === 'Enter' && cur >= 0) {
      e.preventDefault(); e.stopPropagation();
      const el = rows()[cur];
      if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

/* 행을 다른 날짜 묶음으로 끌어다 놓으면 날짜가 바뀐다.
   가장 자주 고치는 게 날짜인데, 날짜 칸이 표에 없으니 이 방법이 제일 짧다. */
function lgBindDrag(box) {
  let dragId = null, dragFrom = null;
  box.querySelectorAll('.lg-line').forEach(line => {
    line.addEventListener('dragstart', (e) => {
      if (line.querySelector('.editing')) { e.preventDefault(); return; }
      dragId = Number(line.dataset.id);
      dragFrom = line.dataset.date;
      line.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) {}
    });
    line.addEventListener('dragend', () => {
      line.classList.remove('dragging');
      box.querySelectorAll('.lg-dg').forEach(g => g.classList.remove('over'));
      dragId = null;
    });
  });
  box.querySelectorAll('.lg-dg').forEach(g => {
    g.addEventListener('dragover', (e) => {
      if (dragId == null || g.dataset.date === dragFrom) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      g.classList.add('over');
    });
    g.addEventListener('dragleave', () => g.classList.remove('over'));
    g.addEventListener('drop', async (e) => {
      e.preventDefault();
      g.classList.remove('over');
      const id = dragId, to = g.dataset.date;
      if (id == null || !to || to === dragFrom) return;
      dragId = null;
      const ok = await lgUpdate(id, { date: to });
      if (!ok) return;
      enToast(`${to.slice(2).replace(/-/g, '.')} 로 옮겼습니다`);
      lgTouched();
      enLoadLedger();
    });
  });
}

/* ---------------- 전체 내역 : 표를 칸 단위로 돌아다니고, 묶어서 고친다 ----------------
   가계부를 정리하는 일은 한 줄을 고치는 일보다 '같은 걸 여러 줄에서 한꺼번에 고치는' 일이 많다.
   그래서 표를 스프레드시트처럼 다룬다 — 화살표로 칸을 옮기고, Shift로 범위를 잡고,
   잡힌 범위에 한 번에 같은 값을 넣는다. 마우스만으로도, 키보드만으로도 끝까지 갈 수 있어야 한다. */

const LGK = {
  cols: ['cat', 'merchant', 'note', 'amount'],
  labels: { cat: '분류', merchant: '사용처', note: '메모', amount: '금액' },
  rows: [], vis: [0, 1, 2, 3],
  cur: null, anchor: null, editing: false, move: null, want: null
};

function lgGridCell(r, c) {
  const row = LGK.rows[r];
  return row ? row.querySelector(`[data-ed="${LGK.cols[c]}"]`) : null;
}

function lgGridRange() {
  if (!LGK.cur) return null;
  const a = LGK.anchor || LGK.cur;
  return {
    r0: Math.min(a.r, LGK.cur.r), r1: Math.max(a.r, LGK.cur.r),
    c0: Math.min(a.c, LGK.cur.c), c1: Math.max(a.c, LGK.cur.c)
  };
}

function lgGridPaint() {
  const rng = lgGridRange();
  const many = !!rng && (rng.r0 !== rng.r1 || rng.c0 !== rng.c1);
  LGK.rows.forEach((row, r) => {
    let inRow = false;
    LGK.cols.forEach((name, c) => {
      const el = row.querySelector(`[data-ed="${name}"]`);
      if (!el) return;
      const on = !!rng && r >= rng.r0 && r <= rng.r1 && c >= rng.c0 && c <= rng.c1;
      const isCur = !!LGK.cur && LGK.cur.r === r && LGK.cur.c === c;
      el.classList.toggle('sel', on && many);
      el.classList.toggle('cur', isCur);
      el.tabIndex = isCur ? 0 : -1;
      if (on) inRow = true;
    });
    row.classList.toggle('rowsel', inRow && many && rng.r0 !== rng.r1);
  });
  /* 아무 칸도 안 잡혀 있으면 Tab 으로 표에 들어올 자리를 하나 열어 둔다 */
  if (!LGK.cur && LGK.rows.length) {
    const el = lgGridCell(0, LGK.vis[0]);
    if (el) el.tabIndex = 0;
  }
  lgBulkPaint();
}

function lgGridSet(r, c, extend) {
  if (r < 0 || r >= LGK.rows.length) return false;
  if (!LGK.vis.includes(c)) {
    c = LGK.vis.reduce((best, v) => Math.abs(v - c) < Math.abs(best - c) ? v : best, LGK.vis[0]);
  }
  LGK.cur = { r, c };
  if (!extend) LGK.anchor = { r, c };
  const el = lgGridCell(r, c);
  if (el) { el.tabIndex = 0; el.focus({ preventScroll: false }); }
  lgGridPaint();
  return true;
}

function lgGridMove(dr, dc, extend) {
  if (!LGK.cur) return lgGridSet(0, LGK.vis[0], false);
  let { r, c } = LGK.cur;
  if (dc) {
    let vi = LGK.vis.indexOf(c) + dc;
    if (vi < 0) { if (r > 0) { r--; vi = LGK.vis.length - 1; } else vi = 0; }
    else if (vi >= LGK.vis.length) { if (r < LGK.rows.length - 1) { r++; vi = 0; } else vi = LGK.vis.length - 1; }
    c = LGK.vis[vi];
  }
  if (dr) r = Math.max(0, Math.min(LGK.rows.length - 1, r + dr));
  return lgGridSet(r, c, extend);
}

function lgGridClear() {
  LGK.cur = null; LGK.anchor = null;
  lgGridPaint();
}

function lgGridEdit(seed) {
  if (!LGK.cur) return;
  const el = lgGridCell(LGK.cur.r, LGK.cur.c);
  if (el) lgCellEdit(el, seed != null ? { seed } : null);
}

/* 고친 다음 어디에 설지 — Enter 는 아래, Tab 은 오른쪽. 표를 안 쳐다봐도 이어서 칠 수 있게 */
function lgGridLand(cell, move) {
  const line = cell && cell.closest('.lg-line');
  if (!line) return;
  const r = LGK.rows.indexOf(line);
  const c = LGK.cols.indexOf(cell.dataset.ed);
  if (r < 0 || c < 0) return;
  lgGridSet(r, c, false);
  if (move === 'down') lgGridMove(1, 0, false);
  else if (move === 'up') lgGridMove(-1, 0, false);
  else if (move === 'right') lgGridMove(0, 1, false);
  else if (move === 'left') lgGridMove(0, -1, false);
}

function lgGridCopy() {
  const rng = lgGridRange();
  if (!rng) return;
  const out = [];
  for (let r = rng.r0; r <= rng.r1; r++) {
    const line = [];
    for (let c = rng.c0; c <= rng.c1; c++) {
      if (!LGK.vis.includes(c)) continue;
      const el = lgGridCell(r, c);
      line.push(el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    }
    out.push(line.join('\t'));
  }
  const text = out.join('\n');
  try {
    navigator.clipboard.writeText(text).then(() => enToast(`${out.length}행 복사했습니다`), () => {});
  } catch (e) { /* 클립보드를 못 쓰는 자리면 조용히 넘어간다 */ }
}

function lgGridInit(box) {
  LGK.rows = [...box.querySelectorAll('.lg-line')];
  LGK.editing = false;
  const want = LGK.want; LGK.want = null;

  if (!LGK.rows.length) { LGK.cur = null; LGK.anchor = null; lgBulkPaint(); return; }

  /* 좁은 화면에선 분류·메모 열이 접힌다. 접힌 칸으로는 옮겨 가지 않는다. */
  const first = LGK.rows[0];
  const vis = LGK.cols.map((name, i) => {
    const el = first.querySelector(`[data-ed="${name}"]`);
    return el && el.offsetParent !== null ? i : -1;
  }).filter(i => i >= 0);
  LGK.vis = vis.length ? vis : [0, 1, 2, 3];

  if (!box.dataset.grid) {
    box.dataset.grid = '1';
    box.addEventListener('mousedown', (e) => {
      const cell = e.target.closest && e.target.closest('[data-ed]');
      if (!cell || cell.classList.contains('editing')) return;
      const r = LGK.rows.indexOf(cell.closest('.lg-line'));
      const c = LGK.cols.indexOf(cell.dataset.ed);
      if (r < 0 || c < 0) return;
      if (e.shiftKey) {
        e.preventDefault();
        if (!LGK.anchor) LGK.anchor = LGK.cur || { r, c };
        LGK.cur = { r, c };
        const el = lgGridCell(r, c);
        if (el) { el.tabIndex = 0; el.focus({ preventScroll: true }); }
        lgGridPaint();
      } else {
        lgGridSet(r, c, false);
      }
    });
    box.addEventListener('focusin', (e) => {
      if (LGK.editing) return;
      const cell = e.target.closest && e.target.closest('[data-ed]');
      if (!cell) return;
      const r = LGK.rows.indexOf(cell.closest('.lg-line'));
      const c = LGK.cols.indexOf(cell.dataset.ed);
      if (r < 0 || c < 0) return;
      if (LGK.cur && LGK.cur.r === r && LGK.cur.c === c) return;
      LGK.cur = { r, c }; LGK.anchor = { r, c };
      lgGridPaint();
    });
    box.addEventListener('keydown', (e) => {
      if (LGK.editing) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (k === 'c' || k === 'C')) { lgGridCopy(); return; }
      if (mod && (k === 'a' || k === 'A')) {
        e.preventDefault();
        LGK.anchor = { r: 0, c: LGK.vis[0] };
        lgGridSet(LGK.rows.length - 1, LGK.vis[LGK.vis.length - 1], true);
        return;
      }
      if (mod) return;
      if (k === 'ArrowDown') { e.preventDefault(); lgGridMove(1, 0, e.shiftKey); }
      else if (k === 'ArrowUp') { e.preventDefault(); lgGridMove(-1, 0, e.shiftKey); }
      else if (k === 'ArrowRight') { e.preventDefault(); lgGridMove(0, 1, e.shiftKey); }
      else if (k === 'ArrowLeft') { e.preventDefault(); lgGridMove(0, -1, e.shiftKey); }
      else if (k === 'Tab') { e.preventDefault(); lgGridMove(0, e.shiftKey ? -1 : 1, false); }
      else if (k === 'Home') { e.preventDefault(); lgGridSet(LGK.cur ? LGK.cur.r : 0, LGK.vis[0], e.shiftKey); }
      else if (k === 'End') { e.preventDefault(); lgGridSet(LGK.cur ? LGK.cur.r : 0, LGK.vis[LGK.vis.length - 1], e.shiftKey); }
      else if (k === 'Enter' || k === 'F2') { e.preventDefault(); lgGridEdit(); }
      else if (k === 'Escape') { e.preventDefault(); lgGridClear(); }
      else if (k === ' ') {
        /* 한 행을 통째로 — 토글·삭제처럼 행 단위로 할 일이 많다 */
        e.preventDefault();
        if (!LGK.cur) return;
        LGK.anchor = { r: LGK.cur.r, c: LGK.vis[0] };
        lgGridSet(LGK.cur.r, LGK.vis[LGK.vis.length - 1], true);
      }
      else if (!e.altKey && k.length === 1) {
        /* 그냥 치기 시작하면 그 글자로 고치기가 열린다 */
        if (LGK.cur && LGK.cols[LGK.cur.c] === 'cat') { e.preventDefault(); lgGridEdit(); return; }
        e.preventDefault();
        lgGridEdit(k);
      }
    });
  }

  if (want) {
    const r = LGK.rows.findIndex(el => Number(el.dataset.id) === want.id);
    const c = LGK.cols.indexOf(want.col);
    if (r >= 0 && c >= 0) {
      lgGridSet(r, c, false);
      if (want.move) lgGridMove(want.move === 'down' ? 1 : want.move === 'up' ? -1 : 0,
        want.move === 'right' ? 1 : want.move === 'left' ? -1 : 0, false);
      return;
    }
  }
  LGK.cur = null; LGK.anchor = null;
  lgGridPaint();
}

/* ---------------- 묶은 칸을 한 번에 고치는 바 ----------------
   무엇이 몇 개 잡혔는지 먼저 말하고, 그 다음에 할 수 있는 일을 늘어놓는다.
   한 열만 잡혔으면 '같은 값으로'가 앞에 오고, 여러 열이면 행 단위 손질만 남는다. */
function lgBulkRows() {
  const rng = lgGridRange();
  if (!rng) return [];
  const out = [];
  for (let r = rng.r0; r <= rng.r1; r++) if (LGK.rows[r]) out.push(LGK.rows[r]);
  return out;
}

async function lgBulkApply(ids, patch, msg) {
  if (!ids.length) return;
  const { error } = await (await enClient()).from('transactions').update(patch).in('id', ids);
  if (error) { enToast('저장하지 못했습니다'); return; }
  enToast(msg || `${ids.length}건 고쳤습니다`);
  LGK.cur = null; LGK.anchor = null;
  lgTouched();
  enLoadLedger();
}

function lgBulkPaint() {
  const host = document.querySelector('.lg-wrap');
  const old = document.getElementById('lg-bulk');
  const rng = lgGridRange();
  const many = !!rng && (rng.r0 !== rng.r1 || rng.c0 !== rng.c1);
  if (!many || !host) { if (old) old.remove(); return; }

  const rows = lgBulkRows();
  const ids = rows.map(el => Number(el.dataset.id));
  const cols = [];
  for (let c = rng.c0; c <= rng.c1; c++) if (LGK.vis.includes(c)) cols.push(c);
  const cellCount = rows.length * Math.max(cols.length, 1);
  const one = cols.length === 1 ? LGK.cols[cols[0]] : null;

  const oneHTML = !one ? '' :
    one === 'cat'
      ? `<span class="one"><span class="lab">분류</span><span class="lg-cpick">
           <input class="lg-ed" id="lg-bk-catq" placeholder="분류 검색 → 고르면 바로 적용" autocomplete="off">
           <input type="hidden" id="lg-bk-cat"></span></span>`
      : `<span class="one"><span class="lab">${LGK.labels[one]}</span>
           <input class="lg-ed${one === 'amount' ? ' mono' : ''}" id="lg-bk-val" autocomplete="off"
                  placeholder="${one === 'amount' ? '금액' : one === 'merchant' ? '사용처 (그룹 › 이름)' : '메모 — 비우면 지움'}">
           <button class="go" id="lg-bk-go">적용</button></span>`;

  const html = `
    <span class="n"><b>${rows.length}</b>행 · <b>${cellCount}</b>칸 잡힘</span>
    ${oneHTML}
    <span class="sep"></span>
    <input class="lg-ed" type="date" id="lg-bk-date" title="잡힌 행의 날짜를 한꺼번에">
    <button data-b="company_paid" title="회사 환급 전환">🏢</button>
    <button data-b="is_fixed" title="고정비 전환">📌</button>
    <button data-b="Good">GOOD</button>
    <button data-b="Bad">BAD</button>
    <button data-b="gbnull">GOOD/BAD 해제</button>
    <span class="sep"></span>
    <button class="danger" data-b="del">삭제</button>
    <button data-b="close">해제 <span class="kbd">Esc</span></button>`;

  let bar = old;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'lg-bulk';
    bar.id = 'lg-bulk';
    host.appendChild(bar);
  }
  bar.innerHTML = html;

  if (one === 'cat') {
    lgCatPick(bar.querySelector('#lg-bk-catq'), bar.querySelector('#lg-bk-cat'), (c) => {
      lgBulkApply(ids, { category_id: c.id }, `${ids.length}건을 '${c.subcategory}'로 옮겼습니다`);
    });
  } else if (one) {
    const val = bar.querySelector('#lg-bk-val');
    if (one === 'merchant') lgMerchantAC(val);
    if (one === 'amount') val.addEventListener('input', () => {
      const minus = /^\s*[-−]/.test(val.value);
      const raw = val.value.replace(/[^\d]/g, '');
      val.value = raw ? (minus ? '−' : '') + enComma(raw) : (minus ? '−' : '');
    });
    const go = () => {
      const v = val.value.trim();
      if (one === 'amount') {
        const neg = /^[-−]/.test(v);
        const n = Number(v.replace(/[^\d]/g, ''));
        if (!n) { enToast('금액을 적어주세요'); return; }
        lgBulkApply(ids, { amount: neg ? -n : n }, `${ids.length}건의 금액을 맞췄습니다`);
      } else if (one === 'merchant') {
        if (!v) { enToast('사용처를 적어주세요'); return; }
        const p = lgSplitMerchant(v);
        lgBulkApply(ids, { merchant_group: p.group, merchant: p.merchant }, `${ids.length}건의 사용처를 맞췄습니다`);
      } else {
        lgBulkApply(ids, { note: v || null }, v ? `${ids.length}건에 메모를 넣었습니다` : `${ids.length}건의 메모를 지웠습니다`);
      }
    };
    bar.querySelector('#lg-bk-go').addEventListener('click', go);
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); go(); }
    });
  }

  bar.querySelector('#lg-bk-date').addEventListener('change', (e) => {
    const d = e.target.value;
    if (d) lgBulkApply(ids, { date: d }, `${ids.length}건을 ${d.slice(2).replace(/-/g, '.')} 로 옮겼습니다`);
  });

  bar.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.b;
    if (k === 'close') { lgGridClear(); return; }
    if (k === 'del') {
      if (!confirm(`${ids.length}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      const { error } = await (await enClient()).from('transactions').delete().in('id', ids);
      if (error) { enToast('삭제하지 못했습니다'); return; }
      enToast(`${ids.length}건 삭제했습니다`);
      LGK.cur = null; LGK.anchor = null;
      lgTouched();
      enLoadLedger();
      return;
    }
    if (k === 'company_paid' || k === 'is_fixed') {
      /* 다 켜져 있으면 끄고, 하나라도 꺼져 있으면 모두 켠다 — 결과를 예측할 수 있게 */
      const allOn = rows.every(el => {
        const t = el.querySelector(`[data-tg="${k}"]`);
        return t && t.classList.contains('on');
      });
      const patch = {}; patch[k] = !allOn;
      lgBulkApply(ids, patch, `${ids.length}건 ${k === 'is_fixed' ? '고정비' : '회사 환급'} ${allOn ? '해제' : '표시'}했습니다`);
      return;
    }
    /* Good/Bad 는 지출에만 매긴다 */
    const spend = rows.filter(el => el.classList.contains('k-지출')).map(el => Number(el.dataset.id));
    if (!spend.length) { enToast('지출 행에만 매길 수 있어요'); return; }
    const v = k === 'gbnull' ? null : k;
    lgBulkApply(spend, { good_bad: v }, `지출 ${spend.length}건 ${v ? v.toUpperCase() : 'GOOD/BAD 해제'}`);
  }));
}

/* ---------------- 전체 내역 : 표 위에서 행을 여러 개 만들어 한 번에 저장 ----------------
   따로 화면을 만들지 않는다. 목록 맨 위에 빈 행이 쌓이고, 다 채우면 한 번에 넣는다.
   같은 날짜·금액·사용처가 이미 있으면 저장 직전에 알려준다. */

/* 새 기록 행에서 오갈 수 있는 칸 — 화면에 놓인 차례와 같게 둔다 */
const LG_DCOLS = ['date', 'merchant', 'catq', 'amount', 'note'];

function lgDraftRowHTML(i, seed) {
  const c = EN.catById[seed.catId];
  /* 칸 순서 = 생각하는 순서. 어디서 샀나 → 무슨 갈래인가 → 얼마인가 → 남길 말.
     사용처를 먼저 적으면 분류·고정비가 따라오므로 분류 칸은 대개 그냥 지나친다. */
  return `<div class="lg-dr" data-dr="${i}">
    <span class="dt"><input class="lg-ed" type="date" data-d="date" value="${enEsc(seed.date)}" style="color-scheme:dark;"></span>
    <span class="nm"><input class="lg-ed" data-d="merchant" placeholder="사용처" autocomplete="off" value="${enEsc(seed.merchant || '')}"></span>
    <span class="ck"><i class="lg-kd ${c ? c.kind : ''}" data-kd>${c ? c.kind : '—'}</i>
      <span class="lg-cpick">
        <input class="lg-ed" data-d="catq" placeholder="분류 검색" autocomplete="off"
               value="${c ? enEsc(c.category + ' › ' + c.subcategory) : ''}">
        <input type="hidden" data-d="cat" value="${seed.catId || ''}">
      </span></span>
    <span class="am"><input class="lg-ed mono" data-d="amount" inputmode="numeric" placeholder="0" value="${enEsc(seed.amount || '')}"></span>
    <span class="no"><input class="lg-ed" data-d="note" placeholder="메모" autocomplete="off" value="${enEsc(seed.note || '')}"></span>
    <span class="tg">
      <button class="lg-tg ${seed.company_paid ? 'on' : ''}" data-dtg="company_paid" title="회사 환급" tabindex="-1">🏢</button>
      <button class="lg-tg ${seed.is_fixed || enMerchFixed(seed.merchant) ? 'on' : ''}${enMerchFixed(seed.merchant) ? ' auto' : ''}" data-dtg="is_fixed" title="고정비" tabindex="-1">📌</button>
    </span>
    <span class="gb"><button class="lg-gb ${c && c.kind !== '지출' ? 'off' : ''} ${seed.good_bad === 'Good' ? 'good' : seed.good_bad === 'Bad' ? 'bad' : ''}" data-dgb tabindex="-1" ${c && c.kind !== '지출' ? 'disabled' : ''}>${seed.good_bad === 'Good' ? 'GOOD' : seed.good_bad === 'Bad' ? 'BAD' : '—'}</button></span>
    <button class="x" data-drx="${i}" aria-label="이 행 삭제" tabindex="-1">×</button>
  </div>`;
}

function lgRenderAdd(focusIdx) {
  const host = document.getElementById('lg-add');
  if (!host) return;
  if (!EN.draft) EN.draft = [];
  if (!EN.draft.length) {
    host.innerHTML = `<button class="lg-addbtn" id="lg-addnew">+ 새 기록 추가</button>`;
    host.querySelector('#lg-addnew').addEventListener('click', () => lgDraftAdd());
    return;
  }
  host.innerHTML = `
    <div class="lg-addbar">
      <span class="t">새 기록 <b>${EN.draft.length}</b>건</span>
      <span class="hint"><kbd>Enter</kbd> 다음 칸 · 금액에서 <kbd>Enter</kbd> 새 행 ·
        <kbd>Shift</kbd>+<kbd>Enter</kbd> 아무 데서나 새 행 · <kbd>↑↓←→</kbd> 칸 이동 ·
        <kbd>⌘</kbd>+<kbd>D</kbd> 행 복제 · <kbd>⌘</kbd>+<kbd>Enter</kbd> 모두 저장</span>
      <button class="lg-addghost" id="lg-drclear">비우기</button>
      <button class="lg-addghost" id="lg-drmore">+ 행 추가</button>
      <button class="lg-addsave" id="lg-drsave">모두 저장</button>
    </div>
    <div class="lg-drs">${EN.draft.map((d, i) => lgDraftRowHTML(i, d)).join('')}</div>
    <p class="lg-drerr" id="lg-drerr" hidden></p>`;

  host.querySelectorAll('.lg-dr').forEach(row => {
    const hid = row.querySelector('[data-d="cat"]');
    const sync = () => {
      const c = EN.catById[Number(hid.value)];
      const kd = row.querySelector('[data-kd]');
      kd.className = 'lg-kd ' + (c ? c.kind : '');
      kd.textContent = c ? c.kind : '—';
      row.classList.remove('bad');
      /* Good/Bad 는 지출에만 매긴다 */
      const gb = row.querySelector('[data-dgb]');
      const off = !!c && c.kind !== '지출';
      gb.disabled = off;
      gb.classList.toggle('off', off);
      if (off) { gb.className = 'lg-gb off'; gb.textContent = '—'; }
    };
    hid.addEventListener('change', sync);
    lgCatPick(row.querySelector('[data-d="catq"]'), hid, sync);
    sync();
  });

  /* 사용처를 적으면 예전에 쓰던 그룹과 분류가 따라오고, 고정비 사용처면 📌도 같이 켜진다 */
  host.querySelectorAll('[data-d="merchant"]').forEach(inp => {
    const row = inp.closest('.lg-dr');
    const apply = (cid) => {
      const hid = row.querySelector('[data-d="cat"]');
      if (!cid || hid.value) return;
      const c = EN.catById[cid];
      hid.value = String(cid);
      const q = row.querySelector('[data-d="catq"]');
      if (q && c) q.value = c.category + ' › ' + c.subcategory;
      hid.dispatchEvent(new Event('change'));
    };
    /* 손으로 끈 것을 다시 켜지는 않는다 — 자동은 auto 표시가 남아 있을 때만 */
    const applyFixed = (m) => {
      const b = row.querySelector('[data-dtg="is_fixed"]');
      if (!b) return;
      const mfx = enMerchFixed(m);
      if (mfx) { b.classList.add('on', 'auto'); }
      else if (b.classList.contains('auto')) { b.classList.remove('on', 'auto'); }
    };
    lgMerchantAC(inp, (m, cid) => { apply(cid); applyFixed(m); });
    inp.addEventListener('change', () => {
      const m = lgSplitMerchant(inp.value).merchant;
      apply(EN.merchCat[m]);
      applyFixed(m);
    });
  });

  host.querySelectorAll('[data-d="amount"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const t = inp.value;
      const minus = /^\s*[-−]/.test(t);
      const raw = t.replace(/[^\d]/g, '');
      inp.value = raw ? (minus ? '−' : '') + enComma(raw) : (minus ? '−' : '');
    });
  });

  host.querySelectorAll('[data-dtg]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    b.classList.remove('auto');   /* 손으로 건드린 순간부터는 자동이 아니다 */
  }));
  host.querySelectorAll('[data-dgb]').forEach(b => b.addEventListener('click', () => {
    const cur = b.classList.contains('good') ? 'Good' : b.classList.contains('bad') ? 'Bad' : null;
    const next = cur === null ? 'Good' : cur === 'Good' ? 'Bad' : null;
    b.className = 'lg-gb ' + (next === 'Good' ? 'good' : next === 'Bad' ? 'bad' : '');
    b.textContent = next === 'Good' ? 'GOOD' : next === 'Bad' ? 'BAD' : '—';
  }));

  host.querySelectorAll('[data-drx]').forEach(b => b.addEventListener('click', () => {
    lgDraftSync();
    EN.draft.splice(Number(b.dataset.drx), 1);
    lgRenderAdd();
  }));

  /* 칸 사이를 손대지 않고 돌아다닌다.
     ↑↓ 는 같은 칸의 위·아래 행, ←→ 는 글자 끝에 닿았을 때만 옆 칸으로 — 글자 고치는 걸 막지 않는다. */
  const DCOLS = LG_DCOLS;
  const drFocus = (r, c) => {
    const el = host.querySelector(`.lg-dr[data-dr="${r}"] [data-d="${DCOLS[c]}"]`);
    if (!el || el.type === 'hidden' || el.offsetParent === null) return false;
    el.focus();
    if (el.select) { try { el.select(); } catch (err) {} }
    return true;
  };
  const drStep = (r, c, dr, dc) => {
    const n = host.querySelectorAll('.lg-dr').length;
    let rr = r + dr, cc = c + dc;
    for (let guard = 0; guard < 24; guard++) {
      if (cc < 0) { cc = DCOLS.length - 1; rr--; }
      if (cc > DCOLS.length - 1) { cc = 0; rr++; }
      if (rr < 0 || rr >= n) return false;
      if (drFocus(rr, cc)) return true;
      if (dc) cc += (dc > 0 ? 1 : -1); else return false;
    }
    return false;
  };
  const caretStart = (el) => { try { return el.selectionStart === 0 && el.selectionEnd === 0; } catch (err) { return true; } };
  const caretEnd = (el) => { try { return el.selectionStart === el.value.length && el.selectionEnd === el.value.length; } catch (err) { return true; } };

  /* 칸 안내는 한 번만 건다 — 행을 그릴 때마다 걸면 Enter 한 번에 행이 두세 개씩 생긴다 */
  if (!host.dataset.keys) {
  host.dataset.keys = '1';
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); lgDraftSave(); return; }
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.d) return;
    const row = t.closest('.lg-dr');
    if (!row) return;
    const i = Number(row.dataset.dr);
    const c = DCOLS.indexOf(t.dataset.d);
    if (c < 0) return;

    /* 어디서든 한 번에 새 행 */
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      lgDraftSync();
      const s = EN.draft[i] || {};
      lgDraftAdd(s.date, s.catId);
      return;
    }
    /* 이 행 그대로 한 벌 더 (금액만 비운다) — 같은 가게에서 여러 건 적을 때.
       아직 아무것도 안 쓴 행이면 바로 윗 행을 물려받는다. */
    if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      lgDraftSync();
      const here = EN.draft[i];
      const blank = here && !here.merchant && !here.note && !here.amount;
      const s = (blank && EN.draft[i - 1]) ? EN.draft[i - 1] : here;
      if (!s) return;
      EN.draft.splice(i + 1, 0, { ...s, amount: '' });
      lgRenderAdd(i + 1);
      return;
    }
    /* 자동완성·분류 목록이 이미 가져간 키는 건드리지 않는다 */
    if (e.defaultPrevented) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (t.dataset.d === 'amount') {
        lgDraftSync();
        if (i === EN.draft.length - 1) lgDraftAdd(EN.draft[i].date, EN.draft[i].catId);
        else lgRenderAdd(i + 1);
        return;
      }
      drStep(i, c, 0, 1);
      return;
    }
    if (e.key === 'ArrowDown') { if (drStep(i, c, 1, 0)) e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { if (drStep(i, c, -1, 0)) e.preventDefault(); return; }
    if (e.key === 'ArrowRight' && caretEnd(t)) { if (drStep(i, c, 0, 1)) e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' && caretStart(t)) { if (drStep(i, c, 0, -1)) e.preventDefault(); return; }
    if (e.key === 'Escape') { t.blur(); }
  });
  }

  host.querySelector('#lg-drmore').addEventListener('click', () => {
    lgDraftSync();
    const last = EN.draft[EN.draft.length - 1] || {};
    lgDraftAdd(last.date, last.catId);
  });
  host.querySelector('#lg-drclear').addEventListener('click', () => {
    if (!confirm('작성 중인 행을 모두 버릴까요?')) return;
    EN.draft = [];
    lgRenderAdd();
  });
  host.querySelector('#lg-drsave').addEventListener('click', lgDraftSave);

  const rows = host.querySelectorAll('.lg-dr');
  /* 언제나 사용처부터 — 여기서 분류와 고정비가 따라 붙으니 첫 칸이어야 한다 */
  const target = rows[focusIdx == null ? rows.length - 1 : focusIdx];
  if (target) {
    const nm = target.querySelector('[data-d="merchant"]');
    if (nm) { nm.focus(); try { nm.select(); } catch (err) {} }
  }
}

/* 화면에 적힌 값을 EN.draft 로 되받는다 — 다시 그릴 때 입력이 날아가지 않게 */
function lgDraftSync() {
  const host = document.getElementById('lg-add');
  if (!host || !EN.draft || !EN.draft.length) return;
  host.querySelectorAll('.lg-dr').forEach(row => {
    const i = Number(row.dataset.dr);
    const v = (k) => { const el = row.querySelector(`[data-d="${k}"]`); return el ? el.value : ''; };
    const gb = row.querySelector('[data-dgb]');
    EN.draft[i] = {
      date: v('date') || enToday(),
      catId: Number(v('cat')) || null,
      merchant: v('merchant').trim(),
      note: v('note').trim(),
      amount: v('amount'),
      company_paid: row.querySelector('[data-dtg="company_paid"]').classList.contains('on'),
      is_fixed: row.querySelector('[data-dtg="is_fixed"]').classList.contains('on'),
      good_bad: gb.classList.contains('good') ? 'Good' : gb.classList.contains('bad') ? 'Bad' : null
    };
  });
}

function lgDraftAdd(date, catId) {
  if (!EN.draft) EN.draft = [];
  if (EN.draft.length) lgDraftSync();
  EN.draft.push({
    date: date || (EN.draft.length ? EN.draft[EN.draft.length - 1].date : enToday()),
    catId: catId || null, merchant: '', note: '', amount: '',
    company_paid: false, is_fixed: false, good_bad: null
  });
  lgRenderAdd();
}

/* 같은 날짜 · 금액 · 사용처가 이미 있는지 — 저장 직전에만 확인한다 */
async function lgDupes(rows) {
  const key = (d, a, m) => `${d}|${a}|${(m || '').trim()}`;
  const dates = [...new Set(rows.map(r => r.date))];
  const out = [];
  const seen = {};
  try {
    const { data } = await (await enClient()).from('v_transactions')
      .select('date,amount,merchant').in('date', dates);
    (data || []).forEach(r => { seen[key(String(r.date), Number(r.amount), r.merchant)] = 'db'; });
  } catch (e) { /* 확인 못 하면 경고 없이 진행한다 — 저장을 막지는 않는다 */ }
  rows.forEach((r, i) => {
    const k = key(r.date, r.amount, r.merchant);
    if (seen[k]) out.push({ i, where: seen[k] });
    seen[k] = seen[k] || 'draft';
  });
  return out;
}

async function lgDraftSave() {
  lgDraftSync();
  const host = document.getElementById('lg-add');
  const err = document.getElementById('lg-drerr');
  host.querySelectorAll('.lg-dr').forEach(r => r.classList.remove('bad'));

  const rows = [];
  let invalid = 0;
  EN.draft.forEach((d, i) => {
    const neg = /^[-−]/.test(d.amount);
    const n = Number(String(d.amount).replace(/[^\d]/g, ''));
    /* 분류는 직전 행에서 물려받아 이미 채워져 있을 수 있다.
       그러니 '아직 아무것도 안 쓴 행'의 기준은 금액·사용처·메모가 모두 빈 것. */
    const blank = !n && !d.merchant && !d.note;
    if (blank) return;
    if (!d.catId || !n) {
      invalid++;
      const el = host.querySelector(`.lg-dr[data-dr="${i}"]`);
      if (el) el.classList.add('bad');
      return;
    }
    const { group, merchant } = lgSplitMerchant(d.merchant);
    rows.push({
      date: d.date, category_id: d.catId, amount: neg ? -n : n,
      merchant_group: group, merchant, note: d.note || null,
      good_bad: d.good_bad, company_paid: d.company_paid, is_fixed: d.is_fixed
    });
  });

  if (invalid) {
    err.hidden = false;
    err.textContent = `${invalid}건은 분류와 금액이 있어야 저장됩니다. 붉게 표시된 행을 확인하세요.`;
    return;
  }
  if (!rows.length) { err.hidden = false; err.textContent = '저장할 내용이 없습니다.'; return; }
  err.hidden = true;

  const dupes = await lgDupes(rows);
  if (dupes.length) {
    const lines = dupes.slice(0, 6).map(({ i }) => {
      const r = rows[i];
      return `· ${r.date} ${enComma(Math.abs(r.amount))}원 ${r.merchant || ''}`;
    }).join('\n');
    const more = dupes.length > 6 ? `\n… 외 ${dupes.length - 6}건` : '';
    if (!confirm(`같은 날짜 · 금액 · 사용처의 기록이 이미 있습니다.\n\n${lines}${more}\n\n그래도 저장할까요?`)) return;
  }

  const btn = document.getElementById('lg-drsave');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  const { error } = await (await enClient()).from('transactions').insert(rows);
  if (btn) { btn.disabled = false; btn.textContent = '모두 저장'; }
  if (error) { err.hidden = false; err.textContent = '저장하지 못했습니다. 다시 시도하세요.'; return; }

  rows.forEach(r => { if (r.merchant) EN.merchCat[r.merchant] = r.category_id; });
  EN.draft = [];
  lgRenderAdd();
  enToast(`${rows.length}건 기록했습니다`);
  lgTouched();
  enLoadLedger();
}

/* ================= 전체 내역 › 사용처 =================
   814개 사용처가 어느 그룹·분류로 쓰이고 있는지 한 곳에서 본다.
   여기서 고치면 그 사용처의 과거 기록 전체가 같이 바뀐다 — 표기 흔들림을 잡는 자리. */

const MG = { rows: null, q: '', group: 'all', fixed: 'all', sort: 'cnt', dir: 'desc', loading: false };
/* 열마다 기본 방향이 다르다 — 숫자는 큰 것부터, 글자는 가나다순이 자연스럽다 */
const MG_SORTDIR = { gp: 'asc', nm: 'asc', ct: 'asc', fx: 'desc', cnt: 'desc', sum: 'desc', last: 'desc' };

/* 그룹 이름 앞에 붙는 그림. 목록이 39줄이라 글자만으로는 훑기 어렵다. */
const MG_EMOJI = {
  '주식': '📈', '카페/디저트': '☕', '음식점': '🍽️', '편의점/마트': '🏪', '내 계좌': '🏦',
  '교통': '🚕', '온라인쇼핑몰': '📦', '구독': '🔁', '사람': '🧑', '잡화': '🧺',
  '회사': '🏢', '모임': '🍻', '통신': '📱', '서점': '📚', '의류/패션': '👕',
  '헤어/뷰티': '💇', '문구/화방': '✏️', '영화관': '🎬', '배달': '🛵', '병원/약국': '💊',
  '여행': '✈️', '소프트웨어': '💻', '가구': '🛋️', '디지털/가전': '🔌', '노래방': '🎤',
  '백화점': '🏬', '공연/전시': '🎭', '주점/이자카야': '🍶', '오락/가챠': '🎮', '소품샵': '🎁',
  'OTT': '📺', '사진관': '📷', '식품/식료품': '🥬', '인쇄소': '🖨️', '클럽': '🕺',
  '숙박': '🛏️', '보험': '🛡️', '적금': '💰', '(그룹 없음)': '⬜'
};
/* 그룹 칸에 '소프트웨어, 🔁구독' 처럼 쉼표로 여러 개가 들어간 경우가 있다.
   이건 합쳐진 이름이 아니라 두 개를 고른 것이므로 쪼개서 각각으로 센다. */
function mgSplitGroups(raw) {
  return String(raw || '')
    .split(',')
    .map(t => t.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean);
}
function mgEmoji(g) {
  if (!g || g === 'all') return '';
  if (MG_EMOJI[g]) return MG_EMOJI[g];
  /* '소프트웨어, 🔁구독' 처럼 합쳐진 이름은 앞부분으로 한 번 더 찾는다 */
  const head = String(g).split(/[,·/]/)[0].trim();
  return MG_EMOJI[head] || '🏷️';
}

function mgGroupPicker(host) {
  const inp = document.getElementById('mg-gq');
  const drop = document.getElementById('mg-gdrop');
  const clear = document.getElementById('mg-gx');
  if (!inp || !drop) return;
  const items = () => Array.from(drop.querySelectorAll('.lg-catopt'));
  const filter = () => {
    const q = inp.value.trim().toLowerCase();
    const picked = MG.group !== 'all' && inp.value === mgEmoji(MG.group) + ' ' + MG.group;
    let n = 0;
    items().forEach(el => {
      const hit = !q || picked || el.textContent.toLowerCase().includes(q);
      el.hidden = !hit;
      if (hit) n++;
    });
    drop.hidden = false;
    return n;
  };
  inp.addEventListener('focus', () => { inp.select(); filter(); });
  inp.addEventListener('input', filter);
  inp.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 140));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); drop.hidden = true; inp.blur(); }
    if (e.key === 'Enter') {
      const first = items().find(el => !el.hidden);
      if (first) { e.preventDefault(); MG.group = first.dataset.g; renderMerchantPage(host); }
    }
  });
  items().forEach(el => el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    MG.group = el.dataset.g;
    renderMerchantPage(host);
  }));
  if (clear) clear.addEventListener('click', () => { MG.group = 'all'; renderMerchantPage(host); });
}

async function mgLoad(force) {
  if (MG.rows && !force) return MG.rows;
  const sb = await enClient();
  const out = [];
  /* 3천~4천 행이라 한 번에 다 받는다. 페이지를 나누면 집계가 틀어진다. */
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from('v_transactions')
      .select('merchant,merchant_group,category_id,kind,amount,date,is_fixed')
      .order('id', { ascending: false }).range(from, from + 999);
    if (error || !data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  const map = {};
  out.forEach(r => {
    const m = (r.merchant || '').trim();
    if (!m) return;
    const k = m;
    if (!map[k]) map[k] = { name: m, groups: {}, tags: {}, cats: {}, cnt: 0, fixedCnt: 0, sum: 0, last: '', kind: r.kind };
    const e = map[k];
    e.cnt++;
    if (r.is_fixed) e.fixedCnt++;
    e.sum += Math.abs(Number(r.amount) || 0);
    if (String(r.date) > e.last) { e.last = String(r.date); e.kind = r.kind; }
    /* 그룹이 비어 있는 것도 하나의 상태로 센다 — 일부만 묶여 있으면 그것도 흔들림이다 */
    e.groups[r.merchant_group || ''] = (e.groups[r.merchant_group || ''] || 0) + 1;
    mgSplitGroups(r.merchant_group).forEach(t => { e.tags[t] = (e.tags[t] || 0) + 1; });
    if (r.category_id) e.cats[r.category_id] = (e.cats[r.category_id] || 0) + 1;
  });
  const top = (o) => {
    let best = null, n = -1;
    Object.keys(o).forEach(k => { if (o[k] > n) { n = o[k]; best = k; } });
    return best;
  };
  const fixedReg = {};
  try {
    const { data: reg } = await sb.from('merchants').select('name,merchant_group,is_fixed');
    (reg || []).forEach(r => {
      const m = String(r.name || '').trim();
      if (!m) return;
      if (r.is_fixed) fixedReg[m] = true;
      if (map[m]) return;
      map[m] = { name: m, groups: { [r.merchant_group || '']: 1 },
        tags: r.merchant_group ? { [r.merchant_group]: 1 } : {}, cats: {}, cnt: 0, fixedCnt: 0, sum: 0, last: '', kind: '지출' };
    });
  } catch (e) {}
  /* 사전 값이 기준이다. 자동완성 쪽 캐시도 여기서 같이 맞춰 둔다. */
  EN.merchFixed = {};
  Object.keys(fixedReg).forEach(m => { EN.merchFixed[m] = true; });
  MG.rows = Object.values(map).map(e => ({
    name: e.name, cnt: e.cnt, sum: e.sum, last: e.last, kind: e.kind,
    fixed: !!fixedReg[e.name],
    fixedCnt: e.fixedCnt,
    /* 사용처는 고정비인데 기록 일부가 빠져 있는 상태 — 표에서 바로 보이게 */
    fixedGap: (fixedReg[e.name] ? e.cnt - e.fixedCnt : e.fixedCnt),
    group: top(e.groups) || '',
    tags: Object.keys(e.tags).sort((a, b) => e.tags[b] - e.tags[a]),
    catId: Number(top(e.cats)) || null,
    mixedGroup: Object.keys(e.groups).length > 1,
    mixedCat: Object.keys(e.cats).length > 1
  }));
  return MG.rows;
}

async function renderMerchantPage(host) {
  if (!host) return;
  host.innerHTML = '<div class="lg-wrap"><div class="en-empty">사용처를 모으는 중…</div></div>';
  await enEnsureRefs();
  await mgLoad();

  const groups = {};
  MG.rows.forEach(r => {
    if (!r.tags.length) { groups['(그룹 없음)'] = (groups['(그룹 없음)'] || 0) + 1; return; }
    r.tags.forEach(t => { groups[t] = (groups[t] || 0) + 1; });
  });
  const gList = Object.keys(groups).sort((a, b) => groups[b] - groups[a]);
  const fxCnt = { y: MG.rows.filter(r => r.fixed).length, gap: MG.rows.filter(r => r.fixedGap).length };

  const q = MG.q.trim().toLowerCase();
  let rows = MG.rows.filter(r => {
    if (MG.group !== 'all') {
      const hit = MG.group === '(그룹 없음)' ? !r.tags.length : r.tags.includes(MG.group);
      if (!hit) return false;
    }
    if (q && !(r.name.toLowerCase().includes(q) || r.tags.join(' ').toLowerCase().includes(q))) return false;
    if (MG.fixed === 'y' && !r.fixed) return false;
    if (MG.fixed === 'gap' && !r.fixedGap) return false;
    return true;
  });
  const catLabel = (r) => { const c = EN.catById[r.catId]; return c ? c.category + ' ' + c.subcategory : 'ㅎㅎㅎ'; };
  const sorts = {
    cnt: (a, b) => b.cnt - a.cnt,
    sum: (a, b) => b.sum - a.sum,
    last: (a, b) => b.last.localeCompare(a.last),
    nm: (a, b) => a.name.localeCompare(b.name, 'ko'),
    fx: (a, b) => (b.fixed ? 1 : 0) - (a.fixed ? 1 : 0) || b.sum - a.sum,
    gp: (a, b) => (a.tags[0] || 'ㅎㅎㅎ').localeCompare(b.tags[0] || 'ㅎㅎㅎ', 'ko') || a.name.localeCompare(b.name, 'ko'),
    ct: (a, b) => catLabel(a).localeCompare(catLabel(b), 'ko') || a.name.localeCompare(b.name, 'ko')
  };
  const base = sorts[MG.sort] || sorts.cnt;
  const flip = MG.dir !== (MG_SORTDIR[MG.sort] || 'desc');
  rows = rows.sort((a, b) => (flip ? -1 : 1) * base(a, b));
  const arrow = (k) => MG.sort === k ? `<b class="ar">${MG.dir === 'asc' ? '▲' : '▼'}</b>` : '';

  host.innerHTML = `
    <div class="lg-wrap">
      <div class="lg-stick mg-stick">
      <div class="mg-bar">
        <div class="lg-grp grow">
          <span class="lg-glab">검색</span>
          <div class="lg-gin"><input class="en-in grow" id="mg-q" placeholder="사용처 · 그룹" value="${enEsc(MG.q)}"></div>
        </div>
        <div class="lg-grp cat">
          <span class="lg-glab">그룹</span>
          <div class="lg-gin lg-catpick">
            <input class="en-in grow" id="mg-gq" placeholder="그룹 전체 — 입력해서 찾기" autocomplete="off"
                   value="${MG.group === 'all' ? '' : enEsc(mgEmoji(MG.group) + ' ' + MG.group)}">
            <button class="lg-catx" id="mg-gx" aria-label="그룹 해제" ${MG.group === 'all' ? 'hidden' : ''}>×</button>
            <div class="lg-catdrop" id="mg-gdrop" hidden>
              <div class="lg-catopt" data-g="all"><span class="tx"><b>전체</b></span><span class="cnt">${MG.rows.length}</span></div>
              ${gList.map(g => `<div class="lg-catopt" data-g="${enEsc(g)}">
                <span class="em">${mgEmoji(g)}</span><span class="tx">${enEsc(g)}</span>
                <span class="cnt">${groups[g]}</span></div>`).join('')}
            </div>
          </div>
        </div>
        <div class="lg-grp">
          <span class="lg-glab">고정비</span>
          <div class="mg-fxseg" id="mg-fxseg">
            ${[['all', '전체', MG.rows.length],
               ['y', '📌 고정비', fxCnt.y],
               ['gap', '어긋남', fxCnt.gap]].map(([v, l, c]) =>
              `<button data-fx="${v}" class="${MG.fixed === v ? 'on' : ''}">${l}<i>${c}</i></button>`).join('')}
          </div>
        </div>
        <div class="lg-grp">
          <span class="lg-glab">&nbsp;</span>
          <button class="bk-add" id="mg-add">+ 사용처 추가</button>
          <button class="lg-reset" id="mg-reload">다시 읽기</button>
        </div>
      </div>

      <div class="lg-cols mg-cols" id="mg-cols">
        <span class="gp" data-s="gp">그룹${arrow('gp')}</span>
        <span class="nm" data-s="nm">사용처${arrow('nm')}</span>
        <span class="fx" data-s="fx">고정${arrow('fx')}</span>
        <span class="ct" data-s="ct">주로 쓰는 분류${arrow('ct')}</span>
        <span class="cn" data-s="cnt">건수${arrow('cnt')}</span>
        <span class="sm" data-s="sum">합계${arrow('sum')}</span>
        <span class="lt" data-s="last">최근${arrow('last')}</span>
      </div>
      </div>
      <div class="lg-card mg-card">
        ${rows.length ? rows.map(r => {
          const c = EN.catById[r.catId];
          return `<div class="mg-row" data-m="${enEsc(r.name)}">
            <span class="gp" data-me="group" title="더블클릭해서 그룹 변경">${r.tags.length
              ? r.tags.map(t => `<i class="lg-mg">${mgEmoji(t)} ${enEsc(t)}</i>`).join('')
                + (r.mixedGroup ? '<b class="mix" title="기록마다 그룹이 다릅니다">•</b>' : '')
              : '<i class="lg-mg none">없음</i>'}</span>
            <span class="nm" data-me="name" title="더블클릭해서 이름 변경">${enEsc(r.name)}</span>
            <span class="fx"><button class="mg-fx ${r.fixed ? 'on' : ''}" data-mfx
              title="${r.fixed ? '고정비 사용처 — 눌러서 해제' : '눌러서 고정비 사용처로 지정'}">📌</button>${
              r.fixedGap ? `<b class="gap" title="${r.fixed
                ? `이 사용처 기록 ${r.fixedGap}건이 아직 고정비로 표시돼 있지 않습니다`
                : `고정비 사용처가 아닌데 기록 ${r.fixedGap}건이 고정비로 표시돼 있습니다`}">${r.fixedGap}</b>` : ''}</span>
            <span class="ct" data-me="cat" title="더블클릭해서 분류 일괄 변경">${c
              ? `<i class="lg-kd ${c.kind}">${c.kind}</i>${enEsc(c.category)} › ${enEsc(c.subcategory)}`
              : '<span class="dim">분류 없음</span>'}${r.mixedCat ? '<b class="mix" title="기록마다 분류가 다릅니다">•</b>' : ''}</span>
            <span class="cn">${enComma(r.cnt)}</span>
            <span class="sm">${enComma(Math.round(r.sum))}</span>
            <span class="lt">${r.last.slice(2).replace(/-/g, '.')}</span>
          </div>`;
        }).join('') : '<div class="en-empty">조건에 맞는 사용처가 없습니다.</div>'}
      </div>
      <div class="lg-meta"><span>${enComma(rows.length)}개 사용처${MG.rows.length !== rows.length ? ` (전체 ${enComma(MG.rows.length)}개 중)` : ''}</span></div>
    </div>`;

  let t = null;
  enQS('#mg-q').addEventListener('input', (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => {
      MG.q = v;
      renderMerchantPage(host).then(() => {
        const el = document.getElementById('mg-q');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }, 260);
  });
  enQS('#mg-reload').addEventListener('click', () => { MG.rows = null; renderMerchantPage(host); });
  host.querySelectorAll('#mg-fxseg [data-fx]').forEach(b => b.addEventListener('click', () => {
    MG.fixed = b.dataset.fx;
    renderMerchantPage(host);
  }));
  host.querySelectorAll('[data-mfx]').forEach(b => b.addEventListener('click', () =>
    mgToggleFixed(b.closest('.mg-row').dataset.m, host)));
  enQS('#mg-add').addEventListener('click', async () => {
    const nm = (prompt('추가할 사용처 이름') || '').trim();
    if (!nm) return;
    const gp = (prompt(`'${nm}' 의 그룹 — 비워두면 나중에 정해도 됩니다`, '') || '').trim();
    const ok = await enRegisterMerchant(nm, gp);
    enToast(ok ? `'${nm}' 등록했습니다` : '등록하지 못했습니다');
    if (ok) { MG.rows = null; renderMerchantPage(host); }
  });
  mgGroupPicker(host);
  host.querySelectorAll('#mg-cols [data-s]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.s;
    if (MG.sort === k) MG.dir = MG.dir === 'asc' ? 'desc' : 'asc';
    else { MG.sort = k; MG.dir = MG_SORTDIR[k] || 'desc'; }
    renderMerchantPage(host);
  }));
  host.querySelectorAll('[data-me]').forEach(cell =>
    cell.addEventListener('dblclick', () => mgEdit(cell, host)));
}

/* 사용처를 고정비로 지정한다. 그룹·분류 수정과 같은 규칙 —
   과거 기록 몇 건이 바뀌는지 먼저 알려주고 묻는다. */
async function mgToggleFixed(name, host) {
  const rec = MG.rows.find(r => r.name === name);
  if (!rec) return;
  const on = !rec.fixed;
  const gap = on ? rec.cnt - rec.fixedCnt : rec.fixedCnt;
  let past = false;
  if (gap > 0) {
    past = confirm(`'${name}' 을(를) ${on ? '고정비 사용처로 지정' : '고정비에서 해제'}합니다.\n\n`
      + `지난 기록 ${enComma(gap)}건도 같이 ${on ? '고정비로 표시' : '해제'}할까요?\n\n`
      + `확인 — 지난 기록까지 맞춥니다\n취소 — 앞으로 넣는 기록에만 적용됩니다`);
  }
  const res = await enSetMerchantFixed(name, on, past);
  if (!res.ok) { enToast('바꾸지 못했습니다'); return; }
  rec.fixed = on;
  if (past) rec.fixedCnt = on ? rec.cnt : 0;
  rec.fixedGap = rec.fixed ? rec.cnt - rec.fixedCnt : rec.fixedCnt;
  enToast(`'${name}' ${on ? '고정비로 지정' : '고정비 해제'}`
    + (res.moved ? ` · 지난 기록 ${enComma(res.moved)}건 반영` : ''));
  renderMerchantPage(host);
}

/* 여기서 고친 건 과거 기록 전체에 적용된다. 몇 건이 바뀌는지 먼저 알려주고 묻는다. */
function mgEdit(cell, host) {
  if (cell.classList.contains('editing')) return;
  const row = cell.closest('.mg-row');
  const name = row.dataset.m;
  const rec = MG.rows.find(r => r.name === name);
  if (!rec) return;
  const what = cell.dataset.me;
  const prev = cell.innerHTML;
  let done = false;
  cell.classList.add('editing');

  let input;
  if (what === 'cat') {
    const rank = { '지출': 0, '수입': 1, '이체': 2 };
    const cats = [...EN.cats].sort((a, b) =>
      (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.sort_order - b.sort_order);
    input = document.createElement('select');
    input.className = 'lg-ed sel';
    let last = '';
    let og = null;
    cats.forEach(c => {
      if (c.kind !== last) { og = document.createElement('optgroup'); og.label = c.kind; input.appendChild(og); last = c.kind; }
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.category + ' › ' + c.subcategory;
      if (c.id === rec.catId) o.selected = true;
      og.appendChild(o);
    });
  } else {
    input = document.createElement('input');
    input.className = 'lg-ed';
    input.value = what === 'group' ? (rec.group || '') : rec.name;
    if (what === 'group') input.setAttribute('list', 'mg-glist');
  }
  cell.innerHTML = '';
  cell.appendChild(input);
  if (what === 'group' && !document.getElementById('mg-glist')) {
    const dl = document.createElement('datalist');
    dl.id = 'mg-glist';
    const seen = {};
    MG.rows.forEach(r => { if (r.group) seen[r.group] = 1; });
    dl.innerHTML = Object.keys(seen).sort().map(g => `<option value="${enEsc(g)}">`).join('');
    document.body.appendChild(dl);
  }
  input.focus();
  if (input.select) input.select();

  const finish = async (commit) => {
    if (done) return;
    done = true;
    cell.classList.remove('editing');
    if (!commit) { cell.innerHTML = prev; return; }
    const patch = {};
    let label = '';
    if (what === 'cat') {
      const cid = Number(input.value);
      if (!cid || cid === rec.catId) { cell.innerHTML = prev; return; }
      const c = EN.catById[cid];
      patch.category_id = cid;
      label = `분류를 ${c.category} › ${c.subcategory} 로`;
    } else if (what === 'group') {
      const v = input.value.trim();
      if (v === (rec.group || '')) { cell.innerHTML = prev; return; }
      patch.merchant_group = v || null;
      label = v ? `그룹을 ${v} 로` : '그룹을 지우도록';
    } else {
      const v = input.value.trim();
      if (!v || v === rec.name) { cell.innerHTML = prev; return; }
      patch.merchant = v;
      label = `이름을 ${v} 로`;
    }
    if (!confirm(`${name} 기록 ${enComma(rec.cnt)}건의 ${label} 바꿉니다.\n되돌리려면 같은 방법으로 다시 고쳐야 합니다.\n\n계속할까요?`)) {
      cell.innerHTML = prev;
      return;
    }
    const { error } = await (await enClient()).from('transactions').update(patch).eq('merchant', name);
    if (error) { enToast('저장하지 못했습니다'); cell.innerHTML = prev; return; }
    enToast(`${enComma(rec.cnt)}건 바꿨습니다`);
    MG.rows = null;
    EN.loaded = false;
    await enEnsureRefs();
    renderMerchantPage(host);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  if (what === 'cat') input.addEventListener('change', () => finish(true));
}

/* ---------------- 단축키 ---------------- */
document.addEventListener('keydown', (e) => {
  const ov = document.getElementById('en-ov');
  const open = ov && !ov.hidden;
  if (e.key === 'Escape' && open) { enClose(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') { e.preventDefault(); open ? enClose() : enOpen(); }
  else if (e.key === 'l' || e.key === 'L' || e.key === 'ㅣ') { e.preventDefault(); if (open) enClose(); goTo('data', 'ledger'); }
  else if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') { e.preventDefault(); if (open) enClose(); dbmOpen(); }
});

/* 가계부를 고쳤으면 캐시된 원장도 같이 갱신한다 — 탭을 옮겼을 때 옛 숫자가 남지 않게 */
let lgRefreshTimer = null;
function lgTouched() {
  clearTimeout(lgRefreshTimer);
  lgRefreshTimer = setTimeout(async () => {
    try {
      const fresh = await fetchLedgerFromDB();
      if (!fresh || !fresh.length || !state.data) return;
      state.data.ledger = fresh;
      state.data.ledgerSource = 'db';
      const pv = buildPivotFromLedger(fresh);
      if (pv) {
        state.data.months = pv.months;
        state.data.incomeTotal = pv.incomeTotal;
        state.data.expenseTotal = pv.expenseTotal;
        state.data.expenseCategories = pv.expenseCategories;
        state.data.incomeCategories = pv.incomeCategories;
        state.data.transferCategories = pv.transferCategories;
      }
      /* 흐름(오늘·이번달·올해) 화면은 원장을 그대로 그리므로, 고친 값이 바로 보이게 다시 그린다.
         전체 내역·자산 화면은 각자 다시 읽으므로 여기서 건드리지 않는다. */
      if (state.page === 'flow' && !document.querySelector('.lg-ed')) renderPage();
    } catch (e) { /* 다음 새로고침에서 다시 맞춰진다 */ }
  }, 900);
}

function renderAll() {
  renderBanner();
  setSyncState(state.source === 'live' ? 'live' : state.lastError ? 'err' : 'snapshot');
  renderPage();
}

/* ---------------- page: 홈 ---------------- */


/* ---------------- 목표 보드 (연도/반기 그리드 · 드래그 이동) ---------------- */

/* Apps Script 웹앱 URL. 배포 후 여기에 붙여넣으면 드래그 결과가 시트에 반영된다.
   비워두면 화면에서만 바뀌고 '시트 미반영' 배지가 뜬다. */
/* Apps Script 웹앱 URL — 설정 모달에서 입력하면 localStorage에 저장된다 */
let GOALS_WEBAPP_URL = '';
function loadGoalsWebapp() {
  try { GOALS_WEBAPP_URL = localStorage.getItem('haedal:goals-webapp') || ''; } catch (e) { GOALS_WEBAPP_URL = ''; }
  return GOALS_WEBAPP_URL;
}
function saveGoalsWebapp(url) {
  GOALS_WEBAPP_URL = (url || '').trim();
  try {
    if (GOALS_WEBAPP_URL) localStorage.setItem('haedal:goals-webapp', GOALS_WEBAPP_URL);
    else localStorage.removeItem('haedal:goals-webapp');
  } catch (e) {}
}
loadGoalsWebapp();

function openGoalsSyncSettings() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head"><b>시트 자동 반영 설정</b><button class="btn small" data-act="close">닫기</button></div>
      <div class="modal-body">
        <label class="fld"><span>Apps Script 웹앱 URL</span>
          <input type="text" id="gw-url" value="${GOALS_WEBAPP_URL.replace(/"/g, '&quot;')}" placeholder="https://script.google.com/macros/s/..../exec" />
        </label>
        <div class="settings-note" style="line-height:1.8;">
          비워두면 변경 내용이 화면에만 남고 새로고침하면 사라집니다.<br/>
          스프레드시트 → 확장 프로그램 → Apps Script에 아래 코드를 붙여넣고
          <b>배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자</b>로 배포한 뒤 나오는 <b>/exec</b> URL을 넣으세요.
        </div>
        <pre class="gw-code">function doPost(e) {
  var p = JSON.parse(e.postData.contents);
  var sh = SpreadsheetApp.getActive().getSheetByName('목표');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = function (name) { return head.indexOf(name) + 1; };
  var MAP = { period: '시기', category: '구분', title: '항목', freq: '기간',
              amount: '금액 or 비율', status: '상태', memo: '메모' };
  if (p.action === 'addGoal') {
    var row = sh.getLastRow() + 1;
    Object.keys(MAP).forEach(function (k) {
      var c = col(MAP[k]);
      if (c > 0 && p[k] !== undefined) sh.getRange(row, c).setValue(p[k]);
    });
  } else if (p.action === 'updateGoal') {
    Object.keys(MAP).forEach(function (k) {
      var c = col(MAP[k]);
      if (c > 0 && p[k] !== undefined) sh.getRange(p.row, c).setValue(p[k]);
    });
  } else if (p.action === 'deleteGoal') {
    sh.deleteRow(p.row);
  }
  return ContentService.createTextOutput('ok');
}</pre>
      </div>
      <div class="modal-foot"><span></span>
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener('click', (e) => {
    if (e.target === back) { back.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') back.remove();
    if (act.dataset.act === 'save') {
      saveGoalsWebapp(back.querySelector('#gw-url').value);
      back.remove();
      showToast(GOALS_WEBAPP_URL ? '시트 자동 반영을 켰어요.' : '시트 자동 반영을 껐어요.', 'good');
      renderPage();
    }
  });
}

/* "2026 상반기" / "26년 하반기" / "2026 H1" / "2026 3분기" / "2026" 등을 {y, h}로 */
function parseGoalPeriod(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return null;
  const ym = s0.match(/(20\d{2}|\d{2})\s*년?/);
  if (!ym) return null;
  let y = parseInt(ym[1], 10);
  if (y < 100) y += 2000;
  let h = null;
  if (/상반기|상반|H1|1H/i.test(s0)) h = 1;
  else if (/하반기|하반|H2|2H/i.test(s0)) h = 2;
  else {
    const q = s0.match(/([1-4])\s*(?:분기|Q)/i) || s0.match(/Q\s*([1-4])/i);
    if (q) h = parseInt(q[1], 10) <= 2 ? 1 : 2;
  }
  return { y, h };
}

/* 시트에 이미 쓰인 표기 스타일을 최대한 따라간다 */
function goalPeriodFormatter(goals) {
  let useYearSuffix = false, useShortYear = false;
  for (const g of goals) {
    const p = String(pickGoalField(g, 'period') || '');
    if (/\d\s*년/.test(p)) useYearSuffix = true;
    if (/^\s*\d{2}\s*년/.test(p)) useShortYear = true;
  }
  return (y, h) => {
    const yy = useShortYear ? String(y).slice(2) : String(y);
    const head = useYearSuffix ? `${yy}년` : yy;
    return h ? `${head} ${h === 1 ? '상' : '하'}반기` : head;
  };
}


function renderGoalBoard(data, d) {
  const host = document.getElementById('home-goals');
  if (!host) return;
  const allGoals = (data.goals || []).filter(g => pickGoalField(g, 'title'));
  if (!allGoals.length) {
    host.innerHTML = `<div class="g"><div class="panel s8">
      <div class="panel-title"><div>목표</div></div>
      <div class="empty-state">목표 탭에서 목표 데이터를 찾지 못했어요.
      <a href="${csvUrlFor(GID_GOALS)}" target="_blank" rel="noopener" style="color:var(--accent-text);">불러오는 값 확인</a></div>
    </div></div>`;
    return;
  }

  const extra = goalMetricExtra(data, d);
  const fmtPeriod = goalPeriodFormatter(allGoals);

  /* 로컬 이동 오버라이드 (시트 반영 전/실패 시에도 화면에 유지) */
  if (!state.goalMoves) state.goalMoves = {};
  const periodOf = (g) => state.goalMoves[g.__row] !== undefined
    ? state.goalMoves[g.__row]
    : (pickGoalField(g, 'period') || '');

  /* 그룹 기준: 구분(기본) · 시기 · 상태.
     시트가 정량 구조로 바뀌면서 '시기'가 비어 있는 목표가 많아 기본값을 '구분'으로 둔다. */
  const GROUP_OPTS = [['period', '시기'], ['category', '구분'], ['status', '상태']];
  const GRP = GROUP_OPTS.some(x => x[0] === state.goalGroup) ? state.goalGroup : 'period';
  const nowY = new Date().getFullYear();
  const curHalf = (new Date().getMonth() < 6) ? 1 : 2;

  let buckets = [], byBucket = {}, curKey = null, draggable = false;
  if (GRP === 'period') {
    draggable = true;
    const years = new Set();
    allGoals.forEach(g => { const p = parseGoalPeriod(periodOf(g)); if (p) years.add(p.y); });
    years.add(nowY); years.add(nowY + 1);
    [...years].sort((a, b) => a - b).forEach(y => {
      buckets.push({ key: `${y}-1`, label: `${y} 상반기` });
      buckets.push({ key: `${y}-2`, label: `${y} 하반기` });
    });
    buckets.push({ key: 'none', label: '시기 미정' });
    buckets.forEach(b => { byBucket[b.key] = []; });
    allGoals.forEach(g => {
      const p = parseGoalPeriod(periodOf(g));
      let k = p ? (p.h ? `${p.y}-${p.h}` : `${p.y}-1`) : 'none';
      if (!byBucket[k]) k = 'none';
      byBucket[k].push(g);
    });
    curKey = `${nowY}-${curHalf}`;
  } else if (GRP === 'status') {
    const order = ['진행중', '대기', '달성/완료', '완료', '보류'];
    const seen = [];
    allGoals.forEach(g => { const st = pickGoalField(g, 'status') || '미지정'; if (!seen.includes(st)) seen.push(st); });
    seen.sort((a, b) => {
      const ia = order.findIndex(o => a.includes(o)), ib = order.findIndex(o => b.includes(o));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    seen.forEach(st => { buckets.push({ key: st, label: st }); byBucket[st] = []; });
    allGoals.forEach(g => byBucket[pickGoalField(g, 'status') || '미지정'].push(g));
    curKey = seen.find(x => /진행/.test(x)) || null;
  } else {
    const seen = [];
    allGoals.forEach(g => { const c = pickGoalField(g, 'category') || '기타'; if (!seen.includes(c)) seen.push(c); });
    seen.forEach(c => { buckets.push({ key: c, label: c }); byBucket[c] = []; });
    allGoals.forEach(g => byBucket[pickGoalField(g, 'category') || '기타'].push(g));
  }
  /* 각 칸 안에서는 '미달 → 달성' 순, 그 안에서 목표값 오름차순 */
  const sortKeyOf = (g) => {
    const p = goalProgressOf(g, d, extra);
    if (!p) return [2, 0];
    const good = p.invert ? p.current <= p.target : p.current >= p.target;
    return [good ? 1 : 0, p.target];
  };
  Object.keys(byBucket).forEach(k => {
    byBucket[k].sort((a, b) => {
      const [ga, ta] = sortKeyOf(a), [gb, tb] = sortKeyOf(b);
      return ga - gb || ta - tb;
    });
  });

  const total = allGoals.length;
  const done = allGoals.filter(g => goalStatusClass(pickGoalField(g, 'status')) === 'ok').length;
  const active = allGoals.filter(g => goalStatusClass(pickGoalField(g, 'status')) === 'active').length;

  const card = (g) => {
    const title = pickGoalField(g, 'title');
    const category = pickGoalField(g, 'category');
    const status = pickGoalField(g, 'status');
    const memo = pickGoalField(g, 'memo');
    const doneDate = pickGoalField(g, 'doneDate');
    const vClass = goalStatusClass(status) || 'pending';
    /* 완료 = 초록 체크·취소선, 대기 = 점선 테두리·흐림 (둘을 다르게 보이게) */
    const progress = goalProgressOf(g, d, extra);
    const freq = pickGoalField(g, 'freq');
    const sanity = goalSanityFlag(progress);

    let metricHtml = '';
    if (progress) {
      const good = progress.invert ? progress.current <= progress.target : progress.current >= progress.target;
      const fmt = (v) => progress.isPct ? `${v.toFixed(1)}%` : `${formatCompactWon(v)}원`;
      /* 달성률: 많을수록 좋은 목표는 현재/목표, 적을수록 좋은 목표는 목표/현재 */
      const raw = progress.invert
        ? (progress.current > 0 ? (progress.target / progress.current) * 100 : 100)
        : (progress.target > 0 ? (progress.current / progress.target) * 100 : 0);
      const pct = Math.max(0, Math.min(raw, 100));
      const gap = progress.current - progress.target;
      const dirIcon = progress.invert ? '↓' : '↑';
      const gapTxt = gap === 0 ? '목표와 동일'
        : progress.invert
          ? (gap < 0 ? `${fmt(Math.abs(gap))} 아래` : `${fmt(gap)} 초과`)
          : (gap >= 0 ? `${fmt(gap)} 초과` : `${fmt(Math.abs(gap))} 남음`);
      metricHtml = `
        <div class="gb-metric ${good ? 'good' : 'bad'}">
          <span class="gb-dir" title="${progress.invert ? '적을수록 좋은 목표' : '많을수록 좋은 목표'}">${dirIcon}</span>
          <span class="gb-cur">${fmt(progress.current)}</span>
          <span class="gb-arrow">/</span>
          <span class="gb-tgt">${fmt(progress.target)}</span>
          <span class="gb-verdict">${good ? '달성' : '미달'}</span>
          ${progress.overridden ? '<span class="gb-ov" title="목표 수치 직접 지정">✎</span>' : ''}
        </div>
        <div class="gb-bar"><i class="${good ? 'good' : 'bad'}" style="width:${pct}%"></i></div>
        <div class="gb-figs"><span>${progress.name}</span><span>${gapTxt}</span></div>
        ${sanity ? `<div class="gb-warn">⚠ ${sanity}</div>` : ''}`;
    }

    const pending = state.goalMoves[g.__row] !== undefined || (state.goalEdits && state.goalEdits[g.__row]);
    return `<div class="gb-card ${vClass}" ${draggable ? 'draggable="true"' : ''} data-row="${g.__row}" title="더블클릭 → 편집">
      <div class="gb-head">
        ${vClass === 'ok' ? '<span class="gb-check">✓</span>' : ''}
        <span class="gb-title">${title}${freq ? `<em class="gb-freq">${freq}</em>` : ''}</span>
      </div>
      ${metricHtml}
      <div class="gb-foot">
        ${status ? `<span class="gb-status ${vClass}">${status}</span>` : ''}
        ${GRP !== 'category' && category ? `<span class="gb-tag">${category}</span>` : ''}
        ${doneDate ? `<span class="gb-date">${doneDate}</span>` : ''}
        ${!progress ? '<span class="gb-nolink">수치 미연동</span>' : ''}
        ${pending ? '<span class="gb-pending">시트 반영 대기</span>' : ''}
      </div>
      ${memo ? `<div class="gb-memo">${memo}</div>` : ''}
    </div>`;
  };

  host.innerHTML = `
    <div class="g" style="margin-bottom:20px;">
      <div class="panel s12" id="panel-goal-ladder"></div>
    </div>
    <div class="g">
      <div class="panel s2" id="panel-goal-side"></div>
      <div class="s10" id="goal-board-wrap">
        <div class="gb-boardbar">
          <div class="range-toggle" id="goal-group-toggle">
            ${GROUP_OPTS.map(([v, l]) => `<button data-grp="${v}" class="${v === GRP ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <span class="settings-note" style="margin:0;">${draggable ? '카드 드래그 → 시기 이동 · ' : ''}더블클릭 → 편집</span>
          <button class="btn small" id="goal-add-btn">+ 목표 추가</button>
        </div>
        <div class="gb-board" id="goal-board">
          ${buckets.map(b => `
            <div class="gb-col ${b.key === curKey ? 'now' : ''} ${b.key === 'none' ? 'undated' : ''}" data-bucket="${b.key}">
              <div class="gb-colhead">
                <b>${b.label}</b>
                <span>${byBucket[b.key].length}</span>
              </div>
              <div class="gb-lane" data-bucket="${b.key}">
                ${byBucket[b.key].map(card).join('') || '<div class="gb-empty">여기로 끌어다 놓기</div>'}
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>
  `;

  renderGoalLadder('panel-goal-ladder', allGoals, d, extra);

  /* --- 사이드: 상태 요약 --- */
  const byStatus = {};
  allGoals.forEach(g => {
    const st = pickGoalField(g, 'status') || '미지정';
    byStatus[st] = (byStatus[st] || 0) + 1;
  });
  const byCat = {};
  allGoals.forEach(g => {
    const c = pickGoalField(g, 'category') || '기타';
    byCat[c] = (byCat[c] || 0) + 1;
  });
  const recs = buildGoalRecommendations(data, d, extra, allGoals);
  document.getElementById('panel-goal-side').innerHTML = `
    <div class="panel-title"><div>요약</div><span class="ptag">${total}개</span></div>
    <div class="gb-donut"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
    <div class="gb-figs" style="margin-bottom:12px;"><span>완료 ${done} · 진행 ${active}</span><span>${total ? Math.round((done / total) * 100) : 0}%</span></div>
    ${Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div class="now-kv"><span>${k}</span><b>${v}</b></div>`).join('')}

    <div class="subhead" style="margin-top:16px;">추천 목표</div>
    <div class="gb-recs">
      ${recs.length ? recs.map((r, i) => `
        <div class="gb-rec" data-rec="${i}">
          <button class="gb-rec-x" data-rec-hide="${i}" title="이 추천 안 보기">×</button>
          <div class="gb-rec-title">${r.title}</div>
          <div class="gb-rec-why">${r.why}</div>
          <button class="btn small" data-rec-add="${i}">+ 추가</button>
        </div>`).join('') : '<div class="empty-state" style="padding:14px 0;">지금 제안할 목표가 없어요.</div>'}
      ${(state.settings.hiddenRecs || []).length ? `<button class="btn small" id="rec-reset" style="margin-top:8px;">숨긴 추천 ${(state.settings.hiddenRecs || []).length}개 되살리기</button>` : ''}
    </div>
    <div class="settings-note" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <button class="btn small" id="goal-sync-btn">시트 반영 ${GOALS_WEBAPP_URL ? '켜짐' : '꺼짐'}</button>
      <span>${GOALS_WEBAPP_URL ? '변경하면 시트에 바로 씁니다.' : '지금은 화면에만 반영돼요.'}</span>
    </div>
  `;

  document.getElementById('panel-goal-side').addEventListener('click', async (e) => {
    const hide = e.target.closest('button[data-rec-hide]');
    if (hide) {
      const r = recs[Number(hide.dataset.recHide)];
      if (!r) return;
      state.settings.hiddenRecs = [...new Set([...(state.settings.hiddenRecs || []), r.metricKey])];
      await saveSettings();
      renderPage();
      return;
    }
    if (e.target.closest('#rec-reset')) {
      state.settings.hiddenRecs = [];
      await saveSettings();
      renderPage();
      return;
    }
    const btn = e.target.closest('button[data-rec-add]');
    if (!btn) return;
    const r = recs[Number(btn.dataset.recAdd)];
    if (!r) return;
    const rows = (state.data.goals || []).map(x => x.__row || 0);
    const newRow = (rows.length ? Math.max(...rows) : 1) + 1;
    const payload = {
      title: r.item, category: r.category, freq: r.freq || '',
      amount: String(r.amount), period: '', status: '진행중', memo: r.why
    };
    const obj = { __row: newRow, __local: true };
    Object.keys(payload).forEach(f => { obj[goalFieldKeyFor(null, f)] = payload[f]; });
    state.data.goals = (state.data.goals || []).concat([obj]);
    pushGoalOp({ action: 'addGoal', ...payload });
    renderPage();
  });

  /* --- 편집 / 추가 / 삭제 --- */
  document.getElementById('goal-add-btn').addEventListener('click', () => openGoalEditor(null, data, d, fmtPeriod));
  document.getElementById('goal-board').addEventListener('dblclick', (e) => {
    const c = e.target.closest('.gb-card');
    if (!c) return;
    const g = allGoals.find(x => String(x.__row) === c.dataset.row);
    if (g) openGoalEditor(g, data, d, fmtPeriod);
  });

  const syncBtn = document.getElementById('goal-sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', openGoalsSyncSettings);

  const grpBox = document.getElementById('goal-group-toggle');
  if (grpBox) grpBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.goalGroup = b.dataset.grp;
    renderPage();
  });

  /* --- 드래그 앤 드롭 --- */
  const board = document.getElementById('goal-board');
  let dragRow = null;

  /* 현재 반기 컬럼이 보이도록 초기 스크롤 */
  const nowCol = board.querySelector('.gb-col.now');
  if (nowCol) board.scrollLeft = Math.max(0, nowCol.offsetLeft - board.offsetLeft - 12);

  /* 드래그 중 좌우 끝에 가까이 가면 자동 스크롤 */
  let autoTimer = null;
  const stopAuto = () => { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } };
  const autoScroll = (clientX) => {
    const r = board.getBoundingClientRect();
    const edge = 70;
    let dir = 0;
    if (clientX < r.left + edge) dir = -1;
    else if (clientX > r.right - edge) dir = 1;
    if (!dir) { stopAuto(); return; }
    if (autoTimer) return;
    autoTimer = setInterval(() => { board.scrollLeft += dir * 18; }, 16);
  };
  board.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.gb-card');
    if (!c) return;
    dragRow = c.dataset.row;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragRow); } catch (err) {}
  });
  board.addEventListener('dragend', () => {
    stopAuto();
    board.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
    board.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
  });
  board.addEventListener('dragover', (e) => {
    autoScroll(e.clientX);
    const lane = e.target.closest('.gb-lane');
    if (!lane) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    board.querySelectorAll('.gb-lane.over').forEach(x => { if (x !== lane) x.classList.remove('over'); });
    lane.classList.add('over');
  });
  board.addEventListener('dragleave', (e) => {
    const lane = e.target.closest('.gb-lane');
    if (lane) lane.classList.remove('over');
  });
  board.addEventListener('drop', (e) => {
    const lane = e.target.closest('.gb-lane');
    if (!lane) return;
    e.preventDefault();
    lane.classList.remove('over');
    stopAuto();
    const row = dragRow || e.dataTransfer.getData('text/plain');
    if (!row) return;
    const bk = lane.dataset.bucket;
    const newPeriod = bk === 'none' ? '' : (() => {
      const [y, h] = bk.split('-').map(Number);
      return fmtPeriod(y, h);
    })();
    const g = allGoals.find(x => String(x.__row) === String(row));
    if (!g) return;
    if (periodOf(g) === newPeriod) return;
    state.goalMoves[row] = newPeriod;
    pushGoalPeriod(Number(row), newPeriod, pickGoalField(g, 'title'));
    renderGoalBoard(data, d);
  });
}


/* ---------------- 추천 목표 (현황을 보고 매번 다시 계산) ---------------- */

/* 만원 단위 반올림 (목표 문구용) */
function roundManwon(v, step) {
  const st = (step || 10) * 10000;
  return Math.max(st, Math.round(v / st) * st);
}
function manwonText(v) { return `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`; }

function buildGoalRecommendations(data, d, extra, existingGoals) {
  /* 이미 같은 (구분+항목) 목표가 있으면 추천하지 않는다 */
  const taken = new Set((existingGoals || []).map(g => {
    const m = findGoalMetric(pickGoalField(g, 'category') || '', pickGoalField(g, 'title') || '');
    return m ? m.key : null;
  }).filter(Boolean));
  const hidden = new Set(state.settings.hiddenRecs || []);
  const out = [];
  const push = (key, o) => { if (!taken.has(key) && !hidden.has(key)) out.push({ metricKey: key, ...o }); };

  const monthlyExp = extra.avgExpense12 || 0;
  const avgIncome = extra.avgIncome12 || 0;

  /* 1. 비상금 — 월 지출 N개월치 */
  const months = state.settings.emergencyMonths || 6;
  const emgTarget = roundManwon(monthlyExp * months, 50);
  if (monthlyExp > 0 && d.emergencyFund < emgTarget) {
    push('emergency', {
      category: '🏦자산', item: '비상금', freq: '', amount: emgTarget,
      title: `비상금 ${manwonText(emgTarget)}`,
      why: `현재 ${formatCompactWon(d.emergencyFund)}원 · 생활비 ${(d.emergencyFund / monthlyExp).toFixed(1)}개월치 (목표 ${months}개월)`
    });
  }

  /* 2. 월 고정비 — 최근 12개월 평균에서 10% 절감 */
  const avgFixed = extra.avgFixed12 || 0;
  if (avgFixed > 0) {
    const t = roundManwon(avgFixed * 0.9, 5);
    push('fixed', {
      category: '💳지출', item: '고정비', freq: '월', amount: t,
      title: `월 고정비 ${manwonText(t)}`,
      why: `최근 12개월 평균 ${formatCompactWon(avgFixed)}원 → 10% 절감`
    });
  }

  /* 3. 월 지출 — 목표 저축률을 맞추는 상한 */
  const rateTarget = state.goals.savingsRateTarget || 40;
  const expCap = avgIncome * (1 - rateTarget / 100);
  if (avgIncome > 0 && monthlyExp > expCap) {
    const t = roundManwon(expCap, 10);
    push('expense', {
      category: '💳지출', item: '지출', freq: '월', amount: t,
      title: `월 지출 ${manwonText(t)}`,
      why: `저축률 ${rateTarget}% 기준 상한 · 현재 평균 ${formatCompactWon(monthlyExp)}원`
    });
  }

  /* 4. 아낄 수 있었던 소비(Bad) — 최근 12개월 평균의 절반 */
  const avgRegret = extra.avgRegret12 || 0;
  if (avgRegret > 30000) {
    const t = roundManwon(avgRegret * 0.5, 5);
    push('regret', {
      category: '💳지출', item: '아낄 수 있었던 소비', freq: '월', amount: t,
      title: `월 아낄 수 있었던 소비 ${manwonText(t)}`,
      why: `최근 12개월 평균 ${formatCompactWon(avgRegret)}원 → 절반으로`
    });
  }

  /* 5. 저축률 */
  if (extra.savingsRate12 > 0 && extra.savingsRate12 < rateTarget) {
    push('savingsRate', {
      category: '👌수입', item: '저축률', freq: '연', amount: rateTarget,
      title: `저축률 ${rateTarget}%`,
      why: `최근 12개월 ${extra.savingsRate12.toFixed(1)}% · 목표까지 ${(rateTarget - extra.savingsRate12).toFixed(1)}%p`
    });
  }

  /* 6. 순자산 다음 마일스톤 (5천만 단위) */
  const nw = d.totalAssets - totalDebt();
  if (nw > 0) {
    const step = 50000000;
    const next = Math.ceil((nw + 1) / step) * step;
    push('netWorth', {
      category: '🏦자산', item: '순 자산', freq: '', amount: next,
      title: `순자산 ${(next / 100000000).toFixed(1)}억`,
      why: `현재 ${formatCompactWon(nw)}원 · ${formatCompactWon(next - nw)}원 남음`
    });
  }

  /* 7. 연금 세액공제 한도 */
  const annPension = (data.transferCategories['연금 자산'] || []).slice(-12).reduce((a, v) => a + (v || 0), 0);
  if (annPension < PENSION_LIMIT) {
    push('pensionAssets', {
      category: '🏦자산', item: '연금 납입', freq: '연', amount: PENSION_LIMIT,
      title: `연금 납입 ${manwonText(PENSION_LIMIT)}`,
      why: `최근 12개월 ${formatCompactWon(Math.max(annPension, 0))}원 · 한도까지 ${formatCompactWon(PENSION_LIMIT - Math.max(annPension, 0))}원`
    });
  }

  return out.slice(0, 4);
}

/* ---------------- 목표 편집기 (더블클릭 / 추가) ---------------- */

const GOAL_STATUS_OPTIONS = ['진행중', '대기', '완료', '보류'];

function goalFieldKeyFor(goal, alias) {
  const names = GOAL_FIELD_ALIASES[alias] || [];
  for (const n of names) if (goal && goal[n] !== undefined) return n;
  return names[0];
}

function openGoalEditor(goal, data, d, fmtPeriod) {
  const isNew = !goal;
  const g = goal || {};
  const extra = goalMetricExtra(data, d);
  const cats = [...new Set((data.goals || []).map(x => pickGoalField(x, 'category')).filter(Boolean))];
  const items = [...new Set((data.goals || []).map(x => pickGoalField(x, 'title')).filter(Boolean))];
  const cur = {
    title: pickGoalField(g, 'title') || '',
    period: pickGoalField(g, 'period') || '',
    category: pickGoalField(g, 'category') || '',
    freq: pickGoalField(g, 'freq') || '',
    amount: pickGoalField(g, 'amount') || '',
    status: pickGoalField(g, 'status') || (isNew ? '진행중' : ''),
    memo: pickGoalField(g, 'memo') || ''
  };
  const savedKey = (state.goalMetric || {})[g.__row] || '';

  const nowY = new Date().getFullYear();
  const periodOpts = [];
  for (let y = nowY - 2; y <= nowY + 3; y++) { periodOpts.push([fmtPeriod(y, 1), `${y} 상반기`]); periodOpts.push([fmtPeriod(y, 2), `${y} 하반기`]); }

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <b>${isNew ? '목표 추가' : '목표 편집'}</b>
        <button class="btn small" data-act="close">닫기</button>
      </div>
      <div class="modal-body">
        <div class="fld-row">
          <label class="fld"><span>구분</span><input type="text" id="ge-category" list="ge-cat-list" value="${cur.category.replace(/"/g, '&quot;')}" placeholder="예) 🏦자산" />
            <datalist id="ge-cat-list">${cats.map(c => `<option value="${c}"></option>`).join('')}</datalist>
          </label>
          <label class="fld"><span>항목</span><input type="text" id="ge-title" list="ge-item-list" value="${cur.title.replace(/"/g, '&quot;')}" placeholder="예) 총 자산" />
            <datalist id="ge-item-list">${items.map(c => `<option value="${c}"></option>`).join('')}</datalist>
          </label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>기간</span>
            <select id="ge-freq">
              ${[['', '해당 없음 (잔액·누적)'], ['월', '월'], ['연', '연']].map(([v, l]) => `<option value="${v}" ${v === cur.freq ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label class="fld"><span>금액 or 비율</span>
            <input type="text" inputmode="numeric" id="ge-amount" value="${cur.amount === '' ? '' : String(cur.amount)}" placeholder="예) 10000000 또는 40%" />
          </label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>상태</span>
            <select id="ge-status">
              ${[...new Set([...GOAL_STATUS_OPTIONS, cur.status].filter(Boolean))].map(v => `<option value="${v}" ${v === cur.status ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="fld"><span>시기 (선택)</span>
            <select id="ge-period">
              <option value="">시기 미정</option>
              ${periodOpts.map(([v, l]) => `<option value="${v}" ${v === cur.period ? 'selected' : ''}>${l}</option>`).join('')}
              ${cur.period && !periodOpts.some(([v]) => v === cur.period) ? `<option value="${cur.period}" selected>${cur.period}</option>` : ''}
            </select>
          </label>
        </div>
        <label class="fld"><span>연동 지표 (비우면 구분·항목으로 자동 인식)</span>
          <select id="ge-metric">
            <option value="">자동</option>
            ${GOAL_METRIC_DEFS.map(m => `<option value="${m.key}" ${m.key === savedKey ? 'selected' : ''}>${m.name} (${m.dir === 'up' ? '많을수록 좋음' : '적을수록 좋음'})</option>`).join('')}
          </select>
        </label>
        <label class="fld"><span>메모</span><input type="text" id="ge-memo" value="${cur.memo.replace(/"/g, '&quot;')}" /></label>
        <div class="ge-link" id="ge-link"></div>
      </div>
      <div class="modal-foot">
        ${isNew ? '<span></span>' : '<button class="btn small danger" data-act="delete">삭제</button>'}
        <div style="display:flex;gap:8px;">
          <button class="btn small" data-act="close">취소</button>
          <button class="btn small primary" data-act="save">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  const $ = (id) => back.querySelector('#' + id);

  const draftGoal = () => ({
    __row: g.__row || -1,
    [goalFieldKeyFor(g, 'title')]: $('ge-title').value,
    [goalFieldKeyFor(g, 'category')]: $('ge-category').value,
    [goalFieldKeyFor(g, 'freq')]: $('ge-freq').value,
    [goalFieldKeyFor(g, 'amount')]: $('ge-amount').value
  });

  const refreshLink = () => {
    const draft = draftGoal();
    const key = $('ge-metric').value || null;
    const savedMetric = state.goalMetric || {};
    const prev = savedMetric[draft.__row];
    if (key) savedMetric[draft.__row] = key; else delete savedMetric[draft.__row];
    state.goalMetric = savedMetric;
    const p = goalProgressOf(draft, d, extra);
    if (prev === undefined) delete savedMetric[draft.__row]; else savedMetric[draft.__row] = prev;

    const box = $('ge-link');
    if (!p) {
      box.className = 'ge-link none';
      box.innerHTML = `연동된 수치 없음 — <b>구분</b>과 <b>항목</b>이 인식되지 않거나 <b>금액 or 비율</b>이 비어 있어요.
        (예: 구분 <b>🏦자산</b> · 항목 <b>총 자산</b> · 금액 <b>150000000</b>)`;
      return;
    }
    const good = p.invert ? p.current <= p.target : p.current >= p.target;
    const fmt = (v) => p.isPct ? `${v.toFixed(1)}%` : `${formatCompactWon(v)}원`;
    const sanity = goalSanityFlag(p);
    box.className = `ge-link ${good ? 'good' : 'bad'}`;
    box.innerHTML = `<b>${p.name}</b> · ${p.invert ? '적을수록 좋음' : '많을수록 좋음'}<br/>
      현재 <b>${fmt(p.current)}</b> / 목표 <b>${fmt(p.target)}</b> → <b>${good ? '달성' : '미달'}</b>
      ${sanity ? `<br/><span style="color:var(--accent-text)">⚠ ${sanity}</span>` : ''}`;
  };
  ['ge-title', 'ge-category', 'ge-amount'].forEach(id => $(id).addEventListener('input', refreshLink));
  ['ge-metric', 'ge-freq'].forEach(id => $(id).addEventListener('change', refreshLink));
  refreshLink();

  const close = () => back.remove();
  back.addEventListener('click', (e) => {
    if (e.target === back) return close();
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') return close();
    if (act === 'delete') {
      if (!window.confirm('이 목표를 시트에서 삭제할까요?')) return;
      pushGoalOp({ action: 'deleteGoal', row: g.__row, title: cur.title });
      state.data.goals = (state.data.goals || []).filter(x => x.__row !== g.__row);
      close(); renderPage();
      return;
    }
    if (act === 'save') {
      const patch = {
        title: $('ge-title').value.trim(),
        category: $('ge-category').value.trim(),
        freq: $('ge-freq').value,
        amount: $('ge-amount').value.trim(),
        period: $('ge-period').value,
        status: $('ge-status').value,
        memo: $('ge-memo').value.trim()
      };
      if (!patch.title) { showToast('항목을 입력해 주세요.', 'warn'); return; }
      if (!state.goalMetric) state.goalMetric = {};
      if (!state.goalTarget) state.goalTarget = {};
      const FIELDS = ['title', 'category', 'freq', 'amount', 'period', 'status', 'memo'];

      if (isNew) {
        const rows = (state.data.goals || []).map(x => x.__row || 0);
        const newRow = (rows.length ? Math.max(...rows) : 1) + 1;
        const obj = { __row: newRow, __local: true };
        FIELDS.forEach(f => { obj[goalFieldKeyFor(null, f)] = patch[f]; });
        state.data.goals = (state.data.goals || []).concat([obj]);
        if ($('ge-metric').value) state.goalMetric[newRow] = $('ge-metric').value;
        pushGoalOp({ action: 'addGoal', ...patch });
      } else {
        FIELDS.forEach(f => { g[goalFieldKeyFor(g, f)] = patch[f]; });
        if (state.goalMoves) delete state.goalMoves[g.__row];
        if ($('ge-metric').value) state.goalMetric[g.__row] = $('ge-metric').value;
        else delete state.goalMetric[g.__row];
        delete state.goalTarget[g.__row];
        pushGoalOp({ action: 'updateGoal', row: g.__row, ...patch });
      }
      close(); renderPage();
    }
  });
}

/* 시트 반영 공통 — Apps Script 웹앱으로 POST */
async function pushGoalOp(payload) {
  if (!GOALS_WEBAPP_URL) {
    showToast('시트 쓰기 엔드포인트가 없어 화면에만 반영됐어요.', 'warn');
    return;
  }
  try {
    await fetch(GOALS_WEBAPP_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    showToast('시트에 반영했어요.', 'good');
  } catch (e) {
    showToast('시트 반영 실패 — 화면에만 적용됐어요.', 'warn');
  }
}

/* 시트 반영 — Apps Script 웹앱으로 POST. 실패해도 화면 상태는 유지된다. */
/* 카드를 다른 시기로 옮겼을 때.
   Apps Script는 updateGoal만 알아듣는다(예전 setGoalPeriod는 무시돼서 시트에 안 써졌음).
   화면 상태(state.data.goals)도 같이 갱신해야 새로고침 전까지 되돌아가지 않는다. */
async function pushGoalPeriod(row, period, title) {
  const g = (state.data.goals || []).find(x => x.__row === row);
  if (g) g[goalFieldKeyFor(g, 'period')] = period;
  if (state.goalMoves) delete state.goalMoves[row];

  if (!GOALS_WEBAPP_URL) {
    showToast('시트 쓰기 엔드포인트가 없어 화면에만 반영됐어요.', 'warn');
    return;
  }
  try {
    await fetch(GOALS_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'updateGoal', row, period, title })
    });
    showToast(`시트에 반영했어요 · ${period || '시기 미정'}`, 'good');
  } catch (e) {
    showToast('시트 반영 실패 — 화면에만 적용됐어요.', 'warn');
  }
}

function showToast(msg, kind) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  el.className = `toast ${kind || ''} on`;
  el.textContent = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = `toast ${kind || ''}`; }, 2600);
}


const INSIGHT_WEIGHT = { warn: 3, info: 2, good: 1 };







function renderAllocation(d) {
  const panel = document.getElementById('panel-allocation');
  /* 목표 배분 갭과 같은 축을 쓰려고 4개 실제 카테고리를 그대로 쓴다(연금을 저축에 합치지 않음) */
  const entries = ALLOC_CATS.filter(c => (d.allocation[c] || 0) > 0).map(c => [c, d.allocation[c]]);
  panel.innerHTML = `
    <div class="panel-title">
      <div>자산 배분</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="ptag">${d.latestMonth || ''}</span>
        <button class="btn small" id="alloc-edit">${state.settings.targetAlloc ? '목표 수정' : '목표 설정'}</button>
      </div>
    </div>
    <div id="panel-target-alloc"></div>
  `;
  renderTargetAllocPanel('panel-target-alloc', d);
  const _ae = document.getElementById('alloc-edit');
  if (_ae) _ae.addEventListener('click', () => openAllocEditor(d));
  /* 도넛 조각 위에 카테고리 · % 를 직접 찍는다 */
  const donutLabel = {
    id: 'donutLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1;
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        const v = chart.data.datasets[0].data[i];
        const pct = (v / total) * 100;
        if (pct < 6) return;
        const pos = arc.tooltipPosition();
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0f141d';
        ctx.font = "700 11px 'IBM Plex Mono', monospace";
        ctx.fillText(`${pct.toFixed(0)}%`, pos.x, pos.y);
        ctx.restore();
      });
      /* 가운데 총액 */
      const meta = chart.getDatasetMeta(0).data[0];
      if (!meta) return;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#eae8e0';
      ctx.font = "700 14px 'IBM Plex Mono', monospace";
      ctx.fillText(formatCompactWon(total), meta.x, meta.y);
      ctx.restore();
    }
  };
  const ctx = document.getElementById('chart-alloc');
  state.charts.alloc = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: entries.map(e => e[0].replace(' 자산', '')), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map(e => CAT_COLORS[e[0]] || '#888'), borderColor: '#171e2b', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatCompactWon(c.raw)}원` } } } },
    plugins: [donutLabel]
  });
}

function buildAssetMonthlySeries(assetRows) {
  const catByMonth = {};
  const catTotals = {};
  const accByMonth = {};
  const accTotals = {};
  assetRows.forEach(r => {
    if (r.amount === null) return;
    catByMonth[r.date] = catByMonth[r.date] || {};
    catByMonth[r.date][r.category] = (catByMonth[r.date][r.category] || 0) + r.amount;
    catTotals[r.category] = (catTotals[r.category] || 0) + r.amount;
    accByMonth[r.date] = accByMonth[r.date] || {};
    accByMonth[r.date][r.account] = (accByMonth[r.date][r.account] || 0) + r.amount;
    accTotals[r.account] = (accTotals[r.account] || 0) + r.amount;
  });
  const accounts = Object.entries(accTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  return { catByMonth, catTotals, accByMonth, accounts };
}

function assetMonthToPivotKey(s) {
  const m = (s || '').match(/(\d{2})년\s*(\d{2})월/);
  if (!m) return null;
  return `${2000 + parseInt(m[1])}-${parseInt(m[2])}월`;
}

function renderTrend(data, d) {
  const panel = document.getElementById('panel-trend');
  panel.innerHTML = `
    <div class="panel-title">
      <div>총자산 추이</div>
      <div class="range-toggle" id="asset-trend-range-toggle"></div>
    </div>
    <div class="range-toggle" id="asset-trend-mode-toggle" style="margin-bottom:10px;">
      <button data-mode="total" class="active">총액</button>
      <button data-mode="category">카테고리별</button>
      <button data-mode="account">계좌별</button>
    </div>
    <div class="income-cat-btns" id="asset-trend-filter-btns" style="display:none;"></div>
    <div class="overlay-toggles" id="asset-trend-overlay-toggles" style="display:none;">
      <label><input type="checkbox" id="asset-net-toggle" checked /> 월별 순익 표시</label>
      <label><input type="checkbox" id="asset-cumnet-toggle" /> 누적 순익 표시</label>
    </div>
    <div class="chart-wrap tall"><canvas id="chart-trend"></canvas></div>
    <div class="chart-legend" id="asset-trend-legend"></div>
  `;
  const months = d.assetMonths;
  const series = buildAssetMonthlySeries(data.assetRows);
  const filterBtns = document.getElementById('asset-trend-filter-btns');
  const overlayBox = document.getElementById('asset-trend-overlay-toggles');

  const netByMonth = {};
  months.forEach(m => {
    const pk = assetMonthToPivotKey(m);
    const idx = pk ? data.months.indexOf(pk) : -1;
    netByMonth[m] = idx >= 0 ? (data.incomeTotal[idx] || 0) - (data.expenseTotal[idx] || 0) : 0;
  });
  let cumAcc = 0;
  const cumNetByMonth = {};
  months.forEach(m => { cumAcc += netByMonth[m]; cumNetByMonth[m] = cumAcc; });

  const renderFilterBtns = (options, allLabel) => {
    const cur = state.assetTrendFilter;
    filterBtns.innerHTML = `
      <button data-val="all" class="income-cat-btn ${cur === 'all' ? 'active' : ''}">${allLabel}</button>
      ${options.map(o => `<button data-val="${o}" class="income-cat-btn ${cur === o ? 'active' : ''}">${o}</button>`).join('')}
    `;
    filterBtns.querySelectorAll('.income-cat-btn').forEach(b => {
      b.addEventListener('click', () => {
        state.assetTrendFilter = b.dataset.val;
        drawTrend();
      });
    });
  };

  /* 카테고리·계좌별도 총자산과 같은 부드러운 선(누적 영역)으로 그린다 */
  const hexA = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const lineDs = (label, values, color, stack) => ({
    type: 'line', label, data: values,
    borderColor: color, backgroundColor: hexA(color, stack ? 0.5 : 0.14),
    fill: stack ? '-1' : true, tension: 0.35, pointRadius: 0, pointHoverRadius: 3,
    borderWidth: 2, labelColor: '#eae8e0', ...(stack ? { stack, fill: true } : {})
  });

  const drawTrend = () => {
    const monthsSlice = sliceByRange(months, state.assetTrendRange);
    const mode = state.assetTrendMode;
    if (state.charts.trend) state.charts.trend.destroy();
    const ctx = document.getElementById('chart-trend');
    let datasets = [];
    let legendHtml = '';
    overlayBox.style.display = mode === 'total' ? '' : 'none';

    if (mode === 'total') {
      filterBtns.style.display = 'none';
      datasets = [{ label: '총자산', data: monthsSlice.map(m => d.byMonth[m] || 0), borderColor: '#c9a227', backgroundColor: 'rgba(201,162,39,0.12)', fill: true, tension: 0.35, pointRadius: 2, pointBackgroundColor: '#c9a227', borderWidth: 2, labelColor: '#efdfa0', yAxisID: 'y' }];
      legendHtml = `<span><i style="background:var(--accent-fill)"></i>총자산</span>`;
      if (document.getElementById('asset-net-toggle') && document.getElementById('asset-net-toggle').checked) {
        datasets.push({ type: 'bar', label: '월별 순익', data: monthsSlice.map(m => netByMonth[m] || 0), backgroundColor: monthsSlice.map(m => (netByMonth[m] || 0) >= 0 ? 'rgba(57,168,189,0.6)' : 'rgba(193,72,63,0.55)'), yAxisID: 'y1' });
        legendHtml += `<span><i style="background:var(--net-fill)"></i>월별 순익</span>`;
      }
      if (document.getElementById('asset-cumnet-toggle') && document.getElementById('asset-cumnet-toggle').checked) {
        datasets.push({ type: 'line', label: '누적 순익', data: monthsSlice.map(m => cumNetByMonth[m] || 0), borderColor: '#9b7fc2', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, borderWidth: 2, yAxisID: 'y1' });
        legendHtml += `<span><i style="background:var(--net-fill)"></i>누적 순익</span>`;
      }
    } else if (mode === 'category') {
      const cats = CAT_ORDER.filter(c => series.catTotals[c] > 0);
      filterBtns.style.display = '';
      renderFilterBtns(cats, '전체 카테고리');
      if (state.assetTrendFilter !== 'all' && cats.includes(state.assetTrendFilter)) {
        const cat = state.assetTrendFilter;
        datasets = [lineDs(cat, monthsSlice.map(m => (series.catByMonth[m] && series.catByMonth[m][cat]) || 0), CAT_COLORS[cat] || '#888')];
      } else {
        datasets = cats.map(cat => lineDs(cat, monthsSlice.map(m => (series.catByMonth[m] && series.catByMonth[m][cat]) || 0), CAT_COLORS[cat] || '#888', 's'));
        legendHtml = cats.map(c => `<span><i style="background:${CAT_COLORS[c] || '#888'}"></i>${c}</span>`).join('');
      }
    } else {
      filterBtns.style.display = '';
      renderFilterBtns(series.accounts, '전체 계좌');
      if (state.assetTrendFilter !== 'all' && series.accounts.includes(state.assetTrendFilter)) {
        const acc = state.assetTrendFilter;
        const i = series.accounts.indexOf(acc);
        datasets = [lineDs(acc, monthsSlice.map(m => (series.accByMonth[m] && series.accByMonth[m][acc]) || 0), CAT_PIE_PALETTE_INV[i % CAT_PIE_PALETTE_INV.length])];
      } else {
        datasets = series.accounts.map((acc, i) => lineDs(acc, monthsSlice.map(m => (series.accByMonth[m] && series.accByMonth[m][acc]) || 0), CAT_PIE_PALETTE_INV[i % CAT_PIE_PALETTE_INV.length], 's'));
        legendHtml = series.accounts.map((acc, i) => `<span><i style="background:${CAT_PIE_PALETTE_INV[i % CAT_PIE_PALETTE_INV.length]}"></i>${acc}</span>`).join('');
      }
    }

    const isolated = mode !== 'total' && state.assetTrendFilter !== 'all';
    const stacked = mode !== 'total' && !isolated;
    const hasOverlay = mode === 'total' && datasets.length > 1;

    state.charts.trend = new Chart(ctx, {
      type: 'line',
      data: { labels: monthsSlice.map(assetMonthLabel), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: hasOverlay ? {
          x: { ticks: MONO_TICK, grid: { display: false } },
          y: { position: 'left', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y1: { position: 'right', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: { display: false } }
        } : {
          x: { stacked, ticks: MONO_TICK, grid: { display: false } },
          y: { stacked, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      },
      plugins: (mode === 'total' || isolated) ? [valueLabelPlugin] : []
    });
    document.getElementById('asset-trend-legend').innerHTML = legendHtml;
  };

  function onAssetTrendRangePick(v) {
    state.assetTrendRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('asset-trend-range-toggle', RANGE_OPTIONS, state.assetTrendRange, onAssetTrendRangePick);
    drawTrend();
  }
  bindRangeToggle('asset-trend-range-toggle', RANGE_OPTIONS, state.assetTrendRange, onAssetTrendRangePick);

  document.getElementById('asset-net-toggle').addEventListener('change', drawTrend);
  document.getElementById('asset-cumnet-toggle').addEventListener('change', drawTrend);

  document.getElementById('asset-trend-mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.assetTrendMode = btn.dataset.mode;
    state.assetTrendFilter = 'all';
    document.querySelectorAll('#asset-trend-mode-toggle button').forEach(b => b.classList.toggle('active', b === btn));
    drawTrend();
  });

  drawTrend();
}


/* ---------------- 내역 행 공용 부품 ----------------
   '오늘' 탭 표와 '전체 내역'이 같은 배지·아이콘·표기를 쓰도록 한 곳에서 만든다.
   전체 내역(.lg-line)은 클릭 편집이 되고 여기는 읽기 전용이라는 점만 다르다. */

function rxKind(r) {
  const k = String(r.major || '');
  return k.includes('수입') ? '수입' : k.includes('지출') ? '지출' : '이체';
}
function rxEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* 종류 배지 — 전체 내역의 .lg-kd 와 같은 모양·같은 색 */
function rxKindBadge(r) {
  const k = rxKind(r);
  return `<i class="lg-kd ${k}">${k}</i>`;
}
/* 분류 › 소분류 (+ 이모지) */
function rxCat(r) {
  const path = [r.minor, r.item].filter(Boolean).map(rxEsc).join(' › ') || '-';
  return `<span class="rx-cat">${r.emoji ? `<span class="rx-emoji" aria-hidden="true">${r.emoji}</span>` : ''}<span class="rx-path">${path}</span></span>`;
}
/* 사용처 (+ 사용처 그룹 태그) */
function rxVendor(r) {
  const grp = r.mgroup && r.mgroup !== r.vendor ? `<i class="lg-mg">${rxEsc(r.mgroup)}</i>` : '';
  return `${grp}${rxEsc(r.vendor || '')}`;
}
/* 회사 환급 · 고정비 · Good/Bad — 전체 내역과 같은 아이콘 어휘 */
function rxMarks(r) {
  const co = `<span class="rx-tg ${r.refund ? 'on' : ''}" title="${r.refund ? '회사 환급 ' + formatCompactWon(r.refund) + '원' : '회사 환급 아님'}">🏢</span>`;
  const fx = `<span class="rx-tg ${r.fixed ? 'on' : ''}" title="${r.fixed ? '고정비' : '고정비 아님'}">📌</span>`;
  const gb = rxKind(r) === '지출'
    ? `<span class="rx-gb ${r.good ? 'good' : r.regret ? 'bad' : 'off'}">${r.good ? 'GOOD' : r.regret ? 'BAD' : '—'}</span>`
    : '<span class="rx-none" title="지출에만 매깁니다">·</span>';
  return `<span class="rx-marks">${co}${fx}${gb}</span>`;
}
/* 금액 — 내역은 원 단위 그대로. 만원 축약은 KPI 카드에서만 쓴다. */
function rxAmount(r) {
  return `<span class="v ${rxKind(r)}">${wonComma(r.amount)}</span>`;
}

/* 수입 → 지출 → 이체 순. 같은 종류 안에서는 금액이 큰 것부터. */
const RX_KIND_RANK = { '수입': 0, '지출': 1, '이체': 2 };
function rxSortRows(rows) {
  return rows.slice().sort((a, b) =>
    (RX_KIND_RANK[rxKind(a)] ?? 9) - (RX_KIND_RANK[rxKind(b)] ?? 9) ||
    Math.abs(b.amount) - Math.abs(a.amount));
}

/* 전체 내역(.lg-cols)과 글자 그대로 같은 헤더 */
function rxLedgerHead(editable) {
  return `<div class="lg-cols">
    <span class="k">종류</span><span class="e"></span><span class="c">분류</span><span class="n">사용처</span>
    <span class="mm">메모</span><span class="f">회사·고정</span><span class="g">GOOD/BAD</span>
    <span class="v">금액</span>${editable ? '<span class="x"></span>' : ''}
  </div>`;
}

/* 전체 내역과 같은 규격 + 같은 편집 어포던스를 가진 행.
   '오늘' 탭에서도 그 자리에서 고칠 수 있어야 해서, 전체 내역과 같은
   data-* 계약(.lg-line[data-id|cat|amt|mgroup|merch|note])을 그대로 쓴다.
   덕분에 lgBindEdit / lgCellEdit 를 고치지 않고 그대로 붙일 수 있다. */
function rxLedgerLineEdit(r) {
  const k = rxKind(r);
  const amt = Number(r.amount) || 0;
  const merch = r.merch !== undefined ? r.merch : (r.vendor || '');
  const gb = r.good ? 'Good' : r.regret ? 'Bad' : null;
  return `<div class="lg-line k-${k}" data-id="${r.id}" data-date="${r.dayKey || ''}"
    data-cat="${r.catId == null ? '' : r.catId}" data-amt="${amt}" data-mgroup="${rxEsc(r.mgroup || '')}"
    data-merch="${rxEsc(merch)}" data-note="${rxEsc(r.memo || '')}">
    <span class="k"><i class="lg-kd ${k}">${k}</i></span>
    <span class="e" aria-hidden="true">${r.emoji || ''}</span>
    <span class="c" data-ed="cat" title="더블클릭해서 분류 변경"><span class="ct">${[r.minor, r.item].filter(Boolean).map(rxEsc).join(' › ') || '-'}</span></span>
    <span class="n" data-ed="merchant" title="더블클릭해서 수정">${r.mgroup && r.mgroup !== merch ? `<i class="lg-mg">${rxEsc(r.mgroup)}</i>` : ''}${rxEsc(merch || r.item || '')}</span>
    <span class="mm" data-ed="note" title="더블클릭해서 메모 수정">${r.memo ? rxEsc(r.memo) : '<i class="lg-ph">메모</i>'}</span>
    <span class="f">
      <button class="lg-tg ${r.refund ? 'on' : ''}" data-tg="company_paid" title="회사 환급">🏢</button>
      ${lgFixedBtn(merch, !!r.fixed)}
    </span>
    <span class="g">${k === '지출'
      ? `<button class="lg-gb ${gb === 'Good' ? 'good' : gb === 'Bad' ? 'bad' : ''}" data-gb title="클릭해서 Good → Bad → 해제">${gb === 'Good' ? 'GOOD' : gb === 'Bad' ? 'BAD' : '—'}</button>`
      : '<span class="lg-na" title="지출에만 매깁니다">·</span>'}</span>
    <span class="v ${k}" data-ed="amount" title="더블클릭해서 수정">${amt < 0 ? '−' : ''}${wonComma(Math.abs(amt))}</span>
    <button class="x" data-id="${r.id}" aria-label="삭제">×</button>
  </div>`;
}

/* 편집 가능한 내역 블록을 만들어 붙인다 ('오늘' 탭 등 전체 내역 밖에서 쓰는 용도).
   참조 데이터(분류·고정비 사용처)는 비동기로 오므로, 먼저 그리고 준비되면 묶는다. */
function rxMountEditableRows(host, rows, emptyMsg) {
  if (!host) return;
  if (!rows.length) { host.innerHTML = `<div class="empty-state">${emptyMsg || '기록이 없어요.'}</div>`; return; }
  const editable = rows.some(r => r.id != null);
  host.innerHTML = rxLedgerHead(editable) +
    `<div class="lg-card lg-ro-card" id="${host.id}-card">${rows.map(r => (r.id != null ? rxLedgerLineEdit(r) : rxLedgerLine(r))).join('')}</div>`;
  if (!editable) return;
  const card = document.getElementById(`${host.id}-card`);
  enEnsureRefs().then(() => {
    if (!card || !card.isConnected) return;
    /* 참조 데이터가 늦게 와도 고정비 표시가 맞도록 한 번 더 칠한다 */
    card.querySelectorAll('.lg-line[data-id]').forEach(line => {
      const btn = line.querySelector('[data-tg="is_fixed"]');
      if (!btn) return;
      const mfx = enMerchFixed(line.dataset.merch);
      const on = btn.classList.contains('on');
      btn.classList.toggle('auto', mfx && on);
      btn.classList.toggle('exc', mfx && !on);
    });
    lgBindEdit(card);
    card.querySelectorAll('.x').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      await (await enClient()).from('transactions').delete().eq('id', Number(b.dataset.id));
      enToast('삭제했습니다');
      lgTouched();
    }));
  }).catch(() => {});
}

/* 한 달치처럼 여러 날이 섞인 목록을 날짜로 묶어 붙인다 (이번달 › 지출).
   행 규격·편집 계약은 전체 내역과 같아서 lgBindEdit 를 그대로 쓴다. */
function rxMountEditableDays(host, rows, emptyMsg) {
  if (!host) return;
  if (!rows.length) { host.innerHTML = `<div class="empty-state">${emptyMsg || '기록이 없어요.'}</div>`; return; }
  const editable = rows.some(r => r.id != null);
  const groups = [];
  const idx = {};
  rows.forEach(r => {
    const k = r.dayKey || r.date;
    if (idx[k] === undefined) { idx[k] = groups.length; groups.push({ key: k, date: r.date, items: [] }); }
    groups[idx[k]].items.push(r);
  });
  host.innerHTML = rxLedgerHead(editable) + groups.map(g => {
    const sum = g.items.reduce((a, r) => a + (Number(r.amount) || 0) - (r.refund || 0), 0);
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(g.key)) ? new Date(g.key + 'T00:00:00') : null;
    const p = parseLedgerDateParts(g.date);
    return `<div class="lg-dg"><div class="lg-day">
        <span class="d">${p ? `${p.mo}/${p.d}` : rxEsc(String(g.date))}</span>
        ${dt ? `<span class="w">${EN_WD[dt.getDay()]}</span>` : ''}
        <span class="s">${g.items.length}건 · ${wonComma(sum)}</span>
      </div><div class="lg-card">${g.items.map(r => (r.id != null ? rxLedgerLineEdit(r) : rxLedgerLine(r))).join('')}</div>
    </div>`;
  }).join('');
  if (!editable) return;
  enEnsureRefs().then(() => {
    if (!host.isConnected) return;
    host.querySelectorAll('.lg-line[data-id]').forEach(line => {
      const btn = line.querySelector('[data-tg="is_fixed"]');
      if (!btn) return;
      const mfx = enMerchFixed(line.dataset.merch);
      const on = btn.classList.contains('on');
      btn.classList.toggle('auto', mfx && on);
      btn.classList.toggle('exc', mfx && !on);
    });
    lgBindEdit(host);
    host.querySelectorAll('.x').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      await (await enClient()).from('transactions').delete().eq('id', Number(b.dataset.id));
      enToast('삭제했습니다');
      lgTouched();
    }));
  }).catch(() => {});
}

/* 전체 내역과 같은 규격의 읽기 전용 행 */
function rxLedgerLine(r) {
  const k = rxKind(r);
  const grp = r.mgroup && r.mgroup !== r.vendor ? `<i class="lg-mg">${rxEsc(r.mgroup)}</i>` : '';
  return `<div class="lg-line lg-ro k-${k}">
    <span class="k"><i class="lg-kd ${k}">${k}</i></span>
    <span class="e" aria-hidden="true">${r.emoji || ''}</span>
    <span class="c"><span class="ct">${[r.minor, r.item].filter(Boolean).map(rxEsc).join(' › ') || '-'}</span></span>
    <span class="n">${grp}${rxEsc(r.vendor || r.item || '')}</span>
    <span class="mm">${r.memo ? rxEsc(r.memo) : '<i class="lg-ph">—</i>'}</span>
    <span class="f">
      <span class="rx-tg ${r.refund ? 'on' : ''}" title="${r.refund ? '회사 환급 ' + formatCompactWon(r.refund) + '원' : '회사 환급 아님'}">🏢</span>
      <span class="rx-tg ${r.fixed ? 'on' : ''}" title="${r.fixed ? '고정비' : '고정비 아님'}">📌</span>
    </span>
    <span class="g">${k === '지출'
      ? `<span class="rx-gb ${r.good ? 'good' : r.regret ? 'bad' : 'off'}">${r.good ? 'GOOD' : r.regret ? 'BAD' : '—'}</span>`
      : '<span class="rx-none" title="지출에만 매깁니다">·</span>'}</span>
    <span class="v ${k}">${wonComma(r.amount)}</span>
  </div>`;
}

function buildLedgerRowsHtml(rows) {
  if (!rows.length) return '<tr><td colspan="6" style="text-align:center;color:var(--text-faint);padding:20px;">표시할 내역이 없어요.</td></tr>';
  return rows.map(r => `<tr>
      <td class="c-date">${r.date}</td>
      <td class="c-kind">${rxKindBadge(r)}</td>
      <td class="c-cat">${rxCat(r)}</td>
      <td class="c-vendor">${rxVendor(r)}</td>
      <td class="c-marks">${rxMarks(r)}</td>
      <td class="amt c-amt">${rxAmount(r)}</td>
    </tr>`).join('');
}


function advancedTableRows(ts, allRows) {
  let rows = allRows;
  if (ts.majorFilter !== 'all') rows = rows.filter(r => r.major.includes(ts.majorFilter));
  if (ts.q.trim()) {
    const q = ts.q.trim().toLowerCase();
    rows = rows.filter(r => (r.item + r.vendor + r.memo + r.minor).toLowerCase().includes(q));
  }
  return [...rows].sort((a, b) => {
    if (ts.sort === 'date-desc') return ledgerDateKey(b.date) - ledgerDateKey(a.date);
    if (ts.sort === 'date-asc') return ledgerDateKey(a.date) - ledgerDateKey(b.date);
    if (ts.sort === 'amount-desc') return b.amount - a.amount;
    if (ts.sort === 'amount-asc') return a.amount - b.amount;
    return 0;
  });
}


function renderAdvancedTableBody(key, allRows, opts) {
  const ts = state.tableState[key];
  const box = document.getElementById(key);
  if (!box || !ts) return;
  const rows = advancedTableRows(ts, allRows);
  const metaEl = box.querySelector('.at-meta');
  const contentEl = box.querySelector('.at-content');
  const sum = rows.reduce((a, r) => a + (r.major.includes('지출') ? -Math.abs(r.amount) : r.amount), 0);
  metaEl.textContent = `총 ${rows.length.toLocaleString()}건 · 합계 ${formatWon(sum)}`;

  if (ts.group === 'none') {
    const totalPages = Math.max(1, Math.ceil(rows.length / ts.pageSize));
    if (ts.page > totalPages) ts.page = totalPages;
    const start = (ts.page - 1) * ts.pageSize;
    const pageRows = rows.slice(start, start + ts.pageSize);
    contentEl.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>날짜</th><th>종류</th><th>분류</th><th>사용처</th><th>체크</th><th style="text-align:right">금액</th></tr></thead>
          <tbody>${buildLedgerRowsHtml(pageRows)}</tbody>
        </table>
      </div>
      <div class="pager">
        <button class="at-prev" ${ts.page <= 1 ? 'disabled' : ''}>‹ 이전</button>
        <span>${ts.page} / ${totalPages}</span>
        <button class="at-next" ${ts.page >= totalPages ? 'disabled' : ''}>다음 ›</button>
      </div>`;
    const prevBtn = contentEl.querySelector('.at-prev');
    const nextBtn = contentEl.querySelector('.at-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { ts.page--; renderAdvancedTableBody(key, allRows, opts); });
    if (nextBtn) nextBtn.addEventListener('click', () => { ts.page++; renderAdvancedTableBody(key, allRows, opts); });
  } else {
    const groups = {};
    rows.forEach(r => {
      const gKey = ts.group === 'category' ? (r.minor || '기타') : (ledgerMonthKey(r.date) || '기타');
      if (!groups[gKey]) groups[gKey] = { rows: [], total: 0 };
      groups[gKey].rows.push(r);
      groups[gKey].total += (r.major.includes('지출') ? -Math.abs(r.amount) : r.amount);
    });
    const groupKeys = Object.keys(groups).sort((a, b) => ts.group === 'month' ? (a < b ? 1 : -1) : Math.abs(groups[b].total) - Math.abs(groups[a].total));
    contentEl.innerHTML = groupKeys.map(gKey => `
      <details class="at-group" ${ts.openGroups[gKey] ? 'open' : ''} data-gkey="${gKey}">
        <summary class="at-group-summary"><span>${gKey}</span><span>${formatWon(groups[gKey].total)} · ${groups[gKey].rows.length}건</span></summary>
        <div class="table-scroll" style="max-height:280px;">
          <table class="data-table">
            <thead><tr><th>날짜</th><th>종류</th><th>분류</th><th>사용처</th><th>체크</th><th style="text-align:right">금액</th></tr></thead>
            <tbody>${buildLedgerRowsHtml(groups[gKey].rows)}</tbody>
          </table>
        </div>
      </details>
    `).join('') || '<div class="empty-state">표시할 내역이 없어요.</div>';
    contentEl.querySelectorAll('.at-group').forEach(el => {
      el.addEventListener('toggle', () => { ts.openGroups[el.dataset.gkey] = el.open; });
    });
  }
}

/* ---------------- page: 이번달 (월 종합) ---------------- */

function parseLedgerDateParts(s) {
  const m = (s || '').match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

function makeMonthKey(y, mo) { return `${y}-${String(mo).padStart(2, '0')}`; }

function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return makeMonthKey(dt.getFullYear(), dt.getMonth() + 1);
}

function monthKeyLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y}년 ${m}월`;
}

function daysInMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function thisMonthKey() {
  const n = new Date();
  return makeMonthKey(n.getFullYear(), n.getMonth() + 1);
}

/* 이번 달이면 오늘 날짜, 과거 달이면 말일, 미래 달이면 0 */
function elapsedDaysOf(monthKey) {
  const cur = thisMonthKey();
  if (monthKey === cur) return new Date().getDate();
  return monthKey < cur ? daysInMonthKey(monthKey) : 0;
}

function buildNowMonth(ledger, monthKey) {
  const [y, mo] = monthKey.split('-').map(Number);
  const days = daysInMonthKey(monthKey);
  const rows = ledger.filter(r => ledgerMonthKey(r.date) === monthKey);
  const daily = [];
  for (let i = 1; i <= days; i++) {
    daily.push({ day: i, dow: new Date(y, mo - 1, i).getDay(), income: 0, expense: 0, transfer: 0, rows: [] });
  }
  rows.forEach(r => {
    const p = parseLedgerDateParts(r.date);
    if (!p) return;
    const b = daily[p.d - 1];
    if (!b) return;
    b.rows.push(r);
    if (r.major.includes('수입')) b.income += r.amount;
    else if (r.major.includes('지출')) b.expense += r.amount;
    else if (r.major.includes('이체')) b.transfer += r.amount;
  });

  const weeks = [];
  let cur = null;
  daily.forEach(b => {
    if (!cur || b.dow === 1) { cur = { idx: weeks.length, days: [] }; weeks.push(cur); }
    cur.days.push(b);
  });
  weeks.forEach(w => {
    w.income = w.days.reduce((a, b) => a + b.income, 0);
    w.expense = w.days.reduce((a, b) => a + b.expense, 0);
    w.transfer = w.days.reduce((a, b) => a + b.transfer, 0);
    w.from = w.days[0].day;
    w.to = w.days[w.days.length - 1].day;
    w.label = `${w.idx + 1}주차`;
    w.range = `${mo}/${w.from}–${mo}/${w.to}`;
    w.rows = w.days.reduce((a, b) => a.concat(b.rows), []);
  });

  const income = rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0);
  const expense = rows.filter(r => r.major.includes('지출')).reduce((a, r) => a + r.amount, 0);
  return { monthKey, y, mo, days, daily, weeks, rows, income, expense };
}

function cumExpenseThroughDay(ledger, monthKey, dayLimit) {
  let sum = 0;
  ledger.forEach(r => {
    if (!r.major.includes('지출')) return;
    if (ledgerMonthKey(r.date) !== monthKey) return;
    const p = parseLedgerDateParts(r.date);
    if (p && p.d <= dayLimit) sum += r.amount;
  });
  return sum;
}

function cumThroughDay(ledger, monthKey, dayLimit, keyword) {
  let sum = 0;
  ledger.forEach(r => {
    if (!r.major.includes(keyword)) return;
    if (ledgerMonthKey(r.date) !== monthKey) return;
    const p = parseLedgerDateParts(r.date);
    if (p && p.d <= dayLimit) sum += r.amount;
  });
  return sum;
}

/* 최근 N개월, 같은 일자까지의 누적 평균 (수입/지출/이체 공용) */
function paceAverageOf(ledger, monthKey, dayLimit, lookback, keyword) {
  const vals = [];
  for (let i = 1; i <= lookback; i++) {
    const k = shiftMonthKey(monthKey, -i);
    const hasData = ledger.some(r => ledgerMonthKey(r.date) === k && r.major.includes(keyword));
    if (hasData) vals.push(cumThroughDay(ledger, k, dayLimit, keyword));
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/* 스탯 카드 보조줄: 기준값 대비 증감 한 줄 */
function cmpSub(cur, base, invert, label) {
  if (base === null || base === undefined || !isFinite(base) || base === 0) {
    return `<div class="sub" style="color:var(--text-faint)">${label} —</div>`;
  }
  const diff = cur - base;
  const pct = (diff / Math.abs(base)) * 100;
  const good = invert ? diff <= 0 : diff >= 0;
  const cls = diff === 0 ? '' : (good ? 'good' : 'warn');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `<div class="sub ${cls}">${label} ${sign}${formatCompactWon(Math.abs(diff))}원 (${sign}${Math.abs(pct).toFixed(0)}%)</div>`;
}

/* 퍼센트포인트 비교 한 줄 */
function cmpSubPp(cur, base, label) {
  if (cur === null || base === null || base === undefined) {
    return `<div class="sub" style="color:var(--text-faint)">${label} —</div>`;
  }
  const diff = cur - base;
  const cls = diff === 0 ? '' : (diff > 0 ? 'good' : 'warn');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `<div class="sub ${cls}">${label} ${sign}${Math.abs(diff).toFixed(1)}%p</div>`;
}

/* 최근 N개월, 같은 일자까지의 누적 지출 평균 (같은 페이스인지 비교용) */
function pacePeerAverage(ledger, monthKey, dayLimit, lookback) {
  const vals = [];
  for (let i = 1; i <= lookback; i++) {
    const k = shiftMonthKey(monthKey, -i);
    const hasData = ledger.some(r => ledgerMonthKey(r.date) === k && r.major.includes('지출'));
    if (hasData) vals.push(cumExpenseThroughDay(ledger, k, dayLimit));
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* 고정비 체크리스트: 최근 3개월에 등장한 고정비 항목 대비 이번 달 결제 여부 */
function nowFixedStatus(ledger, monthKey) {
  const prevKeys = [1, 2, 3].map(i => shiftMonthKey(monthKey, -i));
  const tpl = {};
  ledger.filter(r => r.fixed && r.major.includes('지출')).forEach(r => {
    const k = ledgerMonthKey(r.date);
    if (!prevKeys.includes(k)) return;
    const id = `${r.item}|${r.vendor}`;
    if (!tpl[id]) tpl[id] = { item: r.item, vendor: r.vendor, minor: r.minor, amounts: [], months: new Set() };
    tpl[id].amounts.push(r.amount);
    tpl[id].months.add(k);
  });
  const paid = {};
  ledger.filter(r => r.fixed && r.major.includes('지출') && ledgerMonthKey(r.date) === monthKey).forEach(r => {
    const id = `${r.item}|${r.vendor}`;
    paid[id] = (paid[id] || 0) + r.amount;
    if (!tpl[id]) tpl[id] = { item: r.item, vendor: r.vendor, minor: r.minor, amounts: [r.amount], months: new Set() };
  });
  return Object.keys(tpl).map(id => {
    const t = tpl[id];
    return {
      item: t.item, vendor: t.vendor, minor: t.minor,
      expected: t.amounts.length ? Math.round(t.amounts.reduce((a, b) => a + b, 0) / t.amounts.length) : 0,
      paid: paid[id] !== undefined ? paid[id] : null,
      recur: t.months.size
    };
  }).sort((a, b) => (a.paid === null ? 0 : 1) - (b.paid === null ? 0 : 1) || b.expected - a.expected);
}

function nowCategoryRows(ledger, monthKey, scopeRows, cmpDay) {
  const prevKey = shiftMonthKey(monthKey, -1);
  const curMap = {}, prevMap = {};
  scopeRows.filter(r => r.major.includes('지출')).forEach(r => {
    curMap[r.minor || '기타'] = (curMap[r.minor || '기타'] || 0) + r.amount;
  });
  const limit = (cmpDay === null || cmpDay === undefined) ? null : cmpDay;
  if (limit !== null) {
    ledger.filter(r => r.major.includes('지출') && ledgerMonthKey(r.date) === prevKey).forEach(r => {
      const p = parseLedgerDateParts(r.date);
      if (!p || p.d > limit) return;
      prevMap[r.minor || '기타'] = (prevMap[r.minor || '기타'] || 0) + r.amount;
    });
  }
  const names = [...new Set([...Object.keys(curMap), ...Object.keys(prevMap)])];
  const total = Object.values(curMap).reduce((a, b) => a + b, 0);
  return names.map(n => ({
    name: n, cur: curMap[n] || 0, prev: prevMap[n] || 0,
    pct: total > 0 ? ((curMap[n] || 0) / total) * 100 : 0
  })).filter(r => r.cur > 0 || r.prev > 0).sort((a, b) => b.cur - a.cur);
}

function nowTransferRows(scopeRows) {
  const map = {};
  scopeRows.filter(r => r.major.includes('이체')).forEach(r => {
    const k = r.minor || '기타';
    if (!map[k]) map[k] = { name: k, total: 0, detail: {} };
    map[k].total += r.amount;
    map[k].detail[r.item || '-'] = (map[k].detail[r.item || '-'] || 0) + r.amount;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function nowDeltaSub(cur, prev, invert, note) {
  if (prev === null || prev === undefined || prev === 0) return '<div class="sub">전월 비교 데이터 없음</div>';
  const diff = cur - prev;
  const pct = (diff / Math.abs(prev)) * 100;
  const good = invert ? diff < 0 : diff > 0;
  const cls = diff === 0 ? '' : (good ? 'good' : 'warn');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `<div class="sub ${cls}">${note || '전월 대비'} ${sign}${wonComma(diff)}원 (${sign}${Math.abs(pct).toFixed(1)}%)</div>`;
}

/* 흐름 차트 축 — 누르면 [누적(+예상) + 최근 3개월 평균 페이스]가 한 쌍으로 켜진다 */
const FLOW_AXES = [
  { key: 'income', label: '수입', color: '#4c8c6b' },
  { key: 'expense', label: '지출', color: '#c1483f' },
  { key: 'net', label: '순저축', color: '#9b7fc2' }
];
/* 수입 분류 색 — '이번달'과 '올해'가 같은 분류를 같은 색으로 그려야 눈이 헷갈리지 않는다.
   그래서 화면별로 팔레트를 돌리지 않고, 원장 전체의 수입 합계가 큰 분류부터 한 번 배정해
   두고 어디서나 그 표를 쓴다. 세부항목('근로소득 › 본봉')은 부모 분류 색을 따라간다. */
const INCOME_PALETTE = ['#4c8c6b', '#5b8cb8', '#9b7fc2', '#c9a227', '#c1857a', '#39a8bd', '#d9884f', '#8a9bb0'];

/* 수입 분류·세부항목의 순서는 금액이 아니라 '분류 표'가 정한다.
   달마다 순서가 바뀌면 같은 자리를 보던 눈이 매번 다시 읽어야 한다.
   1순위 = categories 테이블(EN.cats)의 sort_order · 못 읽었을 때를 위한 기본값을 같이 둔다.
   표에 없는데 원장에만 있는 분류는 뒤에 붙인다 — 조용히 빠뜨리지 않기 위해서. */
const INCOME_TAXONOMY_FALLBACK = [
  ['근로소득', ['월급', '월급 외', '보너스']],
  ['부수입', ['부수입']],
  ['투자 수익', ['판매수익', '배당금', '계좌 이자']],
  ['저축 수익', ['예적금 이자']],
  ['그 외', ['그 외 수입']]
];
function incomeTaxonomy(ledger) {
  const order = [];
  const push = (cat, item) => {
    if (!cat) return;
    let g = order.find(x => x.cat === cat);
    if (!g) { g = { cat, items: [] }; order.push(g); }
    if (item && g.items.indexOf(item) < 0) g.items.push(item);
  };
  const fromDb = (EN.cats || []).filter(c => c.kind === '수입')
    .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (fromDb.length) fromDb.forEach(c => push(c.category, c.subcategory));
  else INCOME_TAXONOMY_FALLBACK.forEach(([c, its]) => its.forEach(it => push(c, it)));
  (ledger || []).forEach(r => { if (r.major.includes('수입')) push(r.minor || '기타', r.item || '-'); });
  return order;
}
function incomeCatColorMap(ledger) {
  const map = {};
  incomeTaxonomy(ledger).forEach((g, i) => { map[g.cat] = INCOME_PALETTE[i % INCOME_PALETTE.length]; });
  return map;
}
function incomeCatColorOf(map, name) {
  const base = String(name || '').split(' › ')[0];
  return map[base] || INCOME_PALETTE[INCOME_PALETTE.length - 1];
}

/* 지출도 같은 규칙을 쓴다 — 순서는 금액이 아니라 '분류 표'가 정하고,
   표에 없는데 원장에만 있는 분류는 조용히 빠뜨리지 않고 뒤에 붙인다. */
const EXPENSE_PALETTE = ['#c1483f', '#d9884f', '#c9a227', '#c2749b', '#7b7fd0', '#39a8bd', '#4c8c6b', '#8a9bb0'];
const EXPENSE_TAXONOMY_FALLBACK = [
  ['식비', ['외식', '카페/디저트', '간식', '식료품']],
  ['주거', ['월세/관리비', '공과금']],
  ['교통/차량', ['대중교통', '택시', '차량']],
  ['통신', ['통신비']],
  ['생활용품', ['생활용품']],
  ['문화생활', ['공연', '영화', '취미']],
  ['패션/미용', ['의류', '미용']],
  ['건강', ['병원', '약국', '운동']],
  ['교육', ['교육']],
  ['경조사/회비', ['경조사', '회비']],
  ['기타', ['구독', '그 외 지출']]
];
function expenseTaxonomy(ledger) {
  const order = [];
  const push = (cat, item) => {
    if (!cat) return;
    let g = order.find(x => x.cat === cat);
    if (!g) { g = { cat, items: [] }; order.push(g); }
    if (item && g.items.indexOf(item) < 0) g.items.push(item);
  };
  const fromDb = (EN.cats || []).filter(c => c.kind === '지출')
    .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (fromDb.length) fromDb.forEach(c => push(c.category, c.subcategory));
  else EXPENSE_TAXONOMY_FALLBACK.forEach(([c, its]) => its.forEach(it => push(c, it)));
  (ledger || []).forEach(r => { if (r.major.includes('지출')) push(r.minor || '기타', r.item || '-'); });
  return order;
}
function expenseCatColorMap(ledger) {
  const map = {};
  expenseTaxonomy(ledger).forEach((g, i) => { map[g.cat] = EXPENSE_PALETTE[i % EXPENSE_PALETTE.length]; });
  return map;
}
function expenseCatColorOf(map, name) {
  const base = String(name || '').split(' › ')[0];
  return map[base] || EXPENSE_PALETTE[EXPENSE_PALETTE.length - 1];
}

function hexToRgba(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const NOW_OPTS = [
  { key: 'budget', label: '예산 페이스', color: '#c9a227' },
  { key: 'daily', label: '일별 지출', color: 'rgba(193,72,63,.45)' }
];

function renderNowPage(container, data, d) {
  const ledger = data.ledger || [];
  if (!ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 이번 달을 계산할 수 없어요.</div></div>';
    return;
  }

  const availableKeys = [...new Set(ledger.map(r => ledgerMonthKey(r.date)).filter(Boolean))].sort();
  /* 사람이 직접 고른 달만 붙잡아 둔다. 그러지 않으면 첫 화면을 스냅샷(옛 원장)으로 그릴 때
     그 원장의 마지막 달에 고정돼, 실데이터가 온 뒤에도 엉뚱한 달이 남는다. */
  if (!state.nowMonthPinned || !availableKeys.includes(state.nowMonthKey)) {
    const t = thisMonthKey();
    state.nowMonthKey = availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1];
  }
  const monthKey = state.nowMonthKey;
  const M = buildNowMonth(ledger, monthKey);

  const isThisMonth = monthKey === thisMonthKey();
  const elapsed = Math.max(elapsedDaysOf(monthKey), 0);
  const progressPct = M.days ? Math.min((elapsed / M.days) * 100, 100) : 0;

  const week = (state.nowWeekIdx !== null && M.weeks[state.nowWeekIdx]) ? M.weeks[state.nowWeekIdx] : null;
  const scopeRows = week ? week.rows : M.rows;
  const scopeLabel = week ? `${monthKeyLabel(monthKey)} ${week.label} (${week.range})` : monthKeyLabel(monthKey);

  const sIncome = scopeRows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0);
  const sExpense = scopeRows.filter(r => r.major.includes('지출')).reduce((a, r) => a + r.amount, 0);
  const sNet = sIncome - sExpense;
  const sRate = sIncome > 0 ? (sNet / sIncome) * 100 : null;

  const prevKey = shiftMonthKey(monthKey, -1);
  const cmpDay = isThisMonth ? elapsed : daysInMonthKey(prevKey);
  const cmpRange = isThisMonth ? `${Number(prevKey.split('-')[1])}/1–${cmpDay}` : monthKeyLabel(prevKey);
  const cmpNote = isThisMonth ? `전월 ${cmpRange} 대비` : '전월 대비';
  const prevIncomeSame = week ? null : cumThroughDay(ledger, prevKey, cmpDay, '수입');
  const prevExpenseSame = week ? null : cumThroughDay(ledger, prevKey, cmpDay, '지출');

  /* --- 비교 기준: 전월 동일시점 / 최근 3개월 동일시점 평균 / 목표 --- */
  const prevNetSame = (prevIncomeSame === null || prevExpenseSame === null) ? null : prevIncomeSame - prevExpenseSame;
  const prevRateSame = (prevIncomeSame && prevIncomeSame > 0) ? ((prevIncomeSame - prevExpenseSame) / prevIncomeSame) * 100 : null;
  const avgDay = isThisMonth ? (elapsed || M.days) : M.days;
  const avgIncome = week ? null : paceAverageOf(ledger, monthKey, avgDay, 3, '수입');
  const avgExpense = week ? null : paceAverageOf(ledger, monthKey, avgDay, 3, '지출');
  const avgNet = (avgIncome === null || avgExpense === null) ? null : avgIncome - avgExpense;
  const avgRate = (avgIncome && avgIncome > 0) ? ((avgIncome - avgExpense) / avgIncome) * 100 : null;
  const rateTarget = state.goals.savingsRateTarget;
  const netTarget = sIncome > 0 ? sIncome * (rateTarget / 100) : null;
  const avgNote = isThisMonth ? '최근 3개월 같은 시점 평균 대비' : '최근 3개월 평균 대비';

  const peerAvg = pacePeerAverage(ledger, monthKey, elapsed || M.days, 3);
  const paceDiff = peerAvg !== null ? M.expense - peerAvg : null;
  const projected = (isThisMonth && elapsed > 0) ? Math.round(M.expense / elapsed * M.days) : null;

  const fixedRows = nowFixedStatus(ledger, monthKey);
  const fixedPending = fixedRows.filter(f => f.paid === null);
  const fixedPendingSum = fixedPending.reduce((a, f) => a + f.expected, 0);
  const fixedPaidSum = fixedRows.filter(f => f.paid !== null).reduce((a, f) => a + f.paid, 0);

  const catRows = nowCategoryRows(ledger, monthKey, scopeRows, week ? null : cmpDay);
  const transferRows = nowTransferRows(scopeRows);
  const transferTotal = transferRows.reduce((a, t) => a + t.total, 0);
  const topExpenses = scopeRows.filter(r => r.major.includes('지출')).sort((a, b) => b.amount - a.amount).slice(0, 8);

  const monthOptions = availableKeys.slice().reverse().map(k => `<option value="${k}" ${k === monthKey ? 'selected' : ''}>${monthKeyLabel(k)}</option>`).join('');

  /* --- 투자원금 이체 (➡️이체 › 📈투자 자산) --- */
  const isInvTr = (r) => r.major.includes('이체') && String(r.minor || '').includes('투자');
  const investTr = scopeRows.filter(isInvTr).reduce((a, r) => a + r.amount, 0);
  const prevInvestSame = week ? null : ledger.filter(r => isInvTr(r) && ledgerMonthKey(r.date) === prevKey)
    .reduce((a, r) => { const pp = parseLedgerDateParts(r.date); return (pp && pp.d <= cmpDay) ? a + r.amount : a; }, 0);
  const investRate = sIncome > 0 ? (investTr / sIncome) * 100 : null;

  /* --- 수입 분해 (이번달 스코프) --- */
  const incBy = (kw) => scopeRows.filter(r => r.major.includes('수입') && String(r.minor || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
  const incWork = incBy('근로');
  const incInvest = incBy('투자');
  const incSide = incBy('부수입');
  const incEtc = sIncome - incWork - incInvest - incSide;
  const incCatRows = (() => {
    const curMap = {}, prevMap = {};
    scopeRows.filter(r => r.major.includes('수입')).forEach(r => {
      const k = r.minor || '기타'; curMap[k] = (curMap[k] || 0) + r.amount;
    });
    if (!week) ledger.filter(r => r.major.includes('수입') && ledgerMonthKey(r.date) === prevKey).forEach(r => {
      const pp = parseLedgerDateParts(r.date); if (!pp || pp.d > cmpDay) return;
      const k = r.minor || '기타'; prevMap[k] = (prevMap[k] || 0) + r.amount;
    });
    const names = [...new Set([...Object.keys(curMap), ...Object.keys(prevMap)])];
    const tot = Object.values(curMap).reduce((a, b) => a + b, 0);
    return names.map(n => ({ name: n, cur: curMap[n] || 0, prev: prevMap[n] || 0, pct: tot > 0 ? ((curMap[n] || 0) / tot) * 100 : 0 }))
      .filter(r => r.cur > 0 || r.prev > 0).sort((a, b) => b.cur - a.cur);
  })();
  const topIncomes = scopeRows.filter(r => r.major.includes('수입')).sort((a, b) => b.amount - a.amount).slice(0, 8);

  /* --- 수입 ---------------------------------------------------------------
     기준은 하나로 고정한다: 이 달 직전 12개월 중 '기록이 있는 달'의 월평균.
     (기록이 없는 달까지 분모에 넣으면 평균이 실제보다 낮게 나와 자기 위안이 된다.)
     분류·세부항목은 금액이 아니라 분류 표 순서로 세우고, 이번 달 금액이 0이어도 자리를 지킨다. */
  const incCatOf = (r) => r.minor || '기타';
  const incItemOf = (r) => r.item || '-';
  const incItemKeyOf = (r) => incCatOf(r) + ' › ' + incItemOf(r);
  const incTaxonomy = incomeTaxonomy(ledger);
  const incCmap = incomeCatColorMap(ledger);
  const incColorOf = (name) => incomeCatColorOf(incCmap, name);

  const incStats = (() => {
    const isInc = (r) => r.major.includes('수입');
    const cur = {}, base = {};
    const curRows = scopeRows.filter(isInc);
    curRows.forEach(r => {
      cur[incCatOf(r)] = (cur[incCatOf(r)] || 0) + r.amount;
      cur[incItemKeyOf(r)] = (cur[incItemKeyOf(r)] || 0) + r.amount;
    });
    const keys = [];
    for (let i = 1; i <= 12; i++) keys.push(shiftMonthKey(monthKey, -i));
    const active = keys.filter(k => ledger.some(r => ledgerMonthKey(r.date) === k));
    const n = active.length;
    const baseRows = ledger.filter(r => isInc(r) && active.includes(ledgerMonthKey(r.date)));
    baseRows.forEach(r => {
      base[incCatOf(r)] = (base[incCatOf(r)] || 0) + r.amount;
      base[incItemKeyOf(r)] = (base[incItemKeyOf(r)] || 0) + r.amount;
    });
    const curTot = curRows.reduce((a, r) => a + r.amount, 0);
    const avgTot = n ? baseRows.reduce((a, r) => a + r.amount, 0) / n : 0;
    const of = (k) => {
      const c = cur[k] || 0;
      const a = n ? (base[k] || 0) / n : 0;
      return {
        cur: c, avg: a, diff: c - a,
        ratio: a > 0 ? (c / a) * 100 : null,
        share: curTot > 0 ? (c / curTot) * 100 : 0,
        avgShare: avgTot > 0 ? (a / avgTot) * 100 : 0
      };
    };
    return { of, curTot, avgTot, months: n };
  })();

  /* 차트 줄 — 분류(level 1) · 펼친 분류의 세부항목(level 2).
     합계는 차트에서 뺐다. 위(지표 카드)가 이미 합계를 말하고 있고, 막대 안에 합계가 끼면
     "분류끼리 견주는 그림"이 흐려진다. */
  const incBuildRows = (openCat) => {
    const out = [];
    incTaxonomy.forEach((g, gi) => {
      const open = openCat === g.cat;
      out.push(Object.assign({}, incStats.of(g.cat), {
        label: (open ? '▾ ' : '▸ ') + g.cat, level: 1, sel: g.cat, cat: g.cat,
        color: incColorOf(g.cat), first: gi === 0
      }));
      if (!open) return;
      g.items.forEach(it => {
        const k = g.cat + ' › ' + it;
        out.push(Object.assign({}, incStats.of(k), {
          label: '     ' + it, level: 2, sel: k, cat: g.cat, color: incColorOf(g.cat), first: false
        }));
      });
    });
    return out.map(r => Object.assign(r, { avg: Math.round(r.avg) }));
  };

  const incDayNo = (r) => { const p = parseLedgerDateParts(r.date); return p ? p.d : 0; };
  const incRawRowsFor = (sel) => scopeRows.filter(r => r.major.includes('수입'))
    .filter(r => !sel || (sel.includes(' › ') ? incItemKeyOf(r) === sel : incCatOf(r) === sel))
    .sort((a, b) => incDayNo(b) - incDayNo(a) || b.amount - a.amount);

  /* --- 비상금 이체 --- */
  const isEmgTr = (r) => r.major.includes('이체') && String(r.minor || '').includes('비상금');
  const emgTr = scopeRows.filter(isEmgTr).reduce((a, r) => a + r.amount, 0);
  const prevEmgSame = week ? null : ledger.filter(r => isEmgTr(r) && ledgerMonthKey(r.date) === prevKey)
    .reduce((a, r) => { const pp = parseLedgerDateParts(r.date); return (pp && pp.d <= cmpDay) ? a + r.amount : a; }, 0);

  /* --- 지출 분해 (고정비 / 변동비 / Good·Bad) --- */
  const expRows = scopeRows.filter(r => r.major.includes('지출'));
  const netOfR = (r) => r.amount - (r.refund || 0);
  const projRate = (isThisMonth && elapsed > 0) ? (M.days / elapsed) : 1;
  const expFixed = expRows.filter(r => r.fixed).reduce((a, r) => a + netOfR(r), 0);
  const expRegret = expRows.filter(r => r.regret).reduce((a, r) => a + netOfR(r), 0);
  const expGood = expRows.filter(r => r.good).reduce((a, r) => a + netOfR(r), 0);
  /* 지출 탭 안에서는 전부 환불 뺀 금액으로 센다 — 같은 화면의 두 숫자가 서로 다르면 안 되니까 */
  const expNet = expRows.reduce((a, r) => a + netOfR(r), 0);
  const expVar = expNet - expFixed;
  const EXP_BUCKETS = [
    { key: 'all', label: '지출 합계', value: expNet, color: 'var(--expense-text)' },
    { key: 'fixed', label: '고정비', value: expFixed, color: 'var(--text)' },
    { key: 'var', label: '변동비', value: expVar, color: 'var(--text)' },
    { key: 'good', label: '잘한소비', value: expGood, color: '#7fc0a0' },
    { key: 'regret', label: '아낄 수 있었던', value: expRegret, color: '#e6b48f' }
  ];
  const EXPF = ['all', 'fixed', 'var', 'good', 'regret'].includes(state.nowExpFilter) ? state.nowExpFilter : 'all';
  const expFilterFn = { all: () => true, fixed: (r) => r.fixed, var: (r) => !r.fixed, good: (r) => r.good, regret: (r) => r.regret }[EXPF];

  /* --- 지출 ---------------------------------------------------------------
     수입 탭과 같은 눈으로 본다: 이 달 직전 12개월 중 '기록이 있는 달'의 월평균을 기준선으로
     깔고, 분류·세부항목은 금액이 아니라 분류 표 순서로 세운다. 고정비/변동비/잘한소비/
     아낀 소비 필터는 차트·카드·내역에 함께 걸린다 — 셋이 다른 숫자를 말하면 안 되니까. */
  const expCatOf = (r) => r.minor || '기타';
  const expItemOf = (r) => r.item || '-';
  const expItemKeyOf = (r) => expCatOf(r) + ' › ' + expItemOf(r);
  const expTaxonomy = expenseTaxonomy(ledger);
  const expCmap = expenseCatColorMap(ledger);
  const expColorOf = (name) => expenseCatColorOf(expCmap, name);

  const expStats = (() => {
    const isExp = (r) => r.major.includes('지출');
    const cur = {}, base = {};
    const curRows = expRows.filter(expFilterFn);
    curRows.forEach(r => {
      const v = netOfR(r);
      cur[expCatOf(r)] = (cur[expCatOf(r)] || 0) + v;
      cur[expItemKeyOf(r)] = (cur[expItemKeyOf(r)] || 0) + v;
    });
    const keys = [];
    for (let i = 1; i <= 12; i++) keys.push(shiftMonthKey(monthKey, -i));
    const active = keys.filter(k => ledger.some(r => ledgerMonthKey(r.date) === k));
    const n = active.length;
    const baseRows = ledger.filter(r => isExp(r) && expFilterFn(r) && active.includes(ledgerMonthKey(r.date)));
    baseRows.forEach(r => {
      const v = netOfR(r);
      base[expCatOf(r)] = (base[expCatOf(r)] || 0) + v;
      base[expItemKeyOf(r)] = (base[expItemKeyOf(r)] || 0) + v;
    });
    const curTot = curRows.reduce((a, r) => a + netOfR(r), 0);
    const avgTot = n ? baseRows.reduce((a, r) => a + netOfR(r), 0) / n : 0;
    const of = (k) => {
      const c = cur[k] || 0;
      const a = n ? (base[k] || 0) / n : 0;
      return {
        cur: c, avg: a, diff: c - a,
        ratio: a > 0 ? (c / a) * 100 : null,
        share: curTot > 0 ? (c / curTot) * 100 : 0,
        avgShare: avgTot > 0 ? (a / avgTot) * 100 : 0
      };
    };
    return { of, curTot, avgTot, months: n };
  })();

  const expBuildRows = (openCat) => {
    const out = [];
    expTaxonomy.forEach((g, gi) => {
      const open = openCat === g.cat;
      out.push(Object.assign({}, expStats.of(g.cat), {
        label: (open ? '▾ ' : '▸ ') + g.cat, level: 1, sel: g.cat, cat: g.cat,
        color: expColorOf(g.cat), first: gi === 0
      }));
      if (!open) return;
      g.items.forEach(it => {
        const k = g.cat + ' › ' + it;
        out.push(Object.assign({}, expStats.of(k), {
          label: '     ' + it, level: 2, sel: k, cat: g.cat, color: expColorOf(g.cat), first: false
        }));
      });
    });
    return out.map(r => Object.assign(r, { avg: Math.round(r.avg) }));
  };

  const expDayNo = (r) => { const p = parseLedgerDateParts(r.date); return p ? p.d : 0; };
  const expRawRowsFor = (sel) => expRows.filter(expFilterFn)
    .filter(r => !sel || (sel.includes(' › ') ? expItemKeyOf(r) === sel : expCatOf(r) === sel))
    .sort((a, b) => expDayNo(b) - expDayNo(a) || netOfR(b) - netOfR(a));

  const NOW_SUBS =[['summary', '요약'], ['income', '수입'], ['expense', '지출']];
  const NSUB_MIGRATE = { budget: 'expense', detail: 'expense', saving: 'summary' };
  if (NSUB_MIGRATE[state.nowSub]) state.nowSub = NSUB_MIGRATE[state.nowSub];
  const NSUB = NOW_SUBS.some(x => x[0] === state.nowSub) ? state.nowSub : 'summary';

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${scopeLabel}</div>
        <div class="month-nav">
          <button id="now-prev" ${availableKeys.indexOf(monthKey) <= 0 ? 'disabled' : ''}>◀</button>
          <select id="now-month-select">${monthOptions}</select>
          <button id="now-next" ${availableKeys.indexOf(monthKey) >= availableKeys.length - 1 ? 'disabled' : ''}>▶</button>
          <button class="btn small" id="now-thismonth">이번 달</button>
        </div>
      </div>
    </div>

    <div class="subnav sub2" id="now-subnav">${NOW_SUBS.map(([v, l]) =>
      `<button data-sub="${v}" class="${v === NSUB ? 'active' : ''}">${l}</button>`).join('')}</div>

    ${NSUB === 'summary' ? `
    <div class="stat-grid">
      <div class="stat-card clickable" data-goto="income" title="수입 탭으로 이동">
        <div class="label">수입</div>
        <div class="value" style="color:var(--income-text)">${formatKrw(sIncome)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : nowDeltaSub(sIncome, prevIncomeSame, false, cmpNote)}
      </div>
      <div class="stat-card clickable" data-goto="expense" title="지출 탭으로 이동">
        <div class="label">지출</div>
        <div class="value" style="color:var(--expense-text)">${formatKrw(sExpense)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : nowDeltaSub(sExpense, prevExpenseSame, true, cmpNote)}
        <div class="sub">하루 평균 <b>${formatKrw(Math.round(M.expense / Math.max(isThisMonth ? elapsed : M.days, 1)))}</b></div>
        ${projected === null ? '' : `<div class="sub">월말 예상 <b>${formatKrw(projected + fixedPendingSum)}</b> · 미결 고정비 ${formatCompactWon(fixedPendingSum)} 포함</div>`}
      </div>
      <div class="stat-card clickable" data-goto="saving" title="순저축 탭으로 이동">
        <div class="label">순저축</div>
        <div class="value" style="color:${sNet >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(sNet)}</div>
        ${week ? '' : cmpSub(sNet, avgNet, false, avgNote)}
      </div>
      <div class="stat-card">
        <div class="label">저축률</div>
        <div class="value" style="color:${sRate === null ? 'var(--text)' : sRate >= rateTarget ? 'var(--net-text)' : 'var(--expense-text)'}">${sRate === null ? '—' : sRate.toFixed(1) + '%'}</div>
        ${cmpSubPp(sRate, rateTarget, `목표 ${rateTarget}% 대비`)}
      </div>
      <div class="stat-card">
        <div class="label">투자원금 이체</div>
        <div class="value" style="color:var(--transfer-text)">${formatKrw(investTr)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : nowDeltaSub(investTr, prevInvestSame, false, cmpNote)}
        ${investRate === null ? '' : `<div class="sub">수입의 <b>${investRate.toFixed(1)}%</b></div>`}
      </div>
      <div class="stat-card">
        <div class="label">비상금 이체</div>
        <div class="value" style="color:var(--transfer-text)">${formatKrw(emgTr)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : nowDeltaSub(emgTr, prevEmgSame, false, cmpNote)}
        ${sIncome > 0 ? `<div class="sub">수입의 <b>${((emgTr / sIncome) * 100).toFixed(1)}%</b></div>` : ''}
      </div>
    </div>

    <div class="g">
      <div class="panel s12">
        <div class="panel-title">
          <div>페이스 차트<span class="pace-tag" id="now-pace-tag"></span></div>
          <span class="ptag">${isThisMonth ? `D+${elapsed} / ${M.days}일` : `${M.days}일 · 마감`}</span>
        </div>
        <div class="axis-bar">
          <div class="axis-btns" id="now-axis-btns">
            ${FLOW_AXES.map(a => `<button data-axis="${a.key}" class="axis-btn ${state.nowAxis === a.key ? 'on' : ''}" style="--ac:${a.color}">
              <i></i>${a.label}
            </button>`).join('')}
          </div>
          <div class="series-toggles" id="now-series-toggles" style="margin-bottom:0;${state.nowAxis === 'expense' ? '' : 'display:none;'}">
            ${NOW_OPTS.map(sr => `<label class="series-chk ${state.nowOpts[sr.key] ? 'on' : ''}">
              <input type="checkbox" data-key="${sr.key}" ${state.nowOpts[sr.key] ? 'checked' : ''} />
              <i style="background:${sr.color}"></i>${sr.label}
            </label>`).join('')}
          </div>
        </div>
        <div class="chart-legend" id="now-flow-legend" style="margin-bottom:6px;"></div>
        <div class="chart-wrap tall" style="min-height:320px;"><canvas id="chart-now-flow"></canvas></div>
        <div class="now-progress" style="margin-top:10px;">
          <div class="now-progress-track"><div class="now-progress-fill" style="width:${progressPct}%"></div></div>
          <span class="now-progress-text">${isThisMonth ? `D+${elapsed} / ${M.days}일 · 남은 ${M.days - elapsed}일` : `${M.days}일 · 마감`}</span>
        </div>
      </div>
    </div>` : ''}

    ${NSUB === 'income' ? `
    <div class="inc-scope" id="now-inc-scope"></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:12px;" id="now-inc-stats"></div>

    <div class="g inc-g">
      <div class="panel s7 inc-chart-panel">
        <div class="panel-title">
          <div>차트</div>
          <div class="inc-legend">
            <span><i class="inc-sw solid"></i>이번 달</span>
            <span><i class="inc-sw hollow"></i>지난 ${incStats.months || 0}개월 월평균</span>
          </div>
        </div>
        <div class="chart-wrap inc-chart-wrap" id="now-inc-chartwrap"><canvas id="chart-now-income"></canvas></div>
      </div>

      <div class="panel s5 inc-list-panel">
        <div class="panel-title">
          <div>내역</div>
          <span class="ptag" id="now-inc-ptag"></span>
        </div>
        <div id="now-incright-body"></div>
      </div>
    </div>` : ''}

    ${NSUB === 'expense' ? `
    <div class="inc-scope" id="now-exp-scope"></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:12px;" id="now-exp-stats"></div>

    <div class="g inc-g">
      <div class="panel s7 inc-chart-panel">
        <div class="panel-title">
          <div>차트</div>
          <div class="inc-legend">
            <span><i class="inc-sw solid"></i>이번 달</span>
            <span><i class="inc-sw hollow"></i>지난 ${expStats.months || 0}개월 월평균</span>
          </div>
        </div>
        <div class="chart-wrap inc-chart-wrap" id="now-exp-chartwrap"><canvas id="chart-now-expense"></canvas></div>
      </div>

      <div class="panel s5 inc-list-panel exp-editlist">
        <div class="panel-title">
          <div>내역</div>
          <span class="ptag" id="now-exp-ptag"></span>
        </div>
        <div class="exp-editscroll"><div id="now-expright-body"></div></div>
        <div class="settings-note">칸을 더블클릭하면 그 자리에서 고쳐집니다 · 🏢 회사 환급 · 📌 고정비 · GOOD/BAD 는 눌러서 바꿉니다.</div>
      </div>
    </div>` : ''}

    ${NSUB === 'saving' ? `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">순저축</div>
        <div class="value" style="color:${sNet >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(sNet)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : cmpSub(sNet, avgNet, false, avgNote)}
      </div>
      <div class="stat-card">
        <div class="label">저축률</div>
        <div class="value" style="color:${sRate === null ? 'var(--text)' : sRate >= rateTarget ? 'var(--net-text)' : 'var(--expense-text)'}">${sRate === null ? '—' : sRate.toFixed(1) + '%'}</div>
        ${cmpSubPp(sRate, rateTarget, `목표 ${rateTarget}% 대비`)}
      </div>
      <div class="stat-card">
        <div class="label">투자원금 이체</div>
        <div class="value" style="color:var(--accent-text)">${formatKrw(investTr)}</div>
        ${week ? `<div class="sub">${week.label}</div>` : nowDeltaSub(investTr, prevInvestSame, false, cmpNote)}
      </div>
      <div class="stat-card">
        <div class="label">자산 유입 합계</div>
        <div class="value">${formatKrw(transferTotal)}</div>
        <div class="sub">순저축의 <b>${sNet > 0 ? ((transferTotal / sNet) * 100).toFixed(0) + '%' : '—'}</b></div>
      </div>
    </div>

    <div class="g">
      <div class="panel s5">
        <div class="panel-title"><div>이체</div><span class="ptag">${week ? week.label : monthKeyLabel(monthKey)}</span></div>
        <div id="now-transfer-body"></div>
      </div>
      <div class="panel s7">
        <div class="panel-title"><div>주차별 순저축</div></div>
        <div id="now-week-body"></div>
      </div>
    </div>` : ''}
  `;

  container.querySelectorAll('.stat-card[data-goto]').forEach(el => el.addEventListener('click', () => {
    state.nowSub = el.dataset.goto;
    renderPage();
  }));

  document.getElementById('now-subnav').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.nowSub = btn.dataset.sub;
    renderPage();
  });


  /* --- 고정비 --- */
  const fixedBody = document.getElementById('now-fixed-body');
  if (fixedBody) fixedBody.innerHTML = `
    <div class="now-kv"><span>완료 ${fixedRows.length - fixedPending.length}건</span><b>${formatWon(fixedPaidSum)}</b></div>
    <div class="now-kv"><span>미결제 ${fixedPending.length}건</span><b style="color:${fixedPending.length ? 'var(--expense-text)' : 'var(--income-text)'}">${formatWon(fixedPendingSum)}</b></div>
    <div style="max-height:220px;overflow-y:auto;margin-top:10px;">
      ${fixedRows.length ? fixedRows.map(f => `
        <div class="acct-row">
          <span style="width:16px;flex-shrink:0;">${f.paid !== null ? '✅' : '⬜'}</span>
          <span class="acct-name" style="${f.paid === null ? 'color:var(--text-dim)' : ''}">${f.item}${f.vendor ? `<div class="acct-cat">${f.vendor}</div>` : ''}</span>
          <span class="acct-amt" style="${f.paid === null ? 'color:var(--text-faint)' : ''}">${formatWon(f.paid !== null ? f.paid : f.expected)}</span>
        </div>`).join('') : '<div class="empty-state">고정비로 표시된 항목이 없어요.</div>'}
    </div>
  `;

  /* --- 이체 --- */
  const trBody = document.getElementById('now-transfer-body');
  if (trBody) trBody.innerHTML = `
    <div class="now-kv"><span>합계</span><b style="color:var(--transfer-text)">${formatKrw(transferTotal)}</b></div>
    <div style="margin-top:8px;">
      ${transferRows.length ? transferRows.map(t => `
        <div class="acct-row">
          <span class="acct-name">${t.name}<div class="acct-cat">${Object.keys(t.detail).join(' · ')}</div></span>
          <span class="acct-amt">${formatWon(t.total)}</span>
        </div>`).join('') : '<div class="empty-state">이 기간 이체 내역이 없어요.</div>'}
    </div>
  `;

  /* --- 수입: 지표 카드 · 차트 · 내역 -----------------------------------------
     축 라벨(▸/▾) 쪽을 누르면 그냥 펼치기만, 막대 쪽을 누르면 그 항목을 골라
     지표 카드와 내역이 함께 따라온다. 고를 때 화면 전체를 다시 그리지 않는다. */
  if (NSUB === 'income') {
    const wrap = document.getElementById('now-inc-chartwrap');
    const canvas = document.getElementById('chart-now-income');
    const rBody = document.getElementById('now-incright-body');
    const ptag = document.getElementById('now-inc-ptag');
    const statBox = document.getElementById('now-inc-stats');
    const scopeBox = document.getElementById('now-inc-scope');
    const SEL_C = '#e8c96a';
    let R = incBuildRows(state.nowIncOpen);
    const heightOf = (rows) => Math.max(200, 44 + rows.length * 44);

    const on = (r) => !state.nowIncSel || (r.sel && (r.sel === state.nowIncSel || state.nowIncSel.startsWith(r.sel + ' › ')));
    const isSel = (r) => !!r.sel && r.sel === state.nowIncSel;
    const curBg = (r) => hexToRgba(r.color, !on(r) ? .13 : isSel(r) ? 1 : r.level === 2 ? .58 : .9);
    const avgBg = (r) => hexToRgba(r.color, !on(r) ? .04 : r.level === 2 ? .13 : .2);
    const avgLine = (r) => hexToRgba(r.color, !on(r) ? .15 : r.level === 2 ? .42 : .7);
    const curLine = (r) => isSel(r) ? SEL_C : 'transparent';
    const tickColor = (i) => {
      const r = R[i];
      if (!r) return '#9aa3b6';
      if (isSel(r)) return SEL_C;
      if (!on(r)) return r.level === 2 ? '#4a505c' : '#5d6472';
      return r.level === 2 ? '#8f97a6' : '#e2e7f0';
    };
    const fmt = (pick) => (v, i) => {
      const r = R[i];
      if (!r) return '';
      const sh = pick(r);
      return `${formatCompactWon(v)}${sh != null && sh > 0 ? `  ${sh.toFixed(0)}%` : ''}`;
    };

    /* 켜진 줄은 막대 색만으로 부족하다 — 줄 전체에 띠를 깔고, 분류 사이엔 가는 선을 긋는다 */
    const incRowDecor = {
      id: 'incRowDecor',
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y, area = chart.chartArea;
        if (!y || !area) return;
        const band = y.height / Math.max(y.ticks.length, 1);
        const { ctx } = chart;
        ctx.save();
        R.forEach((r, i) => {
          if (r.level !== 1 || r.first) return;
          const top = y.getPixelForTick(i) - band / 2;
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
          ctx.fillRect(0, top, area.right, 1);
        });
        const i = chart.$selIndex;
        if (i != null && i >= 0) {
          const cy = y.getPixelForTick(i);
          ctx.fillStyle = 'rgba(232,201,106,0.09)';
          ctx.fillRect(0, cy - band / 2, area.right, band);
          ctx.fillStyle = SEL_C;
          ctx.fillRect(0, cy - band / 2 + 3, 2, band - 6);
        }
        ctx.restore();
      }
    };

    const scopeStats = () => {
      const sel = state.nowIncSel;
      if (sel) return incStats.of(sel);
      return {
        cur: incStats.curTot, avg: incStats.avgTot,
        diff: incStats.curTot - incStats.avgTot,
        ratio: incStats.avgTot > 0 ? (incStats.curTot / incStats.avgTot) * 100 : null,
        share: 100
      };
    };

    const renderScope = () => {
      if (!scopeBox) return;
      const sel = state.nowIncSel;
      scopeBox.innerHTML = sel
        ? `<span class="inc-chip"><i style="background:${incColorOf(sel)}"></i>${rxEsc(sel)}<button id="inc-scope-clear" title="전체 보기">×</button></span>`
        : '<span class="inc-chip muted">전체 수입</span>';
      const cl = document.getElementById('inc-scope-clear');
      if (cl) cl.addEventListener('click', () => { state.nowIncSel = null; apply(); });
    };

    const renderCards = () => {
      if (!statBox) return;
      const sel = state.nowIncSel;
      const st = scopeStats();
      const n = incRawRowsFor(sel).length;
      const up = st.diff >= 0;
      const rateCol = st.ratio === null ? 'var(--text)' : st.ratio >= 100 ? 'var(--income-text)' : 'var(--expense-text)';
      statBox.innerHTML = `
        <div class="stat-card">
          <div class="label">이번 달 수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(st.cur)}</div>
          ${incStats.months ? `<div class="sub" style="color:${up ? 'var(--income-text)' : '#d9884f'}">평소보다 ${up ? '+' : '−'}${wonComma(Math.abs(Math.round(st.diff)))}원</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">지난 ${incStats.months || 0}개월 월평균</div>
          <div class="value" style="color:var(--text-dim)">${formatKrw(Math.round(st.avg))}</div>
          <div class="sub">기록이 있는 ${incStats.months || 0}개월 기준</div>
        </div>
        <div class="stat-card">
          <div class="label">달성률</div>
          <div class="value" style="color:${rateCol}">${st.ratio === null ? '—' : Math.round(st.ratio) + '%'}</div>
          <div class="sub">${st.ratio === null ? '평소 기록 없음' : '평소 대비'}</div>
        </div>
        <div class="stat-card">
          <div class="label">${sel ? '이번 달 비중' : '기록'}</div>
          <div class="value">${sel ? `${(st.share || 0).toFixed(0)}%` : `${n}건`}</div>
          <div class="sub">${sel ? '이번 달 수입 중' : '이번 달 수입 기록'}</div>
        </div>`;
    };

    const renderList = () => {
      const sel = state.nowIncSel;
      const rows = incRawRowsFor(sel);
      const sum = rows.reduce((a, r) => a + r.amount, 0);
      if (ptag) ptag.textContent = `${rows.length}건 · ${formatKrw(sum)}`;
      if (!rBody) return;
      rBody.innerHTML = rows.length ? `
        <div class="table-scroll" style="max-height:520px;">
          <table class="data-table inc-raw">
            <thead><tr><th>날짜</th><th>분류 · 항목</th><th>사용처</th><th style="text-align:right">금액</th></tr></thead>
            <tbody>${rows.map(r => {
              const p = parseLedgerDateParts(r.date);
              return `<tr data-day="${r.dayKey || ''}" title="${rxEsc(r.memo || '')}">
              <td class="c-date">${p ? `${p.mo}/${p.d}` : r.date}</td>
              <td class="c-cat">${rxCat(r)}</td>
              <td class="c-vendor">${rxEsc((r.vendor || '').split('›').pop().trim())}${r.memo ? `<div class="acct-cat">${rxEsc(r.memo)}</div>` : ''}</td>
              <td class="amt c-amt"><span class="v 수입">${wonComma(r.amount)}</span></td>
            </tr>`; }).join('')}</tbody>
          </table>
        </div>`
        : `<div class="empty-state">${sel ? `${rxEsc(sel)} 수입이 이번 달엔 없어요.` : '이 기간 수입 내역이 없어요.'}</div>`;
      rBody.querySelectorAll('tr[data-day]').forEach(tr => tr.addEventListener('click', () => {
        const k = tr.dataset.day;
        if (!k || k > todayDayKey()) return;
        state.todayDayKey = k;
        goTo('flow', 'today');
      }));
    };

    const apply = () => {
      R = incBuildRows(state.nowIncOpen);
      const ch = state.charts.nowIncome;
      if (ch) {
        ch.$selIndex = R.findIndex(isSel);
        ch.data.labels = R.map(r => r.label);
        const [d0, d1] = ch.data.datasets;
        d0.data = R.map(r => r.cur);
        d0.backgroundColor = R.map(curBg);
        d0.borderColor = R.map(curLine);
        d0.borderWidth = R.map(r => isSel(r) ? 2 : 0);
        d1.data = R.map(r => r.avg);
        d1.backgroundColor = R.map(avgBg);
        d1.borderColor = R.map(avgLine);
        if (wrap) wrap.style.height = heightOf(R) + 'px';
        ch.resize();
        ch.update('none');   /* 막대가 0에서 다시 자라지 않게 */
      }
      renderScope(); renderCards(); renderList();
    };

    if (wrap) wrap.style.height = heightOf(R) + 'px';
    if (canvas) {
      if (state.charts.nowIncome) state.charts.nowIncome.destroy();
      const ch = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: R.map(r => r.label),
          datasets: [
            {
              label: '이번 달', data: R.map(r => r.cur),
              backgroundColor: R.map(curBg), borderColor: R.map(curLine),
              borderWidth: R.map(r => isSel(r) ? 2 : 0),
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r ? '#dfe4ee' : isSel(r) ? SEL_C : !on(r) ? '#4e5563' : r.level === 2 ? '#c3cad6' : '#eef1f7'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "700 12.5px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.share)
            },
            {
              label: '지난 월평균', data: R.map(r => r.avg),
              backgroundColor: R.map(avgBg), borderColor: R.map(avgLine), borderWidth: 1,
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r || on(r) ? '#8b93a5' : '#454b58'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "500 11px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.avgShare)
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { right: 116, left: 0 } },
          /* 가로 막대라 인덱스 축이 y다 */
          interaction: { mode: 'index', intersect: false, axis: 'y' },
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: (item) => item.raw !== null && item.raw !== undefined,
              callbacks: {
                title: (items) => items.length ? String(R[items[0].dataIndex].label).replace(/^[▸▾\s]+/, '') : '',
                label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}`,
                afterBody: (items) => {
                  if (!items.length) return '';
                  const r = R[items[0].dataIndex];
                  if (!r) return '';
                  return [r.ratio === null
                    ? '평소 기록 없음'
                    : `평소 대비 ${r.ratio.toFixed(0)}% (${r.diff >= 0 ? '+' : '−'}${wonComma(Math.abs(Math.round(r.diff)))}원)`];
                }
              }
            }
          },
          scales: {
            x: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
            y: {
              ticks: {
                ...MONO_TICK, crossAlign: 'far', autoSkip: false, padding: 8,
                color: (ctx) => tickColor(ctx.index),
                font: (ctx) => {
                  const r = R[ctx.index];
                  return {
                    family: r && r.level === 2 ? 'Inter, system-ui, sans-serif' : 'IBM Plex Mono',
                    size: r && r.level === 2 ? 11.5 : 13,
                    weight: r && r.level === 2 ? 400 : 700
                  };
                }
              },
              grid: { display: false }
            }
          }
        },
        plugins: [incRowDecor, valueLabelPlugin]
      });
      state.charts.nowIncome = ch;
      ch.$selIndex = R.findIndex(isSel);

      /* 클릭은 직접 받는다 — 축 라벨(▸/▾) 영역은 '펼치기만', 막대 영역은 '고르기'.
         Chart.js 의 onClick 은 차트 영역 밖(축 라벨 쪽)에서 직전 hover 를 물고 와서 못 쓴다. */
      const rowAt = (py) => {
        const area = ch.chartArea;
        if (!area || py < area.top || py > area.bottom) return -1;
        const i = Math.round(ch.scales.y.getValueForPixel(py));
        return (i >= 0 && i < R.length) ? i : -1;
      };
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const i = rowAt(py);
        if (i < 0) return;
        const r = R[i];
        if (px < ch.chartArea.left) {
          if (r.level === 1) { state.nowIncOpen = state.nowIncOpen === r.cat ? null : r.cat; apply(); }
          return;
        }
        state.nowIncSel = state.nowIncSel === r.sel ? null : r.sel;
        apply();
      });
      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const py = e.clientY - rect.top, px = e.clientX - rect.left;
        const i = rowAt(py);
        canvas.style.cursor = i < 0 ? 'default'
          : (px < ch.chartArea.left && R[i].level !== 1) ? 'default' : 'pointer';
      });
    }
    renderScope(); renderCards(); renderList();
  }

  /* --- 지출: 지표 카드 · 차트 · 내역 -----------------------------------------
     수입 탭과 같은 조작을 그대로 쓴다. 축 라벨(▸/▾)은 펼치기, 막대는 고르기.
     다른 점은 방향뿐이다 — 지출은 평소보다 적게 쓴 쪽이 좋은 소식이라 색이 뒤집힌다. */
  if (NSUB === 'expense') {
    const wrap = document.getElementById('now-exp-chartwrap');
    const canvas = document.getElementById('chart-now-expense');
    const rBody = document.getElementById('now-expright-body');
    const ptag = document.getElementById('now-exp-ptag');
    const statBox = document.getElementById('now-exp-stats');
    const scopeBox = document.getElementById('now-exp-scope');
    const SEL_C = '#e8c96a';
    let R = expBuildRows(state.nowExpOpen);
    const heightOf = (rows) => Math.max(200, 44 + rows.length * 44);

    const on = (r) => !state.nowExpSel || (r.sel && (r.sel === state.nowExpSel || state.nowExpSel.startsWith(r.sel + ' › ')));
    const isSel = (r) => !!r.sel && r.sel === state.nowExpSel;
    const curBg = (r) => hexToRgba(r.color, !on(r) ? .13 : isSel(r) ? 1 : r.level === 2 ? .58 : .9);
    const avgBg = (r) => hexToRgba(r.color, !on(r) ? .04 : r.level === 2 ? .13 : .2);
    const avgLine = (r) => hexToRgba(r.color, !on(r) ? .15 : r.level === 2 ? .42 : .7);
    const curLine = (r) => isSel(r) ? SEL_C : 'transparent';
    const tickColor = (i) => {
      const r = R[i];
      if (!r) return '#9aa3b6';
      if (isSel(r)) return SEL_C;
      if (!on(r)) return r.level === 2 ? '#4a505c' : '#5d6472';
      return r.level === 2 ? '#8f97a6' : '#e2e7f0';
    };
    const fmt = (pick) => (v, i) => {
      const r = R[i];
      if (!r) return '';
      const sh = pick(r);
      return `${formatCompactWon(v)}${sh != null && sh > 0 ? `  ${sh.toFixed(0)}%` : ''}`;
    };

    const expRowDecor = {
      id: 'expRowDecor',
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y, area = chart.chartArea;
        if (!y || !area) return;
        const band = y.height / Math.max(y.ticks.length, 1);
        const { ctx } = chart;
        ctx.save();
        R.forEach((r, i) => {
          if (r.level !== 1 || r.first) return;
          const top = y.getPixelForTick(i) - band / 2;
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
          ctx.fillRect(0, top, area.right, 1);
        });
        const i = chart.$selIndex;
        if (i != null && i >= 0) {
          const cy = y.getPixelForTick(i);
          ctx.fillStyle = 'rgba(232,201,106,0.09)';
          ctx.fillRect(0, cy - band / 2, area.right, band);
          ctx.fillStyle = SEL_C;
          ctx.fillRect(0, cy - band / 2 + 3, 2, band - 6);
        }
        ctx.restore();
      }
    };

    const scopeStats = () => {
      const sel = state.nowExpSel;
      if (sel) return expStats.of(sel);
      return {
        cur: expStats.curTot, avg: expStats.avgTot,
        diff: expStats.curTot - expStats.avgTot,
        ratio: expStats.avgTot > 0 ? (expStats.curTot / expStats.avgTot) * 100 : null,
        share: 100
      };
    };

    const renderScope = () => {
      if (!scopeBox) return;
      const sel = state.nowExpSel;
      scopeBox.innerHTML = `
        ${sel
          ? `<span class="inc-chip"><i style="background:${expColorOf(sel)}"></i>${rxEsc(sel)}<button id="exp-scope-clear" title="전체 보기">×</button></span>`
          : '<span class="inc-chip muted">전체 지출</span>'}
        <span class="exp-fchips">${EXP_BUCKETS.map(b => `
          <button class="exp-fchip ${EXPF === b.key ? 'on' : ''}" data-expf="${b.key}">
            ${b.label}<b>${formatCompactWon(b.value)}</b>
          </button>`).join('')}</span>`;
      const cl = document.getElementById('exp-scope-clear');
      if (cl) cl.addEventListener('click', () => { state.nowExpSel = null; apply(); });
      scopeBox.querySelectorAll('.exp-fchip').forEach(el => el.addEventListener('click', () => {
        state.nowExpFilter = el.dataset.expf;
        renderPage();   /* 필터는 기준선(평소 월평균)까지 바꾼다 — 통째로 다시 센다 */
      }));
    };

    const renderCards = () => {
      if (!statBox) return;
      const sel = state.nowExpSel;
      const st = scopeStats();
      const n = expRawRowsFor(sel).length;
      const less = st.diff <= 0;   /* 지출은 적게 쓴 쪽이 좋은 소식 */
      const rateCol = st.ratio === null ? 'var(--text)' : st.ratio > 100 ? 'var(--expense-text)' : 'var(--income-text)';
      statBox.innerHTML = `
        <div class="stat-card">
          <div class="label">이번 달 지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(st.cur)}</div>
          ${expStats.months ? `<div class="sub" style="color:${less ? 'var(--income-text)' : 'var(--expense-text)'}">평소보다 ${less ? '−' : '+'}${wonComma(Math.abs(Math.round(st.diff)))}원</div>` : ''}
          ${isThisMonth && !week ? `<div class="sub">월말 예상 <b>${formatKrw(Math.round(st.cur * projRate))}</b></div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">지난 ${expStats.months || 0}개월 월평균</div>
          <div class="value" style="color:var(--text-dim)">${formatKrw(Math.round(st.avg))}</div>
          <div class="sub">기록이 있는 ${expStats.months || 0}개월 기준</div>
        </div>
        <div class="stat-card">
          <div class="label">평소 대비</div>
          <div class="value" style="color:${rateCol}">${st.ratio === null ? '—' : Math.round(st.ratio) + '%'}</div>
          <div class="sub">${st.ratio === null ? '평소 기록 없음' : (isThisMonth ? `D+${elapsed} / ${M.days}일 시점` : '마감 기준')}</div>
        </div>
        <div class="stat-card">
          <div class="label">${sel ? '이번 달 비중' : '기록'}</div>
          <div class="value">${sel ? `${(st.share || 0).toFixed(0)}%` : `${n}건`}</div>
          <div class="sub">${sel ? '이번 달 지출 중' : '이번 달 지출 기록'}</div>
        </div>`;
    };

    const renderList = () => {
      const sel = state.nowExpSel;
      const rows = expRawRowsFor(sel);
      const sum = rows.reduce((a, r) => a + netOfR(r), 0);
      if (ptag) ptag.textContent = `${rows.length}건 · ${formatKrw(sum)}`;
      /* 다른 화면으로 보내지 않는다 — 고칠 곳은 보고 있는 자리다 */
      rxMountEditableDays(rBody, rows,
        sel ? `${rxEsc(sel)} 지출이 이번 달엔 없어요.` : '이 조건의 지출 내역이 없어요.');
    };

    const apply = () => {
      R = expBuildRows(state.nowExpOpen);
      const ch = state.charts.nowExpenseCat;
      if (ch) {
        ch.$selIndex = R.findIndex(isSel);
        ch.data.labels = R.map(r => r.label);
        const [d0, d1] = ch.data.datasets;
        d0.data = R.map(r => r.cur);
        d0.backgroundColor = R.map(curBg);
        d0.borderColor = R.map(curLine);
        d0.borderWidth = R.map(r => isSel(r) ? 2 : 0);
        d1.data = R.map(r => r.avg);
        d1.backgroundColor = R.map(avgBg);
        d1.borderColor = R.map(avgLine);
        if (wrap) wrap.style.height = heightOf(R) + 'px';
        ch.resize();
        ch.update('none');
      }
      renderScope(); renderCards(); renderList();
    };

    if (wrap) wrap.style.height = heightOf(R) + 'px';
    if (canvas) {
      if (state.charts.nowExpenseCat) state.charts.nowExpenseCat.destroy();
      const ch = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: R.map(r => r.label),
          datasets: [
            {
              label: '이번 달', data: R.map(r => r.cur),
              backgroundColor: R.map(curBg), borderColor: R.map(curLine),
              borderWidth: R.map(r => isSel(r) ? 2 : 0),
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r ? '#dfe4ee' : isSel(r) ? SEL_C : !on(r) ? '#4e5563' : r.level === 2 ? '#c3cad6' : '#eef1f7'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "700 12.5px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.share)
            },
            {
              label: '지난 월평균', data: R.map(r => r.avg),
              backgroundColor: R.map(avgBg), borderColor: R.map(avgLine), borderWidth: 1,
              borderRadius: 3, barPercentage: .8, categoryPercentage: .78,
              labelColor: (i) => { const r = R[i]; return !r || on(r) ? '#8b93a5' : '#454b58'; },
              labelStep: 1, labelOffset: 8,
              labelFont: "500 11px 'IBM Plex Mono', monospace",
              labelFormatter: fmt(r => r.avgShare)
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { right: 116, left: 0 } },
          interaction: { mode: 'index', intersect: false, axis: 'y' },
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: (item) => item.raw !== null && item.raw !== undefined,
              callbacks: {
                title: (items) => items.length ? String(R[items[0].dataIndex].label).replace(/^[▸▾\s]+/, '') : '',
                label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}`,
                afterBody: (items) => {
                  if (!items.length) return '';
                  const r = R[items[0].dataIndex];
                  if (!r) return '';
                  return [r.ratio === null
                    ? '평소 기록 없음'
                    : `평소 대비 ${r.ratio.toFixed(0)}% (${r.diff >= 0 ? '+' : '−'}${wonComma(Math.abs(Math.round(r.diff)))}원)`];
                }
              }
            }
          },
          scales: {
            x: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
            y: {
              ticks: {
                ...MONO_TICK, crossAlign: 'far', autoSkip: false, padding: 8,
                color: (ctx) => tickColor(ctx.index),
                font: (ctx) => {
                  const r = R[ctx.index];
                  return {
                    family: r && r.level === 2 ? 'Inter, system-ui, sans-serif' : 'IBM Plex Mono',
                    size: r && r.level === 2 ? 11.5 : 13,
                    weight: r && r.level === 2 ? 400 : 700
                  };
                }
              },
              grid: { display: false }
            }
          }
        },
        plugins: [expRowDecor, valueLabelPlugin]
      });
      state.charts.nowExpenseCat = ch;
      ch.$selIndex = R.findIndex(isSel);

      const rowAt = (py) => {
        const area = ch.chartArea;
        if (!area || py < area.top || py > area.bottom) return -1;
        const i = Math.round(ch.scales.y.getValueForPixel(py));
        return (i >= 0 && i < R.length) ? i : -1;
      };
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const i = rowAt(py);
        if (i < 0) return;
        const r = R[i];
        if (px < ch.chartArea.left) {
          if (r.level === 1) { state.nowExpOpen = state.nowExpOpen === r.cat ? null : r.cat; apply(); }
          return;
        }
        state.nowExpSel = state.nowExpSel === r.sel ? null : r.sel;
        apply();
      });
      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const py = e.clientY - rect.top, px = e.clientX - rect.left;
        const i = rowAt(py);
        canvas.style.cursor = i < 0 ? 'default'
          : (px < ch.chartArea.left && R[i].level !== 1) ? 'default' : 'pointer';
      });
    }
    renderScope(); renderCards(); renderList();
  }

  /* --- 카테고리 --- */
  const catBody = document.getElementById('now-cat-body');
  const catMax = Math.max(...catRows.map(r => Math.max(r.cur, r.prev)), 1);
  const showCatDelta = !week;
  if (catBody) catBody.innerHTML = (catRows.length ? catRows.map(r => {
    const diff = r.cur - r.prev;
    let deltaHtml = '';
    if (showCatDelta) {
      const txt = r.prev === 0 ? '신규' : diff === 0 ? '동일' : `${diff > 0 ? '+' : '−'}${wonComma(diff)}`;
      const col = r.prev === 0 ? 'var(--text-faint)' : diff > 0 ? 'var(--expense-text)' : diff < 0 ? 'var(--income-text)' : 'var(--text-faint)';
      deltaHtml = ` · <span style="color:${col}">${cmpNote} ${txt}</span>`;
    }
    return `<div class="budget-row-compact">
      <span class="b-name" title="${r.name}">${r.name}</span>
      <div class="b-bar-track"><div class="b-bar-fill ${showCatDelta && diff > 0 && r.prev > 0 ? 'over' : ''}" style="width:${(r.cur / catMax) * 100}%"></div></div>
      <span class="b-figures">${wonComma(r.cur)}원 · ${r.pct.toFixed(0)}%${deltaHtml}</span>
    </div>`;
  }).join('') : '<div class="empty-state">이 기간 지출 내역이 없어요.</div>')
  + (showCatDelta ? `<div class="settings-note">비교 기준 · ${cmpRange}${isThisMonth ? ' 같은 기간' : ''}</div>` : '');

  /* --- TOP 지출 --- */
  if (document.getElementById('now-top-body')) document.getElementById('now-top-body').innerHTML = `
    <div class="table-scroll" style="max-height:320px;">
      <table class="data-table">
        <thead><tr><th>날짜</th><th>항목</th><th>사용처</th><th style="text-align:right">금액</th></tr></thead>
        <tbody>${topExpenses.length ? topExpenses.map(r => `<tr><td>${r.date}</td><td>${r.item}</td><td>${r.vendor || ''}</td><td class="amt expense">${formatWon(r.amount)}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:20px;">지출 내역이 없어요.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  /* --- 주차별 요약 --- */
  const weekMax = Math.max(...M.weeks.map(w => w.expense), 1);
  if (document.getElementById('now-week-body')) document.getElementById('now-week-body').innerHTML = `
    <div class="table-scroll" style="max-height:none;">
      <table class="data-table">
        <thead><tr><th>주차</th><th>기간</th><th style="text-align:right">수입</th><th style="text-align:right">지출</th><th style="text-align:right">순액</th></tr></thead>
        <tbody>${M.weeks.map(w => `
          <tr>
            <td>${w.label}</td>
            <td style="color:var(--text-faint);">${w.range}</td>
            <td class="amt income">${w.income ? formatWon(w.income) : '—'}</td>
            <td class="amt expense">${w.expense ? formatWon(w.expense) : '—'}</td>
            <td class="amt" style="color:${w.income - w.expense >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(w.income - w.expense)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    ${M.weeks.length ? `<div class="settings-note">최다 지출 주 · <b style="color:var(--accent-text)">${M.weeks.reduce((a, b) => b.expense > a.expense ? b : a).label}</b> ${formatWon(weekMax)}</div>` : ''}
  `;

  /* --- 요일별 평균 지출 --- */
  const dowAgg = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  M.daily.forEach(b => {
    if (isThisMonth && b.day > elapsed) return;
    const di = b.dow === 0 ? 6 : b.dow - 1;   // 월=0 … 일=6
    dowAgg[di].sum += b.expense;
    dowAgg[di].n += 1;
  });
  const dowAvg = dowAgg.map((a, i) => ({ name: ['월', '화', '수', '목', '금', '토', '일'][i], avg: a.n ? a.sum / a.n : 0 }));
  const dowMax = Math.max(...dowAvg.map(x => x.avg), 1);
  const dowTop = dowAvg.reduce((a, b) => b.avg > a.avg ? b : a, dowAvg[0]);
  if (document.getElementById('now-dow-body')) document.getElementById('now-dow-body').innerHTML = `
    ${dowAvg.map(x => `
      <div class="dow-avg-row">
        <span class="nm">${x.name}</span>
        <div class="b-bar-track"><div class="b-bar-fill" style="width:${(x.avg / dowMax) * 100}%"></div></div>
        <span class="fig">${x.avg ? formatWon(Math.round(x.avg)) : '—'}</span>
      </div>`).join('')}
    <div class="settings-note">${dowTop && dowTop.avg > 0 ? `최다 · <b style="color:var(--accent-text)">${dowTop.name}요일</b> 평균 ${formatWon(Math.round(dowTop.avg))}` : '계산할 지출이 없어요.'}</div>
  `;

  /* --- 내역 테이블 --- */

  /* --- 지출 흐름: 일별 누적 실적 vs 최근 3개월 평균 페이스 --- */
  const drawNowFlow = () => {
    if (!document.getElementById('chart-now-flow')) return;
    if (state.charts.nowFlow) state.charts.nowFlow.destroy();
    const days = M.daily;
    const labels = days.map(b => `${b.day}`);
    /* 이번 달 누적 (아직 안 지난 날은 끊는다) */
    let run = 0;
    const cum = days.map(b => {
      if (isThisMonth && b.day > elapsed) return null;
      run += b.expense;
      return run;
    });
    /* 최근 3개월 같은 날짜까지의 평균 누적 = 평균 페이스 */
    const pace = days.map(b => {
      const v = pacePeerAverage(ledger, monthKey, b.day, 3);
      return v === null ? null : Math.round(v);
    });
    /* 예산이 있으면 목표선도 (총예산 / 일수 × 경과일) */
    const budgetTotal = (() => {
      try {
        const { groups } = buildBudgetTree(data);
        return groups.reduce((a, g) => a + g.items.reduce((x, it) => x + budgetOf(g.name, it.name, it.avg), 0), 0);
      } catch (e) { return 0; }
    })();
    const budgetLine = budgetTotal > 0 ? days.map(b => Math.round(budgetTotal / M.days * b.day)) : null;

    let irun = 0;
    const cumIncome = days.map(b => {
      if (isThisMonth && b.day > elapsed) return null;
      irun += b.income;
      return irun;
    });
    let nrun = 0;
    const cumNet = days.map(b => {
      if (isThisMonth && b.day > elapsed) return null;
      nrun += (b.income - b.expense);
      return nrun;
    });
    /* 최근 3개월 같은 날짜까지의 평균 누적 페이스 */
    const paceOf = (kw) => days.map(b => {
      const vals = [];
      for (let i = 1; i <= 3; i++) {
        const k = shiftMonthKey(monthKey, -i);
        if (ledger.some(r => ledgerMonthKey(r.date) === k && r.major.includes(kw))) {
          vals.push(cumThroughDay(ledger, k, b.day, kw));
        }
      }
      return vals.length ? Math.round(vals.reduce((a, x) => a + x, 0) / vals.length) : null;
    });
    const paceIncome = paceOf('수입');
    const paceExpense = pace;
    const paceNet = days.map((b, i) =>
      (paceIncome[i] === null || paceExpense[i] === null) ? null : paceIncome[i] - paceExpense[i]);

    const lastIdx = isThisMonth ? Math.max(elapsed - 1, 0) : days.length - 1;
    const projLine = (arr) => {
      if (!isThisMonth || elapsed <= 0 || elapsed >= days.length) return null;
      const base = arr[lastIdx];
      if (base === null || base === undefined) return null;
      const perDay = base / (lastIdx + 1);
      return days.map((b, i) => (i < lastIdx ? null : Math.round(perDay * (i + 1))));
    };

    const AX = FLOW_AXES.find(a => a.key === state.nowAxis) || FLOW_AXES[1];
    const O = state.nowOpts;
    const SRC = {
      income: { cum: cumIncome, pace: paceIncome, color: '#4c8c6b', label: '수입' },
      expense: { cum, pace: paceExpense, color: '#c1483f', label: '지출' },
      net: { cum: cumNet, pace: paceNet, color: '#9b7fc2', label: '순저축' }
    }[AX.key];
    const proj = projLine(SRC.cum);

    /* 페이스 문구 — 선택한 축에 맞게 */
    const liveIdx = isThisMonth ? Math.max(elapsed - 1, 0) : days.length - 1;
    const curV = SRC.cum[liveIdx], baseV = SRC.pace[liveIdx];
    const tagEl = document.getElementById('now-pace-tag');
    if (tagEl) {
      if (curV === null || baseV === null || baseV === undefined) {
        tagEl.textContent = ''; 
      } else {
        const dv = curV - baseV;
        const better = AX.key === 'expense' ? dv < 0 : dv > 0;
        const verb = AX.key === 'expense' ? (dv > 0 ? '더 쓰는' : '덜 쓰는')
                   : AX.key === 'income' ? (dv > 0 ? '더 버는' : '덜 버는')
                   : (dv > 0 ? '더 모으는' : '덜 모으는');
        tagEl.textContent = `평소보다 ${wonComma(Math.abs(Math.round(dv)))}원 ${verb} 페이스`;
        tagEl.style.color = Math.abs(dv) < 1 ? 'var(--text-dim)' : (better ? 'var(--income-text)' : '#d9884f');
      }
    }

    const ds = [];
    /* 같은 축 안에서도 선/색/굵기로 역할을 구분한다:
       실선+면적 = 이번 달 실제 · 같은 색 점선 = 예상 · 회색 긴점선 = 최근 3개월 평균 · 금색 촘촘점선 = 예산 */
    if (AX.key === 'expense' && O.daily) {
      ds.push({ type: 'bar', label: '일별 지출', data: days.map(b => b.expense), backgroundColor: 'rgba(193,72,63,.30)', borderRadius: 2, yAxisID: 'y1', order: 9, hideLabel: true });
    }
    ds.push({ type: 'line', label: `최근 3개월 평균 ${SRC.label} 페이스`, data: SRC.pace,
      borderColor: '#9aa3b6', borderDash: [7, 4], backgroundColor: 'transparent', borderWidth: 1.6,
      pointRadius: 0, tension: .25, spanGaps: true, yAxisID: 'y', order: 4,
      labelColor: '#9aa3b6', labelStep: 999, labelOffset: 14 });
    if (AX.key === 'expense' && O.budget && budgetLine) {
      ds.push({ type: 'line', label: '예산 페이스', data: budgetLine, borderColor: '#c9a227',
        borderDash: [2, 3], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0,
        tension: 0, yAxisID: 'y', order: 5, hideLabel: true });
    }
    if (proj) {
      ds.push({ type: 'line', label: `예상 ${SRC.label}`, data: proj, borderColor: SRC.color,
        borderDash: [4, 4], backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0,
        tension: .25, spanGaps: true, yAxisID: 'y', order: 3,
        labelColor: SRC.color, labelStep: 999, labelOffset: -14 });
    }
    ds.push({ type: 'line', label: `누적 ${SRC.label}`, data: SRC.cum, borderColor: SRC.color,
      backgroundColor: hexToRgba(SRC.color, .12), fill: true, borderWidth: 2.6, pointRadius: 0,
      tension: .25, spanGaps: false, yAxisID: 'y', order: 1,
      labelColor: SRC.color, labelStep: Math.max(Math.ceil(days.length / 6), 1), labelOffset: -14 });

    const legendBox = document.getElementById('now-flow-legend');
    if (legendBox) legendBox.innerHTML = ds.slice().reverse().map(x =>
      `<span><i style="background:${x.borderColor || x.backgroundColor}"></i>${x.label}</span>`).join('');

    state.charts.nowFlow = new Chart(document.getElementById('chart-now-flow'), {
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, right: 12 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => (c.raw === null ? null : ` ${c.dataset.label}: ${formatWon(c.raw)}`) } }
        },
        scales: {
          x: { ticks: { ...MONO_TICK, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y1: { display: !!(AX.key === 'expense' && O.daily), position: 'right', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: { display: false } }
        }
      },
      plugins: [valueLabelPlugin]
    });
  };
  const nowToggles = document.getElementById('now-series-toggles');
  if (nowToggles) nowToggles.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-key]');
    if (!inp) return;
    state.nowOpts[inp.dataset.key] = inp.checked;
    inp.closest('.series-chk').classList.toggle('on', inp.checked);
    drawNowFlow();
  });
  const nowAxisBtns = document.getElementById('now-axis-btns');
  if (nowAxisBtns) nowAxisBtns.addEventListener('click', (e) => {
    const b = e.target.closest('.axis-btn');
    if (!b || state.nowAxis === b.dataset.axis) return;
    state.nowAxis = b.dataset.axis;
    nowAxisBtns.querySelectorAll('.axis-btn').forEach(x => x.classList.toggle('on', x === b));
    if (nowToggles) nowToggles.style.display = state.nowAxis === 'expense' ? '' : 'none';
    drawNowFlow();
  });
  drawNowFlow();

  /* --- 월 이동 --- */
  const setMonth = (k, pinned) => {
    state.nowMonthKey = k;
    state.nowMonthPinned = pinned !== false;
    state.nowWeekIdx = null;
    renderPage();
  };
  document.getElementById('now-month-select').addEventListener('change', (e) => setMonth(e.target.value));
  document.getElementById('now-prev').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i > 0) setMonth(availableKeys[i - 1]);
  });
  document.getElementById('now-next').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i < availableKeys.length - 1) setMonth(availableKeys[i + 1]);
  });
  document.getElementById('now-thismonth').addEventListener('click', () => {
    const t = thisMonthKey();
    setMonth(availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1], false);
  });
}

/* ---------------- page: 오늘 (하루 단위) ---------------- */

/* 시트의 체크 항목(Good/Bad · 고정비 · 회사 환급)을 배지로 */
const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];

function pad2(n) { return String(n).padStart(2, '0'); }
function dayKeyOfDate(dt) { return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`; }
function todayDayKey() { return dayKeyOfDate(new Date()); }

function ledgerDayKey(dateStr) {
  const p = parseLedgerDateParts(dateStr);
  return p ? `${p.y}-${pad2(p.mo)}-${pad2(p.d)}` : null;
}

function shiftDayKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKeyOfDate(new Date(y, m - 1, d + delta));
}

function dowOfDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function dayKeyLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

function dayKeyShort(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}


function dayDiff(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2)) / 86400000);
}

/* 지출 한 건의 '실지출' = 금액 − 회사 환급 */
function netExpenseOf(r) { return r.amount - (r.refund || 0); }

/* 월 지출 예산
   1순위: 목표 탭의 "(월) 지출/실지출 N만원" 목표
   2순위: 마감된 최근 3개월 실지출(환급 제외) 평균
   ※ 예산·누적 지출 모두 '환급 제외' 기준으로 통일 */
function monthlyExpenseTarget(data, ledger, monthKey) {
  const goals = data.goals || [];
  for (const g of goals) {
    const title = pickGoalField(g, 'title');
    if (!title) continue;
    const m = String(title).match(/(?:월\s*)?(?:실)?지출\s*([\d,]+)\s*만원/);
    if (m) return { amount: parseFloat(m[1].replace(/,/g, '')) * 10000, source: '목표 탭', label: String(title).trim() };
  }
  const cur = thisMonthKey();
  const vals = [];
  for (let i = 1; i <= 3; i++) {
    const k = shiftMonthKey(monthKey, -i);
    if (k >= cur) continue;
    const sum = ledger.filter(r => ledgerMonthKey(r.date) === k && r.major.includes('지출'))
      .reduce((a, r) => a + netExpenseOf(r), 0);
    if (sum > 0) vals.push(sum);
  }
  if (!vals.length) return null;
  return { amount: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), source: '최근 3개월 실지출 평균', label: null };
}

/* 고정비 항목별 예상 결제일(최근 3개월 결제일 중앙값)까지 포함한 상태 */
function fixedScheduleStatus(ledger, monthKey) {
  const prevKeys = [1, 2, 3].map(i => shiftMonthKey(monthKey, -i));
  const tpl = {};
  ledger.filter(r => r.fixed && r.major.includes('지출')).forEach(r => {
    const k = ledgerMonthKey(r.date);
    if (!prevKeys.includes(k)) return;
    const p = parseLedgerDateParts(r.date);
    const id = `${r.item}|${r.vendor}`;
    if (!tpl[id]) tpl[id] = { item: r.item, vendor: r.vendor, minor: r.minor, amounts: [], days: [] };
    tpl[id].amounts.push(r.amount);
    if (p) tpl[id].days.push(p.d);
  });
  const paid = {};
  ledger.filter(r => r.fixed && r.major.includes('지출') && ledgerMonthKey(r.date) === monthKey).forEach(r => {
    const id = `${r.item}|${r.vendor}`;
    const p = parseLedgerDateParts(r.date);
    if (!paid[id]) paid[id] = { amount: 0, day: p ? p.d : null };
    paid[id].amount += r.amount;
  });
  return Object.keys(tpl).map(id => {
    const t = tpl[id];
    const days = t.days.slice().sort((a, b) => a - b);
    return {
      item: t.item, vendor: t.vendor, minor: t.minor,
      expected: Math.round(t.amounts.reduce((a, b) => a + b, 0) / t.amounts.length),
      expectedDay: days.length ? days[Math.floor(days.length / 2)] : null,
      paid: paid[id] ? paid[id].amount : null,
      paidDay: paid[id] ? paid[id].day : null
    };
  }).sort((a, b) => (a.expectedDay || 99) - (b.expectedDay || 99));
}

/* 지표 아래 비교 한 줄 — 기준값 · 차이 · 방향을 색과 함께 준다 (적을수록 좋은 지표 기준) */
function cmpLine(label, cur, base) {
  if (base === null || base === undefined || isNaN(base)) {
    return `<div class="cmp-row none"><span class="cl-l">${label}</span><span class="cl-b">—</span><span class="cl-d">기준 없음</span></div>`;
  }
  const diff = cur - base;
  const good = diff <= 0;
  const cls = diff === 0 ? 'same' : (good ? 'good' : 'bad');
  const arrow = diff === 0 ? '=' : (diff > 0 ? '▲' : '▼');
  return `<div class="cmp-row ${cls}">
    <span class="cl-l">${label}</span>
    <span class="cl-b">${formatWon(base)}</span>
    <span class="cl-d">${arrow} ${diff === 0 ? '동일' : formatWon(Math.abs(diff))}</span>
  </div>`;
}

function renderTodayPage(container, data, d) {
  const ledger = data.ledger || [];
  if (!ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 오늘을 계산할 수 없어요.</div></div>';
    return;
  }

  /* --- 날짜별 집계 --- */
  const byDay = {};
  ledger.forEach(r => {
    const k = ledgerDayKey(r.date);
    if (!k) return;
    if (!byDay[k]) byDay[k] = { income: 0, expense: 0, transfer: 0, rows: [] };
    byDay[k].rows.push(r);
    if (r.major.includes('수입')) byDay[k].income += r.amount;
    else if (r.major.includes('지출')) byDay[k].expense += r.amount;
    else if (r.major.includes('이체')) byDay[k].transfer += r.amount;
  });
  const dayOf = (k) => byDay[k] || { income: 0, expense: 0, transfer: 0, rows: [] };
  const recordedKeys = Object.keys(byDay).sort();
  const earliestKey = recordedKeys[0];
  const latestKey = recordedKeys[recordedKeys.length - 1];

  const realToday = todayDayKey();
  if (!state.todayDayKey) state.todayDayKey = realToday;
  if (state.todayDayKey > realToday) state.todayDayKey = realToday;
  const key = state.todayDayKey;
  const isToday = key === realToday;

  const [Y, MO, DD] = key.split('-').map(Number);
  const monthKey = key.slice(0, 7);
  const monthDays = daysInMonthKey(monthKey);
  const M = buildNowMonth(ledger, monthKey);
  const today = dayOf(key);

  /* 예산·누적은 모두 '실지출(회사 환급 제외)' 기준으로 계산한다 */
  const netExpOfDay = (k) => dayOf(k).rows.filter(r => r.major.includes('지출')).reduce((a, r) => a + netExpenseOf(r), 0);
  const cumBefore = (() => {
    let sum = 0;
    for (let dd = 1; dd < DD; dd++) sum += netExpOfDay(`${monthKey}-${pad2(dd)}`);
    return sum;
  })();
  const todayNetExpense = netExpOfDay(key);
  const todayRefund = today.rows.reduce((a, r) => a + (r.major.includes('지출') ? (r.refund || 0) : 0), 0);
  const todayRegret = today.rows.filter(r => r.regret && r.major.includes('지출')).reduce((a, r) => a + netExpenseOf(r), 0);
  const todayGood = today.rows.filter(r => r.good && r.major.includes('지출')).reduce((a, r) => a + netExpenseOf(r), 0);
  const todayFixed = today.rows.filter(r => r.fixed && r.major.includes('지출')).reduce((a, r) => a + netExpenseOf(r), 0);
  const cumThrough = cumBefore + todayNetExpense;

  /* --- 예산 / 오늘 허용액 --- */
  const budget = monthlyExpenseTarget(data, ledger, monthKey);
  const sched = fixedScheduleStatus(ledger, monthKey);
  const pending = sched.filter(f => f.paid === null);
  const pendingSum = pending.reduce((a, f) => a + f.expected, 0);
  const remainDays = Math.max(monthDays - DD + 1, 1);
  const remainBudget = budget ? budget.amount - cumBefore - pendingSum : null;
  const overBudget = remainBudget !== null && remainBudget < 0;   /* 남은 예산이 이미 마이너스 */
  const allowance = remainBudget === null ? null : Math.max(Math.round(remainBudget / remainDays), 0);
  const allowPct = allowance ? Math.min((todayNetExpense / allowance) * 100, 100) : (todayNetExpense > 0 ? 100 : 0);
  const overToday = allowance !== null && todayNetExpense > allowance;

  /* --- 무지출 스트릭 (기록이 아직 없는 날은 '무지출'로 세지 않는다) --- */
  const noRecordYet = today.rows.length === 0 && key > latestKey;
  let streak = 0;
  if (!noRecordYet) {
    let cursor = key;
    while (dayOf(cursor).expense === 0 && cursor >= earliestKey && streak < 90) {
      streak++;
      cursor = shiftDayKey(cursor, -1);
    }
  }
  /* --- 같은 요일 평균 (최근 8주) --- */
  const sameDowVals = [];
  for (let i = 1; i <= 8; i++) {
    const k = shiftDayKey(key, -7 * i);
    if (k < earliestKey) break;
    sameDowVals.push(netExpOfDay(k));
  }
  const sameDowAvg = sameDowVals.length ? sameDowVals.reduce((a, b) => a + b, 0) / sameDowVals.length : null;
  const monthDailyAvg = DD > 0 ? cumThrough / DD : 0;

  /* --- 판정 문구 --- */
  let verdict, verdictCls;
  if (today.rows.length === 0) {
    verdictCls = 'neutral';
    verdict = isToday
      ? `아직 오늘 기록이 없어요.${latestKey && latestKey < realToday ? ` 마지막 기록은 <b>${dayKeyShort(latestKey)}</b> (${dayDiff(realToday, latestKey)}일 전)이에요.` : ''}`
      : '이 날은 기록이 없어요.';
  } else if (allowance === null) {
    verdictCls = 'neutral';
    verdict = `${isToday ? '오늘' : '이 날'} <b>${formatWon(todayNetExpense)}</b> 썼어요. 이번 달 하루 평균은 ${formatWon(Math.round(monthDailyAvg))}이에요.`;
  } else if (overBudget) {
    verdictCls = 'warn';
    verdict = `이번 달 예산을 이미 <b>${formatWon(Math.abs(remainBudget))}</b> 넘었어요. (${isToday ? '오늘' : '이 날'} ${formatWon(todayNetExpense)})`;
  } else if (overToday) {
    verdictCls = 'warn';
    verdict = `${isToday ? '오늘' : '이 날'} 하루 예산 ${formatWon(allowance)}보다 <b>${formatWon(todayNetExpense - allowance)}</b> 더 썼어요.`;
  } else {
    verdictCls = 'good';
    verdict = `${isToday ? '오늘' : '이 날'} 하루 예산 ${formatWon(allowance)} 중 ${formatWon(todayNetExpense)} 사용 · <b>${formatWon(allowance - todayNetExpense)}</b> 여유 있어요.`;
  }

  /* --- 하루 평균 비교 기준 --- */
  const last12Keys = [];
  for (let i = 0; i < 12; i++) last12Keys.push(shiftMonthKey(monthKey, -i));
  let sum12 = 0, days12 = 0;
  last12Keys.forEach(k => {
    const rowsK = ledger.filter(r => ledgerMonthKey(r.date) === k && r.major.includes('지출'));
    if (!rowsK.length) return;
    sum12 += rowsK.reduce((a, r) => a + netExpenseOf(r), 0);
    days12 += (k === thisMonthKey() ? Math.max(elapsedDaysOf(k), 1) : daysInMonthKey(k));
  });
  const avgDaily12 = days12 > 0 ? sum12 / days12 : 0;
  const targetDaily = budget ? Math.round(budget.amount / monthDays) : null;

  /* --- 예산 기준 (접이식) --- */
  const basisHtml = budget ? `
    <details class="mininote">
      <summary>예산 기준</summary>
      <div class="now-kv"><span>월 실지출 예산 <em style="font-style:normal;color:var(--text-faint)">(${budget.source})</em></span><b>${formatWon(budget.amount)}</b></div>
      <div class="now-kv"><span>− ${DD}일 이전 실지출</span><b>${formatWon(cumBefore)}</b></div>
      <div class="now-kv"><span>− 미결제 고정비 ${pending.length}건</span><b>${formatWon(pendingSum)}</b></div>
      <div class="now-kv"><span>= 남은 예산 ÷ 남은 ${remainDays}일</span><b style="color:${overBudget ? 'var(--expense-text)' : 'var(--accent-text)'}">${formatWon(remainBudget)}</b></div>
      <div class="settings-note">실지출 = 금액 − 회사 환급</div>
    </details>` : `
    <details class="mininote">
      <summary>예산 기준</summary>
      <div class="settings-note">목표 탭에 "월 지출 N만원" 목표가 없고, 마감된 최근 3개월 데이터도 부족해 하루 예산을 계산할 수 없어요.</div>
    </details>`;

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${dayKeyLabel(key)} <span class="today-dow">(${DOW_KR[dowOfDayKey(key)]})</span></div>
        <div class="month-nav">
          <button id="today-prev" ${key <= earliestKey ? 'disabled' : ''}>◀</button>
          <input type="date" id="today-date" value="${key}" max="${realToday}" />
          <button id="today-next" ${key >= realToday ? 'disabled' : ''}>▶</button>
          <button class="btn small" id="today-jump">오늘</button>
        </div>
      </div>
    </div>

    <div class="today-center">
      <div class="today-inner">
      <div class="today-col">
        <div class="stat-card">
          <div class="label">수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(today.income)}</div>
          ${noRecordYet || streak > 0 ? `<div class="streak-badge ${streak > 0 ? 'on' : ''}">${noRecordYet ? '✍️ 기록 미입력' : `🌱 무지출 ${streak}일 연속`}</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(todayNetExpense)}</div>
          <div class="cmp-list">
            ${cmpLine('최근 12개월 하루 평균', todayNetExpense, Math.round(avgDaily12))}
            ${cmpLine('하루 예산', todayNetExpense, targetDaily)}
            ${cmpLine(`${DOW_KR[dowOfDayKey(key)]}요일 평균`, todayNetExpense, sameDowAvg === null ? null : Math.round(sameDowAvg))}
          </div>
          ${(todayFixed || todayRegret || todayGood || todayRefund) ? `<div class="chk-strip">
            ${todayFixed ? `<span class="chk-pill fixed">고정비 ${formatKrw(todayFixed)}</span>` : ''}
            ${todayGood ? `<span class="chk-pill good">잘한소비 ${formatKrw(todayGood)}</span>` : ''}
            ${todayRegret ? `<span class="chk-pill regret">아낄 수 있었던 ${formatKrw(todayRegret)}</span>` : ''}
            ${todayRefund ? `<span class="chk-pill refund">환급 ${formatKrw(todayRefund)}</span>` : ''}
          </div>` : ''}
        </div>
      </div>
      <div class="panel today-list">
        <div class="panel-title"><div>내역</div><span class="ptag">${today.rows.length}건</span></div>
        <div id="today-rows-body"></div>
      </div>
      </div>
    </div>
  `;

  /* --- 내역 (그 자리에서 수정) --- */
  const sortedRows = rxSortRows(today.rows);
  rxMountEditableRows(document.getElementById('today-rows-body'), sortedRows, '이 날 기록이 없어요.');

  /* --- 날짜 이동 --- */
  const setDay = (k) => {
    if (!k || k > realToday) return;
    state.todayDayKey = k;
    renderPage();
  };
  document.getElementById('today-date').addEventListener('change', (e) => setDay(e.target.value));
  document.getElementById('today-prev').addEventListener('click', () => setDay(shiftDayKey(key, -1)));
  document.getElementById('today-next').addEventListener('click', () => setDay(shiftDayKey(key, 1)));
  document.getElementById('today-jump').addEventListener('click', () => setDay(realToday));
}


/* ---------------- page: 올해 ---------------- */

const YEAR_OPTS = [
  { key: 'budget', label: '예산 페이스', color: '#c9a227' },
  { key: 'prevYear', label: '작년 같은 시점', color: '#9aa3b6' }
];

function renderYearPage(container, data, d) {
  const rows = data.months.map((m, i) => {
    const ym = pivotYearMonth(m);
    return { key: m, year: ym.year, month: ym.month, income: data.incomeTotal[i] || 0, expense: data.expenseTotal[i] || 0 };
  }).filter(r => r.year);

  const years = [...new Set(rows.map(r => r.year))].sort();
  if (!state.yearKey || !years.includes(state.yearKey)) {
    const t = String(new Date().getFullYear());
    state.yearKey = years.includes(t) ? t : years[years.length - 1];
  }
  const Y = state.yearKey;
  const prevY = String(Number(Y) - 1);
  const isThisYear = Y === String(new Date().getFullYear());

  const YR_SUBS = [['summary', '요약'], ['income', '수입'], ['expense', '지출'], ['saving', '순저축'], ['invest', '투자']];
  const YR_TOP_PCT = 3;   /* 주요 사용처/수익처 노출 기준 = 연 합계의 3% 이상 */
  if (state.yearSub === 'detail') state.yearSub = 'expense';
  const YSUB = YR_SUBS.some(x => x[0] === state.yearSub) ? state.yearSub : 'summary';
  const YMODE = (state.yearMode === 'flow') ? 'flow' : 'pace';
  const cur = rows.filter(r => r.year === Y).sort((a, b) => a.month - b.month);
  const lastMonthWithData = cur.reduce((a, r) => (r.income > 0 || r.expense > 0) ? r.month : a, 0);
  const throughMonth = isThisYear ? Math.max(new Date().getMonth() + 1, lastMonthWithData) : 12;
  const prev = rows.filter(r => r.year === prevY);
  const prevSame = prev.filter(r => r.month <= throughMonth);

  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const income = sum(cur, 'income'), expense = sum(cur, 'expense');
  const net = income - expense;
  const rate = income > 0 ? (net / income) * 100 : null;

  const pIncome = sum(prevSame, 'income'), pExpense = sum(prevSame, 'expense');
  const pNet = pIncome - pExpense;
  const pRate = pIncome > 0 ? (pNet / pIncome) * 100 : null;
  const cmpNote = isThisYear ? `${prevY}년 1–${throughMonth}월 대비` : `${prevY}년 대비`;

  const monthsElapsed = cur.filter(r => r.income > 0 || r.expense > 0).length || throughMonth;
  const projected = isThisYear && monthsElapsed > 0 ? { income: income / monthsElapsed * 12, expense: expense / monthsElapsed * 12 } : null;

  /* 주요 수입 · 지출 TOP (가계부 원장 기준, 항목+사용처로 묶음) */
  const yrRows = (data.ledger || []).filter(r => String(ledgerMonthKey(r.date) || '').startsWith(Y));
  const topOf = (pred, useNet) => {
    const m = {};
    yrRows.filter(pred).forEach(r => {
      const nm = [r.minor, r.item].filter(Boolean).join(' · ') || r.vendor || '기타';
      if (!m[nm]) m[nm] = { name: nm, v: 0, n: 0 };
      m[nm].v += useNet ? netExpenseOf(r) : r.amount;
      m[nm].n += 1;
    });
    return Object.values(m).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
  };
  /* 이체 (투자원금 · 비상금) — 올해 vs 작년 같은 시점 */
  const trSum = (rows, kw) => rows.filter(r => r.major.includes('이체') && String(r.minor || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
  const prevYrRowsSame = (data.ledger || []).filter(r => {
    const mk = ledgerMonthKey(r.date) || '';
    if (!mk.startsWith(prevY)) return false;
    return Number(mk.slice(5)) <= throughMonth;
  });
  const yrInvestTr = trSum(yrRows, '투자');
  const yrEmgTr = trSum(yrRows, '비상금');
  const pInvestTr = trSum(prevYrRowsSame, '투자');
  const pEmgTr = trSum(prevYrRowsSame, '비상금');

  const topIncome = topOf(r => r.major.includes('수입'), false);
  const topExpense = topOf(r => r.major.includes('지출'), true);
  const maxTopIn = Math.max(...topIncome.map(r => r.v), 1);
  const maxTopEx = Math.max(...topExpense.map(r => r.v), 1);

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${Y}년</div>
        <div class="month-nav">
          <button id="yr-prev" ${years.indexOf(Y) <= 0 ? 'disabled' : ''}>◀</button>
          <select id="yr-select">${years.slice().reverse().map(y => `<option value="${y}" ${y === Y ? 'selected' : ''}>${y}년</option>`).join('')}</select>
          <button id="yr-next" ${years.indexOf(Y) >= years.length - 1 ? 'disabled' : ''}>▶</button>
        </div>
      </div>
    </div>

    <div class="subnav sub2" id="yr-subnav">${YR_SUBS.map(([v, l]) =>
      `<button data-sub="${v}" class="${v === YSUB ? 'active' : ''}">${l}</button>`).join('')}</div>

    ${YSUB === 'summary' ? `
    <div class="stat-grid" style="margin-bottom:0;">
        <div class="stat-card clickable" data-goto="income" title="수입 탭으로 이동">
          <div class="label">수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(income)}</div>
          ${cmpSub(income, pIncome, false, cmpNote)}
          ${projected ? `<div class="sub">연말 예상 ${formatCompactWon(projected.income)}원</div>` : ''}
        </div>
        <div class="stat-card clickable" data-goto="expense" title="지출 탭으로 이동">
          <div class="label">지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(expense)}</div>
          ${cmpSub(expense, pExpense, true, cmpNote)}
          ${projected ? `<div class="sub">연말 예상 ${formatCompactWon(projected.expense)}원</div>` : ''}
        </div>
        <div class="stat-card clickable" data-goto="saving" title="순저축 탭으로 이동">
          <div class="label">순익 (쌓인 돈)</div>
          <div class="value" style="color:${net >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(net)}</div>
          ${cmpSub(net, pNet, false, cmpNote)}
          <div class="sub">월 평균 ${formatCompactWon(monthsElapsed ? net / monthsElapsed : 0)}원</div>
        </div>
        <div class="stat-card">
          <div class="label">저축률</div>
          <div class="value" style="color:${rate !== null && rate >= state.goals.savingsRateTarget ? 'var(--net-text)' : 'var(--expense-text)'}">${rate === null ? '—' : rate.toFixed(1) + '%'}</div>
          ${cmpSubPp(rate, state.goals.savingsRateTarget, `목표 ${state.goals.savingsRateTarget}% 대비`)}
          ${cmpSubPp(rate, pRate, `${prevY}년 대비`)}
        </div>
        <div class="stat-card clickable" data-goto="invest" title="투자 탭으로 이동">
          <div class="label">투자원금 이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatKrw(yrInvestTr)}</div>
          ${cmpSub(yrInvestTr, pInvestTr, false, cmpNote)}
          ${income > 0 ? `<div class="sub">수입의 <b>${((yrInvestTr / income) * 100).toFixed(1)}%</b> · 월 평균 ${formatCompactWon(monthsElapsed ? yrInvestTr / monthsElapsed : 0)}원</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="label">비상금 이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatKrw(yrEmgTr)}</div>
          ${cmpSub(yrEmgTr, pEmgTr, false, cmpNote)}
          ${income > 0 ? `<div class="sub">수입의 <b>${((yrEmgTr / income) * 100).toFixed(1)}%</b></div>` : ''}
        </div>
    </div>

    <div class="g">
      <div class="panel s12">
        <div class="panel-title">
          <div>${YMODE === 'pace' ? '페이스 차트' : '흐름 차트'}<span class="pace-tag" id="yr-pace-tag"></span></div>
          <div class="range-toggle" id="yr-mode">
            <button data-m="pace" class="${YMODE === 'pace' ? 'active' : ''}">페이스</button>
            <button data-m="flow" class="${YMODE === 'flow' ? 'active' : ''}">월별</button>
          </div>
        </div>
        ${YMODE === 'pace' ? `<div class="axis-bar">
          <div class="axis-btns" id="yr-axis-btns">
            ${FLOW_AXES.map(a => `<button data-axis="${a.key}" class="axis-btn ${state.yearAxis === a.key ? 'on' : ''}" style="--ac:${a.color}">
              <i></i>${a.label}
            </button>`).join('')}
          </div>
          <div class="series-toggles" id="yr-series-toggles" style="margin-bottom:0;">
            ${YEAR_OPTS.filter(sr => sr.key !== 'budget' || state.yearAxis === 'expense').map(sr => `<label class="series-chk ${state.yearOpts[sr.key] ? 'on' : ''}">
              <input type="checkbox" data-key="${sr.key}" ${state.yearOpts[sr.key] ? 'checked' : ''} />
              <i style="background:${sr.color}"></i>${sr.label}
            </label>`).join('')}
          </div>
        </div>` : ''}
        <div class="chart-wrap tall"><canvas id="chart-year"></canvas></div>
        <div class="chart-legend" id="yr-legend"></div>
      </div>
    </div>` : ''}

    ${YSUB !== 'summary' ? `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(146px,1fr));margin-bottom:12px;" id="yr-sub-stats"></div>
    <div class="g">
      <div class="panel ${YSUB === 'income' ? 's8' : 's12'}">
        <div class="panel-title"><div>${YSUB === 'invest' ? '월별 평가액' : '월별 추이'}</div><span class="ptag">${Y}년 1–12월</span></div>
        <div class="chart-wrap tall"><canvas id="chart-yr-sub"></canvas></div>
        <div class="chart-legend" id="yr-sub-legend"></div>
      </div>
      ${YSUB === 'income' ? `
      <div class="panel s4">
        <div class="panel-title"><div>수입처 비중</div><span class="ptag">${Y}년</span></div>
        <div class="chart-wrap" style="min-height:230px;"><canvas id="chart-yr-pie"></canvas></div>
      </div>` : ''}
    </div>
    ${YSUB !== 'saving' ? `
    <div class="g">
      <div class="panel s12" id="yr-topsrc-panel">
        <div class="panel-title">
          <div>${YSUB === 'income' ? '주요 수입 사용처' : YSUB === 'expense' ? '주요 지출처' : '주요 수익처'}</div>
          <span class="ptag">${Y}년 · 합계의 ${YR_TOP_PCT}% 이상</span>
        </div>
        <div id="yr-topsrc-body"></div>
      </div>
    </div>` : ''}` : ''}
  `;

  document.getElementById('yr-subnav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.yearSub = b.dataset.sub;
    renderPage();
  });

  container.querySelectorAll('.stat-card[data-goto]').forEach(el => el.addEventListener('click', () => {
    state.yearSub = el.dataset.goto;
    renderPage();
  }));

  if (YSUB !== 'summary') { renderYearSubTab(YSUB, Y, data, d, yrRows, YR_TOP_PCT); }

  const drawYear = () => {
    if (state.charts.year) state.charts.year.destroy();
    const mode = YMODE;
    const labels = [];
    for (let i = 1; i <= 12; i++) labels.push(i + '월');
    const get = (arr, mo, k) => { const r = arr.find(x => x.month === mo); return r ? r[k] : 0; };
    const has = (mo) => cur.some(x => x.month === mo && (x.income > 0 || x.expense > 0));
    const inc = [], exp = [], nt = [], pnt = [];
    let ci = 0, ce = 0, cp = 0;
    for (let mo = 1; mo <= 12; mo++) {
      const i0 = get(cur, mo, 'income'), e0 = get(cur, mo, 'expense');
      const p0 = get(prev, mo, 'income') - get(prev, mo, 'expense');
      ci += i0; ce += e0; cp += p0;
      const live = has(mo) || !isThisYear;
      inc.push(mode === 'cum' ? (live ? ci : null) : i0);
      exp.push(mode === 'cum' ? (live ? ce : null) : e0);
      nt.push(mode === 'cum' ? (live ? ci - ce : null) : i0 - e0);
      pnt.push(mode === 'cum' ? cp : p0);
    }
    if (mode === 'pace') {
      const budgetTotal = (() => {
        try {
          const { groups } = buildBudgetTree(data);
          return groups.reduce((a, g) => a + g.items.reduce((x, it) => x + budgetOf(g.name, it.name, it.avg), 0), 0) * 12;
        } catch (e) { return 0; }
      })();
      let ce2 = 0, cp2 = 0, ci2 = 0, cn2 = 0;
      const curCum = [], prevCum = [], incCum = [], netCum = [], budLine = [];
      let lastLive = 0;
      for (let mo = 1; mo <= 12; mo++) {
        const i0 = get(cur, mo, 'income'), e0 = get(cur, mo, 'expense');
        ce2 += e0; ci2 += i0; cn2 += (i0 - e0);
        cp2 += get(prev, mo, 'expense');
        const live = has(mo) || !isThisYear;
        if (live) lastLive = mo;
        curCum.push(live ? ce2 : null);
        incCum.push(live ? ci2 : null);
        netCum.push(live ? cn2 : null);
        prevCum.push(cp2);
        budLine.push(budgetTotal > 0 ? Math.round(budgetTotal / 12 * mo) : null);
      }

      /* 남은 달은 현재 속도로 연장한 '예상' 점선 */
      const proj = (arr) => {
        if (!isThisYear || lastLive <= 0 || lastLive >= 12) return null;
        const base = arr[lastLive - 1];
        if (base === null || base === undefined) return null;
        const perMonth = base / lastLive;
        return arr.map((_, i) => (i < lastLive - 1 ? null : Math.round(perMonth * (i + 1))));
      };
      const pE = proj(curCum), pI = proj(incCum), pN = proj(netCum);

      /* 작년 같은 시점 누적 (수입·순저축도) */
      let pi2 = 0, pn2 = 0;
      const prevInc = [], prevNet = [];
      for (let mo = 1; mo <= 12; mo++) {
        const i0 = get(prev, mo, 'income'), e0 = get(prev, mo, 'expense');
        pi2 += i0; pn2 += (i0 - e0);
        prevInc.push(pi2); prevNet.push(pn2);
      }

      const AX = FLOW_AXES.find(a => a.key === state.yearAxis) || FLOW_AXES[1];
      const O = state.yearOpts;
      const SRC = {
        income: { cum: incCum, prev: prevInc, proj: pI, color: '#4c8c6b', label: '수입' },
        expense: { cum: curCum, prev: prevCum, proj: pE, color: '#c1483f', label: '지출' },
        net: { cum: netCum, prev: prevNet, proj: pN, color: '#9b7fc2', label: '순저축' }
      }[AX.key];

      const curV = lastLive > 0 ? SRC.cum[lastLive - 1] : null;
      const baseV = lastLive > 0 ? SRC.prev[lastLive - 1] : null;
      const tag = document.getElementById('yr-pace-tag');
      if (tag) {
        if (curV === null || baseV === null) tag.textContent = '';
        else {
          const dv = curV - baseV;
          const better = AX.key === 'expense' ? dv < 0 : dv > 0;
          const verb = AX.key === 'expense' ? (dv > 0 ? '더 쓰는' : '덜 쓰는')
                     : AX.key === 'income' ? (dv > 0 ? '더 버는' : '덜 버는')
                     : (dv > 0 ? '더 모으는' : '덜 모으는');
          tag.textContent = `${prevY}년 같은 시점보다 ${wonComma(Math.abs(Math.round(dv)))}원 ${verb} 페이스`;
          tag.style.color = Math.abs(dv) < 1 ? 'var(--text-dim)' : (better ? 'var(--income-text)' : '#d9884f');
        }
      }

      const dsP = [];
      if (AX.key === 'expense' && O.budget && budgetTotal > 0) {
        dsP.push({ type: 'line', label: '예산 페이스', data: budLine, borderColor: '#c9a227',
          borderDash: [2, 3], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0, order: 6, hideLabel: true });
      }
      if (O.prevYear) {
        dsP.push({ type: 'line', label: `${prevY}년 ${SRC.label}`, data: SRC.prev, borderColor: '#9aa3b6',
          borderDash: [7, 4], backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0, tension: .25, order: 5,
          labelColor: '#9aa3b6', labelStep: 999, labelOffset: 14 });
      }
      if (SRC.proj) {
        dsP.push({ type: 'line', label: `예상 ${SRC.label}`, data: SRC.proj, borderColor: SRC.color,
          borderDash: [4, 4], backgroundColor: 'transparent', borderWidth: 1.6, pointRadius: 0, tension: .25,
          spanGaps: true, order: 3, labelColor: SRC.color, labelStep: 999, labelOffset: -14 });
      }
      dsP.push({ type: 'line', label: `${Y}년 누적 ${SRC.label}`, data: SRC.cum, borderColor: SRC.color,
        backgroundColor: hexToRgba(SRC.color, .12), fill: true, borderWidth: 2.6, pointRadius: 2, tension: .25,
        spanGaps: false, order: 1, labelColor: SRC.color, labelStep: 2, labelOffset: -14 });
      document.getElementById('yr-legend').innerHTML = dsP.slice().reverse().map(x =>
        `<span><i style="background:${x.borderColor}"></i>${x.label}</span>`).join('');
      state.charts.year = new Chart(document.getElementById('chart-year'), {
        data: { labels, datasets: dsP },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, right: 12 } },
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.raw === null ? null : ` ${c.dataset.label}: ${formatWon(c.raw)}`) } } },
          scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
        },
        plugins: [valueLabelPlugin]
      });
      return;
    }

    const tag0 = document.getElementById('yr-pace-tag');
    if (tag0) tag0.textContent = '';
    document.getElementById('yr-legend').innerHTML = `
      <span><i style="background:rgba(76,140,107,0.8)"></i>수입</span>
      <span><i style="background:rgba(193,72,63,0.8)"></i>지출</span>
      <span><i style="background:var(--net-fill)"></i>순익</span>
      <span style="color:var(--text-faint)">점선 = ${prevY}년</span>`;
    state.charts.year = new Chart(document.getElementById('chart-year'), {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: '수입', data: inc, backgroundColor: 'rgba(76,140,107,0.75)', borderRadius: 3, labelColor: '#a8d8bf', order: 3 },
          { type: 'bar', label: '지출', data: exp, backgroundColor: 'rgba(193,72,63,0.75)', borderRadius: 3, labelColor: '#f0b8b2', order: 3 },
          { type: 'line', label: '순익', data: nt, borderColor: '#9b7fc2', backgroundColor: 'transparent', tension: 0.25, pointRadius: 2, borderWidth: 2.5, spanGaps: false, labelColor: '#c0a8e0', labelOffset: -14, order: 1 },
          { type: 'line', label: `${prevY}년 순익`, data: pnt, borderColor: 'rgba(154,163,182,.65)', borderDash: [5, 4], backgroundColor: 'transparent', tension: 0.25, pointRadius: 0, borderWidth: 2, hideLabel: true, order: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw === null ? '—' : formatWon(c.raw)}` } } },
        scales: { x: { ticks: MONO_TICK, grid: { display: false } }, y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      },
      plugins: [valueLabelPlugin]
    });
  };

  if (YSUB !== 'summary') {
    const setYear0 = (y) => { state.yearKey = y; renderPage(); };
    document.getElementById('yr-select').addEventListener('change', (e) => setYear0(e.target.value));
    document.getElementById('yr-prev').addEventListener('click', () => { const i = years.indexOf(Y); if (i > 0) setYear0(years[i - 1]); });
    document.getElementById('yr-next').addEventListener('click', () => { const i = years.indexOf(Y); if (i < years.length - 1) setYear0(years[i + 1]); });
    return;
  }

  drawYear();

  const yrToggles = document.getElementById('yr-series-toggles');
  if (yrToggles) yrToggles.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-key]');
    if (!inp) return;
    state.yearOpts[inp.dataset.key] = inp.checked;
    inp.closest('.series-chk').classList.toggle('on', inp.checked);
    drawYear();
  });
  const yrAxisBtns = document.getElementById('yr-axis-btns');
  if (yrAxisBtns) yrAxisBtns.addEventListener('click', (e) => {
    const b = e.target.closest('.axis-btn');
    if (!b || state.yearAxis === b.dataset.axis) return;
    state.yearAxis = b.dataset.axis;
    renderPage();
  });

  document.getElementById('yr-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.yearMode = b.dataset.m;
    renderPage();
  });
  const setYear = (y) => { state.yearKey = y; renderPage(); };
  document.getElementById('yr-select').addEventListener('change', (e) => setYear(e.target.value));
  document.getElementById('yr-prev').addEventListener('click', () => { const i = years.indexOf(Y); if (i > 0) setYear(years[i - 1]); });
  document.getElementById('yr-next').addEventListener('click', () => { const i = years.indexOf(Y); if (i < years.length - 1) setYear(years[i + 1]); });
}


/* ---------------- 올해 하위 탭 (수입 · 지출 · 순저축 · 투자) ----------------
   전부 선택한 연도(1~12월) 스코프. 기간/단위 토글 없이 항상 12개월을 그린다. */

/* 도넛 조각 안에 이름·비중을 직접 그린다 */
const donutLabelPlugin = {
  id: 'donutLabel',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const raw = chart.data.datasets[0].data || [];
    const total = raw.reduce((a, b) => a + (Number(b) || 0), 0);
    if (!total) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      const v = Number(raw[i]) || 0;
      const pct = (v / total) * 100;
      if (pct < 6) return;
      const a = (arc.startAngle + arc.endAngle) / 2;
      const r = (arc.innerRadius + arc.outerRadius) / 2;
      const x = arc.x + Math.cos(a) * r, y = arc.y + Math.sin(a) * r;
      const name = String(chart.data.labels[i] || '');
      ctx.font = '600 10.5px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(12,14,18,0.85)';
      ctx.fillText(name, x + 0.6, y - 5.4);
      ctx.fillText(pct.toFixed(0) + '%', x + 0.6, y + 6.6);
      ctx.fillStyle = '#f4f2ec';
      ctx.fillText(name, x, y - 6);
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.fillText(pct.toFixed(0) + '%', x, y + 6);
    });
    ctx.restore();
  }
};

function yrAssetSeries(assetRows, year, catRe) {
  /* '26년 08월' → { y:'2026', m:8 } */
  const out = Array.from({ length: 12 }, () => null);
  (assetRows || []).forEach(r => {
    const m = String(r.date || '').match(/(\d{2})년\s*(\d{1,2})월/);
    if (!m) return;
    const yy = String(2000 + Number(m[1]));
    if (yy !== year) return;
    if (!catRe.test(String(r.category || ''))) return;
    const mo = Number(m[2]);
    out[mo - 1] = (out[mo - 1] || 0) + (Number(r.amount) || 0);
  });
  return out;
}

function yrStatCard(label, value, subs, color) {
  return `<div class="stat-card">
    <div class="label">${label}</div>
    <div class="value" ${color ? `style="color:${color}"` : ''}>${value}</div>
    ${(subs || []).filter(Boolean).map(x => typeof x === 'string'
      ? (x.trim().startsWith('<div') ? x : `<div class="sub">${x}</div>`)
      : `<div class="sub ${x.tone || ''}">${x.text}</div>`).join('')}
  </div>`;
}

function yrTopSources(rows, valueOf, nameOf, total, pct) {
  const map = {};
  rows.forEach(r => {
    const nm = nameOf(r) || '기타';
    if (!map[nm]) map[nm] = { name: nm, v: 0, n: 0 };
    map[nm].v += valueOf(r);
    map[nm].n += 1;
  });
  const cut = Math.abs(total) * (pct / 100);
  return Object.values(map).filter(x => x.v >= cut && x.v > 0).sort((a, b) => b.v - a.v);
}

function renderYearSubTab(sub, Y, data, d, yrRows, TOP_PCT) {
  const statBox = document.getElementById('yr-sub-stats');
  const topBox = document.getElementById('yr-topsrc-body');
  const ctx = document.getElementById('chart-yr-sub');
  if (!statBox || !ctx) return;
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '월');
  const isThisYear = Y === String(new Date().getFullYear());
  const thruMonth = isThisYear ? (new Date().getMonth() + 1) : 12;
  const netOfR = (r) => r.amount - (r.refund || 0);
  const moOf = (r) => { const mk = ledgerMonthKey(r.date) || ''; return Number(mk.slice(5)) || 0; };
  const bucket = (rows, valueOf) => {
    const a = Array.from({ length: 12 }, () => 0);
    rows.forEach(r => { const m = moOf(r); if (m >= 1 && m <= 12) a[m - 1] += valueOf(r); });
    return a;
  };
  const live = (arr) => arr.map((v, i) => (isThisYear && i + 1 > thruMonth) ? null : v);
  const cumOf = (arr) => { let c = 0; return arr.map((v, i) => { if (v === null) return null; c += v; return c; }); };
  const monthsWith = (arr) => arr.filter(v => v !== null && v !== 0).length || thruMonth;
  /* ---- 다른 연도와의 비교 기준 ---- */
  const allLedger = data.ledger || [];
  const yearsAvail = [...new Set(allLedger.map(r => (ledgerMonthKey(r.date) || '').slice(0, 4)).filter(Boolean))].sort();
  const cap = isThisYear ? thruMonth : null;
  const rowsOfYear = (y) => allLedger.filter(r => {
    const mk = ledgerMonthKey(r.date) || '';
    if (mk.slice(0, 4) !== y) return false;
    return cap ? (Number(mk.slice(5)) <= cap) : true;
  });
  const prevY = String(Number(Y) - 1);
  const prevRows = rowsOfYear(prevY);
  const priorYears = yearsAvail.filter(y => Number(y) < Number(Y));
  const priorSets = priorYears.map(y => ({ y, rows: rowsOfYear(y) }));
  const capNote = cap ? `1–${cap}월 기준` : '연간 기준';
  const pvNote = `${prevY}년 ${cap ? `1–${cap}월 ` : ''}대비`;
  /* 과거 연도 평균 — 값이 0인 해(데이터 없음)는 제외 */
  const priorAvg = (fn) => {
    const vs = priorSets.map(x => fn(x.rows)).filter(v => isFinite(v) && v !== 0);
    return vs.length ? { v: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length } : null;
  };
  const avgSub = (cur, fn, invert) => {
    const a = priorAvg(fn);
    if (!a) return '';
    return cmpSub(cur, a.v, !!invert, `직전 ${a.n}년 평균 대비`);
  };
  const nMonthsOf = (rows, pred) => new Set(rows.filter(pred).map(moOf).filter(m => m >= 1 && m <= 12)).size || 1;

  if (state.charts.yrSub) { state.charts.yrSub.destroy(); state.charts.yrSub = null; }
  if (state.charts.yrPie) { state.charts.yrPie.destroy(); state.charts.yrPie = null; }
  const PALETTE = ['#4c8c6b', '#c9a227', '#c2749b', '#7b7fd0', '#c1483f', '#39a8bd', '#d9884f'];
  const legendBox = document.getElementById('yr-sub-legend');
  const mkChart = (datasets, opts) => {
    if (legendBox) legendBox.innerHTML = datasets.filter(x => !x.hideLegend).map(x =>
      `<span><i style="background:${x.borderColor || x.backgroundColor}"></i>${x.label}</span>`).join('');
    state.charts.yrSub = new Chart(ctx, {
      data: { labels, datasets },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20, right: 6 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.raw === null ? null : ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: {
          x: { stacked: true, ticks: MONO_TICK, grid: { display: false } },
          y: { stacked: true, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT },
          y2: { position: 'right', ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: { display: false } }
        }
      }, opts || {}),
      plugins: [valueLabelPlugin]
    });
  };
  const cumDs = (arr, color, label) => ({
    type: 'line', label, data: cumOf(arr), borderColor: color, backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 2, tension: .25, spanGaps: false, yAxisID: 'y2',
    hideLabel: true, order: 0
  });

  /* ---------- 수입 ---------- */
  if (sub === 'income') {
    const inc = yrRows.filter(r => r.major.includes('수입'));
    const total = inc.reduce((a, r) => a + r.amount, 0);
    const by = (kw) => inc.filter(r => String(r.minor || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
    const work = by('근로'), invest = by('투자'), side = by('부수입');
    const etc = total - work - invest - side;
    const monthly = live(bucket(inc, r => r.amount));
    const nMonths = monthsWith(monthly);
    const nonWork = total - work;
    const incOf = (rows, kw) => rows.filter(r => r.major.includes('수입') && (!kw || String(r.minor || '').includes(kw))).reduce((a, r) => a + r.amount, 0);
    const incAvgOf = (rows) => { const t = incOf(rows); const n = nMonthsOf(rows, r => r.major.includes('수입')); return n ? t / n : 0; };
    const shareOf = (rows) => { const t = incOf(rows); return t ? ((t - incOf(rows, '근로')) / t) * 100 : null; };
    const pTotal = incOf(prevRows), pWork = incOf(prevRows, '근로'), pInv = incOf(prevRows, '투자'), pSide = incOf(prevRows, '부수입');
    statBox.innerHTML = [
      yrStatCard('수입 합계', formatWon(total),
        [cmpSub(total, pTotal, false, pvNote), avgSub(total, incOf, false), `${capNote} · 월 평균 ${formatCompactWon(nMonths ? total / nMonths : 0)}원`], 'var(--income-text)'),
      yrStatCard('월 평균', formatWon(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(incAvgOf(prevRows)), false, pvNote), avgSub(Math.round(nMonths ? total / nMonths : 0), (rows) => Math.round(incAvgOf(rows)), false), `${nMonths}개월 기준`]),
      yrStatCard('근로소득', formatWon(work),
        [cmpSub(work, pWork, false, pvNote), `전체의 <b>${total ? ((work / total) * 100).toFixed(0) : 0}%</b> · 작년 ${pTotal ? ((pWork / pTotal) * 100).toFixed(0) + '%' : '—'}`]),
      yrStatCard('투자수익', formatWon(invest),
        [cmpSub(invest, pInv, false, pvNote), avgSub(invest, (rows) => incOf(rows, '투자'), false), `전체의 <b>${total ? ((invest / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('부수입', formatWon(side),
        [cmpSub(side, pSide, false, pvNote), `전체의 <b>${total ? ((side / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('그 외', formatWon(etc),
        [cmpSub(etc, pTotal - pWork - pInv - pSide, false, pvNote), `전체의 <b>${total ? ((etc / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('근로 외 수입 비중', (total ? ((nonWork / total) * 100).toFixed(1) : '0.0') + '%',
        [cmpSubPp(total ? (nonWork / total) * 100 : null, shareOf(prevRows), pvNote),
         { text: `근로 외 <b>${formatCompactWon(nonWork)}원</b> — 월급 밖에서 버는 힘`, tone: (total && nonWork / total >= 0.3) ? 'good' : '' }], 'var(--net-text)')
    ].join('');

    /* 색은 '이번달 › 수입'과 같은 표를 쓴다 — 화면을 옮겨도 같은 분류는 같은 색 */
    const incCmap = incomeCatColorMap(data.ledger);
    const incOrder = incomeTaxonomy(data.ledger).map(g => g.cat);
    const cats = [...new Set(inc.map(r => r.minor || '기타'))]
      .sort((a, b) => (incOrder.indexOf(a) + 1 || 99) - (incOrder.indexOf(b) + 1 || 99));
    const ds = cats.map((c) => ({
      type: 'bar', label: c, stack: 'inc',
      data: live(bucket(inc.filter(r => (r.minor || '기타') === c), r => r.amount)),
      backgroundColor: incomeCatColorOf(incCmap, c), borderRadius: 2, order: 3, hideLabel: true
    }));
    ds.push(Object.assign(cumDs(monthly, '#eae8e0', '누적 수입'), { hideLegend: false }));
    mkChart(ds);

    const pieData = cats.map(c => inc.filter(r => (r.minor || '기타') === c).reduce((a, r) => a + r.amount, 0));
    const pieCtx = document.getElementById('chart-yr-pie');
    if (pieCtx) state.charts.yrPie = new Chart(pieCtx, {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: pieData, backgroundColor: cats.map(c => incomeCatColorOf(incCmap, c)), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '46%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatWon(c.raw)}` } } } },
      plugins: [donutLabelPlugin]
    });

    const tops = yrTopSources(inc, r => r.amount, r => (r.vendor || r.item || '기타').split('›').pop().trim(), total, TOP_PCT);
    if (topBox) topBox.innerHTML = renderYrTopList(tops, total, 'var(--income-text)', TOP_PCT, '수입');
    return;
  }

  /* ---------- 지출 ---------- */
  if (sub === 'expense') {
    const exp = yrRows.filter(r => r.major.includes('지출'));
    const total = exp.reduce((a, r) => a + netOfR(r), 0);
    const fixed = exp.filter(r => r.fixed).reduce((a, r) => a + netOfR(r), 0);
    const regret = exp.filter(r => r.regret).reduce((a, r) => a + netOfR(r), 0);
    const refund = exp.reduce((a, r) => a + (r.refund || 0), 0);
    const monthly = live(bucket(exp, netOfR));
    const nMonths = monthsWith(monthly);
    const fixedMonthly = live(bucket(exp.filter(r => r.fixed), netOfR));
    const expOf = (rows, f) => rows.filter(r => r.major.includes('지출') && (!f || f(r))).reduce((a, r) => a + netOfR(r), 0);
    const expAvgOf = (rows) => { const t = expOf(rows); const n = nMonthsOf(rows, r => r.major.includes('지출')); return n ? t / n : 0; };
    const fixAvgOf = (rows) => { const t = expOf(rows, r => r.fixed); const n = nMonthsOf(rows, r => r.major.includes('지출')); return n ? t / n : 0; };
    const pTotal = expOf(prevRows), pFixed = expOf(prevRows, r => r.fixed), pRegret = expOf(prevRows, r => r.regret);
    const pRefund = prevRows.filter(r => r.major.includes('지출')).reduce((a, r) => a + (r.refund || 0), 0);
    statBox.innerHTML = [
      yrStatCard('지출 합계', formatWon(total),
        [cmpSub(total, pTotal, true, pvNote), avgSub(total, expOf, true), `${capNote} · 월 평균 ${formatCompactWon(nMonths ? total / nMonths : 0)}원`], 'var(--expense-text)'),
      yrStatCard('월 평균 지출', formatWon(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(expAvgOf(prevRows)), true, pvNote), avgSub(Math.round(nMonths ? total / nMonths : 0), (rows) => Math.round(expAvgOf(rows)), true), `${nMonths}개월 기준`]),
      yrStatCard('고정비', formatWon(fixed),
        [cmpSub(fixed, pFixed, true, pvNote), cmpSubPp(total ? (fixed / total) * 100 : null, pTotal ? (pFixed / pTotal) * 100 : null, '지출 내 비중 변화'), `지출의 <b>${total ? ((fixed / total) * 100).toFixed(0) : 0}%</b>`]),
      yrStatCard('월 평균 고정비', formatWon(Math.round(nMonths ? fixed / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? fixed / nMonths : 0), Math.round(fixAvgOf(prevRows)), true, pvNote), `매달 반드시 나가는 돈 — 줄면 구조가 가벼워짐`]),
      yrStatCard('아낄 수 있었던 소비', formatWon(regret),
        [cmpSub(regret, pRegret, true, pvNote), { text: `지출의 <b>${total ? ((regret / total) * 100).toFixed(1) : 0}%</b> · 작년 ${pTotal ? ((pRegret / pTotal) * 100).toFixed(1) + '%' : '—'}`, tone: (pTotal && total && (regret / total) <= (pRegret / pTotal)) ? 'good' : 'warn' }], '#e6b48f'),
      yrStatCard('회사 환급', formatWon(refund),
        [cmpSub(refund, pRefund, false, pvNote), `이미 지출에서 차감된 금액`], 'var(--income-text)')
    ].join('');
    mkChart([
      { type: 'bar', label: '지출', data: monthly, backgroundColor: 'rgba(193,72,63,0.75)', borderRadius: 2, stack: 'e', order: 3, hideLabel: true },
      { type: 'bar', label: '고정비', data: fixedMonthly, backgroundColor: 'rgba(154,163,182,0.55)', borderRadius: 2, stack: 'f', order: 4, hideLabel: true },
      Object.assign(cumDs(monthly, '#eae8e0', '누적 지출'), { hideLegend: false })
    ]);
    const tops = yrTopSources(exp, netOfR, r => (r.vendor || r.item || '기타').split('›').pop().trim(), total, TOP_PCT);
    if (topBox) topBox.innerHTML = renderYrTopList(tops, total, 'var(--expense-text)', TOP_PCT, '지출');
    return;
  }

  /* ---------- 순저축 ---------- */
  if (sub === 'saving') {
    const inc = yrRows.filter(r => r.major.includes('수입'));
    const exp = yrRows.filter(r => r.major.includes('지출'));
    const incM = bucket(inc, r => r.amount), expM = bucket(exp, netOfR);
    const netM = live(incM.map((v, i) => v - expM[i]));
    const total = netM.reduce((a, v) => a + (v || 0), 0);
    const incTot = inc.reduce((a, r) => a + r.amount, 0);
    const nMonths = monthsWith(netM);
    const trTot = yrRows.filter(r => r.major.includes('이체')).reduce((a, r) => a + r.amount, 0);
    const activeM = incM.map((v, i) => (v !== 0 || expM[i] !== 0));
    const best = netM.reduce((a, v, i) => (v !== null && activeM[i] && (a === null || v > netM[a])) ? i : a, null);
    const netOfYear = (rows) => rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0)
      - rows.filter(r => r.major.includes('지출')).reduce((a, r) => a + netOfR(r), 0);
    const netAvgOf = (rows) => { const n = nMonthsOf(rows, r => r.major.includes('수입') || r.major.includes('지출')); return n ? netOfYear(rows) / n : 0; };
    const rateOf = (rows) => { const i = rows.filter(r => r.major.includes('수입')).reduce((a, r) => a + r.amount, 0); return i > 0 ? (netOfYear(rows) / i) * 100 : null; };
    const trOf = (rows) => rows.filter(r => r.major.includes('이체')).reduce((a, r) => a + r.amount, 0);
    const pNetY = netOfYear(prevRows);
    const curRate = incTot > 0 ? (total / incTot) * 100 : null;
    statBox.innerHTML = [
      yrStatCard('순저축 합계', formatWon(total),
        [cmpSub(total, pNetY, false, pvNote), avgSub(total, netOfYear, false), `${capNote} · 수입 ${formatCompactWon(incTot)} − 지출 ${formatCompactWon(incTot - total)}`], total >= 0 ? 'var(--net-text)' : 'var(--expense-text)'),
      yrStatCard('월 평균 순저축', formatWon(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(netAvgOf(prevRows)), false, pvNote), avgSub(Math.round(nMonths ? total / nMonths : 0), (rows) => Math.round(netAvgOf(rows)), false), `${nMonths}개월 기준`]),
      yrStatCard('저축률', curRate === null ? '—' : curRate.toFixed(1) + '%',
        [cmpSubPp(curRate, rateOf(prevRows), pvNote),
         { text: `목표 ${state.goals.savingsRateTarget}% 대비 ${curRate === null ? '—' : (curRate - state.goals.savingsRateTarget).toFixed(1) + '%p'}`, tone: curRate !== null && curRate >= state.goals.savingsRateTarget ? 'good' : 'warn' }]),
      yrStatCard('자산으로 옮긴 돈', formatWon(trTot),
        [cmpSub(trTot, trOf(prevRows), false, pvNote), `순저축의 <b>${total > 0 ? ((trTot / total) * 100).toFixed(0) + '%' : '—'}</b> · 나머지는 통장에 남음`], 'var(--transfer-text)'),
      yrStatCard('가장 많이 모은 달', best === null ? '—' : (best + 1) + '월', [best === null ? '' : formatWon(netM[best]) + ' 저축'])
    ].join('');
    mkChart([
      { type: 'bar', label: '월 순저축', data: netM, backgroundColor: netM.map(v => (v || 0) >= 0 ? 'rgba(57,168,189,0.75)' : 'rgba(193,72,63,0.75)'), borderRadius: 2, order: 3, hideLabel: true },
      Object.assign(cumDs(netM, '#eae8e0', '누적 순저축'), { hideLegend: false })
    ]);
    return;
  }

  /* ---------- 투자 ---------- */
  if (sub === 'invest') {
    const inv = yrRows.filter(r => r.major.includes('수입') && String(r.minor || '').includes('투자'));
    const total = inv.reduce((a, r) => a + r.amount, 0);
    const itemSum = (kw) => inv.filter(r => String(r.item || '').includes(kw)).reduce((a, r) => a + r.amount, 0);
    const sale = itemSum('판매수익'), dividend = itemSum('배당'), interest = itemSum('이자');
    const principal = yrRows.filter(r => r.major.includes('이체') && String(r.minor || '').includes('투자')).reduce((a, r) => a + r.amount, 0);
    const t = analyzeCapitalGainsTax(data.ledger || []);
    const taxPaid = t.paid[Y] || 0;
    const taxRow = t.rows.find(x => x.year === Y);
    const valSeries = yrAssetSeries(data.assetRows, Y, /투자/);
    const first = valSeries.find(v => v !== null && v !== undefined);
    const lastIdx = valSeries.reduce((a, v, i) => v !== null ? i : a, -1);
    const last = lastIdx >= 0 ? valSeries[lastIdx] : null;
    const ytdPL = (first !== undefined && first !== null && last !== null && lastIdx >= 0) ? (last - first - principal) : null;
    const monthly = live(bucket(inv, r => r.amount));
    const nMonths = monthsWith(monthly);
    const invOf = (rows, kw) => rows.filter(r => r.major.includes('수입') && String(r.minor || '').includes('투자') && (!kw || String(r.item || '').includes(kw))).reduce((a, r) => a + r.amount, 0);
    const invAvgOf = (rows) => { const n = nMonthsOf(rows, r => r.major.includes('수입') && String(r.minor || '').includes('투자')); return n ? invOf(rows) / n : 0; };
    const prinOf = (rows) => rows.filter(r => r.major.includes('이체') && String(r.minor || '').includes('투자')).reduce((a, r) => a + r.amount, 0);
    const pTotal = invOf(prevRows), pSale = invOf(prevRows, '판매수익'), pDiv = invOf(prevRows, '배당'), pPrin = prinOf(prevRows);
    const pTax = t.paid[prevY] || 0;
    /* 작년 같은 시점 평가손익 */
    const pVal = yrAssetSeries(data.assetRows, prevY, /투자/);
    const pFirst = pVal.find(v => v !== null && v !== undefined);
    const pCapIdx = (cap ? cap : 12) - 1;
    let pLastIdx = -1; for (let i = 0; i <= pCapIdx; i++) if (pVal[i] !== null) pLastIdx = i;
    const pYtdPL = (pFirst != null && pLastIdx >= 0) ? (pVal[pLastIdx] - pFirst - pPrin) : null;
    statBox.innerHTML = [
      yrStatCard('투자수익 합계', formatWon(total),
        [cmpSub(total, pTotal, false, pvNote), avgSub(total, invOf, false), `${capNote} · 판매 ${formatCompactWon(sale)} · 배당 ${formatCompactWon(dividend)}`], total >= 0 ? 'var(--income-text)' : 'var(--expense-text)'),
      yrStatCard('월 평균 투자수익', formatWon(Math.round(nMonths ? total / nMonths : 0)),
        [cmpSub(Math.round(nMonths ? total / nMonths : 0), Math.round(invAvgOf(prevRows)), false, pvNote), `${nMonths}개월 기준`]),
      yrStatCard('판매수익', formatWon(sale),
        [cmpSub(sale, pSale, false, pvNote), `실현손익 · 양도세 과세 대상`]),
      yrStatCard('배당금', formatWon(dividend),
        [cmpSub(dividend, pDiv, false, pvNote), avgSub(dividend, (rows) => invOf(rows, '배당'), false), `이자 ${formatCompactWon(interest)}원 별도`]),
      yrStatCard('세금', formatWon(taxPaid),
        [cmpSub(taxPaid, pTax, true, `${prevY}년 납부액 대비`), taxRow ? `${Y}년 실현손익 기준 예상 ${formatCompactWon(Math.round(taxRow.est))}원` : '해당 연도 납부 내역'], 'var(--expense-text)'),
      yrStatCard('올해 누적 원금', formatWon(principal),
        [cmpSub(principal, pPrin, false, pvNote), avgSub(principal, prinOf, false), `투자 계좌로 새로 넣은 돈`], 'var(--transfer-text)'),
      yrStatCard('연초 대비 평가손익', ytdPL === null ? '—' : formatWon(ytdPL),
        [cmpSub(ytdPL === null ? 0 : ytdPL, pYtdPL, false, `${prevY}년 같은 시점 대비`),
         { text: first == null ? '평가액 스냅샷 부족' : `${formatCompactWon(first)} → ${formatCompactWon(last)} (원금 유입 ${formatCompactWon(principal)} 제외)`, tone: (ytdPL || 0) >= 0 ? 'good' : 'warn' }],
        (ytdPL || 0) >= 0 ? 'var(--net-text)' : 'var(--expense-text)')
    ].join('');
    mkChart([
      { type: 'bar', label: '월말 평가액', data: valSeries, backgroundColor: 'rgba(201,162,39,0.7)', borderRadius: 2, order: 3, hideLabel: true },
      { type: 'line', label: '실현수익 누적', data: cumOf(monthly), borderColor: '#4c8c6b', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, tension: .25, yAxisID: 'y2', hideLabel: true, order: 0 }
    ]);

    const tagOf = {};
    (data.investmentTags || []).forEach(x => { tagOf[x.stock] = (x.tags || []).join(' · '); });
    const nameOf = (r) => (r.vendor || '기타').split('›').pop().trim();
    const tops = yrTopSources(inv, r => r.amount, nameOf, total, TOP_PCT);
    if (topBox) topBox.innerHTML = renderYrTopList(tops, total, 'var(--income-text)', TOP_PCT, '투자수익', tagOf);
    return;
  }
}

function renderYrTopList(rows, total, color, pct, kindLabel, tagOf) {
  if (!rows.length) return `<div class="empty-state">합계의 ${pct}% (${formatCompactWon(Math.round(Math.abs(total) * pct / 100))}원)를 넘는 ${kindLabel}처가 없어요. 고르게 분산돼 있습니다.</div>`;
  const max = Math.max(...rows.map(r => r.v), 1);
  return `<div class="yr-list">
    ${rows.map(r => `<div class="yr-row">
      <span class="yr-y" style="font-family:var(--sans);font-size:12.5px;">${r.name}${tagOf && tagOf[r.name] ? `<em>${tagOf[r.name]}</em>` : `<em>${r.n}건</em>`}</span>
      <span class="yr-track"><i style="width:${(r.v / max) * 100}%;background:${color}"></i></span>
      <span class="yr-net" style="color:${color}">${formatCompactWon(r.v)}</span>
      <span class="yr-rate">${total ? ((r.v / total) * 100).toFixed(0) + '%' : '—'}</span>
    </div>`).join('')}
    <div class="settings-note">합계의 <b>${pct}%</b> 이상만 노출 · ${rows.length}곳이 전체의 <b>${total ? ((rows.reduce((a, r) => a + r.v, 0) / total) * 100).toFixed(0) : 0}%</b>를 차지합니다.</div>
  </div>`;
}

/* ---------------- page: 캘린더 (수입·지출·이체 한눈에) ---------------- */

const DETAIL_GROUPS = [
  ['수입', '수입', 'income'],
  ['지출', '지출', 'expense'],
  ['이체', '이체', 'transfer']
];

const CAL_MODES = [
  ['all', '전체'],
  ['expense', '지출'],
  ['income', '수입'],
  ['transfer', '이체']
];

/* 캘린더 셀: 축약하지 않고 전체 금액을 콤마 표기로 보여준다. */
function formatCalWon(n) {
  const neg = n < 0;
  const abs = Math.round(Math.abs(n));
  return (neg ? '-' : '') + abs.toLocaleString('ko-KR');
}

function calHeatColor(mode, ratio) {
  const a = (0.08 + 0.40 * ratio).toFixed(2);
  if (mode === 'income') return `rgba(76,140,107,${a})`;
  if (mode === 'transfer') return `rgba(57,168,189,${a})`;
  return `rgba(193,72,63,${a})`;
}

function renderCalendarPage(container, data, d) {
  const ledger = data.ledger || [];
  if (!ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 캘린더를 만들 수 없어요.</div></div>';
    return;
  }

  const availableKeys = [...new Set(ledger.map(r => ledgerMonthKey(r.date)).filter(Boolean))].sort();
  if (!state.calMonthKey || !availableKeys.includes(state.calMonthKey)) {
    const t = thisMonthKey();
    state.calMonthKey = availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1];
  }
  const monthKey = state.calMonthKey;
  const [Y, MO] = monthKey.split('-').map(Number);
  const M = buildNowMonth(ledger, monthKey);
  const mode = 'all';
  const realToday = todayDayKey();
  const isThisMonth = monthKey === thisMonthKey();

  /* 선택된 날: 이 달에 속하지 않으면 오늘(또는 마지막 기록일)로 리셋 */
  const dayKeyFor = (day) => `${Y}-${pad2(MO)}-${pad2(day)}`;
  const recordedDays = M.daily.filter(b => b.rows.length).map(b => b.day);
  if (!state.calSelDay || state.calSelDay.slice(0, 7) !== monthKey) {
    state.calSelDay = isThisMonth
      ? realToday
      : dayKeyFor(recordedDays.length ? recordedDays[recordedDays.length - 1] : 1);
  }
  const selDay = state.calSelDay;
  const selBucket = M.daily[parseInt(selDay.slice(8), 10) - 1] || { income: 0, expense: 0, transfer: 0, rows: [] };

  const mIncome = M.daily.reduce((a, b) => a + b.income, 0);
  const mExpense = M.daily.reduce((a, b) => a + b.expense, 0);
  const mTransfer = M.daily.reduce((a, b) => a + b.transfer, 0);
  const recordDays = recordedDays.length;
  const elapsed = Math.max(elapsedDaysOf(monthKey), 0);
  const noSpendDays = M.daily.filter(b => b.day <= (isThisMonth ? elapsed : M.days) && b.expense === 0).length;

  const metricOf = (b) => mode === 'income' ? b.income : mode === 'transfer' ? b.transfer : b.expense;
  const maxMetric = Math.max(...M.daily.map(b => Math.abs(metricOf(b))), 1);

  const monthOptions = availableKeys.slice().reverse()
    .map(k => `<option value="${k}" ${k === monthKey ? 'selected' : ''}>${monthKeyLabel(k)}</option>`).join('');

  /* --- 캘린더 셀 --- */
  const firstDow = new Date(Y, MO - 1, 1).getDay();
  const lead = firstDow === 0 ? 6 : firstDow - 1;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="mcal-cell blank"></div>');
  M.daily.forEach(b => {
    const k = dayKeyFor(b.day);
    const future = k > realToday;
    const metric = Math.abs(metricOf(b));
    const heat = (state.calHeat !== false && !future && metric > 0) ? `background:${calHeatColor(mode, metric / maxMetric)};` : '';
    const dowCls = b.dow === 0 ? 'sun' : b.dow === 6 ? 'sat' : '';
    const lines = [];
    if (!future) {
      if ((mode === 'all' || mode === 'income') && b.income) lines.push(`<span class="mcal-line inc"><i>수입</i>${formatCalWon(b.income)}</span>`);
      if ((mode === 'all' || mode === 'expense') && b.expense) lines.push(`<span class="mcal-line exp"><i>지출</i>${formatCalWon(b.expense)}</span>`);
      if ((mode === 'all' || mode === 'transfer') && b.transfer) lines.push(`<span class="mcal-line trf"><i>이체</i>${formatCalWon(b.transfer)}</span>`);
      if (!lines.length) lines.push(`<span class="mcal-none">${b.rows.length ? '·' : '기록 없음'}</span>`);
    }
    cells.push(`<div class="mcal-cell ${k === selDay ? 'sel' : ''} ${future ? 'future' : ''} ${k === realToday && k !== selDay ? 'real' : ''}" data-k="${k}" style="${heat}">
      <span class="mcal-daynum ${dowCls}">${b.day}${b.rows.length ? `<span class="cnt">${b.rows.length}건</span>` : ''}</span>
      ${lines.join('')}
    </div>`);
  });

  container.innerHTML = `
    <div class="page-daybar">
      <div class="today-datewrap">
        <div class="day-title">${monthKeyLabel(monthKey)}</div>
        <div class="month-nav">
          <button id="cal-prev" ${availableKeys.indexOf(monthKey) <= 0 ? 'disabled' : ''}>◀</button>
          <select id="cal-month-select">${monthOptions}</select>
          <button id="cal-next" ${availableKeys.indexOf(monthKey) >= availableKeys.length - 1 ? 'disabled' : ''}>▶</button>
          <button class="btn small" id="cal-thismonth">이번 달</button>
          <button class="btn small ${state.calHeat === false ? '' : 'on'}" id="cal-heat">지출 진하기</button>
        </div>
      </div>
    </div>

    <div class="g">
    <div class="panel s7">
      <div class="stat-grid" style="margin-bottom:0;">
        <div class="stat-card">
          <div class="label">수입</div>
          <div class="value" style="color:var(--income-text)">${formatKrw(mIncome)}</div>
        </div>
        <div class="stat-card">
          <div class="label">지출</div>
          <div class="value" style="color:var(--expense-text)">${formatKrw(mExpense)}</div>
        </div>
        <div class="stat-card">
          <div class="label">이체</div>
          <div class="value" style="color:var(--transfer-text)">${formatKrw(mTransfer)}</div>
        </div>
        <div class="stat-card">
          <div class="label">순액</div>
          <div class="value" style="color:${mIncome - mExpense >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(mIncome - mExpense)}</div>
        </div>
      </div>

      <div class="mcal-grid mcal-head">
        ${['월', '화', '수', '목', '금', '토', '일'].map((x, i) => `<div class="mcal-dow ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${x}</div>`).join('')}
      </div>
      <div class="mcal-grid" id="cal-grid">${cells.join('')}</div>
      <div class="mcal-legend">
        <span><i style="background:var(--income-text)"></i>수입</span>
        <span><i style="background:var(--expense-text)"></i>지출</span>
        <span><i style="background:var(--transfer-fill)"></i>이체</span>
        <span><i style="background:var(--panel-2);border:1px dashed var(--gold-soft)"></i>오늘</span>
        <span style="color:var(--text-faint)">${state.calHeat === false ? '날짜 클릭 → 오른쪽 내역' : '진하기 = 지출 규모 · 날짜 클릭 → 오른쪽 내역'}</span>
      </div>
    </div>
    <div class="panel s5" id="panel-cal-day"></div>
    </div>
  `;

  /* --- 선택한 날 상세 --- */
  const dayPanel = document.getElementById('panel-cal-day');
  const selRows = selBucket.rows.slice().sort((a, b) => b.amount - a.amount);
  const selDow = DOW_KR[dowOfDayKey(selDay)];
  dayPanel.innerHTML = `
    <div class="panel-title">
      <div>${dayKeyLabel(selDay)} (${selDow}) <span style="color:var(--text-faint);font-family:var(--mono);font-size:11px;">${selRows.length}건</span></div>
      <div class="month-nav">
        <button id="cal-day-prev">◀</button>
        <button id="cal-day-next" ${selDay >= realToday ? 'disabled' : ''}>▶</button>
        <button class="btn small" id="cal-day-open">오늘 탭에서 보기</button>
      </div>
    </div>
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card"><div class="label">수입</div><div class="value" style="color:var(--income-text)">${formatKrw(selBucket.income)}</div></div>
      <div class="stat-card"><div class="label">지출</div><div class="value" style="color:var(--expense-text)">${formatKrw(selBucket.expense)}</div></div>
      <div class="stat-card"><div class="label">이체</div><div class="value" style="color:var(--transfer-text)">${formatKrw(selBucket.transfer)}</div></div>
      <div class="stat-card"><div class="label">순액</div><div class="value" style="color:${selBucket.income - selBucket.expense >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${formatWon(selBucket.income - selBucket.expense)}</div></div>
    </div>
    <div style="flex:1;overflow-y:auto;">
      ${selRows.length ? DETAIL_GROUPS.map(([gk, gLabel, gCls]) => {
        const rows = selRows.filter(r => r.major.includes(gk));
        if (!rows.length) return '';
        const sum = rows.reduce((a, r) => a + r.amount, 0);
        return `<div class="dtl-group ${gCls}">
          <div class="dtl-group-head ${gCls}"><span>${gLabel} · ${rows.length}건</span><b>${formatKrw(sum)}</b></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>분류</th><th>사용처</th><th>메모</th><th>체크</th><th style="text-align:right">금액</th></tr></thead>
              <tbody>${rows.map(r => `<tr>
                <td class="c-cat">${rxCat(r)}</td>
                <td class="c-vendor">${rxVendor(r)}</td>
                <td>${r.memo ? rxEsc(r.memo) : '<span class="rx-none">·</span>'}</td>
                <td class="c-marks">${rxMarks(r)}</td>
                <td class="amt c-amt">${rxAmount(r)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
      }).join('') : '<div class="empty-state">이 날 기록이 없어요.</div>'}
    </div>
  `;

  const setSel = (k) => {
    if (!k || k > realToday) return;
    if (k.slice(0, 7) !== monthKey) {
      if (!availableKeys.includes(k.slice(0, 7))) return;
      state.calMonthKey = k.slice(0, 7);
    }
    state.calSelDay = k;
    renderPage();
  };
  document.getElementById('cal-day-prev').addEventListener('click', () => setSel(shiftDayKey(selDay, -1)));
  document.getElementById('cal-day-next').addEventListener('click', () => setSel(shiftDayKey(selDay, 1)));
  document.getElementById('cal-day-open').addEventListener('click', () => {
    state.todayDayKey = selDay > realToday ? realToday : selDay;
    goTo('flow', 'today');
  });

  document.getElementById('cal-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('.mcal-cell');
    if (!cell || cell.classList.contains('blank') || cell.classList.contains('future')) return;
    state.calSelDay = cell.dataset.k;
    renderPage();
  });

  /* --- 월 이동 / 모드 --- */
  const setMonth = (k) => { state.calMonthKey = k; state.calSelDay = null; renderPage(); };
  document.getElementById('cal-month-select').addEventListener('change', (e) => setMonth(e.target.value));
  document.getElementById('cal-prev').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i > 0) setMonth(availableKeys[i - 1]);
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    const i = availableKeys.indexOf(monthKey);
    if (i < availableKeys.length - 1) setMonth(availableKeys[i + 1]);
  });
  document.getElementById('cal-heat').addEventListener('click', () => {
    state.calHeat = state.calHeat === false;
    renderPage();
  });
  document.getElementById('cal-thismonth').addEventListener('click', () => {
    const t = thisMonthKey();
    setMonth(availableKeys.includes(t) ? t : availableKeys[availableKeys.length - 1]);
  });
}

/* ---------------- page: 구조 (자산 증식 엔진) ----------------
   "돈이 어디로 들어와서 어디로 빠지고 무엇으로 쌓이는가"를 한 화면에 놓고,
   그 위에 지금 내가 손을 대야 하는 지점을 레버리지 순서로 표시한다.
   임팩트는 모두 '연 환산 원' 단위로 계산해서 서로 직접 비교할 수 있게 만든다. */

const STRUCT_CTRL_W = { '높음': 1, '중간': 0.6, '낮음': 0.2 };
const PENSION_LIMIT = 9000000;    /* 연금저축+IRP 합산 세액공제 납입 한도 */
const PENSION_CREDIT = 0.132;     /* 세액공제율: 총급여 5,500만 초과 13.2% / 이하 16.5% → 보수적으로 13.2% */
const CGT_FREE = 2500000;         /* 해외주식 양도소득 기본공제 */
const CGT_TAX_RATE = 0.22;

function structureTargets(goals) {
  const out = { milestones: [] };
  (goals || []).forEach(g => {
    const t = String(pickGoalField(g, 'title') || '');
    const status = String(pickGoalField(g, 'status') || '');
    const done = /완료|달성/.test(status);
    let m;
    if ((m = t.match(/비상금\s*([\d,]+)\s*만원/))) {
      const v = parseFloat(m[1].replace(/,/g, '')) * 10000;
      out.emergency = Math.max(out.emergency || 0, v);
    }
    if ((m = t.match(/고정비\s*([\d,]+)\s*만원/))) {
      const v = parseFloat(m[1].replace(/,/g, '')) * 10000;
      out.fixed = out.fixed ? Math.min(out.fixed, v) : v;
    }
    if ((m = t.match(/현금\s*비율.*?(\d+(?:\.\d+)?)\s*%/))) out.cashPct = parseFloat(m[1]);
    if ((m = t.match(/총자산\s*([\d.]+)\s*억/)) && !done) out.milestones.push(parseFloat(m[1]) * 100000000);
  });
  out.milestones.sort((a, b) => a - b);
  return out;
}

function buildStructureModel(data, d) {
  const ledger = data.ledger || [];
  const allKeys = [...new Set(ledger.map(r => ledgerMonthKey(r.date)).filter(Boolean))].sort();
  const cur = thisMonthKey();
  const closed = allKeys.filter(k => k < cur);            /* 진행 중인 달은 평균을 왜곡하므로 제외 */
  const win = (closed.length >= 3 ? closed : allKeys).slice(-12);
  const winSet = new Set(win);
  const n = win.length || 1;
  const rows = ledger.filter(r => winSet.has(ledgerMonthKey(r.date)));

  const isInc = r => r.major.includes('수입');
  const isExp = r => r.major.includes('지출');
  const isTrf = r => r.major.includes('이체');
  const isTax = r => CGT_RE.test(`${r.item} ${r.memo} ${r.vendor}`);
  const absSum = (pred) => rows.filter(pred).reduce((a, r) => a + Math.abs(r.amount), 0);
  /* 이체는 출금(음수)도 섞여 있으므로 부호를 살려서 순유입으로 본다 */
  const netSum = (pred) => rows.filter(pred).reduce((a, r) => a + r.amount, 0);

  /* 보너스·퇴직금 같은 일회성 유입이 평균을 끌어올리므로
     '연봉 +5%'처럼 반복성을 가정하는 계산에는 중앙값을 쓴다. */
  const monthlySeries = (pred) => {
    const map = {};
    win.forEach(k => { map[k] = 0; });
    rows.filter(pred).forEach(r => {
      const k = ledgerMonthKey(r.date);
      if (k in map) map[k] += Math.abs(r.amount);
    });
    return win.map(k => map[k]);
  };
  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  };

  const inc = {
    work: absSum(r => isInc(r) && r.minor.includes('근로')),
    side: absSum(r => isInc(r) && r.minor.includes('부수입')),
    invest: absSum(r => isInc(r) && r.minor.includes('투자')),
    etc: absSum(r => isInc(r) && !r.minor.includes('근로') && !r.minor.includes('부수입') && !r.minor.includes('투자'))
  };
  inc.total = inc.work + inc.side + inc.invest + inc.etc;
  const realized = absSum(r => isInc(r) && r.minor.includes('투자') && /판매/.test(r.item));

  const exp = { total: absSum(isExp) };
  exp.tax = absSum(r => isExp(r) && isTax(r));
  exp.fixed = absSum(r => isExp(r) && r.fixed && !isTax(r));
  exp.variable = Math.max(exp.total - exp.tax - exp.fixed, 0);

  const netSave = inc.total - exp.total;
  const saveRate = inc.total ? (netSave / inc.total) * 100 : 0;

  const trf = {
    invest: netSum(r => isTrf(r) && r.minor.includes('투자')),
    pension: netSum(r => isTrf(r) && r.minor.includes('연금')),
    save: netSum(r => isTrf(r) && r.minor.includes('저축')),
    emergency: netSum(r => isTrf(r) && r.minor.includes('비상금'))
  };
  trf.total = trf.invest + trf.pension + trf.save + trf.emergency;

  const alloc = d.allocation || {};
  const stock = {
    invest: alloc['투자 자산'] || 0,
    pension: alloc['연금 자산'] || 0,
    save: alloc['저축 자산'] || 0,
    cash: alloc['현금 자산'] || 0
  };
  stock.total = d.totalAssets || (stock.invest + stock.pension + stock.save + stock.cash);
  const riskAssets = stock.invest + stock.pension;

  /* 복리 루프: 투자 자산만으로 계산한다.
     전체 자산 증감으로 계산하면 퇴직연금(DC) 회사 부담금처럼
     가계부에 수입으로 안 잡히는 외부 유입이 전부 '시장 손익'으로 오인된다. */
  const invByKey = {};
  (data.assetRows || []).forEach(r => {
    if (r.category !== '투자 자산' || r.amount === null) return;
    const k = assetMonthKey(r.date);
    if (!k) return;
    invByKey[k] = (invByKey[k] || 0) + r.amount;
  });
  const numKey = (k) => parseInt(k.replace('-', ''), 10);
  const snapKeys = Object.keys(invByKey).map(Number).sort((a, b) => a - b);
  const endK = snapKeys.filter(k => k <= numKey(win[win.length - 1])).pop();
  const priorK = snapKeys.filter(k => k < numKey(win[0])).pop();
  const loop = { covered: !!(endK && priorK) };
  if (loop.covered) {
    loop.delta = invByKey[endK] - invByKey[priorK];
    loop.contribution = trf.invest;
    loop.market = loop.delta - trf.invest;
  }

  const medWork = median(monthlySeries(r => isInc(r) && r.minor.includes('근로')));
  const medIncome = median(monthlySeries(isInc));

  return {
    win, n, inc, realized, exp, netSave, saveRate, trf, stock, riskAssets, loop,
    medWork, medIncome,
    per: (v) => v / n,
    ann: (v) => (v / n) * 12
  };
}

function buildStructureActions(m, tg, d) {
  const annWork = m.medWork * 12;      /* 중앙값 기준 = 보너스 없는 '평상시' 연 근로소득 */
  const annFixed = m.ann(m.exp.fixed);
  const annVar = m.ann(m.exp.variable);
  const annRealized = m.ann(m.realized);
  const annPension = m.ann(m.trf.pension);
  const pensionRoom = Math.max(0, PENSION_LIMIT - annPension);
  const emgTarget = tg.emergency || state.goals.emergencyFundTarget;

  const A = [];
  A.push({
    node: '근로소득', stage: '유입', control: '중간',
    name: '주 소득 +5% (연봉·직무 이동)', impact: annWork * 0.05,
    short: '연봉 협상·이동',
    todo: `전체 유입의 대부분이 여기서 나옵니다. 1년에 한두 번뿐인 기회지만 한 번의 효과가 지출 절감 몇 달치를 넘습니다.`
  });
  A.push({
    node: '부수입', stage: '유입', control: '높음', assumed: true,
    name: `부수입으로 고정비 덮기 (월 ${formatCompactWon(m.per(m.exp.fixed))}원)`, impact: annFixed,
    short: '부수입으로 고정비 덮기',
    todo: m.inc.side > 0
      ? `현재 부수입 월 ${formatCompactWon(m.per(m.inc.side))}원. 고정비를 부수입으로 덮으면 월급이 흔들려도 구조가 버팁니다.`
      : `유입 채널이 근로소득 하나뿐입니다. 금액보다 '두 번째 채널의 존재' 자체가 구조를 바꿉니다.`
  });
  A.push({
    node: '고정비', stage: '누수', control: '높음',
    name: '고정비 10% 절감', impact: annFixed * 0.1,
    short: '고정비 −10%',
    todo: `월 ${formatCompactWon(m.per(m.exp.fixed))}원. 한 번 끊으면 매달 자동으로 남습니다. 지출 탭 FIXED COSTS에서 항목별로 확인하세요.`
  });
  A.push({
    node: '변동비', stage: '누수', control: '중간',
    name: '변동비 10% 절감', impact: annVar * 0.1,
    short: '변동비 −10%',
    todo: `월 ${formatCompactWon(m.per(m.exp.variable))}원. 매달 의지로 관리해야 하는 영역이라 고정비보다 유지 비용이 큽니다.`
  });
  A.push({
    node: '세금', stage: '누수', control: '높음',
    name: pensionRoom > 0 ? `연금 세액공제 한도 잔여 ${formatCompactWon(pensionRoom)}원 채우기` : '연금 세액공제 한도 소진 완료',
    impact: pensionRoom * PENSION_CREDIT,
    short: pensionRoom > 0 ? '연금 한도 채우기' : '한도 소진 완료',
    todo: pensionRoom > 0
      ? `연 납입 ${formatCompactWon(annPension)}원 / 한도 900만원. 채우는 만큼 13.2~16.5%가 세금에서 즉시 돌아옵니다. 시장 수익률과 달리 확정된 수익입니다.`
      : `한도 900만원을 채웠습니다. 이 이상 납입은 절세 효과가 없으니 위성 계좌로 보내세요.`
  });
  A.push({
    node: '세금', stage: '누수', control: '높음',
    name: '해외주식 기본공제 250만원 매년 소진', impact: Math.min(annRealized, CGT_FREE) * CGT_TAX_RATE,
    short: '250만 공제 쓰기',
    todo: `최근 12개월 실현이익 ${formatCompactWon(annRealized)}원. 연말에 이익을 250만원 안쪽으로 나눠 실현하면 그만큼은 22%가 붙지 않습니다.`
  });
  A.push({
    node: '투자 수익', stage: '유입', control: '낮음',
    name: '수익률 +1%p', impact: m.riskAssets * 0.01,
    short: '수익률 +1%p',
    todo: `투자성 자산 ${formatCompactWon(m.riskAssets)}원 기준. 종목을 잘 고르는 건 통제 밖이고, 실제로 통제되는 건 비용·분산·안 파는 것뿐입니다.`
  });
  A.push({
    node: '비상금', stage: '배분', control: '높음', risk: true,
    name: '비상금 목표 채우기', impact: null,
    short: '비상금 방어선',
    todo: `현재 비상금 ${formatCompactWon(d.emergencyFund)}원 / 목표 ${formatCompactWon(emgTarget)}원. 비상금이 얇으면 하락장에서 투자 자산을 팔아야 하고, 그 순간 이 엔진이 멈춥니다.`
  });

  A.forEach(a => { a.score = (a.impact || 0) * (STRUCT_CTRL_W[a.control] || 0.5); });
  A.sort((a, b) => b.score - a.score);
  A.forEach((a, i) => { a.rank = i + 1; });
  return { list: A, pensionRoom, annPension, emgTarget, annWork, annFixed, annVar, annRealized };
}

function renderStructurePage(container, data, d) {
  if (!data.ledger || !data.ledger.length) {
    container.innerHTML = '<div class="panel full"><div class="empty-state">가계부(D) 데이터를 불러오지 못해 구조를 계산할 수 없어요.</div></div>';
    return;
  }

  const m = buildStructureModel(data, d);
  const tg = structureTargets(data.goals);
  const AC = buildStructureActions(m, tg, d);
  const actByNode = {};
  AC.list.forEach(a => { if (!actByNode[a.node]) actByNode[a.node] = a; });

  /* 다이어그램 위에 올릴 액션 칩: 상위 4순위 + 리스크 방어 항목만 (나머지는 아래 표에서) */
  const chip = (nodeName) => {
    const a = actByNode[nodeName];
    if (!a) return '';
    const showIt = a.rank <= 4 || a.risk;
    if (!showIt) return '';
    const cls = a.risk ? 'risk' : (a.rank === 1 ? 'p1' : '');
    const badge = a.risk ? '방어' : `${a.rank}순위`;
    const gain = a.impact ? ` <b>+연 ${formatCompactWon(a.impact)}원</b>` : '';
    return `<div class="eng-act ${cls}"><span class="rk">${badge}</span>${a.short}${gain}</div>`;
  };

  const node = (o) => {
    const pctTxt = (o.pct === null || o.pct === undefined) ? '' : `<span class="pct">${o.pct.toFixed(0)}%</span>`;
    const bar = (o.pct === null || o.pct === undefined) ? '' : `<div class="eng-bar"><i class="${o.tone || ''}" style="width:${Math.min(Math.max(o.pct, 0), 100)}%"></i></div>`;
    const chipHtml = chip(o.nm);
    return `<div class="eng-node ${o.cls || ''} ${(o.amount || chipHtml) ? '' : 'zero'}" title="${formatWon(o.amount)}">
      <div class="eng-node-top"><span class="nm">${o.nm}</span>${pctTxt}</div>
      <div class="eng-amt ${o.tone || ''}">${formatCompactWon(o.amount)}원</div>
      ${bar}
      ${o.sub ? `<div class="eng-sub">${o.sub}</div>` : ''}
      ${chipHtml}
    </div>`;
  };

  const pctOf = (v, t) => (t ? (v / t) * 100 : 0);
  const winLabel = `${monthKeyLabel(m.win[0])} ~ ${monthKeyLabel(m.win[m.win.length - 1])}`;

  /* --- 복리 루프 문구 --- */
  const annIncome = m.medIncome * 12;   /* 일회성 유입이 낀 달을 빼기 위해 중앙값 사용 */
  const crossPct = annIncome ? (m.riskAssets / annIncome) * 100 : 0;
  const nextMile = (tg.milestones || []).find(v => v > m.stock.total);
  const annNet = m.ann(m.netSave);
  const emgTargetV = AC.emgTarget;
  const cashRatio = m.stock.total ? (d.emergencyFund / m.stock.total) * 100 : 0;
  const workShare = m.inc.total ? (m.inc.work / m.inc.total) * 100 : 0;
  const coreShare = m.riskAssets ? (m.stock.pension / m.riskAssets) * 100 : 0;
  const pensionFill = (AC.annPension / PENSION_LIMIT) * 100;
  const monthlyFixed = m.per(m.exp.fixed);
  const loopC = Math.max(m.loop.contribution, 0);
  const loopK = m.loop.market;
  const engineIsInput = loopC > Math.abs(loopK);

  /* --- 구조 점검 6항목 (통과/미달) --- */
  const checks = [
    { nm: '저축률', cur: `${m.saveRate.toFixed(1)}%`, tgt: `${state.goals.savingsRateTarget}%`, ok: m.saveRate >= state.goals.savingsRateTarget },
    { nm: '월 고정비', cur: formatCompactWon(monthlyFixed), tgt: tg.fixed ? formatCompactWon(tg.fixed) : '—', ok: tg.fixed ? monthlyFixed <= tg.fixed : null },
    { nm: '비상금', cur: formatCompactWon(d.emergencyFund), tgt: formatCompactWon(emgTargetV), ok: d.emergencyFund >= emgTargetV },
    { nm: '현금 비율', cur: `${cashRatio.toFixed(1)}%`, tgt: tg.cashPct ? `${tg.cashPct}%` : '—', ok: tg.cashPct ? cashRatio >= tg.cashPct : null },
    { nm: '연금 한도', cur: `${Math.max(pensionFill, 0).toFixed(0)}%`, tgt: '100%', ok: pensionFill >= 100 },
    { nm: '유입 집중도', cur: `${workShare.toFixed(0)}%`, tgt: '≤90%', ok: workShare <= 90 }
  ];
  const failCount = checks.filter(c => c.ok === false).length;

  const risk = AC.list.find(a => a.risk && !(d.emergencyFund >= emgTargetV));

  /* ================= 시뮬레이터 =================
     레버 6개를 조정하면 순저축이 바뀌고, 그게 20년 자산 곡선에 반영된다.
     현재값 = 최근 n개월 월평균. 레버는 '얼마로 바꿀지' 절대값으로 입력한다. */
  const LEVERS = [
    { key: 'work',   side: 'in',  nm: '근로소득',   cur: m.per(m.inc.work),     unit: 'won', hint: '연봉 협상·이직' },
    { key: 'side',   side: 'in',  nm: '부수입',     cur: m.per(m.inc.side),     unit: 'won', hint: '두 번째 채널' },
    { key: 'invinc', side: 'in',  nm: '투자 수익',  cur: m.per(m.inc.invest),   unit: 'won', hint: '배당·실현' },
    { key: 'fixed',  side: 'out', nm: '고정비',     cur: m.per(m.exp.fixed),    unit: 'won', hint: '한 번 끊으면 매달' },
    { key: 'var',    side: 'out', nm: '변동비',     cur: m.per(m.exp.variable), unit: 'won', hint: '매달 판단' },
    { key: 'tax',    side: 'out', nm: '세금',       cur: m.per(m.exp.tax),      unit: 'won', hint: '양도세·연금공제' }
  ];
  const RET = { key: 'ret', nm: '연 수익률', cur: 6, unit: 'pct', hint: '투자성 자산 기대수익' };

  if (!state.simLevers) state.simLevers = {};
  const lvVal = (k, def) => (state.simLevers[k] === undefined || state.simLevers[k] === null || state.simLevers[k] === '')
    ? def : Number(state.simLevers[k]);

  const simNow = () => {
    const inc = LEVERS.filter(l => l.side === 'in').reduce((a, l) => a + lvVal(l.key, l.cur), 0);
    const out = LEVERS.filter(l => l.side === 'out').reduce((a, l) => a + lvVal(l.key, l.cur), 0);
    return { inc, out, net: inc - out, ret: lvVal('ret', RET.cur) / 100 };
  };
  const baseNet = m.per(m.netSave);
  const startAssets = m.stock.total;

  /* 월 복리 시뮬 (연 수익률은 투자성 자산 비중만큼만 적용) */
  const riskShare = m.stock.total ? Math.min(m.riskAssets / m.stock.total, 1) : 0;
  const project = (monthlyNet, annualRet, years) => {
    const r = Math.pow(1 + annualRet * riskShare, 1 / 12) - 1;
    const out = [startAssets];
    let v = startAssets;
    for (let i = 1; i <= years * 12; i++) { v = v * (1 + r) + monthlyNet; out.push(v); }
    return out;
  };

  const drawSim = () => {
    const ctx = document.getElementById('chart-sim');
    if (!ctx) return;
    if (state.charts.sim) state.charts.sim.destroy();
    const yrs = state.simYears || 10;
    const cur = simNow();
    const baseLine = project(baseNet, RET.cur / 100, yrs);
    const simLine = project(cur.net, cur.ret, yrs);
    const labels = baseLine.map((_, i) => (i % 12 === 0 ? `${i / 12}년` : ''));
    const mileLines = (tg.milestones || []).filter(v => v > startAssets).slice(0, 2);
    state.charts.sim = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '지금 이대로', data: baseLine, borderColor: 'rgba(154,163,182,.75)', borderDash: [5, 4], backgroundColor: 'transparent', pointRadius: 0, tension: .25, borderWidth: 2 },
          { label: '레버 적용', data: simLine, borderColor: '#c9a227', backgroundColor: 'rgba(201,162,39,.12)', fill: true, pointRadius: 0, tension: .25, borderWidth: 2.5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (it) => `${(it[0].dataIndex / 12).toFixed(1)}년 후`,
            label: (c) => ` ${c.dataset.label}: ${formatCompactWon(c.raw)}원`
          } },
          annotation: undefined
        },
        scales: {
          x: { ticks: { ...MONO_TICK, autoSkip: false, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      }
    });

    /* 결과 요약 */
    const endBase = baseLine[baseLine.length - 1];
    const endSim = simLine[simLine.length - 1];
    const diff = endSim - endBase;
    const yearsTo = (target) => {
      if (!target) return null;
      const idx = simLine.findIndex(v => v >= target);
      return idx === -1 ? null : (idx / 12);
    };
    const mile = (tg.milestones || []).find(v => v > startAssets);
    document.getElementById('sim-out').innerHTML = `
      <div class="sim-kpi">
        <span><em>${yrs}년 후 자산</em><b>${formatCompactWon(endSim)}원</b></span>
        <span><em>지금 이대로 대비</em><b style="color:${diff >= 0 ? 'var(--net-text)' : 'var(--expense-text)'}">${diff >= 0 ? '+' : '−'}${formatCompactWon(Math.abs(diff))}원</b></span>
        <span><em>월 순저축</em><b style="color:${cur.net >= baseNet ? 'var(--net-text)' : 'var(--expense-text)'}">${formatCompactWon(cur.net)}원</b><i>현재 ${formatCompactWon(baseNet)}</i></span>
        <span><em>저축률</em><b>${cur.inc > 0 ? ((cur.net / cur.inc) * 100).toFixed(1) : '—'}%</b><i>현재 ${m.saveRate.toFixed(1)}%</i></span>
        ${mile ? `<span><em>${formatCompactWon(mile)}원 도달</em><b>${yearsTo(mile) === null ? `${yrs}년 내 미달` : yearsTo(mile).toFixed(1) + '년'}</b></span>` : ''}
      </div>`;
  };

  const leverRow = (l) => {
    const v = lvVal(l.key, l.cur);
    const changed = Math.round(v) !== Math.round(l.cur);
    const delta = v - l.cur;
    const good = l.side === 'in' ? delta > 0 : delta < 0;
    return `<div class="lv ${changed ? (good ? 'up' : 'down') : ''}">
      <span class="lv-nm">${l.nm}<em>${l.hint}</em></span>
      <span class="lv-cur">현재 ${l.unit === 'pct' ? l.cur + '%' : formatCompactWon(l.cur)}</span>
      <span class="lv-in">
        <input type="text" inputmode="numeric" data-lv="${l.key}" value="${l.unit === 'pct' ? v : wonComma(Math.round(v))}" />
        <i>${l.unit === 'pct' ? '%' : '원'}</i>
      </span>
      <span class="lv-delta">${changed ? `${delta > 0 ? '+' : '−'}${l.unit === 'pct' ? Math.abs(delta).toFixed(1) + '%p' : formatCompactWon(Math.abs(delta))}` : '—'}</span>
    </div>`;
  };

  /* 우선순위 액션 (레버리지 통합) */
  const actions = AC.list.slice();
  const goalFor = (a) => {
    const gs = (data.goals || []).filter(g => pickGoalField(g, 'title'));
    const kw = { '고정비': /고정비/, '변동비': /지출/, '세금': /(연금|양도|세금)/, '비상금': /비상금/, '근로소득': /(수입|소득|연봉)/, '투자 수익': /(수익률|투자)/ };
    const re = kw[a.node];
    if (!re) return null;
    const hit = gs.find(g => re.test(String(pickGoalField(g, 'title'))));
    return hit ? { title: pickGoalField(hit, 'title'), status: pickGoalField(hit, 'status') } : null;
  };

  container.innerHTML = `
    <div class="g">
      <div class="panel s6">
        <div class="panel-title">
          <div>자산 시뮬레이션</div>
          <div class="range-toggle" id="sim-years">
            ${[5, 10, 20].map(y => `<button data-y="${y}" class="${(state.simYears || 10) === y ? 'active' : ''}">${y}년</button>`).join('')}
          </div>
        </div>
        <div class="chart-legend" style="margin-bottom:6px;">
          <span><i style="background:rgba(154,163,182,.75)"></i>지금 이대로</span>
          <span><i style="background:var(--accent-fill)"></i>레버 적용</span>
        </div>
        <div class="chart-wrap" style="min-height:250px;"><canvas id="chart-sim"></canvas></div>
        <div id="sim-out"></div>
      </div>

      <div class="panel s3">
        <div class="panel-title"><div>레버</div><button class="btn small" id="sim-reset">되돌리기</button></div>
        <div class="lv-sec inflow"><span>유입 · 월</span></div>
        ${LEVERS.filter(l => l.side === 'in').map(leverRow).join('')}
        <div class="lv-sec leak"><span>누수 · 월</span></div>
        ${LEVERS.filter(l => l.side === 'out').map(leverRow).join('')}
        <div class="lv-sec ret"><span>수익률 · 연</span></div>
        ${leverRow(RET)}
        <div class="settings-note">현재 금액 = <b>마감된 최근 ${m.n}개월(${monthKeyLabel(m.win[0])}–${monthKeyLabel(m.win[m.win.length - 1])})</b> 월평균. 진행 중인 달은 평균을 왜곡해서 제외했어요. 연 수익률만 기본 6% 가정값이고 나머지는 전부 가계부 실적입니다.</div>
      </div>

      <div class="panel s3">
        <div class="panel-title"><div>지금 할 일</div><span class="ptag">임팩트순</span></div>
        <div class="pri-list">
          ${actions.map(a => {
            const gl = goalFor(a);
            return `<div class="pri ${a.rank === 1 ? 'p1' : ''} ${a.risk ? 'risk' : ''}">
              <span class="pri-rank">${a.risk ? '!' : a.rank}</span>
              <span class="pri-body">
                <b>${a.short}</b>
                <em>${a.node} · 통제력 ${a.control}</em>
                ${gl ? `<span class="pri-goal-chip">🎯 ${gl.title}</span>` : ''}
              </span>
              <span class="pri-imp">${a.impact ? '+' + formatCompactWon(a.impact) : '—'}<i>/연</i></span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  drawSim();
  document.getElementById('sim-years').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.simYears = Number(b.dataset.y);
    document.querySelectorAll('#sim-years button').forEach(x => x.classList.toggle('active', x === b));
    drawSim();
  });
  container.querySelectorAll('input[data-lv]').forEach(inp => {
    inp.addEventListener('change', () => {
      const raw = inp.value.replace(/[^0-9.]/g, '');
      state.simLevers[inp.dataset.lv] = raw === '' ? undefined : Number(raw);
      renderPage();
    });
  });
  document.getElementById('sim-reset').addEventListener('click', () => {
    state.simLevers = {};
    renderPage();
  });
}

/* ---------------- page: 자산 ---------------- */


/* 흐름 › 순저축 — 자산 증감이 저축 때문인지 시장 때문인지.
   기간(6/12/24/전체)과 월·연 토글이 위 지표와 차트를 함께 움직인다. */
const SAVE_RANGES = [[6, '6개월'], [12, '12개월'], [24, '24개월'], ['all', '전체']];

/* 홈 — 두 축(현금흐름·자산)이 만나는 단 하나의 화면.
   "이번 달 자산이 얼마 늘었고, 그게 아껴서인지 굴려서인지"를 먼저 보여준다.
   본체는 아래 renderSavingFlowPage 를 그대로 쓴다. */
function renderHomePage(container, data, d) {
  container.innerHTML = `
    <div class="panel-title" style="margin:2px 0 14px;">
      <div>이번 달, 얼마나 늘었나</div>
      <span class="ptag">저축 · 시장 분해</span>
    </div>
    <div id="home-save"></div>`;
  renderSavingFlowPage(document.getElementById('home-save'), data, d);
}

function renderSavingFlowPage(container, data, d) {
  if (!state.saveRange) state.saveRange = 12;
  if (!state.savePeriod) state.savePeriod = 'month';

  container.innerHTML = `
    <div class="bare">
      <div class="bare-bar">
        <div class="range-toggle" id="save-period-toggle">
          <button data-p="month" class="${state.savePeriod === 'month' ? 'active' : ''}">월</button>
          <button data-p="year" class="${state.savePeriod === 'year' ? 'active' : ''}">연</button>
        </div>
        <div class="range-toggle" id="save-range-toggle">
          ${SAVE_RANGES.map(([v, l]) => `<button data-r="${v}" class="${String(state.saveRange) === String(v) ? 'active' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);" id="save-cards"></div>
      <div class="today-verdict" id="save-verdict" style="margin:2px 0 14px;"></div>
      <div class="chart-wrap tall" style="min-height:320px;"><canvas id="chart-save"></canvas></div>
      <div class="chart-legend">
        <span><i style="background:rgba(57,168,189,.75)"></i>순저축</span>
        <span><i style="background:rgba(201,162,39,.7)"></i>투자·평가손익</span>
        <span><i style="background:#eae8e0"></i>Δ 총자산</span>
        <span style="color:var(--text-faint)">막대 클릭 → 그 구간 값으로 위 지표 전환</span>
      </div>
      <div class="settings-note">Δ총자산 = 순저축(외부 유입) + 투자·평가손익. 투자 수익(판매수익·배당)은 계좌 안에서 생긴 돈이라 순저축이 아니라 평가손익에 잡혀요.</div>
    </div>
  `;

  const all = (d.decomposition || []).filter(x => x.netSavings !== null);
  if (!all.length) {
    document.getElementById('save-cards').innerHTML = '<div class="empty-state">분해할 자산 스냅샷이 부족해요.</div>';
    return;
  }

  const nowKey = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);
  const cumBy = d.byMonth || {};
  const build = () => {
    const n = state.saveRange === 'all' ? all.length : Number(state.saveRange);
    const slice = all.slice(-n);
    if (state.savePeriod === 'month') {
      return slice.map(x => ({
        key: x.month, label: x.label,
        totalDelta: x.totalDelta, netSavings: x.netSavings, marketOther: x.marketOther,
        extIncome: x.extIncome, expense: x.expense, invIncome: x.invIncome,
        endTotal: cumBy[x.month] || 0,
        inProgress: assetMonthKey(x.month) === nowKey
      }));
    }
    /* 연 단위 합산 */
    const byYear = {};
    slice.forEach(x => {
      const y = String(Math.floor(assetMonthKey(x.month) / 100));
      if (!byYear[y]) byYear[y] = { key: y, label: y + '년', totalDelta: 0, netSavings: 0, marketOther: 0, extIncome: 0, expense: 0, invIncome: 0, endTotal: 0, inProgress: false };
      const b = byYear[y];
      b.totalDelta += x.totalDelta; b.netSavings += x.netSavings; b.marketOther += x.marketOther;
      b.extIncome += x.extIncome || 0; b.expense += x.expense || 0; b.invIncome += x.invIncome || 0;
      b.endTotal = cumBy[x.month] || b.endTotal;
      if (assetMonthKey(x.month) === nowKey) b.inProgress = true;
    });
    return Object.keys(byYear).sort().map(y => byYear[y]);
  };

  let series = build();
  let selIdx = series.length - 1;

  const sign = (v) => (v >= 0 ? '+' : '−') + formatCompactWon(Math.abs(v));
  const col = (v) => v >= 0 ? 'var(--income-text)' : 'var(--expense-text)';

  const paint = () => {
    const x = series[selIdx] || series[series.length - 1];
    if (!x) return;
    const rate = x.extIncome > 0 ? (x.netSavings / x.extIncome) * 100 : null;
    document.getElementById('save-cards').innerHTML = `
      <div class="stat-card">
        <div class="label">총자산 <em style="font-style:normal;color:var(--text-faint);font-size:10px;">${x.label}${x.inProgress ? ' · 진행 중' : ''}</em></div>
        <div class="value">${formatCompactWon(x.endTotal)}원</div>
        <div class="sub">Δ <span style="color:${col(x.totalDelta)}">${sign(x.totalDelta)}</span></div>
      </div>
      <div class="stat-card">
        <div class="label">순저축</div>
        <div class="value" style="color:var(--net-text)">${sign(x.netSavings)}</div>
        <div class="sub">수입 ${formatCompactWon(x.extIncome)} − 지출 ${formatCompactWon(x.expense)}</div>
      </div>
      <div class="stat-card">
        <div class="label">투자·평가손익</div>
        <div class="value" style="color:${col(x.marketOther)}">${sign(x.marketOther)}</div>
        <div class="sub">실현수익 ${formatCompactWon(x.invIncome)} 포함</div>
      </div>
      <div class="stat-card">
        <div class="label">저축률</div>
        <div class="value">${rate === null ? '—' : rate.toFixed(1) + '%'}</div>
        <div class="sub">근로·기타 수입 대비</div>
      </div>`;
    const driver = Math.abs(x.marketOther) > Math.abs(x.netSavings) ? '시장' : '저축';
    const v = document.getElementById('save-verdict');
    v.className = 'today-verdict ' + (x.totalDelta >= 0 ? 'good' : 'warn');
    v.innerHTML = x.totalDelta >= 0
      ? `${x.label} 자산은 ${formatCompactWon(x.totalDelta)}원 늘었고, ${driver}이 더 크게 움직였어요.`
      : `${x.label} 자산은 ${formatCompactWon(Math.abs(x.totalDelta))}원 줄었어요. ${x.netSavings > 0 ? `저축은 ${formatCompactWon(x.netSavings)}원 들어왔지만 평가손익이 ${formatCompactWon(Math.abs(x.marketOther))}원 빠진 결과예요.` : '저축 유입도 마이너스였어요.'}`;
    if (state.charts.save && state.charts.save.data) {
      state.charts.save.data.datasets[0].backgroundColor = series.map((_, i) => i === selIdx ? 'rgba(57,168,189,1)' : 'rgba(57,168,189,.45)');
      state.charts.save.data.datasets[1].backgroundColor = series.map((_, i) => i === selIdx ? 'rgba(201,162,39,1)' : 'rgba(201,162,39,.42)');
      state.charts.save.update();
    }
  };

  const draw = () => {
    if (state.charts.save) state.charts.save.destroy();
    const ctx = document.getElementById('chart-save');
    if (!ctx) return;
    state.charts.save = new Chart(ctx, {
      data: {
        labels: series.map(x => x.label),
        datasets: [
          { type: 'bar', label: '순저축', data: series.map(x => x.netSavings), backgroundColor: 'rgba(57,168,189,.75)', stack: 'x', borderRadius: 2, labelColor: '#a8e6f0' },
          { type: 'bar', label: '투자·평가손익', data: series.map(x => x.marketOther), backgroundColor: 'rgba(201,162,39,.7)', stack: 'x', borderRadius: 2, labelColor: '#efdfa0' },
          { type: 'line', label: 'Δ 총자산', data: series.map(x => x.totalDelta), borderColor: '#eae8e0', backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 1.5, labelColor: '#eae8e0' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
        onClick: (evt, els) => { if (els && els.length) { selIdx = els[0].index; paint(); } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: { x: { stacked: true, ticks: MONO_TICK, grid: { display: false } }, y: { stacked: true, ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT } }
      }
    });
    paint();
  };

  const rebuild = () => { series = build(); selIdx = series.length - 1; draw(); };

  document.getElementById('save-period-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.savePeriod = b.dataset.p;
    document.querySelectorAll('#save-period-toggle button').forEach(x => x.classList.toggle('active', x === b));
    rebuild();
  });
  document.getElementById('save-range-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.saveRange = b.dataset.r === 'all' ? 'all' : Number(b.dataset.r);
    document.querySelectorAll('#save-range-toggle button').forEach(x => x.classList.toggle('active', x === b));
    rebuild();
  });

  draw();
}

function renderAssetsPage(container, data, d) {
  container.innerHTML = `
    <div class="g">
      <div class="stat-grid s3" style="grid-template-columns:1fr;" id="panel-asset-stats"></div>
      <div class="panel s9" id="panel-trend"></div>
    </div>
    <div class="g">
      <div class="panel s5" id="panel-allocation"></div>
      <div class="panel s7" id="panel-accounts"></div>
    </div>
  `;
  renderAssetStats(data, d);
  renderAccountsPanel(data, d);
  renderTrend(data, d);
  renderAllocation(d);
}

function renderAssetStats(data, d) {
  const box = document.getElementById('panel-asset-stats');
  const latestMonth = d.latestMonth;
  const accSum = (pred) => data.assetRows
    .filter(r => r.date === latestMonth && r.amount !== null && pred(r.account, r.category))
    .reduce((a, r) => a + r.amount, 0);
  const toss = accSum((name) => /토스/.test(name));
  const pension = (d.allocation && d.allocation['연금 자산']) || 0;
  const emgTarget = state.goals.emergencyFundTarget || 0;
  const emgPct = emgTarget > 0 ? Math.min((d.emergencyFund / emgTarget) * 100, 999) : null;
  const emgDone = emgPct !== null && emgPct >= 100;
  const pct = (v) => d.totalAssets ? ((v / d.totalAssets) * 100).toFixed(0) + '%' : '—';
  const debt = totalDebt();
  const netWorth = d.totalAssets - debt;
  const cfList = d.cashflow || [];
  const closedExp = cfList.filter(c => c.expense > 0).slice(-6).map(c => c.expense);
  const avgMonthlyExpense = closedExp.length ? closedExp.reduce((a, b) => a + b, 0) / closedExp.length : 0;
  const livingCost = avgMonthlyExpense + monthlyDebtPayment();
  const emgMonths = livingCost > 0 ? d.emergencyFund / livingCost : null;
  const emgMonthTarget = state.settings.emergencyMonths || 6;

  box.innerHTML = `
      <div class="stat-card">
        <div class="label">순자산 <em style="font-style:normal;color:var(--text-faint);font-size:10px;">${latestMonth || ''}</em></div>
        <div class="value">${formatCompactWon(netWorth)}원</div>
        <div class="sub ${d.deltaAssets >= 0 ? 'good' : 'warn'}">전월 ${d.deltaAssets >= 0 ? '▲' : '▼'} ${formatCompactWon(Math.abs(d.deltaAssets))}원 (${d.deltaPct === null ? '—' : d.deltaPct.toFixed(1) + '%'})</div>
        <div class="sub" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span>자산 ${formatCompactWon(d.totalAssets)} − 부채 ${debt ? formatCompactWon(debt) : '0'}</span>
          <button class="btn small" id="debt-edit">부채 ${debt ? '수정' : '등록'}</button>
        </div>
      </div>
      <div class="stat-card">
        <div class="label">비상금 (NH-CMA)</div>
        <div class="value" style="color:${emgDone ? 'var(--income-text)' : 'var(--accent-text)'}">${formatCompactWon(d.emergencyFund)}원</div>
        <div class="sub ${emgPct === null ? '' : emgPct >= 100 ? 'good' : emgPct >= 60 ? 'warn' : 'bad'}">목표 ${formatCompactWon(emgTarget)}원 · 달성 ${emgPct === null ? '—' : emgPct.toFixed(0) + '%'}</div>
        <div class="allow-track" style="margin-top:7px;height:7px;">
          <div class="allow-fill" style="width:${emgPct === null ? 0 : Math.min(emgPct, 100)}%;${emgDone ? '' : 'background:linear-gradient(90deg,var(--gold),var(--gold-soft));'}"></div>
        </div>
        <div class="allow-legend"><span>${emgDone ? '목표 달성' : `${formatCompactWon(Math.max(emgTarget - d.emergencyFund, 0))}원 남음`}</span><span>${formatCompactWon(emgTarget)}원</span></div>
        <div class="sub ${emgMonths !== null && emgMonths >= emgMonthTarget ? 'good' : 'warn'}">${emgMonths === null ? '월 지출 데이터 부족' : `생활비 <b>${emgMonths.toFixed(1)}개월치</b> · 목표 ${emgMonthTarget}개월 (월 ${formatCompactWon(Math.round(livingCost))})`}</div>
      </div>
      <div class="stat-card">
        <div class="label">토스 증권</div>
        <div class="value">${formatCompactWon(toss)}원</div>
        <div class="sub">총자산의 ${pct(toss)}</div>
      </div>
      <div class="stat-card">
        <div class="label">연금 전체</div>
        <div class="value" style="color:var(--net-fill)">${formatCompactWon(pension)}원</div>
        <div class="sub">총자산의 ${pct(pension)}</div>
      </div>
  `;
  const de = document.getElementById('debt-edit');
  if (de) de.addEventListener('click', openDebtEditor);
}

function renderAccountsPanel(data, d) {
  const panel = document.getElementById('panel-accounts');
  const latestMonth = d.latestMonth;
  const accounts = {};
  data.assetRows.filter(r => r.date === latestMonth && r.amount !== null).forEach(r => {
    accounts[r.account] = { amount: (accounts[r.account] ? accounts[r.account].amount : 0) + r.amount, category: r.category };
  });
  const accountList = Object.entries(accounts).sort((a, b) => b[1].amount - a[1].amount);
  panel.innerHTML = `
    <div class="panel-title"><div>계좌별 잔액</div><span class="ptag">${latestMonth || ''}</span></div>
    <div class="acct-board">
      ${ACCT_BOARD_ORDER.map(cat => {
        const list = accountList.filter(([, v]) => v.category === cat);
        if (!list.length) return '';
        const sum = list.reduce((a, [, v]) => a + v.amount, 0);
        const catPct = d.totalAssets ? (sum / d.totalAssets) * 100 : 0;
        return `<div class="acct-col" style="--catc:${CAT_COLORS[cat] || '#888'}">
          <div class="acct-col-head"><b>${cat.replace(' 자산', '')}</b><span>${formatCompactWon(sum)}<em>${catPct.toFixed(0)}%</em></span></div>
          ${list.map(([name, v]) => {
            const pct = sum ? (v.amount / sum) * 100 : 0;
            return `<div class="acct-cell">
              <span class="acct-nm">${name}</span>
              <span class="acct-val">${formatCompactWon(v.amount)}</span>
              <span class="acct-bar"><i style="width:${pct}%"></i></span>
            </div>`;
          }).join('')}
        </div>`;
      }).join('') || '<div class="empty-state">계좌 데이터가 없어요.</div>'}
    </div>
  `;
}

/* ---------------- page: 수입 ---------------- */

function currentPivotMonthKeyString() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}월`;
}

function bindRangeToggle(elId, options, currentVal, onPick) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = options.map(([v, l]) => `<button data-r="${v}" class="${String(currentVal) === String(v) ? 'active' : ''}">${l}</button>`).join('');
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    onPick(btn.dataset.r);
  });
}

const RANGE_OPTIONS = [['6', '6개월'], ['12', '1년'], ['24', '2년'], ['all', '전체']];

function sliceByRange(arr, range) {
  if (range === 'all' || !range) return arr;
  const n = parseInt(range, 10);
  return arr.slice(-n);
}








const EXP_SUBS = [['summary', '요약'], ['fixed', '고정비'], ['budget', '예산'], ['regret', 'Good/Bad']];


/* ---------------- 카테고리별 예산 가이드 + 이번 달 주요 지출 (같은 연월 기준, 동시 업데이트) ---------------- */

function pivotYearMonth(m) {
  const match = (m || '').match(/(\d{4})-(\d{1,2})월/);
  return match ? { year: match[1], month: parseInt(match[2], 10) } : { year: '', month: 0 };
}

function renderExpenseMonthSection(data, d) {
  if (state.expenseMonthIdx === undefined || state.expenseMonthIdx === null) {
    state.expenseMonthIdx = d.latestPivotIdx;
  }
  renderBudgetTable(data, d);
}

function setExpenseMonthIdx(idx, data, d) {
  state.expenseMonthIdx = idx;
  renderExpenseMonthSection(data, d);
}

function renderMonthNavControls(idx, data, d) {
  const curYM = pivotYearMonth(data.months[idx]);
  const years = [...new Set(data.months.map(m => pivotYearMonth(m).year))];
  const monthsInYear = data.months.map((m, i) => ({ i, ...pivotYearMonth(m) })).filter(x => x.year === curYM.year);
  const yearOptions = years.map(y => `<option value="${y}" ${y === curYM.year ? 'selected' : ''}>${y}</option>`).join('');
  const monthOptions = monthsInYear.map(x => `<option value="${x.i}" ${x.i === idx ? 'selected' : ''}>${x.month}월</option>`).join('');
  return `
    <div class="month-nav">
      <select id="expense-month-year">${yearOptions}</select>
      <select id="expense-month-month">${monthOptions}</select>
      <button class="btn small" id="expense-month-thismonth">이번달</button>
    </div>
  `;
}

function bindMonthNavControls(data, d) {
  const yearSel = document.getElementById('expense-month-year');
  const monthSel = document.getElementById('expense-month-month');
  const thisBtn = document.getElementById('expense-month-thismonth');
  if (yearSel) yearSel.addEventListener('change', () => {
    const y = yearSel.value;
    const firstInYear = data.months.map((m, i) => ({ i, ...pivotYearMonth(m) })).filter(x => x.year === y)[0];
    if (firstInYear) setExpenseMonthIdx(firstInYear.i, data, d);
  });
  if (monthSel) monthSel.addEventListener('change', () => setExpenseMonthIdx(parseInt(monthSel.value, 10), data, d));
  if (thisBtn) thisBtn.addEventListener('click', () => {
    const curKey = currentPivotMonthKeyString();
    let targetIdx = data.months.indexOf(curKey);
    if (targetIdx === -1) targetIdx = d.latestPivotIdx;
    setExpenseMonthIdx(targetIdx, data, d);
  });
}

/* 세부 카테고리(소분류 › 항목) 단위 예산.
   기준값 = 최근 12개월 월평균 실지출. 사용자가 고치면 그 값이 예산이 된다. */
function buildBudgetTree(data) {
  const rows = (data.ledger || []).filter(r => r.major.includes('지출'));
  const keys = Array.from(new Set(rows.map(r => ledgerMonthKey(r.date)).filter(Boolean))).sort();
  const last12 = keys.slice(-12);
  const n = last12.length || 1;
  const tree = {};
  rows.forEach(r => {
    const mk = ledgerMonthKey(r.date);
    const minor = r.minor || '기타';
    const item = r.item || '기타';
    tree[minor] = tree[minor] || { name: minor, items: {} };
    const it = tree[minor].items[item] = tree[minor].items[item] || { name: item, sum12: 0, byMonth: {} };
    if (last12.includes(mk)) it.sum12 += netExpenseOf(r);
    it.byMonth[mk] = (it.byMonth[mk] || 0) + netExpenseOf(r);
  });
  const groups = Object.values(tree).map(g => {
    const items = Object.values(g.items).map(it => ({ ...it, avg: it.sum12 / n }))
      .filter(it => it.avg > 0).sort((a, b) => b.avg - a.avg);
    return { name: g.name, items, avg: items.reduce((a, x) => a + x.avg, 0) };
  }).filter(g => g.items.length).sort((a, b) => b.avg - a.avg);
  return { groups, months: keys, n };
}

function budgetKeyOf(minor, item) { return `${minor}|${item}`; }
function budgetOf(minor, item, fallback) {
  const v = state.budgets && state.budgets[budgetKeyOf(minor, item)];
  return (v === undefined || v === null || v === '') ? fallback : Number(v);
}

/* ---------------- 지출 › 예산 : 예산과 실적을 한 표로 ----------------
   상위(소분류) 행을 접었다 폈다 하면 예산·실적이 같이 열린다.
   예산 입력칸은 항목 바로 옆, 그 오른쪽에 실적과 차이. */
function renderBudgetTable(data, d, forceMonthKey, hostId) {
  const body = document.getElementById(hostId || 'budget-table-body');
  if (!body) return;
  const { groups, months } = buildBudgetTree(data);
  if (!state.budgetOpen) state.budgetOpen = {};

  let mk;
  if (forceMonthKey) {
    mk = forceMonthKey;
  } else {
    if (state.expenseMonthIdx === undefined || state.expenseMonthIdx === null) state.expenseMonthIdx = d.latestPivotIdx;
    const pm = data.months[state.expenseMonthIdx];
    const ym = pivotYearMonth(pm);
    mk = ym.year ? `${ym.year}-${String(ym.month).padStart(2, '0')}` : months[months.length - 1];
  }

  const rows = groups.map(g => {
    const items = g.items.map(it => {
      const budget = budgetOf(g.name, it.name, it.avg);
      const used = it.byMonth[mk] || 0;
      const custom = !!(state.budgets && state.budgets[budgetKeyOf(g.name, it.name)] !== undefined
        && state.budgets[budgetKeyOf(g.name, it.name)] !== '');
      return { name: it.name, avg: it.avg, budget, used, custom };
    });
    return {
      name: g.name,
      items,
      budget: items.reduce((a, x) => a + x.budget, 0),
      used: items.reduce((a, x) => a + x.used, 0)
    };
  }).filter(g => g.budget > 0 || g.used > 0)
    .sort((a, b) => b.budget - a.budget);

  const tB = rows.reduce((a, r) => a + r.budget, 0);
  const tU = rows.reduce((a, r) => a + r.used, 0);
  /* 남음 / 초과 — 숫자만으로는 안 읽혀서 사용률 게이지 + 방향 기호를 같이 준다.
     초과분은 게이지가 100%를 넘어 빨갛게 넘치는 걸로 표현. */
  const diffCell = (b, u) => {
    const gap = b - u;
    const pct = b > 0 ? (u / b) * 100 : (u > 0 ? 200 : 0);
    const over = gap < 0;
    return `<div class="bt2-gauge ${over ? 'over' : ''}" title="${b > 0 ? Math.round(pct) + '% 사용' : ''}">
      <span class="g-track"><i style="width:${Math.min(pct, 100)}%"></i>${over ? `<u style="width:${Math.min(pct - 100, 100)}%"></u>` : ''}</span>
      <span class="g-txt">${over ? '▲' : '▼'} ${wonComma(Math.round(Math.abs(gap)))}</span>
    </div>`;
  };

  body.innerHTML = `
    <table class="bt2">
      <colgroup><col class="w-nm"/><col class="w-in"/><col class="w-act"/><col class="w-num"/></colgroup>
      <thead>
        <tr>
          <th class="c-nm">항목</th>
          <th class="c-in">예산 <em>월 기준</em></th>
          <th class="c-act">실적 ${forceMonthKey ? `<span class="bt2-mlabel">${monthKeyLabel(mk)}</span>` : '<span id="expense-month-nav-slot"></span>'}</th>
          <th class="c-num">남음 / 초과</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(g => {
          const open = !!state.budgetOpen[g.name];
          return `
          <tr class="bt2-g ${open ? 'open' : ''} ${g.used > g.budget ? 'over' : ''}" data-g="${g.name}">
            <td class="c-nm"><span class="bt2-caret">${open ? '▾' : '▸'}</span><b>${g.name}</b><em>${g.items.length}</em></td>
            <td class="c-in">${wonComma(Math.round(g.budget))}</td>
            <td class="c-act">${wonComma(Math.round(g.used))}</td>
            <td class="c-num">${diffCell(g.budget, g.used)}</td>
          </tr>
          ${open ? g.items.map(it => `
            <tr class="bt2-i ${it.used > it.budget ? 'over' : ''}">
              <td class="c-nm"><span class="bt2-ind">└</span>${it.name}${it.custom ? '' : '<i class="bt2-auto" title="최근 12개월 평균">자동</i>'}</td>
              <td class="c-in"><input type="text" inputmode="numeric" class="bt2-input" data-cat="${g.name}" data-item="${it.name}" value="${wonComma(Math.round(it.budget))}" /></td>
              <td class="c-act">${wonComma(Math.round(it.used))}</td>
              <td class="c-num">${diffCell(it.budget, it.used)}</td>
            </tr>`).join('') : ''}`;
        }).join('') || '<tr><td colspan="4"><div class="empty-state">지출 데이터가 없어요.</div></td></tr>'}
      </tbody>
      <tfoot>
        <tr class="${tU > tB ? 'over' : ''}">
          <td class="c-nm"><b>합계</b></td>
          <td class="c-in">${wonComma(Math.round(tB))}</td>
          <td class="c-act">${wonComma(Math.round(tU))}</td>
          <td class="c-num">${diffCell(tB, tU)}</td>
        </tr>
      </tfoot>
    </table>
  `;

  if (!forceMonthKey) {
    const navSlot = document.getElementById('expense-month-nav-slot');
    if (navSlot) {
      navSlot.innerHTML = renderMonthNavControls(state.expenseMonthIdx, data, d);
      bindMonthNavControls(data, d);
    }
  }

  body.querySelectorAll('.bt2-g').forEach(tr => tr.addEventListener('click', (e) => {
    if (e.target.closest('input')) return;
    state.budgetOpen[tr.dataset.g] = !state.budgetOpen[tr.dataset.g];
    renderBudgetTable(data, d, forceMonthKey, hostId);
  }));
  body.querySelectorAll('.bt2-input').forEach(inp => {
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('change', () => {
      const k = budgetKeyOf(inp.dataset.cat, inp.dataset.item);
      const raw = inp.value.replace(/[^0-9]/g, '');
      if (raw === '') delete state.budgets[k];
      else state.budgets[k] = parseFloat(raw);
      saveBudgets();
      renderBudgetTable(data, d, forceMonthKey, hostId);
    });
  });
}





const FIXED_TONE_COLOR = { red: 'var(--expense-text)', green: 'var(--income-text)', gold: 'var(--accent-text)', muted: 'var(--text-faint)' };


/* ---------------- 해외주식 양도소득세 ---------------- */
/* 실현손익(판매수익)은 '수입'으로, 그에 대한 양도소득세는 이듬해 5월에 '지출'로 잡힌다.
   두 흐름이 서로 다른 해에 서로 다른 대분류로 흩어져 있어서,
   여기서 과세연도 기준으로 다시 붙여준다. */
const CGT_DEDUCTION = 2500000;   // 기본공제 250만원
const CGT_RATE = 0.22;           // 양도소득세 20% + 지방소득세 2%
const CGT_RE = /양도소득세|양도세/;

function analyzeCapitalGainsTax(ledger) {
  const gain = {}, div = {}, paid = {}, paidRows = [];
  ledger.forEach(r => {
    const mk = ledgerMonthKey(r.date);
    if (!mk) return;
    const y = mk.slice(0, 4);
    if (r.major.includes('수입') && (r.minor || '').includes('투자 수익')) {
      if ((r.item || '').includes('판매수익')) gain[y] = (gain[y] || 0) + r.amount;
      else if ((r.item || '').includes('배당')) div[y] = (div[y] || 0) + r.amount;
    }
    if (r.major.includes('지출') && CGT_RE.test(`${r.item} ${r.memo} ${r.vendor}`)) {
      paid[y] = (paid[y] || 0) + r.amount;
      paidRows.push({ date: r.date, monthKey: mk, amount: r.amount, label: r.memo || r.item });
    }
  });

  const years = Array.from(new Set(Object.keys(gain).concat(Object.keys(paid)))).sort();
  const rows = years.filter(y => (gain[y] || 0) !== 0).map(y => {
    const g = gain[y] || 0;
    const est = Math.max(0, g - CGT_DEDUCTION) * CGT_RATE;
    const payYear = String(Number(y) + 1);
    const actual = paid[payYear] || 0;
    const settled = actual > 0;
    const burden = settled ? actual : est;
    return {
      year: y, payYear, gain: g, dividend: div[y] || 0,
      est, actual, settled, burden, net: g - burden,
      rate: g > 0 ? (burden / g) * 100 : 0
    };
  });
  const totalPaid = Object.values(paid).reduce((a, b) => a + b, 0);
  const totalGain = Object.values(gain).reduce((a, b) => a + b, 0);
  return { rows, paid, paidRows, totalPaid, totalGain };
}

/* ---------------- BENCHMARK: 같은 일정으로 지수에 넣었다면 ----------------
   "내가 고른 종목"과 "아무 생각 없이 지수"를 같은 조건에서 비교한다.
   조건을 맞추는 방법: 실제 투자 이체가 일어난 달·금액 그대로 지수를 매수했다고
   가정하고, 매달 누적 좌수 × 그 달 지수 = 반사실 평가액.
   실제 평가액(자산 스냅샷의 투자 자산)과 같은 시점에서 뺀 값이 초과수익.
   이 패널이 있어야 "이겼다/졌다"를 기억이 아니라 숫자로 판정할 수 있다. */
function analyzeBenchmark(data, d) {
  const hasSheetPrices = data.indexPrices && Object.keys(data.indexPrices).length > 0;
  const prices = hasSheetPrices ? data.indexPrices : INDEX_SEED;
  if (!Object.keys(prices).length) return null;

  const sortedPriceKeys = Object.keys(prices).sort();
  /* 해당 월 가격이 없으면 그 이전 가장 가까운 달 가격으로 대체한다.
     (시트 갱신이 한 달 밀렸을 때 패널이 죽지 않게) */
  const priceAt = (key) => {
    if (prices[key] !== undefined) return prices[key];
    let found = null;
    for (const k of sortedPriceKeys) { if (k <= key) found = prices[k]; else break; }
    return found;
  };

  /* 1) 납입 스케줄.
     원장이 충분하면 원장에서 뽑는다 — 계좌별로 나뉘어 있어서
     "이체 기록이 있는 계좌"만 비교 대상으로 좁힐 수 있다.
     신한 증권처럼 이체 기록 없이 잔고만 있는 계좌를 실제 평가액에 넣으면
     그 금액만큼 초과수익이 매달 공짜로 부풀려진다. */
  const monthKeyOf = (pivotMonth) => {
    const m = String(pivotMonth).match(/(\d{4})-(\d{1,2})월/);
    return m ? `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, '0')}` : null;
  };
  const ledgerMonthKey = (s) => {
    const m = String(s || '').match(/(\d{4})\.\s*(\d{1,2})\./);
    return m ? `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, '0')}` : null;
  };

  const pivotSeries = data.transferCategories['투자 자산'] || [];
  const pivotFlow = {};
  let pivotTotal = 0;
  data.months.forEach((pm, i) => {
    const key = monthKeyOf(pm);
    if (!key) return;
    pivotFlow[key] = (pivotFlow[key] || 0) + (pivotSeries[i] || 0);
    pivotTotal += pivotSeries[i] || 0;
  });

  const invTransfers = (data.ledger || []).filter(r => r.major === '이체' && r.minor === '투자 자산');
  const ledgerFlow = {};
  const trackedAccounts = new Set();
  let ledgerTotal = 0;
  invTransfers.forEach(r => {
    const key = ledgerMonthKey(r.date);
    if (!key) return;
    ledgerFlow[key] = (ledgerFlow[key] || 0) + (r.amount || 0);
    ledgerTotal += r.amount || 0;
    if (r.item) trackedAccounts.add(r.item);
  });

  /* 원장 쪽이 피벗 총액을 거의 재현할 때만 원장을 신뢰한다.
     오프라인 스냅샷의 ledger는 앞부분만 잘려 담겨 있어서, 건수만 보고
     원장을 쓰면 누적 원금이 조용히 과소 집계된다. */
  const ledgerAgrees = pivotTotal === 0
    ? invTransfers.length >= 10
    : Math.abs(ledgerTotal - pivotTotal) <= Math.abs(pivotTotal) * 0.02;
  const useLedger = invTransfers.length >= 10 && ledgerAgrees;

  const flowByKey = useLedger ? ledgerFlow : pivotFlow;
  if (!useLedger) trackedAccounts.clear();

  /* 2) 시간순으로 누적 좌수와 누적 원금을 쌓는다 */
  let units = 0, contrib = 0, missing = 0;
  const stateByKey = {};
  const allKeys = Array.from(new Set(Object.keys(flowByKey).concat(sortedPriceKeys))).sort();
  allKeys.forEach(key => {
    const flow = flowByKey[key] || 0;
    if (flow !== 0) {
      const px = priceAt(key);
      if (px) { units += flow / px; contrib += flow; }
      else { missing += 1; contrib += flow; }
    }
    stateByKey[key] = { units, contrib };
  });

  /* 3) 자산 스냅샷이 있는 달마다 실제 vs 반사실을 같은 시점으로 맞춘다.
     원장을 쓸 수 있으면 이체 기록이 있는 계좌만 합산한다. */
  const balByMonth = {};
  const excluded = new Set();
  data.assetRows.forEach(r => {
    if (r.category !== '투자 자산' || r.amount === null) return;
    if (useLedger && trackedAccounts.size && !trackedAccounts.has(r.account)) {
      excluded.add(r.account);
      return;
    }
    balByMonth[r.date] = (balByMonth[r.date] || 0) + r.amount;
  });

  const carry = (key) => {
    if (stateByKey[key]) return stateByKey[key];
    const keys = Object.keys(stateByKey).filter(k => k <= key).sort();
    return keys.length ? stateByKey[keys[keys.length - 1]] : { units: 0, contrib: 0 };
  };

  const rows = [];
  (d.assetMonths || []).forEach(am => {
    const mk = assetMonthKey(am);
    if (!mk) return;
    const key = `${Math.floor(mk / 100)}-${String(mk % 100).padStart(2, '0')}`;
    const px = priceAt(key);
    const st = carry(key);
    const actual = balByMonth[am];
    if (px === null || px === undefined || actual === undefined) return;
    const index = st.units * px;
    rows.push({
      month: am, key, contrib: st.contrib, actual, index,
      diff: actual - index,
      actualRoi: st.contrib > 0 ? ((actual - st.contrib) / st.contrib) * 100 : null,
      indexRoi: st.contrib > 0 ? ((index - st.contrib) / st.contrib) * 100 : null
    });
  });
  if (!rows.length) return null;

  const last = rows[rows.length - 1];
  const best = rows.reduce((a, r) => (r.diff > a.diff ? r : a), rows[0]);
  const worst = rows.reduce((a, r) => (r.diff < a.diff ? r : a), rows[0]);
  const wins = rows.filter(r => r.diff > 0).length;

  return {
    rows, last, best, worst, wins, total: rows.length, missing,
    source: hasSheetPrices ? (data.indexSource || 'sheet') : 'seed',
    accounts: Array.from(trackedAccounts), excluded: Array.from(excluded), useLedger
  };
}

function renderBenchmarkPanel(hostId, data, d) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const b = analyzeBenchmark(data, d);
  if (!b) {
    host.innerHTML = `
      <div class="panel-title"><div>지수 대비 초과수익</div></div>
      <div class="empty-state">지수 데이터를 찾지 못했어요. 시트의 <b>지수_S&amp;P500</b> 탭에
        <b>년월 / 종가</b> 두 컬럼이 있는지 확인해주세요.
        <a href="${csvUrlFor(GID_INDEX)}" target="_blank" rel="noopener" style="color:var(--accent-text);">불러오는 값 확인</a></div>`;
    return;
  }

  const { last, best, worst, wins, total } = b;
  const sign = (v) => (v >= 0 ? '+' : '−');
  const col = (v) => (v >= 0 ? 'var(--income-text)' : 'var(--expense-text)');
  const pct = (v) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);

  host.innerHTML = `
    <div class="panel-title">
      <div>지수 대비 초과수익 — 같은 일정으로 S&amp;P500에 넣었다면</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="range-toggle" id="bench-mode-toggle">
          <button data-mode="amount" class="${state.benchMode !== 'excess' ? 'active' : ''}">금액</button>
          <button data-mode="excess" class="${state.benchMode === 'excess' ? 'active' : ''}">초과수익</button>
        </div>
        <div class="range-toggle" id="bench-range-toggle"></div>
      </div>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(122px,1fr));margin-bottom:10px;">
      <div class="stat-card" style="border-color:${last.diff >= 0 ? 'rgba(76,140,107,0.45)' : 'rgba(193,72,63,0.45)'};">
        <div class="label">${assetMonthLabel(last.month)} 초과수익</div>
        <div class="value" style="color:${col(last.diff)}">${sign(last.diff)}${formatCompactWon(Math.abs(last.diff))}원</div>
        <div class="sub ${last.actualRoi == null || last.indexRoi == null ? '' : last.actualRoi >= last.indexRoi ? 'good' : 'warn'}">내 ${pct(last.actualRoi)} vs 지수 ${pct(last.indexRoi)}</div>
      </div>
      <div class="stat-card">
        <div class="label">최고 초과수익</div>
        <div class="value" style="color:${col(best.diff)}">${sign(best.diff)}${formatCompactWon(Math.abs(best.diff))}원</div>
        <div class="sub">${assetMonthLabel(best.month)} 시점</div>
      </div>
      <div class="stat-card">
        <div class="label">최저 초과수익</div>
        <div class="value" style="color:${col(worst.diff)}">${sign(worst.diff)}${formatCompactWon(Math.abs(worst.diff))}원</div>
        <div class="sub">${assetMonthLabel(worst.month)} 시점</div>
      </div>
      <div class="stat-card">
        <div class="label">지수를 이긴 달</div>
        <div class="value">${wins} / ${total}</div>
        <div class="sub">스냅샷 기준 승률 ${total ? Math.round((wins / total) * 100) : 0}%</div>
      </div>
    </div>
    <div class="chart-wrap tall"><canvas id="chart-bench"></canvas></div>
    <div class="chart-legend" id="bench-legend"></div>
    <div class="table-scroll" style="margin-top:12px;">
      <table class="data-table">
        <thead><tr>
          <th>시점</th><th style="text-align:right">누적 납입</th><th style="text-align:right">내 평가액</th>
          <th style="text-align:right">지수 반사실</th><th style="text-align:right">초과수익</th>
          <th style="text-align:right">내 수익률</th><th style="text-align:right">지수 수익률</th><th>판정</th>
        </tr></thead>
        <tbody>
          ${b.rows.slice().reverse().map(r => `<tr>
            <td>${assetMonthLabel(r.month)}</td>
            <td class="amt">${formatWon(r.contrib)}</td>
            <td class="amt">${formatWon(r.actual)}</td>
            <td class="amt">${formatWon(Math.round(r.index))}</td>
            <td class="amt" style="color:${col(r.diff)}">${r.diff >= 0 ? '+' : '-'}${wonComma(r.diff)}</td>
            <td class="amt">${pct(r.actualRoi)}</td>
            <td class="amt">${pct(r.indexRoi)}</td>
            <td style="color:${col(r.diff)}">${r.diff >= 0 ? '내가 앞섬' : '지수가 앞섬'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <details class="mininote"><summary>계산 기준 · 한계</summary>
      동일 시점·동일 금액으로 지수를 샀다고 가정 (누적 좌수 × 그 달 종가) → 차이 = 종목 선택의 결과.
      종가는 월평균이고 배당 재투자 미반영 → 지수 연 1.3%p 과소평가. 환율·국내주식 혼재분은 부정확. 양도세 미반영.
      ${b.accounts.length ? `<br>대상 계좌: <b>${b.accounts.join(', ')}</b>` : ''}
      ${b.excluded.length ? `<br>제외 계좌: <b>${b.excluded.join(', ')}</b> (이체 기록 없음)` : ''}
      ${!b.useLedger ? `<br><b style="color:var(--accent-text)">원장이 얕아 월별 피벗 기준 · 계좌 분리 없음</b>` : ''}
      ${b.missing ? `<br><b style="color:var(--expense-text)">${b.missing}개 달 지수 결측 → 이전 달 종가 대체</b>` : ''}
      ${b.source === 'seed' ? `<br><b style="color:var(--accent-text)">지수_S&amp;P500 탭 미수신 → 내장 백업값 사용</b>` : ''}
    </details>
  `;

  const drawBench = () => {
    if (state.charts.bench) state.charts.bench.destroy();
    const slice = sliceByRange(b.rows, state.benchRange);
    const labels = slice.map(r => assetMonthLabel(r.month));
    const ctx = document.getElementById('chart-bench');
    if (!ctx) return;
    const excess = state.benchMode === 'excess';

    document.getElementById('bench-legend').innerHTML = excess
      ? '<span><i style="background:var(--accent-fill)"></i>초과수익 (내 평가액 − 지수 반사실)</span>'
      : '<span><i style="background:var(--income-fill)"></i>내 평가액</span><span><i style="background:var(--info-fill)"></i>지수 반사실</span><span><i style="background:var(--accent-text)"></i>누적 납입</span>';

    if (excess) {
      state.charts.bench = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '초과수익', data: slice.map(r => Math.round(r.diff)),
            backgroundColor: slice.map(r => (r.diff >= 0 ? 'rgba(76,140,107,0.65)' : 'rgba(193,72,63,0.65)')),
            borderColor: slice.map(r => (r.diff >= 0 ? '#4c8c6b' : '#c1483f')), borderWidth: 1
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` 초과수익: ${formatWon(c.raw)}` } } },
          scales: {
            x: { ticks: MONO_TICK, grid: { display: false } },
            y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
          }
        }
      });
      return;
    }

    state.charts.bench = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '내 평가액', data: slice.map(r => r.actual), borderColor: '#4c8c6b', backgroundColor: 'rgba(76,140,107,0.12)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: '지수 반사실', data: slice.map(r => Math.round(r.index)), borderColor: '#5b8fc7', backgroundColor: 'transparent', borderDash: [6, 4], tension: 0.3, pointRadius: 2 },
          { label: '누적 납입', data: slice.map(r => r.contrib), borderColor: '#e0c766', backgroundColor: 'transparent', borderDash: [2, 3], borderWidth: 1.5, tension: 0.3, pointRadius: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } } },
        scales: {
          x: { ticks: MONO_TICK, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      }
    });
  };

  function onBenchRangePick(v) {
    state.benchRange = v === 'all' ? 'all' : parseInt(v, 10);
    bindRangeToggle('bench-range-toggle', RANGE_OPTIONS, state.benchRange, onBenchRangePick);
    drawBench();
  }
  bindRangeToggle('bench-range-toggle', RANGE_OPTIONS, state.benchRange, onBenchRangePick);

  const modeToggle = document.getElementById('bench-mode-toggle');
  if (modeToggle) {
    modeToggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.benchMode = btn.dataset.mode;
        modeToggle.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === btn));
        drawBench();
      });
    });
  }
  drawBench();
}

function renderCapitalGainsPanel(hostId, ledger) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const t = analyzeCapitalGainsTax(ledger);
  if (!t.rows.length) { host.innerHTML = ''; return; }

  const pending = t.rows.filter(r => !r.settled);
  const upcoming = pending.length ? pending[pending.length - 1] : null;
  const settledRows = t.rows.filter(r => r.settled);
  const accuracy = settledRows.length
    ? avgOf(settledRows.map(r => (r.est > 0 ? (r.actual / r.est) * 100 : 100)))
    : null;

  host.innerHTML = `
    <div class="panel-title"><div>양도소득세 · 세후 실현수익</div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(122px,1fr));margin-bottom:10px;">
      <div class="stat-card">
        <div class="label">지금까지 낸 양도세</div>
        <div class="value" style="color:var(--expense-text)">${formatCompactWon(t.totalPaid)}원</div>
        <div class="sub">누적 실현손익 ${formatCompactWon(t.totalGain)}원</div>
      </div>
      <div class="stat-card">
        <div class="label">${upcoming ? `${upcoming.payYear}년 5월 예상 납부액` : '미납 예정 세액'}</div>
        <div class="value" style="color:var(--accent-text)">${upcoming ? formatCompactWon(Math.round(upcoming.est)) + '원' : '없음'}</div>
        <div class="sub">${upcoming ? `${upcoming.year}년 실현손익 ${formatCompactWon(upcoming.gain)}원 기준` : '모두 정산 완료'}</div>
      </div>
      <div class="stat-card">
        <div class="label">누적 세후 실현수익</div>
        <div class="value" style="color:var(--income-text)">${formatCompactWon(t.rows.reduce((a, r) => a + r.net, 0))}원</div>
        <div class="sub">배당 제외, 판매수익 기준</div>
      </div>
      <div class="stat-card">
        <div class="label">추정 정확도</div>
        <div class="value">${accuracy === null ? '—' : accuracy.toFixed(0) + '%'}</div>
        <div class="sub">실제 납부 ÷ 22% 추정</div>
      </div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>과세연도</th><th style="text-align:right">실현손익</th><th style="text-align:right">과세표준</th>
          <th style="text-align:right">추정 세액</th><th style="text-align:right">실제 납부</th>
          <th style="text-align:right">세후 실현수익</th><th style="text-align:right">실효세율</th><th>상태</th>
        </tr></thead>
        <tbody>
          ${t.rows.slice().reverse().map(r => `<tr>
            <td>${r.year}년</td>
            <td class="amt income">${formatWon(r.gain)}</td>
            <td class="amt">${formatWon(Math.max(0, r.gain - CGT_DEDUCTION))}</td>
            <td class="amt">${formatWon(Math.round(r.est))}</td>
            <td class="amt expense">${r.settled ? formatWon(r.actual) : '—'}</td>
            <td class="amt" style="color:var(--income-text)">${formatWon(Math.round(r.net))}</td>
            <td class="amt">${r.rate.toFixed(1)}%</td>
            <td style="color:${r.settled ? 'var(--text-faint)' : 'var(--accent-text)'}">${r.settled ? `${r.payYear}.05 납부` : `${r.payYear}.05 예정`}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <details class="mininote"><summary>계산 기준</summary>
      추정 세액 = (실현손익 − 250만원) × 22% · 국내 상장주식 비과세분 제외 전이라 <b>상한선</b>.
      가계부에는 지출 › 기타로 잡히지만 성격은 투자 비용.
    </details>
  `;
}


/* ---------------- 토스증권 실시간 데이터 ---------------- */
/* 맥북의 수집기가 15분마다 채워주는 토스_* 탭을 읽는다.
   탭이 없거나 수집기가 안 돌고 있으면 조용히 null을 돌려주고,
   대시보드의 나머지 기능은 그대로 동작해야 한다. */

function tossRowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(h => String(h || '').trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some(c => String(c || '').trim())) continue;
    const o = {};
    header.forEach((h, i) => { if (h) o[h] = row[i]; });
    out.push(o);
  }
  return out;
}

function tossNum(v) {
  const n = parseWon(v);
  return n === null ? 0 : n;
}

/* 손익률·비중은 소수(0.0895)나 퍼센트 문자열('8.95%') 둘 다 올 수 있다.
   parseWon은 소수점을 살리지만 %는 못 읽으므로 따로 처리한다. */
function tossRate(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return 0;
  const pct = s.includes('%');
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  if (isNaN(n)) return 0;
  return pct ? n / 100 : n;
}

function parseTossSummary(rows) {
  const o = tossRowsToObjects(rows)[0];
  if (!o || !o['기준시각']) return null;
  return {
    asOf: String(o['기준시각']).trim(),
    value: tossNum(o['주식평가액']),
    cost: tossNum(o['주식매입액']),
    pl: tossNum(o['평가손익']),
    plRate: tossRate(o['손익률']),
    cash: tossNum(o['예수금']),
    total: tossNum(o['계좌총액']),
    fx: tossRate(o['환율']),
    count: tossNum(o['종목수']),
    daily: tossNum(o['당일손익'])
  };
}

function parseTossHoldings(rows) {
  return tossRowsToObjects(rows).map(o => ({
    name: String(o['종목명'] || '').trim(),
    symbol: String(o['티커'] || '').trim(),
    country: String(o['국가'] || '').trim(),
    currency: String(o['통화'] || '').trim(),
    qty: tossRate(o['수량']),
    avg: tossRate(o['평단가']),
    last: tossRate(o['현재가']),
    value: tossNum(o['평가액원화']),
    cost: tossNum(o['매입액원화']),
    pl: tossNum(o['평가손익원화']),
    plRate: tossRate(o['손익률'])
  })).filter(h => h.name && h.value > 0);
}

function parseTossDaily(rows) {
  return tossRowsToObjects(rows).map(o => ({
    date: String(o['날짜'] || '').trim().slice(0, 10),
    total: tossNum(o['계좌총액']),
    value: tossNum(o['주식평가액']),
    cost: tossNum(o['주식매입액']),
    pl: tossNum(o['평가손익']),
    plRate: tossRate(o['손익률'])
  })).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchTossData() {
  const names = [TOSS_TABS.summary, TOSS_TABS.holdings, TOSS_TABS.daily];
  const res = await Promise.allSettled(names.map(async (n) => {
    const r = await fetch(csvUrlForSheet(n), { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    let text = await r.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.trim().startsWith('<')) throw new Error('탭 접근 불가');
    return Papa.parse(text, { skipEmptyLines: false }).data
      .map(row => row.map(c => (c === null || c === undefined) ? '' : String(c)));
  }));

  const get = (i) => res[i].status === 'fulfilled' ? res[i].value : null;
  let summary = null, holdings = [], daily = [];
  try { if (get(0)) summary = parseTossSummary(get(0)); } catch (e) {}
  try { if (get(1)) holdings = parseTossHoldings(get(1)); } catch (e) {}
  try { if (get(2)) daily = parseTossDaily(get(2)); } catch (e) {}

  if (!summary && !holdings.length) return null;
  return { summary, holdings, daily };
}

/* '2026-08-18 02:35' 기준으로 얼마나 오래된 데이터인지 사람 말로 */
function tossFreshness(asOf) {
  const m = String(asOf || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return { text: '시각 불명', stale: true, mins: null };
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const mins = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
  let text;
  if (mins < 2) text = '방금';
  else if (mins < 60) text = `${mins}분 전`;
  else if (mins < 60 * 24) text = `${Math.floor(mins / 60)}시간 전`;
  else text = `${Math.floor(mins / 1440)}일 전`;
  return { text, stale: mins > 60, mins };
}

/* ---------------- 토스 실시간 패널 ---------------- */

const TOSS_PALETTE = ['#4c8c6b', '#c9a227', '#c2749b', '#7b7fd0', '#c1483f',
                      '#4f9d9d', '#d9884f', '#7f8fa6', '#d9884f', '#6b8f4c'];

function renderTossPanel(hostId, data) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const t = data.toss;
  if (!t || !t.summary) {
    host.innerHTML = `
      <div class="panel-title"><div>토스증권 실시간</div></div>
      <div class="empty-state">토스 데이터를 아직 못 불러왔어요.
        맥북의 수집기가 돌고 있는지 확인해보세요 —
        <code>cat ~/haedal/toss.log</code></div>`;
    return;
  }

  const s = t.summary;
  const fresh = tossFreshness(s.asOf);
  const holdings = t.holdings.slice().sort((a, b) => b.value - a.value);
  const totalVal = holdings.reduce((a, h) => a + h.value, 0) || 1;

  /* 종목명 → 주식_카테고리 태그. '☁️클라우드, 🤖AI' 처럼 복수 태그가 온다.
     한 종목이 여러 태그면 평가액을 태그 수로 나눠 배분한다. */
  const tagAgg = {};
  const untagged = [];
  holdings.forEach(h => {
    const raw = (data.stockCategoryMap || {})[h.name];
    const tags = raw ? String(raw).split(',').map(x => x.trim()).filter(Boolean) : [];
    if (!tags.length) { untagged.push(h.name); return; }
    tags.forEach(tag => { tagAgg[tag] = (tagAgg[tag] || 0) + h.value / tags.length; });
  });
  const tagRows = Object.entries(tagAgg).map(([name, v]) => ({ name, v }))
    .sort((a, b) => b.v - a.v);

  const krVal = holdings.filter(h => h.country === 'KR').reduce((a, h) => a + h.value, 0);
  const usVal = totalVal - krVal;

  const winners = holdings.filter(h => h.pl > 0).length;
  const showAll = !!state.tossShowAll;
  const shown = showAll ? holdings : holdings.slice(0, 15);

  host.innerHTML = `
    <div class="panel-title">
      <div>토스증권 실시간</div>
      <div style="font-family:'IBM Plex Mono';font-size:11px;color:${fresh.stale ? 'var(--expense-text)' : 'var(--income-text)'}">
        ${s.asOf} · ${fresh.text}${fresh.stale ? ' ⚠️' : ''}
      </div>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(122px,1fr));margin-bottom:10px;">
      <div class="stat-card">
        <div class="label">계좌 총액</div>
        <div class="value">${formatCompactWon(s.total)}원</div>
        <div class="sub">예수금 ${formatCompactWon(s.cash)}원 포함</div>
      </div>
      <div class="stat-card">
        <div class="label">주식 평가액</div>
        <div class="value">${formatCompactWon(s.value)}원</div>
        <div class="sub">매입 ${formatCompactWon(s.cost)}원</div>
      </div>
      <div class="stat-card">
        <div class="label">미실현 손익</div>
        <div class="value" style="color:${s.pl >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">
          ${s.pl >= 0 ? '+' : ''}${formatCompactWon(s.pl)}원</div>
        <div class="sub ${s.plRate >= 0 ? 'good' : 'bad'}">${(s.plRate * 100).toFixed(2)}%</div>
      </div>
      <div class="stat-card">
        <div class="label">당일 손익</div>
        <div class="value" style="color:${s.daily >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">
          ${s.daily >= 0 ? '+' : ''}${formatCompactWon(s.daily)}원</div>
        <div class="sub">환율 ${s.fx ? s.fx.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—'}원</div>
      </div>
      <div class="stat-card">
        <div class="label">보유 종목</div>
        <div class="value">${holdings.length}개</div>
        <div class="sub">수익 ${winners} · 손실 ${holdings.length - winners}</div>
      </div>
      <div class="stat-card">
        <div class="label">국내 / 해외</div>
        <div class="value">${((usVal / totalVal) * 100).toFixed(0)}% 해외</div>
        <div class="sub">국내 ${formatCompactWon(krVal)}원</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:10px;">
      <div>
        <div class="chart-label">테마별 비중</div>
        <div class="chart-wrap" style="min-height:170px;"><canvas id="chart-toss-tag"></canvas></div>
      </div>
      <div>
        <div class="chart-label">일별 계좌 총액</div>
        <div class="chart-wrap" style="min-height:170px;"><canvas id="chart-toss-daily"></canvas></div>
      </div>
    </div>
    <div id="toss-tag-legend" class="pie-legend" style="margin-bottom:16px;"></div>

    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>종목</th><th>티커</th><th style="text-align:right">비중</th>
          <th style="text-align:right">평가액</th><th style="text-align:right">평단가</th>
          <th style="text-align:right">현재가</th><th style="text-align:right">손익</th>
          <th style="text-align:right">손익률</th><th>테마</th>
        </tr></thead>
        <tbody>
          ${shown.map(h => {
            const tag = (data.stockCategoryMap || {})[h.name] || '';
            const dec = h.currency === 'USD' ? 2 : 0;
            return `<tr>
              <td>${h.name}</td>
              <td style="font-family:'IBM Plex Mono';color:var(--text-faint)">${h.symbol}</td>
              <td class="amt">${((h.value / totalVal) * 100).toFixed(1)}%</td>
              <td class="amt">${formatWon(h.value)}</td>
              <td class="amt">${h.avg.toLocaleString('ko-KR', { maximumFractionDigits: dec })}</td>
              <td class="amt">${h.last.toLocaleString('ko-KR', { maximumFractionDigits: dec })}</td>
              <td class="amt" style="color:${h.pl >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${h.pl >= 0 ? '+' : ''}${formatWon(h.pl)}</td>
              <td class="amt" style="color:${h.plRate >= 0 ? 'var(--income-text)' : 'var(--expense-text)'}">${(h.plRate * 100).toFixed(1)}%</td>
              <td style="color:var(--text-faint);font-size:11px">${tag}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${holdings.length > 15 ? `<div style="text-align:center;margin-top:10px;">
      <button id="toss-toggle-all" class="ghost-btn">${showAll ? '상위 15개만 보기' : `전체 ${holdings.length}개 보기`}</button>
    </div>` : ''}
    ${untagged.length ? `<div class="settings-note" style="margin-top:12px;">
      테마 미분류 ${untagged.length}종목 · ${untagged.slice(0, 6).join(', ')}${untagged.length > 6 ? ' 외' : ''}</div>` : ''}
  `;

  /* 테마별 도넛 */
  if (state.charts.tossTag) state.charts.tossTag.destroy();
  const tagTop = tagRows.slice(0, 9);
  const tagRest = tagRows.slice(9).reduce((a, r) => a + r.v, 0);
  const tagFinal = tagRest > 0 ? tagTop.concat([{ name: '기타', v: tagRest }]) : tagTop;
  if (tagFinal.length) {
    state.charts.tossTag = new Chart(document.getElementById('chart-toss-tag'), {
      type: 'doughnut',
      data: {
        labels: tagFinal.map(r => r.name),
        datasets: [{
          data: tagFinal.map(r => Math.round(r.v)),
          backgroundColor: tagFinal.map((_, i) => TOSS_PALETTE[i % TOSS_PALETTE.length]),
          borderColor: '#171e2b', borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatCompactWon(c.raw)}원` } }
        }
      }
    });
    const tagSum = tagFinal.reduce((a, r) => a + r.v, 0) || 1;
    document.getElementById('toss-tag-legend').innerHTML = tagFinal.map((r, i) => `
      <div class="pie-legend-row">
        <span class="pie-legend-swatch" style="background:${TOSS_PALETTE[i % TOSS_PALETTE.length]}"></span>
        <span class="pie-legend-name">${r.name}</span>
        <span class="pie-legend-val">${formatCompactWon(r.v)}원 · ${((r.v / tagSum) * 100).toFixed(1)}%</span>
      </div>`).join('');
  }

  /* 일별 계좌 총액 */
  if (state.charts.tossDaily) state.charts.tossDaily.destroy();
  const daily = t.daily.slice(-90);
  if (daily.length) {
    state.charts.tossDaily = new Chart(document.getElementById('chart-toss-daily'), {
      type: 'line',
      data: {
        labels: daily.map(x => x.date.slice(5)),
        datasets: [
          { label: '계좌 총액', data: daily.map(x => x.total), borderColor: '#c9a227',
            backgroundColor: 'rgba(201,162,39,0.12)', fill: true, tension: 0.25,
            pointRadius: daily.length > 30 ? 0 : 2, borderWidth: 2 },
          { label: '매입액', data: daily.map(x => x.cost), borderColor: '#7f8fa6',
            borderDash: [4, 3], fill: false, tension: 0.25, pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatWon(c.raw)}` } }
        },
        scales: {
          x: { ticks: MONO_TICK, grid: { display: false } },
          y: { ticks: { ...MONO_TICK, callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT }
        }
      }
    });
  } else {
    const c = document.getElementById('chart-toss-daily');
    if (c && c.parentElement) {
      c.parentElement.innerHTML = '<div class="empty-state">일별 기록이 하루치뿐이에요. 며칠 쌓이면 곡선이 그려집니다.</div>';
    }
  }

  const btn = document.getElementById('toss-toggle-all');
  if (btn) btn.addEventListener('click', () => {
    state.tossShowAll = !state.tossShowAll;
    renderTossPanel(hostId, data);
  });
}




const INV_SERIES = [
  { key: 'balance', label: '평가액', color: '#4c8c6b' },
  { key: 'contrib', label: '누적 원금', color: '#e0c766' },
  { key: 'transfer', label: '투자 이체', color: '#39a8bd' },
  { key: 'returns', label: '실현 수익', color: '#d9884f' },
  { key: 'roi', label: '원금 대비 수익률', color: '#9b7fc2' },
  { key: 'share', label: '총자산 대비 비중', color: '#5b8fc7' }
];

/* ---------------- 종목_팩트 시트 → 스터디 카드 자동 생성 ----------------
   시트가 단일 진실 공급원. 내가 배치로 채워두면 대시보드가 읽어서
   유형·5단계·적정가를 자동 계산한다. 로컬 카드가 있으면 그쪽이 우선(수동 오버라이드). */

const FACTS_TAB = '종목_팩트';
const FACT_TYPE_KO = {
  '성장형': 'growth', '안정형': 'stable', '사이클형': 'cyclical',
  '턴어라운드형': 'turnaround', '옵션형': 'option', '자산형': 'asset'
};
/* 개별기업이 아닌 것 — 6유형 틀이 작동하지 않는다 */
const FACT_NONEQUITY = { '레버리지': 'lev', 'ETF': 'etf', '특수': 'lev' };
const FACT_STAGE_KO = {
  src: { '덧셈': 'sell', '가격': 'price', '뺄셈': 'cost', '회계': 'acct', '없음': 'none' },
  quality: { '양호': 'high', '보통': 'mid', '누수': 'low', '손실': 'neg' },
  survive: { '순현금': 'netcash', '양호': 'ok', '소진': 'burn2', '위험': 'burn1' },
  moat: { '검증': 'proven', '점유↓': 'share', '점유하락': 'share', '정책': 'policy', '마진': 'channel' },
  price: { '합의': 'narrow', '분산': 'wide', '무반응': 'nogood', '바닥': 'nobad' }
};
const FACT_NUM_KEYS = ['eps', 'g', 'per', 'dy', 'bps', 'pbrLow', 'pbrAvg', 'pbrHigh', 'neps', 'prob', 'nav', 'disc', 'mcap', 'revT', 'psr', 'years'];

async function fetchStockFacts() {
  const r = await fetch(csvUrlForSheet(FACTS_TAB), { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let text = await r.text();
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.trim().startsWith('<')) throw new Error('탭 접근 불가');
  const rows = Papa.parse(text, { skipEmptyLines: true }).data
    .map(row => row.map(c => (c === null || c === undefined) ? '' : String(c).trim()));
  return parseStockFacts(rows);
}

function parseStockFacts(rows) {
  if (!rows || !rows.length) return {};
  /* 헤더 이름 기반 조회 — 컬럼이 밀려도 안 깨진다 */
  const hdr = rows[0].map(h => h.replace(/\s/g, ''));
  const at = (r, name) => { const i = hdr.indexOf(name); return i === -1 ? '' : (r[i] || ''); };
  const out = {};
  rows.slice(1).forEach(r => {
    const name = at(r, '종목명');
    if (!name) return;
    const tyKo = at(r, '유형');
    const type = FACT_TYPE_KO[tyKo] || null;
    const nonEquity = FACT_NONEQUITY[tyKo] || null;
    const chk = {};
    [['1출처', 'src'], ['2질', 'quality'], ['3생존', 'survive'], ['4해자', 'moat'], ['5가격', 'price']]
      .forEach(([col, id]) => {
        const v = at(r, col);
        const mapped = (FACT_STAGE_KO[id] || {})[v];
        if (mapped) chk[id] = mapped;
      });
    const val = {};
    FACT_NUM_KEYS.forEach(k => { const v = at(r, k); if (v) val[k] = v; });
    out[name] = {
      id: 'sheet:' + name, name, type, nonEquity, tyKo, chk, val,
      price: at(r, '현재가'), stop: at(r, '손절조건'), take: at(r, '익절조건'),
      weight: at(r, '목표비중'), memo: at(r, '메모') ? { sheet: at(r, '메모') } : {},
      crit: [], source: 'sheet'
    };
  });
  return out;
}

/* 개별기업이 아닌 상품 — 별도 판정 */
const FACT_NONEQ_INFO = {
  lev: {
    label: '레버리지', tag: '기초자산의 배수를 추종하는 파생 상품',
    why: '<b>기업이 아니라서 기업 분석 틀이 작동하지 않는다.</b> 이익도 자산도 해자도 없다. 분류·5단계·적정가 모두 해당 없음.',
    rule: '보유 기간 제한이 유일한 관리 수단. 변동성 끌림 때문에 기초자산이 제자리로 돌아와도 손실이 남는다.',
    stop: '정해둔 보유 기간 경과 (판단이 아니라 달력)'
  },
  etf: {
    label: 'ETF', tag: '지수·바스켓 추종 상품',
    why: '개별기업 분석 대상이 아니다. 편입 종목이 알아서 교체되므로 유형 분류가 무의미하다.',
    rule: '지수 ETF는 사실상 손절 기준이 필요 없다. 비중과 적립 규칙으로만 관리.',
    stop: '자산배분 목표 이탈 시 리밸런싱'
  }
};

/* ---------------- 밸류에이션: 유형이 방법을 정한다 ----------------
   적정가는 사실이 아니라 가정의 출력이다. 그래서 점이 아니라 밴드로 내고,
   "지금 가격이 참이 되려면 무엇이 필요한가"를 역산으로 함께 보여준다. */

const STUDY_VAL = {
  growth: {
    method: '3년 뒤 EPS × 목표 PER → 현재가치 할인',
    why: '성장형은 지금 이익이 아니라 <b>몇 년 뒤 이익</b>에 값을 매긴다. 대신 그만큼 할인해서 끌어와야 한다.',
    inputs: [
      ['eps', '현재 주당순이익 (EPS)', '최근 4개 분기 합산'],
      ['g', '향후 3년 예상 연평균 성장률', '%'],
      ['per', '3년 뒤 적용할 PER', '동종업계 성숙기 배수']
    ],
    calc: (v, price) => {
      const f = v.eps * Math.pow(1 + v.g / 100, 3);
      const pv = (k) => f * v.per * k / Math.pow(1.10, 3);
      return {
        low: pv(0.75), base: pv(1), high: pv(1.25),
        note: `3년 뒤 EPS ${Math.round(f).toLocaleString()} × PER ${v.per} 를 연 10%로 할인. 밴드는 PER ±25%.`,
        reverse: (() => {
          const need = price * Math.pow(1.10, 3) / v.per;
          const gNeed = (Math.pow(need / v.eps, 1 / 3) - 1) * 100;
          return `지금 가격이 정당화되려면 3년 뒤 EPS가 <b>${Math.round(need).toLocaleString()}</b> (연 ${gNeed.toFixed(1)}% 성장) 이어야 한다.`;
        })()
      };
    }
  },
  stable: {
    method: '이익 × 과거 PER 밴드',
    why: '안정형은 이익이 평평하니 <b>배수만 정하면</b> 값이 나온다. 싸게 사는 것 자체가 수익의 대부분이다.',
    inputs: [
      ['eps', '주당순이익 (EPS)', '최근 4개 분기 합산'],
      ['per', '과거 평균 PER', '5년 평균 정도'],
      ['dy', '배당수익률', '% · 선택']
    ],
    calc: (v, price) => {
      const b = v.eps * v.per;
      return {
        low: b * 0.8, base: b, high: b * 1.2,
        note: `EPS × PER ${v.per}. 밴드는 ±20%.${v.dy ? ` 배당수익률 ${v.dy}% 는 여기에 더해지는 수익.` : ''}`,
        reverse: `지금 가격은 PER <b>${(price / v.eps).toFixed(1)}배</b>. 과거 평균 ${v.per}배 대비 ${price / v.eps > v.per ? '비싸다' : '싸다'}.`
      };
    }
  },
  cyclical: {
    method: 'BPS × 과거 PBR 밴드',
    why: '<b>PER을 쓰면 안 된다.</b> 정점에서 가장 싸 보이고 바닥에서 가장 비싸 보여 신호가 거꾸로 나온다. 자산가치는 사이클을 타지 않는다.',
    inputs: [
      ['bps', '주당순자산 (BPS)', '자기자본 ÷ 주식수'],
      ['pbrLow', '과거 PBR 저점', '불황기 바닥'],
      ['pbrAvg', '과거 PBR 평균', '사이클 전체 평균'],
      ['pbrHigh', '과거 PBR 고점', '호황기 천장']
    ],
    calc: (v, price) => ({
      low: v.bps * v.pbrLow, base: v.bps * v.pbrAvg, high: v.bps * v.pbrHigh,
      note: `BPS ${Math.round(v.bps).toLocaleString()} 에 과거 PBR 저점·평균·고점을 각각 적용.`,
      reverse: `지금 가격은 PBR <b>${(price / v.bps).toFixed(2)}배</b> — 과거 밴드에서 ${price / v.bps >= v.pbrHigh ? '고점 위' : price / v.bps <= v.pbrLow ? '저점 아래' : `${(((price / v.bps) - v.pbrLow) / (v.pbrHigh - v.pbrLow) * 100).toFixed(0)}% 지점`}.`
    })
  },
  turnaround: {
    method: '정상화 이익 × PER × 회복 확률',
    why: '<b>지금 이익이 아니라 회복이 끝났을 때의 이익</b>으로 값을 매긴다. 대신 회복이 실패할 확률을 반드시 곱해야 한다.',
    inputs: [
      ['neps', '회복 완료 시 예상 주당순이익', '정상화 EPS'],
      ['per', '적용 PER', '업종 평균'],
      ['prob', '회복 성공 확률', '% · 냉정하게']
    ],
    calc: (v, price) => {
      const b = v.neps * v.per * (v.prob / 100);
      return {
        low: b * 0.7, base: b, high: b * 1.3,
        note: `정상화 EPS ${Math.round(v.neps).toLocaleString()} × PER ${v.per} × 확률 ${v.prob}%. 확률을 안 곱하면 턴어라운드 밸류에이션이 아니다.`,
        reverse: `지금 가격이 정당화되려면 회복 확률이 <b>${Math.min(999, (price / (v.neps * v.per) * 100)).toFixed(0)}%</b> 여야 한다.`
      };
    }
  },
  asset: {
    method: '주당 NAV × (1 − 할인율)',
    why: '자산형은 <b>할인율이 전부</b>다. 싸다는 것과 오른다는 건 다르다. 할인율을 좁힐 촉매가 없으면 10년도 싼 채로 있는다.',
    inputs: [
      ['nav', '주당 순자산가치 (NAV)', '보유자산 시가 − 부채'],
      ['disc', '적용 할인율', '% · 지주사는 보통 40~60']
    ],
    calc: (v, price) => ({
      low: v.nav * (1 - Math.min(95, v.disc + 15) / 100),
      base: v.nav * (1 - v.disc / 100),
      high: v.nav * (1 - Math.max(0, v.disc - 15) / 100),
      note: `NAV ${Math.round(v.nav).toLocaleString()} 에 할인율 ${v.disc}% 적용. 밴드는 할인율 ±15%p.`,
      reverse: `지금 가격의 실제 할인율은 <b>${((1 - price / v.nav) * 100).toFixed(0)}%</b>. 이걸 좁힐 촉매가 있는지가 전부다.`
    })
  },
  option: {
    method: '미래 매출 × PSR → 역산 (적정가 산출 불가)',
    why: '<b>이 유형은 적정가를 낼 수 없다.</b> 이익이 없으니 배수를 걸 대상이 없다. 대신 지금 가격이 무엇을 가정하고 있는지를 역산한다.',
    inputs: [
      ['mcap', '현재 시가총액', '억원 또는 백만달러'],
      ['revT', 'N년 뒤 예상 연매출', '같은 단위'],
      ['psr', '그때 적용할 PSR', '성숙기 배수'],
      ['years', '몇 년 뒤인가', 'N년']
    ],
    calc: (v, price) => {
      const fut = v.revT * v.psr;
      const disc = Math.pow(1.15, v.years);
      const ratio = (fut / disc) / v.mcap;
      const needRev = v.mcap * disc / v.psr;
      return {
        low: price * ratio * 0.5, base: price * ratio, high: price * ratio * 1.5,
        note: `${v.years}년 뒤 매출 × PSR ${v.psr} 을 연 15%로 할인 → 현재 시총의 ${ratio.toFixed(2)}배. 밴드가 ±50%인 건 이 유형의 불확실성이 그만큼이라는 뜻이다.`,
        reverse: `지금 가격이 정당화되려면 ${v.years}년 뒤 연매출이 <b>${Math.round(needRev).toLocaleString()}</b> (현재 대비 필수 성장)이어야 한다. 이 숫자가 현실적인지가 유일한 질문이다.`
      };
    }
  }
};

/* 입력이 다 찼는지 확인하고 계산 */
function studyValue(type, valInputs, priceRaw) {
  const cfg = STUDY_VAL[type];
  if (!cfg) return null;
  const price = Number(String(priceRaw || '').replace(/[^0-9.\-]/g, ''));
  if (!price || price <= 0) return { need: true, cfg };
  const v = {};
  let missing = false;
  cfg.inputs.forEach(([k, , hint]) => {
    const raw = Number(String((valInputs || {})[k] || '').replace(/[^0-9.\-]/g, ''));
    if (!raw && !(hint || '').includes('선택')) missing = true;
    v[k] = raw;
  });
  if (missing) return { need: true, cfg };
  let r;
  try { r = cfg.calc(v, price); } catch (e) { return { need: true, cfg }; }
  if (!isFinite(r.base) || r.base <= 0) return { need: true, cfg };
  const lo = Math.min(r.low, r.base, r.high), hi = Math.max(r.low, r.base, r.high);
  return {
    need: false, cfg, price, low: lo, base: r.base, high: hi,
    note: r.note, reverse: r.reverse,
    gap: (r.base / price - 1) * 100,
    pos: hi > lo ? Math.max(0, Math.min(100, (price - lo) / (hi - lo) * 100)) : 50
  };
}

/* 밴드 막대 — 현재가가 밴드 어디에 있는지 */
function studyBandBar(r, compact) {
  if (!r || r.need) return '';
  const fmt = (n) => Math.round(n).toLocaleString();
  return `
    <div class="sv-band ${compact ? 'compact' : ''}">
      <div class="sv-track">
        <div class="sv-fill"></div>
        <div class="sv-base" style="left:${r.high > r.low ? Math.max(0, Math.min(100, (r.base - r.low) / (r.high - r.low) * 100)) : 50}%"></div>
        <div class="sv-now" style="left:${r.pos}%"><span>현재가</span></div>
      </div>
      <div class="sv-legend">
        <span>보수 ${fmt(r.low)}</span>
        <span class="mid">기본 ${fmt(r.base)}</span>
        <span>낙관 ${fmt(r.high)}</span>
      </div>
    </div>`;
}

/* ================= 자산 > 투자 > 스터디 : 종목 판단 흐름 =================
   화면 정중앙에 판단할 항목이 하나씩 들어온다. 고르면 해석을 돌려주고 다음 항목으로.
   0단계 분류 → 유형 발표(처방전) → 1~5단계 검토 → 손절/익절 → 처방전 한 장. */

const STUDY_TYPES = {
  growth: {
    label: '성장형', tag: '이익이 계단식으로 커지는 회사',
    tool: 'PEG · 매출성장률', track: '성장률 둔화 시점',
    stop: '성장률이 정해둔 선 아래로', size: '중간',
    trap: '성장률은 반드시 언젠가 꺾인다. "얼마나 크냐"가 아니라 "언제 꺾이냐"가 이 유형의 유일한 질문이다.',
    w: { src: 2, quality: 1, survive: 0, moat: 2, price: 2 },
    h: {
      src: '매출이 늘어서 난 이익인지가 전부다. 비용 절감으로 난 이익이면 애초에 성장형이 아니다.',
      quality: '성장기엔 이익률이 낮아도 되지만, 방향이 개선인지 악화인지는 봐야 한다.',
      survive: '흑자 성장이면 대개 문제없다. 성장에 자금이 계속 필요한 구조인지만 확인.',
      moat: '성장은 반드시 경쟁을 부른다. 후발주자가 못 따라오는 이유를 한 줄로 말할 수 있어야 한다.',
      price: '이미 성장이 가격에 다 들어가 있는 경우가 대부분이다. 기대치를 넘어야 오른다.'
    }
  },
  stable: {
    label: '안정형', tag: '이익이 평평하게 유지되는 회사',
    tool: 'PER · 배당수익률 · FCF', track: '이익 방어력 · 배당 지속성',
    stop: '배당 삭감 · 점유율 구조적 하락', size: '크게 가능',
    trap: '안정형의 진짜 위험은 급락이 아니라 "천천히 낡는 것". 아무 일도 안 일어나는 동안 대체되고 있을 수 있다.',
    w: { src: 1, quality: 2, survive: 0, moat: 2, price: 2 },
    h: {
      src: '드라마틱한 변화가 없는 게 정상이다. 갑자기 이익이 튀면 오히려 일회성을 의심.',
      quality: '이 유형의 핵심. 번 돈이 배당·자사주로 실제로 돌아오는지가 전부다.',
      survive: '보통 문제되지 않는다. 부채비율만 확인.',
      moat: '규제·인프라·브랜드 중 무엇이 이 안정성을 만드는지 특정할 수 있어야 한다.',
      price: '싸게 사는 것 자체가 수익의 대부분. 비싸게 산 안정형은 채권만도 못하다.'
    }
  },
  cyclical: {
    label: '사이클형', tag: '이익이 파도처럼 오르내리는 회사',
    tool: 'PBR · 정상화 이익 (PER 아님)', track: '제품 가격 · 사이클 위치',
    stop: '제품 가격 사이클의 하강 전환', size: '중간',
    trap: 'PER이 가장 싸 보일 때가 정점이고 가장 비싸 보일 때가 바닥이다. 신호가 정확히 거꾸로 나온다.',
    w: { src: 2, quality: 1, survive: 0, moat: 1, price: 2 },
    h: {
      src: '이익의 출처는 거의 항상 "가격"이다. 내 실력이 아니라는 점을 인정하고 시작한다.',
      quality: '정점 이익엔 성과급·환율 같은 일회성이 섞이기 쉽다. 걷어내고 봐야 한다.',
      survive: '정점에선 무의미하고 바닥에선 결정적. 사이클 위치가 가중치를 정한다.',
      moat: '사이클형의 해자는 대개 원가 경쟁력과 생존력이다. 불황에 남을 회사인가.',
      price: 'PER 말고 PBR로 봐라. 자산가치는 사이클을 타지 않아 제자리를 지켜준다.'
    }
  },
  turnaround: {
    label: '턴어라운드형', tag: '이익이 바닥에서 회복 중인 회사',
    tool: 'EV/EBITDA · 회복률', track: '매출 성장률 (이익 아님)',
    stop: '회복이 N개 분기 이상 지연', size: '중간~작게',
    trap: '이익 회복은 뺄셈으로도 만들어진다. 하지만 매출 회복은 못 속인다. 그래서 이익이 아니라 매출을 본다.',
    w: { src: 2, quality: 2, survive: 1, moat: 2, price: 1 },
    h: {
      src: '이 유형의 생사가 걸린 질문. 덧셈(매출)인가 뺄셈(비용)인가. 뺄셈이면 한 번짜리다.',
      quality: '적자를 벗어난 직후엔 이자비용이 이익을 대부분 먹는다. 순이익까지 내려가서 확인.',
      survive: '회복이 완성되기 전에 자금이 마르면 판단이 옳아도 진다.',
      moat: '"업황이 돌아온다"와 "내 이익이 돌아온다"는 다른 명제다. 여기서 대부분이 틀린다.',
      price: '회복 초입엔 지표가 다 이상하게 나온다. 시장이 안 믿는 이유를 먼저 알아야 한다.'
    }
  },
  option: {
    label: '옵션형', tag: '아직 이익이 없는 회사',
    tool: '현금 소진 속도 · 손익분기점', track: '현금과 EBITDA 궤적',
    stop: '없음 — 사이징으로 대체', size: '잃어도 되는 만큼만',
    trap: '이 유형엔 손절 기준이 존재하지 않는다. 가격이 논리와 무관하게 움직이기 때문. 손절 결정은 매수하는 순간 이미 끝나 있어야 한다.',
    w: { src: 0, quality: 0, survive: 2, moat: 2, price: 1 },
    h: {
      src: '아직 볼 이익이 없다. 매출이 있다면 그게 진짜 제품 판매인지만 확인.',
      quality: '흑자 전환 전까지는 의미 없는 단계. 건너뛰어도 된다.',
      survive: '이 유형 분석의 절반. 현금 − 차입, 분기 소진액, 남은 개월 수를 직접 계산한다.',
      moat: '이익이 없으니 기술·특허·수주잔고가 유일한 근거다. 실제 계약으로 나오는지 확인.',
      price: '밸류에이션이 불가능하다. 목표주가는 참고도 되지 않는다.'
    }
  },
  asset: {
    label: '자산형', tag: '가치의 원천이 이익이 아니라 보유 자산인 회사',
    tool: 'NAV · PBR', track: 'NAV 할인율 · 자산 매각 여부',
    stop: '할인율 확대가 고착', size: '중간',
    trap: '싸다는 것과 오른다는 것은 다르다. 할인율을 좁힐 촉매(매각·배당·지배구조 변화)가 없으면 10년도 싼 채로 있는다.',
    w: { src: 1, quality: 1, survive: 1, moat: 0, price: 2 },
    h: {
      src: '영업이익보다 자산에서 나오는 수익(배당·임대·지분법)의 비중을 먼저 확인.',
      quality: '장부가와 실제 시장가치의 괴리를 확인. 장부가는 거짓말을 자주 한다.',
      survive: '자산이 많아도 현금이 없으면 급매를 하게 된다. 유동성은 따로 본다.',
      moat: '대체로 해당 없음. 자산의 질 자체가 해자다.',
      price: '이 유형의 전부. 할인율이 과거 평균 대비 어디인지, 좁힐 촉매가 있는지.'
    }
  }
};

/* 0단계 분류 문답 — 고르면 해석을 돌려준다 */
const STUDY_Q = {
  q1: {
    eyebrow: '0단계 · 분류',
    ask: '이 회사는 지금 돈을 버는가?',
    why: '가장 먼저 갈라야 하는 질문. 여기서 틀리면 이후의 모든 도구가 잘못 작동한다. 적자 기업에 PER을 들이대는 것 같은 일이 벌어진다.',
    lens: '분류의 유일한 기준은 <b>"이 회사의 미래 이익을 결정하는 지배 변수가 무엇인가"</b>다. 업종도 시총도 아니다.',
    opts: [
      ['profit', '흑자다', '영업이익과 순이익이 플러스', '',
        '그럼 다음 갈림길은 <b>그 이익이 어디서 오는가</b>다. 같은 흑자라도 원천이 회사 밖이면 완전히 다른 종목이 된다.'],
      ['loss', '적자다', '아직 이익이 없거나 손실 중', 'warn',
        '<b>옵션형</b>으로 분류된다. 이 순간 PER·목표주가 같은 도구는 전부 버려야 한다. 남는 건 현금과 시간뿐이다.'],
      ['assetheavy', '버는 돈보다 가진 것이 크다', '지주회사 · 부동산 과다 보유 등', '',
        '<b>자산형</b>이다. 이익이 아니라 가진 것의 가치와 그 할인율이 분석 대상이 된다.']
    ]
  },
  q2: {
    eyebrow: '0단계 · 분류',
    ask: '이익을 결정하는 것이 회사 밖인가, 안인가?',
    why: '분류 전체에서 가장 중요한 갈림길이다. 여기가 갈려야 PER을 믿을지 말지가 정해진다.',
    lens: '판별법 한 줄 — <b>"이 회사가 아무것도 안 바꿔도 이익이 절반이 될 수 있는가?"</b> 답이 예라면 회사 밖이 지배하는 것이다.',
    opts: [
      ['outside', '회사 밖 — 제품 가격 · 업황', '반도체 · 화학 · 해운 · 정유처럼 가격이 이익을 결정', '',
        '<b>사이클형</b>이다. 지금부터 PER은 신뢰하면 안 되는 지표가 된다. 정점에서 가장 싸 보이기 때문.'],
      ['inside', '회사 안 — 실력 · 전략 · 제품', '회사가 잘하면 이익이 늘어나는 구조', '',
        '회사의 실력이 이익을 만든다. 이제 <b>그 이익이 지금 어느 국면인지</b>만 정하면 분류가 끝난다.']
    ]
  },
  q3: {
    eyebrow: '0단계 · 분류',
    ask: '이익이 지금 어느 국면인가?',
    why: '회사를 분류하는 게 아니라 "지금 이 국면"을 분류하는 것이다. 같은 회사도 시간에 따라 칸을 옮겨 다닌다.',
    lens: '<b>칸이 바뀌는 순간이 재평가가 일어나는 순간</b>이다. 삼성전자도 2023년엔 턴어라운드형이었고 지금은 사이클 정점에 있다.',
    opts: [
      ['up', '커지는 중', '전년 대비 이익이 추세적으로 증가', '', '<b>성장형</b>으로 분류된다.'],
      ['flat', '유지되는 중', '큰 변화 없이 안정적', '', '<b>안정형</b>으로 분류된다.'],
      ['recover', '바닥에서 회복 중', '적자 · 부진에서 빠져나오는 중', '', '<b>턴어라운드형</b>으로 분류된다.']
    ]
  }
};

const STUDY_CHECK = [
  {
    id: 'src', n: 1, ask: '이익은 어디서 왔나?',
    why: '가계부를 여는 단계. 이번 달에 돈이 남았다고 다 같은 게 아니다. 월급이 올랐나, 씀씀이를 줄였나, 적금을 깼나.',
    lens: '시장은 <b>덧셈으로 번 돈과 뺄셈으로 번 돈에 전혀 다른 값</b>을 매긴다. 같은 이익 증가라도 주가 반응이 정반대로 나온다.',
    opts: [
      ['sell', '제품·서비스가 더 팔려서', '덧셈', 'good',
        '가장 좋은 형태. 재평가로 이어질 수 있다. 남은 질문은 <b>이게 몇 분기 더 가는가</b> 하나뿐이다.'],
      ['price', '판매 가격이 올라서', '외부 요인', '',
        '내 실력이 아니다. 이익이 아니라 <b>가격 사이클의 위치</b>를 봐야 한다. 사이클형으로 재분류할지 검토해볼 것.'],
      ['cost', '비용을 줄여서', '뺄셈', 'warn',
        '한 번밖에 못 쓰는 카드. 내년엔 기저에 깔려 성장 기여가 사라진다. 실적이 좋아도 목표가가 깎이는 일이 여기서 생긴다. <b>멀티플 확장은 매출이 늘 때만</b> 일어난다.'],
      ['acct', '회계·일회성 (합의금·보험금·환율)', '현금과 무관할 수 있음', 'warn',
        '이 금액을 걷어내고 다시 계산해야 진짜 추세가 보인다. 이연수익이면 앞으로 몇 분기 더 들어오는지까지 확인할 것.'],
      ['none', '아직 이익이 없다', '', '',
        '이 단계는 건너뛴다. 3단계 생존이 이 종목 분석의 절반이다.']
    ]
  },
  {
    id: 'quality', n: 2, ask: '그 이익이 끝까지 내려오나?',
    why: '수도관 점검. 상류에서 100을 흘려보냈는데 수도꼭지에서 30이 나오면 중간 어딘가에 새는 곳이 있는 것이다.',
    lens: '보는 법 — <b>순이익 ÷ 영업이익</b>. 차액이 크면 그 원인(이자·세금·소수주주지분)을 반드시 특정할 것.',
    opts: [
      ['high', '80% 이상', '누수 거의 없음', 'good', '깨끗하다. 영업이익 추세를 그대로 믿어도 된다.'],
      ['mid', '50 ~ 80%', '보통', '', '이자인지 세금인지 확인. 이자라면 차입 만기 구조까지 봐야 한다.'],
      ['low', '50% 미만', '누수 큼', 'warn',
        '번 돈의 절반 이상이 밖으로 샌다. 대개 이자비용이 주범이고, 이건 <b>영업이익이 늘어도 주주 몫은 안 는다</b>는 뜻이다.'],
      ['neg', '순손실이다', '', 'warn', '이익의 질을 논할 단계가 아니다. 생존으로 넘어간다.']
    ]
  },
  {
    id: 'survive', n: 3, ask: '그때까지 버티나?',
    why: '잠수부의 산소통. 아무리 정확한 판단도 산소가 떨어지면 실현되지 않는다. 옳았는데 죽는 경우가 실제로 있다.',
    lens: '계산할 것 — <b>현금 − 차입</b>, 분기 소진액, 남은 개월 수. 이 단계의 가중치는 유형이 정한다.',
    opts: [
      ['netcash', '순현금이다 (현금 > 차입)', '', 'good', '시간을 살 수 있다. 판단이 늦게 맞아도 견딜 수 있다는 뜻.'],
      ['ok', '차입은 있지만 영업현금흐름 +', '', '', '당장은 위험하지 않다. 만기 구조와 금리만 확인.'],
      ['burn2', '현금 소진 중 · 2년 이상 버팀', '', '', '옵션으로 취급할 것. 가격이 아니라 <b>사이징</b>으로 관리한다.'],
      ['burn1', '1년 미만치 현금', '', 'warn', '증자 위험. 지분 희석이 일어나면 판단이 맞아도 수익률은 깎인다.']
    ]
  },
  {
    id: 'moat', n: 4, ask: '업황이 좋아지면 "내"가 좋아지나?',
    why: '밀물이 들어오면 모든 배가 뜬다지만, 내 배 바닥에 구멍이 났으면 물만 들어온다.',
    lens: '<b>업황 명제와 기업 명제 사이에 등호를 놓는 순간 분석은 끝난 것</b>이다. "중국인이 돌아온다"와 "이 회사 이익이 돌아온다"는 다른 명제다.',
    opts: [
      ['proven', '업황 개선이 내 매출로 이어진 이력이 있다', '', 'good', '검증된 연결고리. 업황 지표를 선행지표로 써도 된다.'],
      ['share', '업황은 좋은데 내 몫이 줄고 있다', '점유율 하락', 'warn',
        '가장 위험한 조합. 시장이 커지는데 내 매출이 안 크면 구조적으로 밀리고 있는 것이다.'],
      ['policy', '정책·규제가 지배한다', '통제 밖', 'warn',
        '경영진이 잘해도 안 되는 변수다. 이건 실력이 아니라 <b>정책에 대한 베팅</b>이라는 걸 인정하고 사이징해야 한다.'],
      ['channel', '경쟁·대체채널로 마진 회복이 불확실', '', 'warn',
        '수요가 돌아와도 예전 마진으로는 못 돌아올 수 있다. 물량과 마진을 분리해서 볼 것.']
    ]
  },
  {
    id: 'price', n: 5, ask: '시장은 이미 뭘 알고 있나?',
    why: '이길 말을 찍는 게 아니라 배당률 대비 빠른 말을 찍는 것이다. 좋은 회사도 이미 그 값이 붙어 있으면 먹을 게 없다.',
    lens: '목표주가는 평균이 아니라 <b>분산</b>을 봐라. 그리고 뉴스보다 <b>뉴스에 대한 반응</b>을 봐라.',
    opts: [
      ['narrow', '목표주가 분산이 좁다', '합의 존재', '', '컨센서스가 있다. 남들이 다 아는 것이므로 초과수익 여지가 작다.'],
      ['wide', '분산이 2배 이상 벌어져 있다', '합의 없음', '',
        '전문가들도 갈린다는 뜻. 남의 결론을 빌려올 수 없고, <b>내 관점이 없으면 애초에 살 자리가 아니다.</b>'],
      ['nogood', '좋은 뉴스에도 안 오른다', '', 'warn',
        '가장 나쁜 신호. 나쁜 뉴스에 내리는 것보다 훨씬 나쁘다. 시장이 개선의 지속성을 안 믿는다는 뜻.'],
      ['nobad', '나쁜 뉴스에도 안 내린다', '', 'good',
        '악재 소화가 끝났을 가능성. 바닥 신호로 볼 수 있는 몇 안 되는 가격 정보다.']
    ]
  }
];

const STUDY_CRITERIA = [
  '공시·지표로 관측 가능하다',
  '분기마다 주기적으로 확인된다',
  '해석의 여지가 없다 (숫자로 참·거짓이 갈린다)',
  '지금 미리 숫자로 적어둘 수 있다'
];

const STUDY_WLABEL = { 2: ['핵심', 'core'], 1: ['보통', 'mid'], 0: ['참고', 'low'] };
const STUDY_PHASES = [
  ['분류', ['q1', 'q2', 'q3', 'type']],
  ['검토', ['src', 'quality', 'survive', 'moat', 'price', 'value']],
  ['판정', ['stop', 'take', 'done']]
];
const STUDY_CARDS_KEY = 'haedal:study-cards';

function studyLoadCards() {
  /* 원장은 Supabase(study_cards). 아직 못 불러왔을 때만 예전 로컬 카드를 쓴다. */
  try {
    if (SDX && SDX.rows && SDX.rows.length) {
      return SDX.rows.map(r => ({
        id: 'sdx' + r.id, name: r.name, type: r.type || null,
        ans: r.ans || {}, chk: r.chk || {}, memo: r.note_by_stage || {},
        stop: r.stop || '', take: r.take || '',
        weight: (r.weight == null ? '' : String(r.weight)),
        crit: [], val: r.val || {}, price: r.price || '',
        nonEquity: r.non_equity || null,
        ts: String(r.updated_at || '').slice(0, 10)
      }));
    }
  } catch (e) {}
  try { return JSON.parse(localStorage.getItem(STUDY_CARDS_KEY) || '[]'); } catch (e) { return []; }
}
function studySaveCards(list) { try { localStorage.setItem(STUDY_CARDS_KEY, JSON.stringify(list)); } catch (e) {} }
function studyReset() {
  state.study = { name: '', step: 0, ans: {}, chk: {}, memo: {}, stop: '', take: '', weight: '', crit: [], val: {}, price: '', editId: null };
}
function studyType() {
  const a = (state.study && state.study.ans) || {};
  if (a.q1 === 'loss') return 'option';
  if (a.q1 === 'assetheavy') return 'asset';
  if (a.q1 === 'profit') {
    if (a.q2 === 'outside') return 'cyclical';
    if (a.q2 === 'inside') {
      if (a.q3 === 'up') return 'growth';
      if (a.q3 === 'flat') return 'stable';
      if (a.q3 === 'recover') return 'turnaround';
    }
  }
  return null;
}
function studySteps() {
  const a = (state.study && state.study.ans) || {};
  const arr = ['q1'];
  if (a.q1 === 'profit') { arr.push('q2'); if (a.q2 === 'inside') arr.push('q3'); }
  if (studyType()) arr.push('type', 'src', 'quality', 'survive', 'moat', 'price', 'value', 'stop', 'take', 'done');
  return arr;
}
/* 지금 화면에서 '판단'이 끝났는지 — 끝나야 다음으로 넘어갈 수 있다 */
function studyAnswered(id) {
  const S = state.study;
  if (id === 'q1' || id === 'q2' || id === 'q3') return !!S.ans[id];
  if (STUDY_CHECK.some(c => c.id === id)) return !!S.chk[id];
  return true;
}
/* 지나온 판단 요약 (되돌아가기용 칩) */
function studyTrail() {
  const S = state.study, out = [];
  const push = (stepId, n, label) => out.push({ stepId, n, label });
  ['q1', 'q2', 'q3'].forEach(q => {
    if (!S.ans[q]) return;
    const o = STUDY_Q[q].opts.find(x => x[0] === S.ans[q]);
    if (o) push(q, '', o[1]);
  });
  STUDY_CHECK.forEach(c => {
    if (!S.chk[c.id]) return;
    const o = c.opts.find(x => x[0] === S.chk[c.id]);
    if (o) push(c.id, c.n, o[1]);
  });
  return out;
}

/* 입력 중 포커스가 튀지 않도록 결과 영역만 갈아끼운다 */
let studyValTimer = null;
function studyValRefresh() {
  clearTimeout(studyValTimer);
  studyValTimer = setTimeout(() => {
    const S = state.study, T = studyType();
    const host = document.getElementById('panel-study');
    if (!host || !T) return;
    const grid = host.querySelector('.sv-grid');
    if (!grid) return;
    const r = studyValue(T, S.val, S.price);
    let slot = host.querySelector('#sv-out');
    if (!slot) { slot = document.createElement('div'); slot.id = 'sv-out'; grid.insertAdjacentElement('afterend', slot); }
    /* 최초 렌더 때 만들어진 정적 결과 블록 제거 */
    host.querySelectorAll('.sv-band,.sv-gap,.sv-rev').forEach(el => { if (!slot.contains(el)) el.remove(); });
    const stale = grid.nextElementSibling;
    if (stale && stale !== slot && stale.classList.contains('sd-why')) stale.remove();
    slot.innerHTML = (r && !r.need) ? `
      ${studyBandBar(r)}
      <div class="sv-gap">기본값 대비 현재가 <b class="${r.gap >= 0 ? 'up' : 'down'}">${r.gap >= 0 ? '+' : '−'}${Math.abs(r.gap).toFixed(0)}%</b>
        ${r.gap >= 0 ? '저평가 구간' : '고평가 구간'}<span style="font-size:11.5px;color:var(--text-faint);"> — 어디까지나 내 가정 기준</span></div>
      <div class="sd-why" style="margin:9px 0 0;font-size:11.5px;">${r.note}</div>
      <div class="sv-rev">역산 — ${r.reverse}</div>`
      : '<div class="sd-why" style="margin-top:14px;">숫자를 채우면 밴드가 나와요. 모르는 값이 있으면 이 단계는 건너뛰어도 됩니다.</div>';
  }, 160);
}

/* ================= 자산 > 투자 > 스터디 : 종목 검토 보드 =================
   게이트 0~5를 종목별로 채워 넣는 카드 한 장. 원장은 Supabase(study_cards)에 있고
   입력하는 즉시 저장된다. 왼쪽은 종목 목록, 오른쪽은 지금 보고 있는 종목의 카드. */

const SD_G0 = [
  ['g1', '3년 연속 영업적자 + 흑자 전환 시점 미제시', '가치 평가가 성립하지 않는다. 투자가 아니라 옵션 베팅.'],
  ['g2', '최근 2년 주식수 10% 이상 증가', '희석이 성장을 먹는다. 주당 가치가 늘지 않는다.'],
  ['g3', '현금소진율 기준 잔여 런웨이 18개월 미만', '증자가 강제된다. 시점은 내가 못 고른다.'],
  ['g4', '사업 내용을 3문장으로 못 쓰겠다', '이해하지 못한 것. 이해 못 한 건 들고 버틸 수 없다.']
];
const SD_G1 = [
  ['cov', '커버리지 공백', '애널리스트 3명 이하 · 컨콜 질문자 4명 이하'],
  ['size', '사이즈 배제', '시총 3조 미만 + 일평균 거래대금 낮음'],
  ['mis', '분류 오류', '실제 사업과 등록 섹터가 다름'],
  ['forced', '강제 매도', '스핀오프 · 지수 편출 · 소송 종결 직후'],
  ['hate', '혐오 산업', 'ESG 배제 · 사양산업 오인 · 지루함']
];
const SD_G2 = [
  ['s1', '매출총이익률 추세', '8분기 개선 또는 유지', 2],
  ['s2', '매출 증가율 vs 판관비 증가율', '매출이 더 빠름', 2],
  ['s3', 'ROIC', '10% 이상이면서 자본비용 상회', 3],
  ['s4', 'FCF ÷ 순이익 (3년 평균)', '1.0 이상', 3],
  ['s5', '매출채권 회전일수', '매출 증가율보다 느리게 증가', 1],
  ['s6', '수주잔고 · 이연매출', '매출보다 빠르게 증가', 2],
  ['s7', '상위 1개 고객 매출 비중', '20% 미만', 1]
];
const SD_GRADE = [
  [12, 14, '우량', '8~10%', '3회 분할 · 6개월 이상'],
  [9, 11, '성장', '5~7%', '3회 분할'],
  [6, 8, '턴어라운드', '4~5%', '2회 분할 · 실적 확인 후'],
  [3, 5, '옵션형', '2~3%', '일괄 · 손절선 사전 설정'],
  [0, 2, '매수 금지', '0%', '—']
];
const SD_VERDICT = [
  ['buy', '신규매수'], ['add', '추가매수'], ['hold', '유지'],
  ['trim', '축소'], ['exit', '전량매도'], ['watch', '관망']
];
const SD_TYPE_OPTS = [
  ['growth', '성장형'], ['stable', '안정형'], ['cyclical', '순환형'],
  ['turnaround', '턴어라운드'], ['option', '옵션형'], ['asset', '자산형']
];

/* 관심 레벨 — 등급(얼마나 좋은가)이 아니라 매수 준비도(다음 자금이 어디로 가는가)다.
   정원이 이 체계의 전부다. 상한이 없으면 석 달 안에 전부 L1으로 몰려서 등급이 사라진다.
   [키, 이름, 정원(0=무제한), 진입 조건, 입력칸 이름, 예시] */
const SD_WATCH = [
  ['L1', '대기 발주', 3, '자금 생기면 즉시 매수 — 진입가까지 정해진 것',
    '진입 조건 — 가격 · 투입액', '예: 46달러 이하 · 1차 60만원'],
  ['L2', '트리거 대기', 8, '확인 이벤트만 남은 것 — 날짜가 반드시 있어야 한다',
    '트리거 이벤트', '예: 3분기 실적에서 동일점포 매출 플러스 전환'],
  ['L3', '아이디어', 0, '이유 한 줄만 있는 것 — 90일 방치되면 지운다',
    '관심 이유 — 한 문장', '예: 관세 완화 수혜인데 아직 안 봄']
];
const SD_WATCH_STALE = 90;   /* L3 자동 정리 기준(일) */
const SD_WATCH_GRACE = 14;   /* L2 트리거 경과 허용(일) */

const SDX = { rows: [], byName: {}, loaded: false, sel: null, q: '', filter: 'all', timers: {}, saved: '' };

async function sdxLoad(force) {
  if (SDX.loaded && !force) return SDX.rows;
  try {
    const sb = await enClient();
    const { data } = await sb.from('study_cards').select('*').order('name');
    SDX.rows = data || [];
  } catch (e) { SDX.rows = []; }
  SDX.byName = {};
  SDX.rows.forEach(r => { SDX.byName[r.name] = r; });
  SDX.loaded = true;
  return SDX.rows;
}

function sdxRow(name) {
  return SDX.byName[name] || null;
}

function sdxMark(txt) {
  SDX.saved = txt;
  const el = document.getElementById('sd-saved');
  if (el) el.textContent = txt;
}

/* 저장 — 있으면 update, 없으면 insert. 화면은 다시 그리지 않는다(포커스 유지). */
async function sdxPatch(name, patch) {
  const sb = await enClient();
  const row = sdxRow(name);
  sdxMark('저장 중…');
  try {
    if (row && row.id) {
      Object.assign(row, patch);
      const { error } = await sb.from('study_cards').update(patch).eq('id', row.id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('study_cards')
        .insert(Object.assign({ name }, patch)).select().single();
      if (error) throw error;
      SDX.rows.push(data); SDX.byName[name] = data;
    }
    const t = new Date();
    sdxMark('저장됨 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
  } catch (e) {
    sdxMark('저장 실패 — 다시 시도하세요');
  }
}
function sdxPatchLater(name, patch, key) {
  const k = name + ':' + (key || Object.keys(patch)[0]);
  clearTimeout(SDX.timers[k]);
  sdxMark('입력 중…');
  SDX.timers[k] = setTimeout(() => sdxPatch(name, patch), 650);
}

/* ---------- 판정 로직 ---------- */
function sdxG0State(r) {
  const g = (r && r.gate0) || {};
  const v = SD_G0.map(x => g[x[0]]);
  if (v.some(x => x === 'y')) return 'fail';
  if (v.every(x => x === 'n')) return 'pass';
  return 'part';
}
function sdxScore(r) {
  const g = (r && r.gate2) || {};
  let s = 0, n = 0;
  SD_G2.forEach(([id, , , max]) => {
    const v = g[id];
    if (!v) return;
    n++;
    if (v === 'y') s += max;
    else if (v === 'w') s += Math.floor(max / 2);
  });
  return { score: s, answered: n, full: n === SD_G2.length };
}
function sdxGrade(score) {
  return SD_GRADE.find(([lo, hi]) => score >= lo && score <= hi) || SD_GRADE[SD_GRADE.length - 1];
}
function sdxStatus(r) {
  if (!r) return { k: 'none', label: '미검토' };
  const g0 = sdxG0State(r);
  if (g0 === 'fail') return { k: 'fail', label: '게이트0 탈락' };
  const sc = sdxScore(r);
  if (g0 === 'part' && !sc.answered) return { k: 'wip', label: '검토 중' };
  const gr = sdxGrade(sc.score);
  if (!sc.full) return { k: 'wip', label: `검토 중 ${sc.score}점` };
  return { k: gr[2] === '매수 금지' ? 'fail' : 'pass', label: `${gr[2]} ${sc.score}점` };
}
/* ---------- 관심 레벨 ---------- */
function sdxWatchCount() {
  const c = { L1: 0, L2: 0, L3: 0 };
  SDX.rows.forEach(r => { if (c[r.watch_level] != null) c[r.watch_level]++; });
  return c;
}
function sdxWatchMeta(lv) {
  return SD_WATCH.find(x => x[0] === lv) || null;
}
/* 레벨이 아니라 "규칙을 어긴 상태"를 돌려준다. 멀쩡하면 null.
   경고를 카드 안에만 두면 안 보니까, 표에도 같은 값을 쓴다. */
function sdxWatchFlag(r) {
  if (!r || !r.watch_level) return null;
  const lv = r.watch_level;
  const day = (a, b) => Math.floor((a - b) / 864e5);
  if (lv === 'L1' && !String(r.watch_trigger || '').trim())
    return { k: 'warn', msg: '진입 조건이 비어 있다 — 조건 없는 L1은 L2다' };
  if (lv === 'L2' && !r.watch_date)
    return { k: 'warn', msg: '트리거 날짜 없음 — 날짜 없는 트리거는 L3다' };
  if (lv === 'L2' && r.watch_date) {
    const over = day(Date.now(), Date.parse(r.watch_date + 'T00:00:00Z'));
    if (over > SD_WATCH_GRACE)
      return { k: 'bad', msg: `트리거 ${over}일 경과 — 승격이든 강등이든 지금 정한다` };
    if (over >= 0) return { k: 'due', msg: '트리거 날짜 도달 — 확인할 것' };
  }
  if (lv === 'L3') {
    const at = r.watch_at || r.updated_at;
    if (at) {
      const d = day(Date.now(), Date.parse(at));
      if (d > SD_WATCH_STALE) return { k: 'bad', msg: `${d}일 방치 — 정리 대상` };
    }
  }
  return null;
}
/* 레벨을 바꾸면 방치 시계도 같이 리셋된다 */
async function sdxSetWatch(name, lv) {
  const patch = { watch_level: lv || null, watch_at: new Date().toISOString() };
  if (!lv) { patch.watch_trigger = null; patch.watch_date = null; }
  if (lv !== 'L2') patch.watch_date = null;
  await sdxPatch(name, patch);
}

function sdxSentence(r) {
  const a = (r && r.why_not || '').trim(), b = (r && r.resolve_when || '').trim(), c = (r && r.resolve_how || '').trim();
  if (!a && !b && !c) return null;
  const blank = (v) => v ? `<b>${enEsc(v)}</b>` : '<i class="sd-blank">______</i>';
  return `나보다 정보가 많은 사람이 이 회사를 안 사는 이유는 ${blank(a)} 이고,
    이 이유는 ${blank(b)} 시점에 ${blank(c)} 로 해소된다.`;
}

/* ---------- 목록 ---------- */
function sdxList() {
  const hold = ((state.data && state.data.toss && state.data.toss.holdings) || []);
  const total = hold.reduce((a, h) => a + h.value, 0) || 1;
  const seen = {};
  const out = hold.slice().sort((a, b) => b.value - a.value).map(h => {
    seen[h.name] = 1;
    return { name: h.name, symbol: h.symbol, weight: (h.value / total) * 100, plRate: h.plRate, held: true, row: sdxRow(h.name) };
  });
  SDX.rows.forEach(r => {
    if (seen[r.name]) return;
    out.push({ name: r.name, symbol: r.ticker || '', weight: null, plRate: null, held: false, row: r });
  });
  return out;
}

function renderStudy() {
  const host = document.getElementById('panel-study');
  if (!host) return;
  if (!SDX.loaded) {
    host.innerHTML = '<div class="empty-state">검토 카드를 불러오는 중…</div>';
    sdxLoad().then(() => renderStudy());
    return;
  }
  const items = sdxList();
  if (SDX.sel === null && items.length) SDX.sel = items[0].name;

  const cnt = { pass: 0, fail: 0, wip: 0, none: 0 };
  items.forEach(it => { cnt[sdxStatus(it.row).k]++; });

  const q = SDX.q.trim().toLowerCase();
  const shown = items.filter(it => {
    if (q && !(it.name.toLowerCase().includes(q) || (it.symbol || '').toLowerCase().includes(q))) return false;
    if (SDX.filter === 'all') return true;
    return sdxStatus(it.row).k === SDX.filter;
  });

  host.innerHTML = `
    <div class="panel-title">
      <div>스터디 — 종목 검토</div>
      <div class="sd-headright">
        <span class="sd-saved" id="sd-saved">${enEsc(SDX.saved)}</span>
        <button class="sd-ghost" id="sdb-new">+ 종목 추가</button>
      </div>
    </div>
    <p class="sd-lead">게이트 0에서 하나라도 걸리면 아래로 내려가지 않는다. 통과한 것만 점수를 매기고, 점수가 비중을 정한다.</p>
    <div class="sdb-strip">
      ${[['all', '전체', items.length], ['pass', '통과', cnt.pass], ['wip', '검토 중', cnt.wip],
        ['fail', '탈락', cnt.fail], ['none', '미검토', cnt.none]].map(([k, l, n]) =>
        `<button class="sdb-chip ${SDX.filter === k ? 'on' : ''}" data-fil="${k}"><span class="l">${l}</span><span class="n">${n}</span></button>`).join('')}
    </div>
    <div class="sdb">
      <div class="sdb-side">
        <input class="en-in sdb-q" id="sdb-q" placeholder="종목 · 티커 검색" value="${enEsc(SDX.q)}">
        <div class="sdb-list">${shown.length ? shown.map(it => {
          const st = sdxStatus(it.row);
          return `<button class="sdb-item ${it.name === SDX.sel ? 'on' : ''}" data-nm="${enEsc(it.name)}">
            <span class="nm">${enEsc(it.name)}${it.symbol ? `<i>${enEsc(it.symbol)}</i>` : ''}</span>
            <span class="meta">
              ${it.weight != null ? `<span class="w">${it.weight.toFixed(1)}%</span>` : '<span class="w off">미보유</span>'}
              <span class="st ${st.k}">${st.label}</span>
            </span>
          </button>`;
        }).join('') : '<div class="empty-state">해당하는 종목이 없어요.</div>'}</div>
      </div>
      <div class="sdb-main" id="sdb-main">${sdxCard(items.find(x => x.name === SDX.sel))}</div>
    </div>`;

  host.querySelectorAll('[data-fil]').forEach(b => b.addEventListener('click', () => {
    SDX.filter = b.dataset.fil; renderStudy();
  }));
  const qi = host.querySelector('#sdb-q');
  if (qi) {
    let t = null;
    qi.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { SDX.q = qi.value; renderStudy(); const n = document.getElementById('sdb-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250);
    });
  }
  host.querySelectorAll('[data-nm]').forEach(b => b.addEventListener('click', () => {
    SDX.sel = b.dataset.nm; renderStudy();
  }));
  const nb = host.querySelector('#sdb-new');
  if (nb) nb.addEventListener('click', async () => {
    const nm = (prompt('검토할 종목 이름 — 예: 크레인 NXT') || '').trim();
    if (!nm) return;
    if (!sdxRow(nm)) await sdxPatch(nm, { ticker: null });
    SDX.sel = nm; renderStudy();
  });
  sdxBind(host);
}

/* ---------- 카드 ---------- */
function sdxCard(it) {
  if (!it) return '<div class="empty-state">왼쪽에서 종목을 고르거나 <b>+ 종목 추가</b>로 새로 만드세요.</div>';
  const r = it.row || {};
  const g0 = (r.gate0 || {}), g1 = (Array.isArray(r.gate1) ? r.gate1 : []), g2 = (r.gate2 || {});
  const g0s = sdxG0State(r);
  const sc = sdxScore(r);
  const gr = sdxGrade(sc.score);
  const st = sdxStatus(r);
  const blocked = g0s === 'fail';
  const over = (it.weight != null && gr[3] !== '—')
    ? it.weight - Number(String(gr[3]).split('~')[0].replace('%', '')) : null;

  const tri = (field, id, cur, opts) => opts.map(([v, l, cls]) =>
    `<button class="sd-tri ${cls || ''} ${cur === v ? 'on' : ''}" data-g="${field}" data-k="${id}" data-v="${v}">${l}</button>`).join('');

  return `
    <div class="sdc-head">
      <div>
        <div class="sdc-nm">${enEsc(it.name)}${it.symbol ? `<span class="tk">${enEsc(it.symbol)}</span>` : ''}</div>
        <div class="sdc-sub">
          ${it.weight != null ? `현재 비중 <b>${it.weight.toFixed(2)}%</b>` : '보유하지 않음'}
          ${it.plRate != null ? ` · 손익 <b class="${it.plRate >= 0 ? 'up' : 'down'}">${it.plRate >= 0 ? '+' : '−'}${Math.abs(it.plRate).toFixed(2)}%</b>` : ''}
          ${r.updated_at ? ` · 갱신 ${String(r.updated_at).slice(0, 10)}` : ''}
        </div>
      </div>
      <div class="sdc-right">
        <span class="sdc-badge ${st.k}">${st.label}</span>
        <button class="sd-ghost danger" data-del="${enEsc(it.name)}">카드 삭제</button>
      </div>
    </div>

    <div class="sdc-sec ${blocked ? '' : ''}">
      <div class="sdc-h"><span class="n">게이트 0</span>즉시 탈락 조건<i>하나라도 &lsquo;해당&rsquo;이면 여기서 끝난다</i></div>
      ${SD_G0.map(([id, q, why]) => `
        <div class="sdc-row ${g0[id] === 'y' ? 'bad' : ''}">
          <div class="q"><span class="t">${q}</span><span class="w">${why}</span></div>
          <div class="a">${tri('gate0', id, g0[id], [['n', '아니오', 'ok'], ['y', '해당', 'no']])}</div>
        </div>`).join('')}
      ${blocked ? `<div class="sdc-stop">여기서 종료. <b>가치평가 대상이 아니다.</b> 아래 점수는 매기지 않아도 된다 — 판단은 이미 났다.</div>` : ''}
    </div>

    <div class="sdc-sec ${blocked ? 'dim' : ''}">
      <div class="sdc-h"><span class="n">게이트 1</span>소외 유형<i>하나도 해당 없으면 이미 컨센서스다</i></div>
      <div class="sdc-tags">
        ${SD_G1.map(([id, l, w]) => `<button class="sd-tag ${g1.includes(id) ? 'on' : ''}" data-g1="${id}" title="${w}">${l}</button>`).join('')}
      </div>
      ${g1.length ? '' : '<div class="sdc-note">좋은 회사여도 초과수익의 원천이 없다. 사도 시장 수익률이다.</div>'}
    </div>

    <div class="sdc-sec ${blocked ? 'dim' : ''}">
      <div class="sdc-h"><span class="n">게이트 2</span>숫자 일곱 개
        <i>${sc.answered}/7 응답 · <b>${sc.score}</b>/14점</i></div>
      <div class="sdc-bar"><i style="width:${Math.round(sc.score / 14 * 100)}%"></i></div>
      ${SD_G2.map(([id, l, w, max]) => `
        <div class="sdc-row">
          <div class="q"><span class="t">${l}<em>${max}점</em></span><span class="w">${w}</span></div>
          <div class="a">${tri('gate2', id, g2[id], [['y', '통과', 'ok'], ['w', '경고', 'warn'], ['n', '실패', 'no']])}</div>
        </div>`).join('')}
      <div class="sdc-grade">
        <span class="k">${sc.full ? '판정' : '잠정'}</span>
        <span class="v">${gr[2]}</span>
        <span class="k">최대 비중</span>
        <span class="v">${gr[3]}</span>
        <span class="k">진입</span>
        <span class="v sm">${gr[4]}</span>
      </div>
      ${over != null && over > 0 ? `<div class="sdc-stop warn">현재 비중이 상한을 <b>${over.toFixed(1)}%p</b> 넘는다. 논리와 무관하게 그 자체로 축소 사유.</div>` : ''}
    </div>

    <div class="sdc-sec ${blocked ? 'dim' : ''}">
      <div class="sdc-h"><span class="n">게이트 3</span>세 문장<i>빈칸이 있으면 리서치가 아니라 발견의 흥분이다</i></div>
      <div class="sdc-sent">${sdxSentence(r) || '아래 세 칸을 채우면 문장이 완성된다.'}</div>
      <div class="sdc-fields three">
        <label><span>안 사는 이유</span><input class="en-in" data-f="why_not" value="${enEsc(r.why_not || '')}" placeholder="예: 매출이 역성장 전환 중"></label>
        <label><span>해소 시점</span><input class="en-in" data-f="resolve_when" value="${enEsc(r.resolve_when || '')}" placeholder="예: 2026년 11월 3분기 실적"></label>
        <label><span>해소 경로</span><input class="en-in" data-f="resolve_how" value="${enEsc(r.resolve_how || '')}" placeholder="예: 동일점포 매출 플러스 전환"></label>
      </div>
    </div>

    <div class="sdc-sec ${blocked ? 'dim' : ''}">
      <div class="sdc-h"><span class="n">게이트 5</span>반증 조건<i>진입 전에 적는다. 나중에 적으면 합리화가 된다</i></div>
      <div class="sdc-fields">
        <label class="wide"><span>매수 근거 — 한 문장</span><input class="en-in" data-f="buy_reason" value="${enEsc(r.buy_reason || '')}"></label>
        <label><span>틀렸다는 증거 ①</span><input class="en-in" data-f="falsify1" value="${enEsc(r.falsify1 || '')}" placeholder="예: GPM 3분기 연속 하락"></label>
        <label><span>틀렸다는 증거 ②</span><input class="en-in" data-f="falsify2" value="${enEsc(r.falsify2 || '')}" placeholder="예: 수주잔고 감소"></label>
        <label><span>확인 날짜</span><input class="en-in" type="date" data-f="check_date" value="${enEsc(r.check_date || '')}" style="color-scheme:dark;"></label>
        <label><span>손절 조건</span><input class="en-in" data-f="stop" value="${enEsc(r.stop || '')}"></label>
        <label><span>익절 조건</span><input class="en-in" data-f="take" value="${enEsc(r.take || '')}"></label>
        <label><span>목표 비중 %</span><input class="en-in" inputmode="decimal" data-f="weight" value="${r.weight == null ? '' : enEsc(r.weight)}" placeholder="${gr[3]}"></label>
        <label><span>유형 — 밸류에이션 도구</span>
          <select class="en-in" data-f="type">
            <option value="">미지정</option>
            ${SD_TYPE_OPTS.map(([v, l]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>
    </div>

    ${sdxWatchBlock(r, blocked)}

    <div class="sdc-sec">
      <div class="sdc-h"><span class="n">결론</span>지금 할 일<i>기준의 기계적 귀결. 기분이 아니라</i></div>
      <div class="sdc-tags">
        ${SD_VERDICT.map(([v, l]) => `<button class="sd-tag act ${r.verdict === v ? 'on' : ''}" data-vd="${v}">${l}</button>`).join('')}
      </div>
      <label class="sdc-memo"><span>메모</span><textarea class="en-in" data-f="memo" rows="4" placeholder="오늘 확인한 숫자, 다음에 볼 것">${enEsc(r.memo || '')}</textarea></label>
    </div>`;
}

/* 판정 다음에 온다. 게이트 0에서 걸린 것은 애초에 줄을 설 수 없다. */
function sdxWatchBlock(r, blocked) {
  const cur = (r && r.watch_level) || null;
  const cnt = sdxWatchCount();
  const meta = sdxWatchMeta(cur);
  const flag = sdxWatchFlag(r);
  const head = `<div class="sdc-h"><span class="n">관심</span>매수 준비도<i>다음 자금이 어디로 가는지의 순서 — 정원이 차면 하나를 내려야 올린다</i></div>`;
  if (blocked) {
    return `<div class="sdc-sec dim">${head}
      <div class="sdc-note">게이트 0 탈락. 관심 목록에 올릴 수 있는 대상이 아니다.</div></div>`;
  }
  const btns = SD_WATCH.map(([v, l, q, w]) => {
    const c = cnt[v], full = q && c >= q && cur !== v;
    return `<button class="sd-tag wl w-${v} ${cur === v ? 'on' : ''} ${full ? 'full' : ''}"
      data-wl="${v}" title="${w}${full ? ' · 정원이 찼다 — 하나를 내리고 올릴 것' : ''}">${v} ${l}<em>${c}${q ? '/' + q : ''}</em></button>`;
  }).join('');
  const over = (cur && meta && meta[2] && cnt[cur] > meta[2]) ? cnt[cur] - meta[2] : 0;
  return `
    <div class="sdc-sec">
      ${head}
      <div class="sdc-tags">${btns}
        <button class="sd-tag ${cur ? '' : 'on'}" data-wl="">관심 아님</button></div>
      ${cur ? `<div class="sdc-fields">
        <label class="wide"><span>${meta[4]}</span>
          <input class="en-in" data-f="watch_trigger" value="${enEsc(r.watch_trigger || '')}" placeholder="${meta[5]}"></label>
        ${cur === 'L2' ? `<label><span>트리거 날짜</span>
          <input class="en-in" type="date" data-f="watch_date" value="${enEsc(r.watch_date || '')}" style="color-scheme:dark;"></label>` : ''}
      </div>` : ''}
      ${flag ? `<div class="sdc-stop ${flag.k === 'bad' ? '' : 'warn'}">${flag.msg}</div>` : ''}
      ${over ? `<div class="sdc-stop warn">${cur} 정원 ${meta[2]}개를 <b>${over}개</b> 넘었다. 무엇을 내릴지 먼저 정하지 않으면 이 레벨은 순서가 아니다.</div>` : ''}
    </div>`;
}

function sdxBind(host) {
  const nm = SDX.sel;
  if (!nm) return;
  const repaintMain = () => {
    const it = sdxList().find(x => x.name === nm);
    const main = document.getElementById('sdb-main');
    if (main) { main.innerHTML = sdxCard(it); sdxBind(document); }
    const side = document.querySelector('.sdb-list [data-nm="' + nm.replace(/"/g, '\\"') + '"] .st');
    if (side) { const st = sdxStatus(sdxRow(nm)); side.className = 'st ' + st.k; side.textContent = st.label; }
  };

  host.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', async () => {
    const field = b.dataset.g, key = b.dataset.k, v = b.dataset.v;
    const r = sdxRow(nm) || {};
    const cur = Object.assign({}, r[field] || {});
    cur[key] = (cur[key] === v) ? null : v;
    if (!cur[key]) delete cur[key];
    const patch = {}; patch[field] = cur;
    if (field === 'gate2') { const tmp = { gate2: cur }; patch.score = sdxScore(tmp).score; }
    await sdxPatch(nm, patch);
    repaintMain();
  }));

  host.querySelectorAll('[data-g1]').forEach(b => b.addEventListener('click', async () => {
    const r = sdxRow(nm) || {};
    const cur = Array.isArray(r.gate1) ? r.gate1.slice() : [];
    const i = cur.indexOf(b.dataset.g1);
    if (i >= 0) cur.splice(i, 1); else cur.push(b.dataset.g1);
    await sdxPatch(nm, { gate1: cur });
    repaintMain();
  }));

  host.querySelectorAll('[data-vd]').forEach(b => b.addEventListener('click', async () => {
    const r = sdxRow(nm) || {};
    await sdxPatch(nm, { verdict: r.verdict === b.dataset.vd ? null : b.dataset.vd });
    repaintMain();
  }));

  host.querySelectorAll('[data-wl]').forEach(b => b.addEventListener('click', async () => {
    const r = sdxRow(nm) || {};
    const v = b.dataset.wl || null;
    await sdxSetWatch(nm, r.watch_level === v ? null : v);
    repaintMain();
  }));

  host.querySelectorAll('[data-f]').forEach(el => {
    const f = el.dataset.f;
    const handler = () => {
      let v = el.value;
      if (f === 'weight') v = v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, ''));
      else if (f === 'check_date') v = v || null;
      else v = (v === '' ? null : v);
      const p = {}; p[f] = v;
      if (el.tagName === 'SELECT' || el.type === 'date') sdxPatch(nm, p);
      else sdxPatchLater(nm, p, f);
      if (['why_not', 'resolve_when', 'resolve_how'].includes(f)) {
        const r = sdxRow(nm) || {}; r[f] = v;
        const s = document.querySelector('.sdc-sent');
        if (s) s.innerHTML = sdxSentence(r) || '아래 세 칸을 채우면 문장이 완성된다.';
      }
    };
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', handler);
  });

  host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const target = b.dataset.del;
    if (!confirm(`${target} 검토 카드를 삭제할까요? 보유 종목 목록에서는 사라지지 않습니다.`)) return;
    const r = sdxRow(target);
    if (r && r.id) {
      await (await enClient()).from('study_cards').delete().eq('id', r.id);
      SDX.rows = SDX.rows.filter(x => x.id !== r.id);
      delete SDX.byName[target];
    }
    renderStudy();
  }));
}

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

const INV_SUBS = [
  ['overview', '요약'],
  ['book', '종목'],
  ['perf', '벤치마크·세금']
];

function renderInvestmentPage(container, data, d) {
  const SUB = INV_SUBS.some(s => s[0] === state.invSub) ? state.invSub : 'overview';
  const subnav = `<div class="subnav sub2" id="inv-subnav">${INV_SUBS.map(([v, l]) =>
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
    ${SUB === 'overview' ? `
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
          <div>투자 추이</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <div class="range-toggle" id="inv-period-toggle">
              <button data-period="month" class="${(state.invPeriod || 'month') === 'month' ? 'active' : ''}">월</button>
              <button data-period="year" class="${state.invPeriod === 'year' ? 'active' : ''}">연</button>
            </div>
            <div class="range-toggle" id="inv-range-toggle"></div>
          </div>
        </div>
        <div class="series-toggles" id="inv-series-toggles">
          ${INV_SERIES.map(sr => `<label class="series-chk ${state.invSeries[sr.key] ? 'on' : ''}">
            <input type="checkbox" data-key="${sr.key}" ${state.invSeries[sr.key] ? 'checked' : ''} />
            <i style="background:${sr.color}"></i>${sr.label}
          </label>`).join('')}
        </div>
        <div class="chart-wrap tall" style="min-height:300px;"><canvas id="chart-inv-main"></canvas></div>
      </div>
    </div>` : ''}

    ${SUB === 'perf' ? `
    <div class="g">
      <div class="panel s7" id="panel-bench"></div>
      <div class="panel s5" id="panel-cgt"></div>
    </div>
    <div class="g">
      <div class="panel s7" id="panel-discipline"></div>
      <div class="panel s5" id="panel-idle-invest"></div>
    </div>` : ''}

    ${SUB === 'book' ? `<div id="panel-book"></div>` : ''}

  `;

  document.getElementById('inv-subnav').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.invSub = btn.dataset.sub;
    renderPage();
  });

  if (SUB === 'perf') {
    renderBenchmarkPanel('panel-bench', data, d);
    renderCapitalGainsPanel('panel-cgt', data.ledger);
    renderDisciplinePanel('panel-discipline', data);
    renderIdlePanel('panel-idle-invest', data, d, ['투자 자산'], '방치된 증권 계좌');
  }
  if (SUB === 'book') renderBookPage('panel-book', data, d);

  if (SUB === 'overview') {

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

    const S = state.invSeries;
    const ds = [];
    if (S.transfer) ds.push({ type: 'bar', label: '투자 이체', data: flowAgg(transferByYM), backgroundColor: 'rgba(57,168,189,0.7)', borderRadius: 3, yAxisID: 'yFlow', labelColor: '#a8e6f0', order: 4 });
    if (S.returns) ds.push({ type: 'bar', label: '실현 수익', data: flowAgg(returnsByYM), backgroundColor: 'rgba(224,138,95,0.85)', borderRadius: 3, yAxisID: 'yFlow', labelColor: '#f0b795', order: 3 });
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
          y: { display: S.balance || S.contrib, position: 'left', ticks: { ...MONO_TICK, color: '#7fc0a0', callback: (v) => formatCompactWon(v) }, grid: GRID_FAINT, title: { display: true, text: '잔액', color: '#7fc0a0', font: { family: 'IBM Plex Mono', size: 9 } } },
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
    state.invSeries[cb.dataset.key] = cb.checked;
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

async function loadBudgets() {
  try {
    const res = await window.storage.get('category-budgets', false);
    if (res && res.value) state.budgets = JSON.parse(res.value);
  } catch (e) { /* no saved budgets yet */ }
  state.budgetsLoaded = true;
}

async function saveBudgets() {
  try { await window.storage.set('category-budgets', JSON.stringify(state.budgets), false); } catch (e) {}
}

/* ================= 현황 › 자산 스냅샷 =================
   달마다 계좌 잔액을 한 번 적어 두는 자리. Supabase asset_snapshots 가 유일한 원본이고,
   여기서 저장하면 자산·흐름·목표 화면이 같은 값을 그대로 쓴다. (시트는 더 이상 쓰지 않는다) */

const SNAP = { rows: [], accounts: [], accountsLoaded: false, month: null, uid: null, loaded: false, saving: false, extra: [], err: null,
  skip: {} };   // × 로 지운 계좌는 다시 제안하지 않는다 (그 달 안에서만)

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

/* ================= 할 일 › 고정비 점검 =================
   📌 로 찍힌 거래를 사용처별로 묶어 '월 얼마 · 연 얼마'로 환산하고,
   유지 / 점검 / 해지 중 하나를 고르게 한다. 관심 종목의 L1·L2·L3 와 같은 문법이다.
   판정은 브라우저에 저장된다(기기 간 동기화 안 됨). */
const FX_KEY = 'fixedreview';
const FX = { rows: [], verdict: {}, loaded: false, err: null };

async function fxLoadVerdict() {
  try {
    const r = await window.storage.get(FX_KEY, false);
    FX.verdict = r && r.value ? JSON.parse(r.value) : {};
  } catch (e) { FX.verdict = {}; }
}
async function fxSaveVerdict() {
  try { await window.storage.set(FX_KEY, JSON.stringify(FX.verdict), false); } catch (e) {}
}

/* 최근 12개월치 고정비를 사용처별로 묶는다 */
async function fxLoad() {
  FX.err = null;
  let rows = [];
  try {
    const { data, error } = await (await enClient()).from('transactions')
      .select('date,amount,merchant,merchant_group,note')
      .eq('is_fixed', true)
      .gte('date', enDayShift(-365))
      .order('date', { ascending: false })
      .limit(2000);
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    FX.err = e.message || String(e);
    FX.rows = [];
    return;
  }

  const by = {};
  rows.forEach(r => {
    const m = String(r.merchant || '').trim();
    if (!m) return;
    const mk = String(r.date).slice(0, 7);
    if (!by[m]) by[m] = { merchant: m, group: r.merchant_group || null, byMonth: {}, last: r.date, note: r.note || '' };
    by[m].byMonth[mk] = (by[m].byMonth[mk] || 0) + Math.abs(Number(r.amount) || 0);
    if (r.date > by[m].last) by[m].last = r.date;
  });

  const today = enToday();
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  FX.rows = Object.values(by).map(o => {
    const keys = Object.keys(o.byMonth).sort();
    const vals = keys.map(k => o.byMonth[k]);
    const months = keys.length;
    const latest = vals[vals.length - 1];
    const avg = vals.reduce((a, b) => a + b, 0) / months;
    /* 인상 감지 — 최근 3개월 평균과 그 이전 구간 평균을 견준다 */
    const recent = vals.slice(-3), older = vals.slice(0, -3);
    const rAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const oAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : null;
    const upPct = (oAvg && oAvg > 0) ? ((rAvg - oAvg) / oAvg) * 100 : null;
    const gapDays = daysBetween(o.last, today);
    return {
      ...o, months, latest, avg, upPct, gapDays,
      monthly: latest, annual: latest * 12
    };
  }).sort((a, b) => b.annual - a.annual);
}

async function renderFixedPage(body) {
  body.innerHTML = '<div class="lg-wrap"><div class="en-empty">고정비를 불러오는 중…</div></div>';
  await fxLoadVerdict();
  await fxLoad();
  fxPaint(body);
}

function fxPaint(body) {
  if (FX.err) {
    body.innerHTML = `<div class="lg-wrap"><div class="en-empty">고정비를 불러오지 못했습니다 — ${enEsc(FX.err)}</div></div>`;
    return;
  }
  if (!FX.rows.length) {
    body.innerHTML = `<div class="lg-wrap"><div class="en-empty">📌 고정비로 표시된 거래가 없어요.<br>
      기록할 때 📌 고정비를 켜두면 여기 모입니다.</div></div>`;
    return;
  }

  const vOf = (m) => (FX.verdict[m] && FX.verdict[m].v) || null;
  const alive = FX.rows.filter(r => vOf(r.merchant) !== 'cancel');
  const cancelled = FX.rows.filter(r => vOf(r.merchant) === 'cancel');
  const unjudged = FX.rows.filter(r => !vOf(r.merchant));

  const moTotal = alive.reduce((a, r) => a + r.monthly, 0);
  const saveYear = cancelled.reduce((a, r) => a + r.annual, 0);

  /* 미판정 → 연 환산 큰 순. 해지한 것은 맨 아래로. */
  const order = [
    ...unjudged,
    ...alive.filter(r => vOf(r.merchant)),
    ...cancelled
  ];

  const rowHtml = (r) => {
    const v = vOf(r.merchant);
    const flags = [];
    if (r.upPct !== null && r.upPct >= 5) flags.push(`<span class="fx-flag up">↑ ${r.upPct.toFixed(0)}% 인상</span>`);
    if (r.gapDays > 45) flags.push(`<span class="fx-flag gap">${r.gapDays}일째 결제 없음</span>`);
    if (r.months <= 2) flags.push(`<span class="fx-flag">${r.months}개월치만 있음</span>`);
    const btn = (val, label) =>
      `<button data-m="${enEsc(r.merchant)}" data-v="${val}" class="${v === val ? 'on' : ''}">${label}</button>`;
    return `<div class="fx-row${v === 'cancel' ? ' done' : ''}">
      <span class="fx-name">
        <b>${enEsc(r.merchant)}</b>
        <span>${r.months}개월 기록 · 최근 ${r.last}</span>
      </span>
      <span class="fx-flags">${flags.join('')}</span>
      <span class="fx-num">
        <span class="mo">${wonComma(r.monthly)}원</span>
        <span class="yr">연 ${formatCompactWon(r.annual)}원</span>
      </span>
      <span class="fx-acts">${btn('keep', '유지')}${btn('watch', '점검')}${btn('cancel', '해지')}</span>
    </div>`;
  };

  body.innerHTML = `
    <div class="lg-wrap">
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);gap:8px;">
        <div class="stat-card">
          <div class="label">월 고정비</div>
          <div class="value">${formatKrw(moTotal)}</div>
          <div class="sub">해지 표시분 제외</div>
        </div>
        <div class="stat-card">
          <div class="label">연 환산</div>
          <div class="value">${formatKrw(moTotal * 12)}</div>
          <div class="sub">지금 이대로 1년</div>
        </div>
        <div class="stat-card">
          <div class="label">항목</div>
          <div class="value">${alive.length}개</div>
          <div class="sub">미점검 ${unjudged.length}개</div>
        </div>
        <div class="stat-card">
          <div class="label">해지 시 절감</div>
          <div class="value" style="color:var(--income-text)">${saveYear ? '+' + formatKrw(saveYear) : '—'}</div>
          <div class="sub">연 기준 · ${cancelled.length}건</div>
        </div>
      </div>

      <div class="today-verdict ${unjudged.length ? 'warn' : 'good'}" style="margin:10px 0 14px;">
        ${unjudged.length
          ? `아직 판정하지 않은 고정비가 ${unjudged.length}건 있어요. 위에서부터 큰 것을 먼저 보세요.`
          : `${alive.length}건 모두 판정했어요. 월 ${formatKrw(moTotal)}이 매달 자동으로 나갑니다.`}
      </div>

      <div class="panel">
        <div class="panel-title"><div>고정비 목록</div><span class="ptag">연 환산 큰 순</span></div>
        <div id="fx-list">${order.map(rowHtml).join('')}</div>
        <div class="settings-note" style="margin-top:10px;">
          📌 고정비로 기록한 거래를 사용처별로 묶었어요. 월 금액은 가장 최근 결제액 기준입니다.
          판정은 이 브라우저에만 저장돼요.
        </div>
      </div>
    </div>`;

  body.querySelectorAll('.fx-acts button').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.m, v = b.dataset.v;
    if (FX.verdict[m] && FX.verdict[m].v === v) delete FX.verdict[m];   // 다시 누르면 해제
    else FX.verdict[m] = { v, at: enToday() };
    fxSaveVerdict();
    fxPaint(body);
  }));
}

async function renderSnapshotPage(body) {
  body.innerHTML = '<div class="lg-wrap sn-wrap"><div class="en-empty">자산 스냅샷을 불러오는 중…</div></div>';
  try {
    await snapLoad(false);
    await snapLoadAccounts(false).catch(() => {});
    SNAP.err = null;
  } catch (e) {
    body.innerHTML = `<div class="lg-wrap sn-wrap"><div class="en-empty">자산 스냅샷을 불러오지 못했습니다 — ${enEsc(e.message || e)}</div></div>`;
    return;
  }
  if (!SNAP.month) SNAP.month = snapNowMonth();
  const mk = SNAP.month;
  const prevKey = snapMonthShift(mk, -1);
  const cur = snapMonthRows(mk), prev = snapMonthRows(prevKey);
  const accounts = snapAccounts();
  const months = snapMonthList();
  const filled = Object.keys(cur).length;
  const prevTotal = snapMonthTotal(prevKey);

  const byCls = {};
  accounts.forEach(a => { (byCls[a.cls] = byCls[a.cls] || []).push(a); });
  const clsOrder = [...CAT_ORDER.filter(c => byCls[c]), ...Object.keys(byCls).filter(c => !CAT_ORDER.includes(c))];

  /* ── 빈 칸 자동 채우기 ──
     스냅샷은 매달 대부분의 값이 그대로다. 그래서 빈 칸을 처음부터 채우는 대신
     지난달 값(또는 토스 실시간 잔액)을 미리 깔아두고 바뀐 것만 고치게 한다.
     제안값은 점선 테두리로 표시되고, 손대는 순간 확정값이 된다. */
  const tossTotal = (() => {
    const t = state.data && state.data.toss && state.data.toss.summary;
    return t && t.total > 0 ? Math.round(t.total) : null;
  })();
  const isTossAcct = (name) => /토스/.test(String(name || '').replace(/\s/g, ''));
  const isThisMonth = mk === snapNowMonth();

  const suggestFor = (a) => {
    if (cur[a.account]) return null;                 // 이미 저장된 값이 있으면 건드리지 않는다
    if (SNAP.skip[a.account]) return null;           // × 로 지운 것은 다시 올리지 않는다
    if (isThisMonth && tossTotal && isTossAcct(a.account)) return { v: tossTotal, src: 'toss' };
    const p = prev[a.account];
    return p ? { v: p.amount, src: 'prev' } : null;
  };

  let sugCount = 0, shownTotal = 0;
  accounts.forEach(a => {
    const c = cur[a.account];
    if (c) { shownTotal += c.amount; return; }
    const sg = suggestFor(a);
    if (sg) { shownTotal += sg.v; sugCount++; }
  });
  const total = shownTotal;
  const diff = (filled || sugCount) && prevTotal ? total - prevTotal : null;

  const rowHtml = (a) => {
    const c = cur[a.account], p = prev[a.account];
    const sg = suggestFor(a);
    const val = c ? c.amount : (sg ? sg.v : null);
    const dv = (val !== null && p) ? val - p.amount : null;
    return `<div class="sn-row">
      <span class="ac">${enEsc(a.account)}${sg
        ? `<em class="sn-tag ${sg.src}">${sg.src === 'toss' ? '토스 실시간' : '전월값'}</em>` : ''}</span>
      <span class="pv">${p ? wonComma(p.amount) : '—'}</span>
      <input class="en-in sn-in${sg ? ' sug' : ''}" inputmode="numeric" data-acct="${enEsc(a.account)}" data-cls="${enEsc(a.cls)}"
             value="${val === null ? '' : wonComma(val)}" placeholder="미입력">
      <span class="dl ${dv > 0 ? 'up' : dv < 0 ? 'down' : ''}">${dv === null ? '' : (dv > 0 ? '+' : '') + wonComma(dv)}</span>
      <button class="sn-x" data-acct="${enEsc(a.account)}" title="이 달 값 비우기">×</button>
    </div>`;
  };

  body.innerHTML = `
    <div class="lg-wrap sn-wrap">
      <div class="sn-head">
        <div class="sn-mo">
          <button class="sn-nav" id="sn-prev" aria-label="이전 달">‹</button>
          <select class="en-in sn-sel" id="sn-msel">
            ${months.map(m => `<option value="${m}" ${m === mk ? 'selected' : ''}>${snapMonthLabel(m)}</option>`).join('')}
          </select>
          <button class="sn-nav" id="sn-next" aria-label="다음 달">›</button>
          <span class="sn-badge ${filled ? 'ok' : 'new'}">${filled ? `${filled}개 계좌 기록됨` : '미입력'}</span>
          ${sugCount ? `<span class="sn-badge new">제안 ${sugCount}건 — 확인 후 저장</span>` : ''}
        </div>
        <div class="sn-acts">
          <button class="lg-reset" id="sn-fill">${sugCount ? '제안 지우기' : '전월 값 채우기'}</button>
          <button class="bk-add" id="sn-save">저장</button>
        </div>
      </div>

      <div class="sn-sum">
        <div><span class="k">${snapMonthLabel(mk)} 합계${sugCount ? ' · 제안 포함' : ''}</span><b>${(filled || sugCount) ? formatKrw(total) : '—'}</b></div>
        <div><span class="k">전월(${snapMonthLabel(prevKey)})</span><b>${prevTotal ? formatKrw(prevTotal) : '—'}</b></div>
        <div><span class="k">증감</span><b class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff === null ? '—' : (diff > 0 ? '+' : '') + formatKrw(diff)}</b></div>
      </div>

      <div class="sn-card">
        <div class="sn-cols"><span class="ac">계좌</span><span class="pv">전월</span><span class="in">${snapMonthLabel(mk)} 잔액</span><span class="dl">증감</span><span class="x"></span></div>
        ${clsOrder.map(c => `
          <div class="sn-cls"><i style="background:${CAT_COLORS[c] || 'var(--text-faint)'}"></i>${enEsc(c)}
            <b>${byCls[c].some(x => cur[x.account]) ? wonComma(byCls[c].reduce((a, x) => a + (cur[x.account] ? cur[x.account].amount : 0), 0)) : '—'}</b></div>
          ${byCls[c].map(rowHtml).join('')}`).join('')}
        <div class="sn-addrow">
          <select class="en-in" id="sn-newcls">${CAT_ORDER.map(c => `<option value="${enEsc(c)}">${enEsc(c)}</option>`).join('')}</select>
          <input class="en-in" id="sn-newacct" placeholder="새 계좌 이름">
          <button class="lg-reset" id="sn-addacct">+ 계좌 추가</button>
        </div>
      </div>

      <div class="sn-hist">
        <div class="sn-histhead">월별 기록</div>
        <table class="data-table">
          <thead><tr><th>월</th><th class="r">합계</th><th class="r">증감</th><th class="r">계좌</th></tr></thead>
          <tbody>
            ${months.filter(m => snapMonthTotal(m)).slice(0, 18).map(m => {
              const t = snapMonthTotal(m), pt = snapMonthTotal(snapMonthShift(m, -1));
              const dd = pt ? t - pt : null;
              return `<tr class="sn-hrow ${m === mk ? 'on' : ''}" data-m="${m}">
                <td>${snapMonthLabel(m)}</td>
                <td class="r mono">${wonComma(t)}</td>
                <td class="r mono ${dd > 0 ? 'up' : dd < 0 ? 'down' : ''}">${dd === null ? '—' : (dd > 0 ? '+' : '') + wonComma(dd)}</td>
                <td class="r mono">${Object.keys(snapMonthRows(m)).length}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const go = (m) => { SNAP.month = m; SNAP.extra = []; SNAP.skip = {}; renderSnapshotPage(body); };
  document.getElementById('sn-prev').addEventListener('click', () => go(snapMonthShift(mk, -1)));
  document.getElementById('sn-next').addEventListener('click', () => go(snapMonthShift(mk, 1)));
  document.getElementById('sn-msel').addEventListener('change', (e) => go(e.target.value));
  body.querySelectorAll('.sn-hrow').forEach(tr => tr.addEventListener('click', () => go(tr.dataset.m)));

  /* 제안값에 손대면 그 줄은 확정으로 바꾼다 (점선·배지 제거) */
  const snConfirm = (el) => {
    if (!el.classList.contains('sug')) return;
    el.classList.remove('sug');
    const row = el.closest('.sn-row');
    const tag = row && row.querySelector('.sn-tag');
    if (tag) tag.remove();
  };

  body.querySelectorAll('.sn-in').forEach(el => {
    el.addEventListener('input', () => snConfirm(el));
    el.addEventListener('blur', () => {
      const n = snapNum(el.value);
      el.value = n === null ? '' : wonComma(n);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') snapSave(body); });
  });
  body.querySelectorAll('.sn-x').forEach(b => b.addEventListener('click', () => {
    const el = body.querySelector(`.sn-in[data-acct="${CSS.escape(b.dataset.acct)}"]`);
    if (!el) return;
    SNAP.skip[b.dataset.acct] = true;    // 저장·재렌더 후에도 다시 제안하지 않게
    snConfirm(el);
    el.value = '';
    el.focus();
  }));

  document.getElementById('sn-fill').addEventListener('click', () => {
    if (sugCount) {
      /* 제안 지우기 — 손 안 댄 제안값만 비운다 */
      body.querySelectorAll('.sn-in.sug').forEach(el => {
        SNAP.skip[el.dataset.acct] = true;
        el.value = '';
        snConfirm(el);
      });
      enToast('제안값을 지웠어요. 직접 입력하고 저장하세요.');
    } else {
      SNAP.skip = {};
      renderSnapshotPage(body);
      enToast('전월 값을 빈 칸에 다시 채웠어요. 확인하고 저장하세요.');
    }
  });

  const addAcct = () => {
    const name = (document.getElementById('sn-newacct').value || '').trim();
    const cls = document.getElementById('sn-newcls').value;
    if (!name) return;
    if (snapAccounts().some(a => a.account === name)) { enToast('이미 있는 계좌입니다'); return; }
    SNAP.extra.push({ account: name, cls });
    renderSnapshotPage(body);
    /* 계좌 목록(accounts)에도 등록해 둔다 — 다음 달부터 칸이 저절로 생긴다 */
    enClient().then(sb => sb.from('accounts').insert([{ name, asset_class: cls, sort_order: 9000 }]))
      .then(() => snapLoadAccounts(true)).catch(() => {});
  };
  document.getElementById('sn-addacct').addEventListener('click', addAcct);
  document.getElementById('sn-newacct').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAcct(); });
  document.getElementById('sn-save').addEventListener('click', () => snapSave(body));
}

/* 저장 — 값이 있는 칸은 넣거나 고치고, 비운 칸은 그 달 기록에서 지운다.
   (owner_id, month, account) 가 유일 키라서 같은 달 같은 계좌는 늘 한 줄만 남는다. */
async function snapSave(body) {
  if (SNAP.saving) return;
  const mk = SNAP.month, monthDate = mk + '-01';
  const cur = snapMonthRows(mk);
  const ups = [], dels = [];
  body.querySelectorAll('.sn-in').forEach(el => {
    const acct = el.dataset.acct, cls = el.dataset.cls;
    const n = snapNum(el.value);
    const ex = cur[acct];
    if (n === null) { if (ex) dels.push(ex.id); return; }
    if (ex && ex.amount === n && ex.cls === cls) return;
    ups.push({ owner_id: SNAP.uid, month: monthDate, asset_class: cls, account: acct, amount: n });
  });
  if (!ups.length && !dels.length) { enToast('바뀐 값이 없어요'); return; }

  SNAP.saving = true;
  const btn = document.getElementById('sn-save');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    const sb = await enClient();
    if (ups.length) {
      const { error } = await sb.from('asset_snapshots').upsert(ups, { onConflict: 'owner_id,month,account' });
      if (error) throw new Error(error.message);
    }
    if (dels.length) {
      const { error } = await sb.from('asset_snapshots').delete().in('id', dels);
      if (error) throw new Error(error.message);
    }
    await snapLoad(true);
    SNAP.extra = [];
    snapPushToDashboard();
    renderNav();
    enToast(`${snapMonthLabel(mk)} 저장했습니다 (${ups.length}건 반영${dels.length ? `, ${dels.length}건 삭제` : ''})`);
    renderSnapshotPage(body);
  } catch (e) {
    enToast('저장하지 못했습니다 — ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  } finally {
    SNAP.saving = false;
  }
}

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
    { k: 'merchant_group', l: '그룹', t: 'txt', w: '150px', list: 'dbm-mgroups' },
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
    { k: 'merchant_group', l: '그룹', dyn: true },
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
      { k: 'merchant_group', l: '그룹', t: 'txt', w: '220px' },
      { k: '_n', l: '사용처', t: 'ro', num: true, w: '90px' },
      { k: '_cnt', l: '기록', t: 'ro', num: true, w: '90px' },
      { k: '_sum', l: '합계', t: 'ro', num: true, w: '130px' }
    ],
    build(all) {
      const map = {};
      all.forEach(r => {
        const g = r.merchant_group || '';
        const m = map[g] || (map[g] = { id: g || '__none', merchant_group: g, _raw: g, _n: 0, _cnt: 0, _sum: 0 });
        m._n++; m._cnt += (r._cnt || 0); m._sum += (r._sum || 0);
      });
      return Object.values(map).sort((a, b) => b._n - a._n || String(a._raw).localeCompare(String(b._raw), 'ko'));
    },
    line: (rec, patch) => `· ${rec._raw || '(그룹 없음)'} (사용처 ${enComma(rec._n)}곳 · 기록 ${enComma(rec._cnt)}건) — 그룹 → ${patch.merchant_group || '없음'}`,
    async apply(sb, rec, patch) {
      const to = String(patch.merchant_group || '').trim() || null;
      const old = rec._raw;
      let q1 = sb.from('merchants').update({ merchant_group: to });
      let q2 = sb.from('transactions').update({ merchant_group: to });
      q1 = old ? q1.eq('merchant_group', old) : q1.is('merchant_group', null);
      q2 = old ? q2.eq('merchant_group', old) : q2.is('merchant_group', null);
      const a = await q1; if (a.error) throw new Error(a.error.message);
      const b = await q2; if (b.error) throw new Error(b.error.message);
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
  goTo('data', 'dbm');
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

function dbmRender(host) {
  const el = host || document.getElementById('page-content');
  if (!el) return;
  enSyncHeaderOffset();
  el.innerHTML = `
    <div class="dbm-page">
      <div class="dbm-railcol">
        <nav class="dbm-rail" id="dbm-tabs">
          ${DBM_TABS.filter(x => !x.hidden).map(x => `<button data-t="${x.id}" class="${x.id === DBM.tab ? 'on' : ''}">${x.label}${
            DBM.rows[x.id] ? `<i>${DBM.rows[x.id].length}</i>` : ''}</button>`).join('')}
        </nav>
      </div>
      <div class="dbm-main">
        <div class="dbm-body" id="dbm-body"><div class="en-empty">불러오는 중…</div></div>
      </div>
    </div>`;
  document.getElementById('dbm-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    DBM.tab = b.dataset.t; DBM.q = ''; DBM.draft = null; DBM.dirty = {}; DBM.adding = false;
    dbmRender();
  });
  dbmRenderPane();
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
  };
  el.innerHTML = (cfg.search ? '<input class="q" placeholder="검색">' : '') + '<div class="opts"></div>';
  document.body.appendChild(el);
  draw('');
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 12)) + 'px';
  const below = window.innerHeight - r.bottom;
  el.style.top = (below > el.offsetHeight + 12 ? r.bottom + 5 : Math.max(8, r.top - el.offsetHeight - 5)) + 'px';
  const q = el.querySelector('.q');
  if (q) { q.addEventListener('input', () => draw(q.value)); setTimeout(() => q.focus(), 10); }
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
  return Object.keys(cnt)
    .sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b, 'ko'))
    .map(v => [v, v === '__none' ? '(없음)' : v]);
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
    if (c.t === 'cat' || c.t === 'sel' || c.t === 'tags') return chipHtml(c, r);
    return `<input class="en-in" id="${id}" data-k="${c.k}"
      ${c.t === 'num' ? 'inputmode="numeric"' : ''} ${c.list ? `list="${c.list}"` : ''}
      value="${enEsc(v == null ? '' : v)}" placeholder="${enEsc(c.l)}">`;
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
          { search: c.t === 'cat' });
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
    if (c.t === 'cat' || c.t === 'sel' || c.t === 'tags')
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
          <td class="mid col-meta">${agg ? '' : `<button class="dbm-x" data-del="${enEsc(r.id)}" title="삭제">×</button>`}</td>
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
      if (c.t === 'cat' || c.t === 'sel' || c.t === 'tags') {
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
  if (tabId === 'cat') { EN.loaded = false; await enEnsureRefs().catch(() => {}); }
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

/* ---------------- fetch & init ---------------- */

async function fetchCsvRows(gid) {
  const res = await fetch(csvUrlFor(gid), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} (gid ${gid})`);
  let text = await res.text();
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // gviz/tq 응답 맨 앞의 UTF-8 BOM 제거
  if (text.trim().startsWith('<')) throw new Error(`시트 접근 권한이 없어요 (gid ${gid})`);
  const parsed = Papa.parse(text, { skipEmptyLines: false });
  return parsed.data.map(r => r.map(c => (c === null || c === undefined) ? '' : String(c).replace(/^\uFEFF/, '')));
}

/* 가계부 원장은 Supabase 가 유일한 원본이다.
   전체 내역에서 고치거나 새로 넣은 것이 흐름·현황·목표까지 그대로 흘러가야 하므로,
   시트의 가계부(D) 탭은 더 이상 읽지 않는다. (자산·목표·지수는 아직 시트) */
async function fetchLedgerFromDB() {
  const sb = await enClient();
  const raw = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await sb.from('v_transactions')
      .select('id,category_id,date,kind,category,subcategory,emoji_category,amount,merchant_group,merchant,note,good_bad,company_paid,is_fixed')
      .order('date', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('가계부를 불러오지 못했습니다: ' + error.message);
    if (!data || !data.length) break;
    raw.push(...data);
    if (data.length < 1000) break;
  }
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
  const sb = await enClient();
  const raw = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from('asset_snapshots')
      .select('id,month,asset_class,account,amount')
      .order('month', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('자산 스냅샷을 불러오지 못했습니다: ' + error.message);
    if (!data || !data.length) break;
    raw.push(...data);
    if (data.length < 1000) break;
  }
  /* 시트 파서가 내주던 모양 그대로 맞춘다 — 아래 집계 코드를 건드리지 않기 위해서 */
  return raw.map(snapRowToAssetRow);
}

async function fetchAllTabsAndMerge() {
  /* 토스 탭 조회는 실패해도 대시보드 전체를 막지 않도록 병렬로 따로 돌린다. */
  const [results, tossResult, factsResult, dbLedger, dbAssets, dbStocks] = await Promise.all([
    Promise.allSettled(TAB_GIDS.map(fetchCsvRows)),
    fetchTossData().catch(() => null),
    fetchStockFacts().catch(() => null),
    fetchLedgerFromDB().catch((e) => { console.error('ledger from DB failed', e); return null; }),
    fetchAssetsFromDB().catch((e) => { console.error('assets from DB failed', e); return null; }),
    fetchStocksFromDB().catch((e) => { console.error('stocks from DB failed', e); return null; })
  ]);
  const failures = results.filter(r => r.status === 'rejected');
  const rowSets = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (rowSets.length === 0) {
    throw new Error(failures[0] ? failures[0].reason.message : '탭을 하나도 불러오지 못했어요');
  }

  let assetRows = (dbAssets && dbAssets.length) ? dbAssets : [], ledger = dbLedger || [], investmentTags = [], goals = [], stockCategoryMap = {}, indexPrices = {};
  const ledgerSource = dbLedger ? 'db' : 'sheet';
  const assetSource = assetRows.length ? 'db' : 'sheet';
  for (const rows of rowSets) {
    try {
      const ip = parseIndexFromRows(rows);
      if (Object.keys(ip).length > Object.keys(indexPrices).length) indexPrices = ip;
    } catch (e) {}
    if (assetSource !== 'db') {
      /* DB를 못 읽었을 때만 시트를 예비로 쓴다 */
      try {
        const ar = parseAssetsFromRows(rows);
        if (ar.length > assetRows.length) assetRows = ar;
      } catch (e) {}
    }
    if (!dbLedger) {
      /* DB를 못 읽었을 때만 시트를 예비로 쓴다 */
      try {
        const lg = parseLedgerFromRows(rows);
        if (lg.length > ledger.length) ledger = lg;
      } catch (e) {}
    }
    try {
      const tags = parseInvestmentTagsFromRows(rows);
      if (tags.length > investmentTags.length) investmentTags = tags;
    } catch (e) {}
    try {
      const gl = parseGoalsFromRows(rows);
      if (gl.length > goals.length) goals = gl;
    } catch (e) {}
    try {
      const scm = parseStockCategoryFromRows(rows);
      if (Object.keys(scm).length > Object.keys(stockCategoryMap).length) stockCategoryMap = scm;
    } catch (e) {}
  }

  // 가계부(M) 피벗 탭은 폐기되어, 정상 파싱된 가계부(D) 원장에서 월별 카테고리 요약을 직접 집계한다.
  const pivot = buildPivotFromLedger(ledger);

  const fetchFailNote = failures.length
    ? ` (${failures.length}개 탭 fetch 실패: ${failures.map(f => f.reason.message).join(', ')})`
    : ' (탭은 모두 불러왔지만 그 안에서 못 찾음)';

  if (!pivot) throw new Error('가계부 원장에서 카테고리 요약을 계산하지 못했습니다' + fetchFailNote);
  if (assetRows.length < 5) throw new Error('자산 현황표를 찾지 못했습니다' + fetchFailNote);

  const data = {
    months: pivot.months, incomeTotal: pivot.incomeTotal, expenseTotal: pivot.expenseTotal,
    expenseCategories: pivot.expenseCategories, incomeCategories: pivot.incomeCategories, transferCategories: pivot.transferCategories,
    assetRows, assetSource, ledger, ledgerSource, investmentTags, goals, stockCategoryMap, stocks: dbStocks || [],
    toss: tossResult,
    stockFacts: factsResult || {},
    indexPrices: Object.keys(indexPrices).length ? indexPrices : INDEX_SEED,
    indexSource: Object.keys(indexPrices).length ? 'sheet' : 'seed'
  };

  /* 종목 테마는 Supabase(stocks)가 원본 — 시트 값 위에 덮어쓴다 */
  applyStocksToData(data, dbStocks || []);

  if (failures.length) {
    data._partialWarning = `${failures.length}개 탭을 못 불러왔지만(${failures.map(f => f.reason.message).join(', ')}), 나머지 데이터로 표시 중이에요.`;
  }
  return data;
}

function applySuggestedGoals(data) {
  const d0 = computeDerived(data);
  const sug = computeSuggestedGoals(data, d0);
  state.goals.savingsRateTarget = sug.suggestedSavings;
  state.goals.emergencyFundTarget = sug.suggestedEmergency;
}

async function clearInsightCaches() {
  try {
    const res = await window.storage.list('weekly-insights', false);
    if (res && res.keys) {
      await Promise.all(res.keys.map(k => window.storage.delete(k, false).catch(() => {})));
    }
  } catch (e) { /* nothing cached yet */ }
}

async function fetchLive(manual) {
  setSyncState('loading');
  if (manual) await clearInsightCaches();
  try {
    const data = await fetchAllTabsAndMerge();
    state.data = data;
    state.source = 'live';
    state.lastError = data._partialWarning || null;
    state.lastSync = new Date();
    applySuggestedGoals(state.data);
    renderAll();
  } catch (e) {
    console.error('live sync failed', e);
    state.lastError = e.message || String(e);
    if (!state.data) {
      state.data = SNAPSHOT_DATA;
      state.source = 'snapshot';
    }
    renderAll();
  }
}

async function init() {
  routeApply();          /* 주소에 적힌 화면이 있으면 거기서 시작한다 */
  renderShell();
  await Promise.all([loadBudgets(), loadSettings(), sdxLoad(true)]);
  state.data = SNAPSHOT_DATA;
  state.source = 'snapshot';
  applySuggestedGoals(state.data);
  renderAll();
  /* 분류 표(순서·이름)는 화면 곳곳에서 쓰므로 미리 받아 둔다 */
  enEnsureRefs().catch(() => {});
  fetchLive(false);
}

/* 로그인한 사람만 화면을 볼 수 있다. */
(async () => {
  let sb;
  try {
    sb = await enClient();
  } catch (e) {
    enShowLock('로그인 모듈을 불러오지 못했습니다. 네트워크를 확인하고 새로고침하세요.');
    return;
  }
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) init(); else enShowLock();
    sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT') location.reload(); });
  } catch (e) {
    enShowLock('로그인 상태를 확인하지 못했습니다. 다시 로그인하세요.');
  }
})();
