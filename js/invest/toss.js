/* ---------------- 토스증권 실시간 데이터 ---------------- */
/* 맥북의 수집기(toss_collector.py)가 15분마다 Supabase 에 채운다.
   toss_summary(요약 한 줄) · toss_holdings(보유 종목) · toss_daily(날짜별).
   수집기가 안 돌고 있으면 조용히 null 을 돌려주고, 나머지 화면은 그대로 동작해야 한다.
   손익률은 DB 에 소수(0.1678)로 있고, 화면은 퍼센트 숫자(16.78)로 쓴다 — 여기서 ×100. */
const tossPct = (v) => (+v || 0) * 100;

/* timestamptz → '2026-09-28 21:44' (한국 시각) — tossFreshness 가 읽는 모양 */
function tossStamp(ts) {
  const t = new Date(ts);
  if (isNaN(t)) return '';
  const k = new Date(t.getTime() + 9 * 3600e3).toISOString();
  return k.slice(0, 10) + ' ' + k.slice(11, 16);
}

async function fetchTossData() {
  const sb = await haedalSupabase();
  const [s, h, d] = await Promise.all([
    sb.from('toss_summary').select('*').maybeSingle(),
    sb.from('toss_holdings').select('*'),
    sb.from('toss_daily').select('date,total,value,cost,pl,pl_rate').order('date')
  ]);
  const summary = s.data ? {
    asOf: tossStamp(s.data.as_of),
    value: +s.data.value || 0, cost: +s.data.cost || 0, pl: +s.data.pl || 0, plRate: tossPct(s.data.pl_rate),
    cash: +s.data.cash || 0, total: +s.data.total || 0, fx: +s.data.fx || 0,
    count: +s.data.count || 0, daily: +s.data.daily || 0
  } : null;
  const holdings = (h.data || []).map(o => ({
    name: o.name, symbol: o.symbol || '', country: o.country || '', currency: o.currency || '',
    qty: +o.qty || 0, avg: +o.avg || 0, last: +o.last || 0,
    value: +o.value_krw || 0, cost: +o.cost_krw || 0, pl: +o.pl_krw || 0, plRate: tossPct(o.pl_rate)
  })).filter(x => x.name && x.value > 0);
  const daily = (d.data || []).map(o => ({
    date: String(o.date).slice(0, 10), total: +o.total || 0, value: +o.value || 0,
    cost: +o.cost || 0, pl: +o.pl || 0, plRate: tossPct(o.pl_rate)
  }));
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






const INV_SERIES = [
  { key: 'balance', label: '평가액', color: '#4c8c6b' },
  { key: 'contrib', label: '누적 원금', color: '#e0c766' },
  { key: 'transfer', label: '투자 이체', color: '#39a8bd' },
  { key: 'returns', label: '실현 수익', color: '#d9884f' },
  { key: 'returnsCum', label: '누적 실현수익', color: '#c56a3a' },
  { key: 'roi', label: '원금 대비 수익률', color: '#9b7fc2' },
  { key: 'share', label: '총자산 대비 비중', color: '#5b8fc7' }
];
