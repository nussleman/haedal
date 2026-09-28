/* =========================================================
   MY 자산 통장 — 대시보드 로직
   데이터 원본: Supabase (가계부·자산 스냅샷·종목). 목표·지수·토스는 아직 시트 → 옮기는 중
   ========================================================= */

const SPREADSHEET_ID = '1tT7p4brwpOZyGojQfxyUb1WHNiDXn-6uH4I7B4oUMPA';

/* 토스 탭은 수집기가 자동 생성하므로 gid를 미리 알 수 없다.
   gviz는 sheet= 파라미터로 탭 이름 조회도 지원하니 그걸 쓴다. */
const csvUrlForSheet = (name) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
const TOSS_TABS = { summary: '토스_계좌요약', holdings: '토스_보유종목', daily: '토스_일별' };

const CAT_COLORS = {
  '현금 자산': '#c9a227',
  '투자 자산': '#4c8c6b',
  '저축 자산': '#c2749b',
  '연금 자산': '#7b7fd0'
};
const CAT_ORDER = ['현금 자산', '투자 자산', '저축 자산', '연금 자산'];
const ACCT_BOARD_ORDER = ['현금 자산', '투자 자산', '연금 자산', '저축 자산'];
const DISPLAY_GROUP = { '현금 자산': '현금', '투자 자산': '투자', '저축 자산': '저축', '연금 자산': '저축' };
const CAT_PIE_PALETTE_INV = ['#c9a227', '#4c8c6b', '#c2749b', '#7b7fd0', '#c1483f', '#e0c766', '#39a8bd', '#5b8fc7', '#9b7fc2', '#d9884f'];

/* 날짜 키 (state 초기값에서 바로 쓰므로 맨 앞에 둔다) */
function pad2(n) { return String(n).padStart(2, '0'); }
function dayKeyOfDate(dt) { return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`; }
function todayDayKey() { return dayKeyOfDate(new Date()); }

const state = {
  data: null,
  source: null,        // 'live' | null(아직 못 불러옴)
  lastSync: null,
  lastError: null,
  goals: { savingsRateTarget: 40, emergencyFundTarget: 5000000 },
  range: 12,
  page: 'home',
  homeMainSub: 'main',
  entrySub: 'ledger', goalsSub: 'list',
  reportSub: 'monthly', labSub: 'sim', setSub: 'cat',
  entryView: 'list',      // 입출금 보기: list | calendar
  ledgerFilter: { q: '', major: 'all', page: 1, pageSize: 50 },
  charts: {},
  budgets: {},          // 분류별 예산 (Supabase app_settings)
  transferGoals: {},    // 이체 대상별 월 기댓값 (Supabase app_settings)
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
  goalMoves: {},           // 드래그로 옮긴 목표 시기 (저장 전 로컬 오버라이드)
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
  invSub: 'overview',      // 투자 하위: overview | book | bench | tax | rules | journal
  invView: 'ovGrowth',     // 투자 요약 차트 보기: ovGrowth | ovTransfer | ovRealized | ovUnrealized
  /* 요약을 4개 차트 화면으로 쪼갰다. 화면마다 기본으로 켜 둘 계열이 다르고,
     체크박스를 만지면 그 화면에만 남는다.
     누적 원금이 세 화면에 겹쳐 나오는 건 중복이 아니라 공통 기준선이다. */
  invSeriesBySub: {
    ovGrowth:     { balance: false, contrib: true,  transfer: false, returns: false, returnsCum: false, roi: true,  share: false },
    ovTransfer:   { balance: false, contrib: true,  transfer: true,  returns: false, returnsCum: false, roi: false, share: false },
    ovRealized:   { balance: false, contrib: false, transfer: false, returns: true,  returnsCum: true,  roi: false, share: false },
    ovUnrealized: { balance: true,  contrib: true,  transfer: false, returns: false, returnsCum: false, roi: false, share: false }
  },
  study: { name: '', step: 0, ans: {}, chk: {}, memo: {}, stop: '', take: '', weight: '', crit: [], val: {}, price: '', editId: null },
  bookFilter: 'all',       // 내 종목 필터: all | due | action | none
  bookOpen: null,          // 내 종목에서 펼친 행 (종목명)
  bookCcy: 'won'           // 내 종목 표시 통화: won | local
};

/* ---------------- 사용자 설정 (목표 배분·부채·미운용 계좌·흐름표) ---------------- */
const SETTINGS_KEY = 'haedal-settings';
const ALLOC_CATS = ['현금 자산', '저축 자산', '투자 자산', '연금 자산'];
const DEFAULT_SETTINGS = {
  targetAlloc: null,        // { '투자 자산': 55, ... } · null = 미설정
  debts: [],                // { id, name, balance, monthly, rate, memo }
  emergencyMonths: 6,       // 비상금 목표 = 월 지출 × N개월
  idleAccounts: [],         // 운용 점검할 계좌 이름들 (설정 › 계좌에서 고른다)
  emergencyAccount: '',     // 비상금으로 볼 계좌 이름
  brokerAccount: '',        // 홈에 따로 보여줄 대표 증권 계좌 (비우면 가장 큰 투자 계좌)
  idleCheck: {},            // { 계좌명: 'YYYY-MM' } 마지막 운용 점검 월
  hiddenRecs: [],           // 안 보고 싶은 추천 목표 지표 키
  flowmap: null             // { income:[], expense:[], asset:[], liability:[] }
};
state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

/* 대시보드 설정은 Supabase app_settings('dashboard_settings') 에 둔다 — 폰·PC 가 같은 값을 본다.
   예전에 브라우저(localStorage)에만 저장된 값이 있으면 처음 한 번 DB 로 올린다. */
async function loadSettings() {
  const v = await appSettingLoad('dashboard_settings', 'haedal:' + SETTINGS_KEY);
  if (v && typeof v === 'object') state.settings = Object.assign({}, DEFAULT_SETTINGS, v);
}
async function saveSettings() {
  return await appSettingSave('dashboard_settings', state.settings);
}
/* 계좌 이름 비교: 기호·공백 무시 ("NH-CMA" = "NH(CMA)") */
function acctKey(s) { return String(s || '').replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase(); }
function sameAcct(a, b) { return !!a && !!b && acctKey(a) === acctKey(b); }

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
