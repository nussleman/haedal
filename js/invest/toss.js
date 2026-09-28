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






const INV_SERIES = [
  { key: 'balance', label: '평가액', color: '#4c8c6b' },
  { key: 'contrib', label: '누적 원금', color: '#e0c766' },
  { key: 'transfer', label: '투자 이체', color: '#39a8bd' },
  { key: 'returns', label: '실현 수익', color: '#d9884f' },
  { key: 'returnsCum', label: '누적 실현수익', color: '#c56a3a' },
  { key: 'roi', label: '원금 대비 수익률', color: '#9b7fc2' },
  { key: 'share', label: '총자산 대비 비중', color: '#5b8fc7' }
];
