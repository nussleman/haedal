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
  else if (status === 'err') label.textContent = '불러오기 실패';
  else label.textContent = '';
}

/* 최상단 4탭 = 사용 빈도순 (매일 → 주/월 → 월 → 분기)
   각 탭의 하위는 SECTION_SUBS 에서 정의하고, 실제 렌더 함수로 매핑한다. */
const NAV_ITEMS = [
  { id: 'home',   label: '홈', solo: true },
  { id: 'entry',  label: '기록' },
  { id: 'invest', label: '투자' },
  { id: 'goals',  label: '목표' },
  { id: 'report', label: '리포트' },
  { id: 'lab',    label: '실험실' },
  { id: 'set',    label: '설정' }
];

/* 2단계는 좌측 레일에 뜬다. solo 는 하위가 하나뿐이라 레일을 띄우지 않는다. */
const SECTION_SUBS = {
  home:   [['main', '홈']],
  entry:  [['#', '입출금'], ['ledger', '입출금 내역'], ['calendar', '캘린더'],
           ['#', '자산'], ['snapshot', '자산 스냅샷']],
  invest: [['#', '요약'], ['ovGrowth', '자산 성장률'], ['ovTransfer', '투자 이체'],
           ['ovRealized', '실현 수익'], ['ovUnrealized', '평가손익'],
           ['#', '포트폴리오'], ['book', '종목'], ['bench', '벤치마크'], ['tax', '세금'],
           ['#', '규율'], ['rules', '매매원칙'], ['journal', '매매일지']],
  goals:  [['#', '상태'], ['active', '진행중'], ['done', '달성'], ['next', '다음 할 것'],
           ['#', '모아보기'], ['board', '보드'], ['all', '전체 목록'], ['category', '카테고리별']],
  report: [['#', '기간별'], ['monthly', '월간'], ['yearly', '연간'],
           ['#', '자산별'], ['networth', '순자산'], ['pension', '연금'], ['savings', '저축']],
  lab:    [['explore', '돋보기'], ['sim', '시뮬레이션'], ['flowmap', '흐름표'], ['fixed', '고정비 검토']],
  set:    [['#', '가계부'], ['cat', '분류'], ['merch', '사용처'], ['fixedm', '고정비'],
           ['#', '계획'], ['budget', '예산'], ['saving', '적립'],
           ['#', '자산·투자'], ['acct', '계좌'], ['stock', '종목']]
};

const SECTION_STATE_KEY = { home: 'homeMainSub', entry: 'entrySub', invest: 'invSub',
  goals: 'goalsSub', report: 'reportSub', lab: 'labSub', set: 'setSub' };

function currentSub(section) {
  const subs = (SECTION_SUBS[section] || []).filter(x => x[0] !== '#');
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
  /* 옛 메뉴(흐름·자산·할 일·데이터)로 저장된 북마크와 뒤로가기를 새 자리로 넘긴다. */
  'status': 'goals/main', 'status/goals': 'goals/main',
  'status/structure': 'lab/sim',
  'flow': 'report/monthly', 'flow/today': 'home/main',
  'flow/now': 'report/monthly', 'flow/year': 'report/yearly',
  'flow/calendar': 'entry/calendar', 'flow/flowmap': 'lab/flowmap',
  'assets': 'report/networth', 'assets/overview': 'report/networth',
  'assets/investment': 'invest/ovGrowth', 'invest/main': 'invest/ovGrowth',
  'invest/overview': 'invest/ovGrowth',
  'invest/perf': 'invest/bench', 'assets/pension': 'report/pension',
  'assets/savings': 'report/savings',
  'todo': 'goals/main', 'todo/goals': 'goals/main',
  'todo/fixed': 'lab/fixed', 'todo/structure': 'lab/sim',
  'data': 'entry/ledger', 'data/ledger': 'entry/ledger',
  'data/snapshot': 'entry/snapshot', 'data/dbm': 'set/cat'
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
