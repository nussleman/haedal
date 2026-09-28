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


/* ---------------- 밸류에이션: 유형이 방법을 정한다 ----------------
   적정가는 사실이 아니라 가정의 출력이다. 그래서 점이 아니라 밴드로 내고,
   "지금 가격이 참이 되려면 무엇이 필요한가"를 역산으로 함께 보여준다. */




/* ================= 자산 > 투자 > 스터디 : 종목 판단 흐름 =================
   화면 정중앙에 판단할 항목이 하나씩 들어온다. 고르면 해석을 돌려주고 다음 항목으로.
   0단계 분류 → 유형 발표(처방전) → 1~5단계 검토 → 손절/익절 → 처방전 한 장. */








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
