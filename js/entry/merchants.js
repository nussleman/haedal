/* ================= 전체 내역 › 사용처 =================
   814개 사용처가 어느 그룹·분류로 쓰이고 있는지 한 곳에서 본다.
   여기서 고치면 그 사용처의 과거 기록 전체가 같이 바뀐다 — 표기 흔들림을 잡는 자리. */

const MG = { rows: null, q: '', group: 'all', fixed: 'all', sort: 'cnt', dir: 'desc', loading: false };

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
/* 직접 지정한 그림만 돌려준다 (없으면 빈 값). 기록 목록처럼 기본 그림을 강제로
   붙이면 안 되는 곳에서 쓴다. 지정표에 '' 로 적혀 있으면 '그림 없음'이 뜻이다. */
function mgEmojiSet(g) {
  const k = String(g || '').trim();
  if (!k || k === 'all') return '';
  if (EN.groupEmoji && Object.prototype.hasOwnProperty.call(EN.groupEmoji, k)) return EN.groupEmoji[k];
  return MG_EMOJI[k] || '';
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
