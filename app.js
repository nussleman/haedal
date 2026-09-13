/* =========================================================
   해달 v2 — 대시보드 로직
   원본: Supabase (rjxmrpifrhybucexuvli)
   구조: 기록(현금흐름·자산) / 판단(투자·목표) / 관리(리포트·설정)
   ========================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL  = 'https://rjxmrpifrhybucexuvli.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqeG1ycGlmcmh5YnVjZXh1dmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjU1OTAsImV4cCI6MjEwMTE0MTU5MH0.xSzE02pjZYqbx9nPLb8RVsQF9w7hJHEx2cO0JDOLLSU';
const sb = createClient(SB_URL, SB_ANON);

/* ═════════════════════════════════════════════════════════
   1. 데이터 계층
   ─────────────────────────────────────────────────────────
   화면은 이 객체만 본다. 테이블 구조가 바뀌면 여기만 고친다.
   RLS가 걸려 있어 로그인 세션이 있어야 값이 돌아온다.
   ═════════════════════════════════════════════════════════ */
const DB = {
  _c: {},                                   // 세션 단위 캐시
  async _once(key, fn){ return this._c[key] ??= fn(); },
  clear(){ this._c = {}; },

  /* 거래 원장 — v_transactions 뷰가 kind·category·subcategory를 이미 펼쳐 준다.
     transactions에 kind 컬럼이 없어 직접 조인할 필요가 없다. */
  transactions(months = 14){
    return this._once('tx:'+months, async () => {
      const from = new Date(); from.setMonth(from.getMonth() - months);
      const { data, error } = await sb.from('v_transactions')
        .select('id,date,kind,category,subcategory,emoji_category,amount,merchant,merchant_group,'
              + 'note,good_bad,company_paid,is_fixed')
        .gte('date', from.toISOString().slice(0,10))
        .order('date', { ascending:false });
      if (error) throw error;
      return (data||[]).map(t => ({ ...t, sub:t.subcategory||'', amount:Number(t.amount) }));
    });
  },

  /* 자산 스냅샷 — month · asset_class · account · amount */
  snapshots(){
    return this._once('snap', async () => {
      const { data, error } = await sb.from('asset_snapshots')
        .select('month,asset_class,account,amount').order('month');
      if (error) throw error;
      return (data||[]).map(r => ({ ...r, amount:Number(r.amount), ym:r.month.slice(0,7) }));
    });
  },

  /* 보유 종목 — 가장 최근 snapshot_at 한 벌만 */
  holdings(){
    return this._once('hold', async () => {
      const { data, error } = await sb.from('holdings')
        .select('name,ticker,market,value,cost,pnl,pnl_pct,weight,snapshot_at')
        .order('snapshot_at',{ascending:false}).order('value',{ascending:false}).limit(400);
      if (error) throw error;
      if (!data?.length) return [];
      const latest = data[0].snapshot_at;
      return data.filter(h => h.snapshot_at === latest)
                 .map(h => ({ ...h, value:Number(h.value||0), pnl_pct:h.pnl_pct==null?null:Number(h.pnl_pct) }));
    });
  },

  /* 관심종목 — 전용 테이블이 아니라 study_cards.watch_level(L1/L2/L3) */
  watchlist(){
    return this._once('watch', async () => {
      const { data, error } = await sb.from('study_cards')
        .select('name,ticker,type,watch_level,watch_trigger,watch_date,buy_reason,stop,take,'
              + 'falsify1,falsify2,score,verdict')
        .order('watch_level',{nullsFirst:false});
      if (error) throw error;
      return (data||[]).map(c => ({
        ...c,
        /* watch_level이 비어 있으면 0 = 미배정. 화면에서 따로 모아 보여준다. */
        tier: c.watch_level ? Number(c.watch_level.replace('L','')) : 0,
        /* 3문장 메모 = ①왜 사는가 ②언제 파는가 ③틀렸다는 신호 */
        thesis: [c.buy_reason, (c.stop||c.take), (c.falsify1||c.falsify2)].filter(Boolean).length,
        daysLeft: c.watch_date ? 90 - Math.floor((Date.now()-new Date(c.watch_date))/864e5) : null
      }));
    });
  },

  /* 투자 논리 원장 — 보유 종목과 티커로 붙인다 */
  thesis(){
    return this._once('thesis', async () => {
      const { data } = await sb.from('thesis')
        .select('name,ticker,type,target_weight,logic,sell_trigger,reviewed_on');
      return data || [];
    });
  },

  /* 재무 목표 — goals 테이블의 current_value는 비어 있다.
     goal_progress 뷰가 metric_source를 보고 현재값·진행률을 계산해 준다. */
  goals(){
    return this._once('goals', async () => {
      const { data, error } = await sb.from('goal_progress')
        .select('id,item,emoji,kind,status,metric_source,target,current,progress_pct,'
              + 'lower_is_better,unit,note,target_on,position')
        .not('target_amount','is',null).neq('status','중단');
      if (error) throw error;
      /* numeric은 PostgREST에서 "10000000.00" 문자열로 온다. 반드시 Number()로 변환할 것. */
      const rows = (data||[])
        .map(g => ({ ...g, target:Number(g.target), current:Number(g.current||0),
                     pct: Number(g.progress_pct||0) }))
        .filter(g => Number.isFinite(g.target) && g.target > 0);

      /* 같은 지표에 이정표가 사다리처럼 여러 개 걸려 있다(총 자산 5천만~2억).
         달성한 계단은 접고, 지금 겨누는 다음 계단 하나만 남긴다. */
      const byMetric = {};
      rows.forEach(g => (byMetric[g.metric_source || g.item] ??= []).push(g));
      const out = [];
      Object.values(byMetric).forEach(list => {
        const live = list.filter(g => g.status !== '달성/완료')
                         .sort((a,b) => a.target - b.target);
        const next = live.find(g => g.lower_is_better ? true : g.current < g.target) || live[0];
        if (next) out.push({ ...next, cleared: list.length - live.length, ladder: list.length });
      });
      return out.sort((a,b) => (a.position ?? 999) - (b.position ?? 999));
    });
  },

  /* 고정비 상인 — merchants.is_fixed 가 마스터 */
  fixedMerchants(){
    return this._once('fixm', async () => {
      const { data } = await sb.from('merchants').select('name,merchant_group,is_fixed').eq('is_fixed',true);
      return data || [];
    });
  },

  /* 연간 집계 — 기본 14개월 캐시로는 한 해를 못 덮는다. 연도별로 따로 읽는다. */
  yearly(year){
    return this._once('yr:'+year, async () => {
      const { data, error } = await sb.from('v_transactions')
        .select('date,kind,category,subcategory,amount,merchant,company_paid,is_fixed,good_bad')
        .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
      if (error) throw error;
      return (data||[]).map(t => ({ ...t, sub:t.subcategory||'', amount:Number(t.amount) }));
    });
  },

  /* 상인 전체 — 고정비 지정 화면에서 쓴다. 캐시하지 않고 매번 읽어 토글 결과를 바로 본다. */
  async merchants(){
    const { data, error } = await sb.from('merchants')
      .select('id,name,merchant_group,is_fixed').order('name');
    if (error) throw error;
    return data || [];
  },

  categories(){
    return this._once('cats', async () => {
      const { data, error } = await sb.from('categories')
        .select('id,kind,category,subcategory,emoji_category,sort_order,is_active')
        .eq('is_active', true).order('kind').order('sort_order');
      if (error) throw error;
      return data || [];
    });
  },

  accounts(){
    return this._once('acc', async () => {
      const { data } = await sb.from('accounts')
        .select('name,asset_class,is_active,note,sort_order').eq('is_active',true).order('sort_order');
      return data || [];
    });
  }
};

/* ═════════════════════════════════════════════════════════
   2. 계산 규칙 — 기존 해달에서 잡은 버그를 코드로 막는다
   ═════════════════════════════════════════════════════════ */
const KST = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()+540); return d; };
const CUR_YM = KST().toISOString().slice(0,7);

/* 규칙 ① 이체·자산 이동은 지출이 아니다 — 합계에서 제외 */
const isSpend  = t => t.kind === '지출';
const isIncome = t => t.kind === '수입';

/* 규칙 ② 진행 중인 달은 평균 산출에서 제외한다 */
const completed = rows => rows.filter(r => (r.ym || r.date?.slice(0,7)) !== CUR_YM);

/* 규칙 ③ 연 단위 비용은 관찰 기간이 아니라 실제 경과 개월로 나눈다.
   완료된 개월 수로 나누면 연납 항목도 자동으로 12분의 1이 된다. */
function monthlyAverage(rows, pick = r => r.amount){
  const done = completed(rows);
  const months = new Set(done.map(r => r.ym || r.date.slice(0,7))).size;
  if (!months) return 0;
  return done.reduce((s,r)=>s+pick(r),0) / months;
}

const won = n => Math.round(n).toLocaleString('ko-KR');
const man = n => Math.round(n/10000).toLocaleString('ko-KR') + '만원';
const ymOf = d => d.slice(0,7);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ═════════════════════════════════════════════════════════
   3. IA — 메뉴 트리가 곧 데이터. ready:false → 준비중
   ═════════════════════════════════════════════════════════ */
const TREE = {
  home:{title:'홈',tabs:[{id:'today',label:'오늘',ready:true}]},
  flow:{title:'현금흐름',tabs:[
    {id:'ledger',label:'거래 내역',ready:true},{id:'budget',label:'예산',ready:true},
    {id:'fixed',label:'고정비',ready:true},{id:'rules',label:'자금 흐름',ready:true}]},
  assets:{title:'자산 현황',tabs:[
    {id:'networth',label:'순자산',ready:true},{id:'accounts',label:'계좌',ready:true},
    {id:'pension',label:'연금',ready:true},{id:'debt',label:'부채'}]},
  invest:{title:'투자',tabs:[
    {id:'port',label:'포트폴리오',ready:true},{id:'holding',label:'종목 상세',ready:true},
    {id:'watch',label:'관심종목',ready:true},{id:'history',label:'매매 이력'}]},
  goals:{title:'목표',tabs:[{id:'targets',label:'재무 목표',ready:true},{id:'progress',label:'진행률',ready:true}]},
  report:{title:'리포트',tabs:[{id:'monthly',label:'월간',ready:true},{id:'yearly',label:'연간',ready:true}]},
  settings:{title:'설정',tabs:[{id:'sources',label:'데이터 연동',ready:true},
    {id:'cats',label:'카테고리',ready:true},{id:'alerts',label:'알림'}]}
};

/* ═════════════════════════════════════════════════════════
   4. 공용 컴포넌트
   ═════════════════════════════════════════════════════════ */
const wipbar = t => `<div class="wipbar"><b>준비중</b><span>${t}</span></div>`;
const stub = (h3,desc,items=[],sk='') => `${sk}<div class="stub"><h3>${esc(h3)}</h3><p>${desc}</p>
  ${items.length?`<h4>이 패널에 들어갈 것</h4><ul>${items.map(i=>
    `<li class="${i.has?'has':''}">${i.has?'<b>이식 대상</b> — ':''}${i.t}</li>`).join('')}</ul>`:''}</div>`;
const skel = (k,h=52,n=3) => `<div class="skel ${k}" aria-hidden="true">${
  Array(n).fill(`<div style="--h:${h}px"></div>`).join('')}</div>`;
const memo3 = n => `<div class="memo3" title="3문장 메모 ${n}/3">${
  [0,1,2].map(i=>`<i class="${i<n?'on':''}"></i>`).join('')}</div>`;

function sparkline(vals, w=400, h=56){
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), r = hi-lo || 1;
  const pts = vals.map((v,i)=>`${(i/(vals.length-1)*w).toFixed(1)},${(h-6-((v-lo)/r)*(h-14)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="추이">
    <polyline points="${pts}" fill="none" stroke="var(--asset)" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="${pts} ${w},${h} 0,${h}" fill="var(--asset-bg)" stroke="none"/></svg>`;
}

function txRow(t){
  const sign = t.kind==='수입' ? '+' : t.kind==='지출' ? '−' : '';
  return `<tr><td class="sub num">${t.date.slice(5).replace('-','.')}</td>
    <td>${esc(t.merchant || t.note || t.category)}
      ${t.is_fixed?' <span class="chip c-w">고정</span>':''}
      ${t.good_bad?` <span class="chip c-${t.good_bad==='Good'?'good':'bad'}">${t.good_bad}</span>`:''}
      <div class="sub">${esc(t.category)}${t.sub?' · '+esc(t.sub):''}</div></td>
    <td><span class="chip c-${t.kind}">${t.kind}</span></td>
    <td class="r" style="color:var(--${{'수입':'income','지출':'expense','이체':'transfer','자산':'asset'}[t.kind]});font-weight:600">
      ${sign}${won(t.amount)}</td></tr>`;
}

/* 스냅샷을 월별 합계로 접는다 */
function netWorthByMonth(snap){
  const m = new Map();
  snap.forEach(r => m.set(r.ym, (m.get(r.ym)||0) + r.amount));
  return [...m.entries()].sort((a,b)=>a[0]<b[0]?-1:1);
}

/* ═════════════════════════════════════════════════════════
   5. 패널
   ═════════════════════════════════════════════════════════ */
const P = {};

/* ── 홈 ── */
P['home:today'] = async () => {
  const [tx, snap, goals] = await Promise.all([DB.transactions(), DB.snapshots(), DB.goals()]);
  const nwSeries = netWorthByMonth(snap);
  const [curYm, nw] = nwSeries.at(-1) || ['—',0];
  const prev = nwSeries.at(-2)?.[1] ?? nw;
  const d = nw - prev;

  const cur = tx.filter(t => ymOf(t.date) === CUR_YM);
  const inc = cur.filter(isIncome).reduce((s,t)=>s+t.amount,0);
  /* 실지출 = 회사 환급분 제외. 예산·리포트와 같은 기준으로 맞춘다. */
  const exp = cur.filter(t => isSpend(t) && !t.company_paid).reduce((s,t)=>s+t.amount,0);
  const avgExp = monthlyAverage(tx.filter(t => isSpend(t) && !t.company_paid));
  /* 급여일 전이라 수입이 아직 0인 달이 있다. 그럴 땐 저축률 대신 지출 진도를 보여준다. */
  const hasInc = inc > 0;
  const rate = hasInc ? ((inc-exp)/inc*100).toFixed(1) : null;

  /* 할 일은 규칙에서 나온다 — 손으로 적지 않는다 */
  const todos = [];
  const rising = risingFixed(tx);
  rising.forEach(r => todos.push({t:`${r.name} 고정비 ${r.months}개월 연속 상승`,
    m:`${won(r.first)} → ${won(r.last)}원 · 요금제나 약정 확인 필요`}));
  if (exp > avgExp && avgExp) todos.push({t:'이번 달 지출이 평균을 넘었습니다',
    m:`${won(exp)}원 · 최근 평균 ${won(avgExp)}원`});
  goals.filter(g => g.lower_is_better && g.current > g.target)
       .forEach(g => todos.push({t:`${g.item}이 상한을 넘었습니다`,
    m:`${won(g.current)}원 · 상한 ${won(g.target)}원`}));
  goals.filter(g => !g.lower_is_better && g.pct < 15)
       .slice(0,1).forEach(g => todos.push({t:`${g.item} 진행이 더딥니다`,
    m:`${man(g.current)} / ${man(g.target)} · ${Math.round(g.pct)}%`}));

  return `<div class="hero">
    <div class="slab">
      <div class="nw-label">순자산 · ${curYm}</div>
      <div class="nw-value num">${Math.round(nw/10000).toLocaleString()}<small>만원</small></div>
      <div class="nw-delta"><b class="num ${d>=0?'up':'down'}">${d>=0?'+':'−'}${man(Math.abs(d))}</b>
        <span class="sub">전월 대비 ${prev?((d/prev)*100).toFixed(1):'—'}%</span></div>
      ${sparkline(nwSeries.map(x=>x[1]))}
    </div>
    <div class="slab todo">
      <h3>지금 확인할 것</h3><p>규칙에 걸린 항목만 올라옵니다</p>
      ${todos.length ? todos.map(x=>`<div class="todo-row"><button class="tick" aria-label="완료"></button>
        <p>${esc(x.t)}<em>${esc(x.m)}</em></p></div>`).join('')
        : '<div class="empty">걸린 규칙이 없습니다. 이번 주는 그냥 넘어가도 됩니다.</div>'}
    </div>
  </div>

  <div class="flow">
    <div class="flow-card i"><h4>이번 달 수입</h4>
      <div class="v num" style="color:var(--income)">${won(inc)}</div><div class="m">${CUR_YM} 누적</div></div>
    <div class="flow-card e"><h4>이번 달 지출</h4>
      <div class="v num" style="color:var(--expense)">${won(exp)}</div>
      <div class="m">이체·자산 이동 제외 · 평균 ${won(avgExp)}</div></div>
    <div class="flow-card s"><h4>${hasInc?'저축률':'평균 대비 지출'}</h4>
      <div class="v num" style="color:var(--save)">${hasInc ? rate+'%'
        : (avgExp ? (exp/avgExp*100).toFixed(0)+'%' : '—')}</div>
      <div class="m">${hasInc ? '(수입 − 실지출) ÷ 수입' : '이번 달 수입 기록 전 · 평균 '+won(avgExp)+'원 기준'}</div></div>
  </div>

  <div class="block">
    <header><h2>목표 진행</h2><button class="more" data-go="goals:targets">전체 보기</button></header>
    ${goals.slice(0,3).map(goalRow).join('') || '<div class="empty">등록된 재무 목표가 없습니다.</div>'}
  </div>

  <div class="block">
    <header><h2>최근 거래</h2><button class="more" data-go="flow:ledger">전체 보기</button></header>
    <table><thead><tr><th style="width:70px">날짜</th><th>내용</th><th style="width:74px">구분</th>
      <th class="r" style="width:120px">금액</th></tr></thead>
    <tbody>${tx.slice(0,6).map(txRow).join('')}</tbody></table>
  </div>`;
};

/* 고정비 3개월 연속 상승 감지 */
function risingFixed(tx){
  const byName = {};
  tx.filter(t => t.is_fixed && isSpend(t)).forEach(t => {
    const k = t.merchant || t.category;
    (byName[k] ??= {})[ymOf(t.date)] = ((byName[k][ymOf(t.date)])||0) + t.amount;
  });
  return Object.entries(byName).map(([name,byYm])=>{
    const ms = Object.keys(byYm).filter(y=>y!==CUR_YM).sort().slice(-3);
    if (ms.length < 3) return null;
    const v = ms.map(m=>byYm[m]);
    return v[0]<v[1] && v[1]<v[2] ? {name, months:3, first:v[0], last:v[2]} : null;
  }).filter(Boolean).slice(0,3);
}

/* lower_is_better 목표(고정비·지출)는 "채우는" 게 아니라 "넘지 않는" 것이다.
   같은 막대를 쓰되 색과 문구를 뒤집는다. */
function goalRow(g){
  const over = g.lower_is_better && g.current > g.target;
  const col  = g.lower_is_better ? (over ? 'var(--expense)' : 'var(--income)') : 'var(--asset)';
  return `<div class="goal"><header><b>${g.emoji?g.emoji+' ':''}${esc(g.item)}</b>
    <span class="num">${man(g.current)} ${g.lower_is_better?'／상한':'/'} ${man(g.target)} · ${Math.round(g.pct)}%</span></header>
    <div class="track"><i style="width:${Math.min(100,Math.max(0,g.pct))}%;background:${col}"></i></div>
    <footer>
      <span>${g.lower_is_better ? (over?'상한 초과':'상한 안쪽') : g.status}</span>
      ${g.cleared ? `<span>이미 지난 이정표 ${g.cleared}개</span>` : ''}
      ${g.target_on?`<span>기한 ${g.target_on}</span>`:''}
      ${g.metric_source?`<span>자동 계산 · ${g.metric_source}</span>`:'<span>수동 입력</span>'}
      ${g.note?`<span>${esc(g.note)}</span>`:''}</footer></div>`;
}

/* ── 현금흐름 · 거래 내역 ── */
let LED = { kind:'전체', q:'' };
P['flow:ledger'] = async () => {
  const all = await DB.transactions();
  const rows = all.filter(t =>
    (LED.kind==='전체' || t.kind===LED.kind) &&
    (!LED.q || (t.merchant+t.category+(t.note||'')).toLowerCase().includes(LED.q.toLowerCase())));
  const sum = k => rows.filter(t=>t.kind===k).reduce((s,t)=>s+t.amount,0);

  /* 칩은 실제로 쓰인 구분만 띄운다. '자산'은 최근 원장에 없어서 자동으로 빠진다. */
  const kinds = ['전체', ...['수입','지출','이체','자산'].filter(k => all.some(t=>t.kind===k))];

  return `<div class="toolbar">
    <div class="seg" id="ledKind">${kinds.map(k=>
      `<button data-k="${k}" aria-pressed="${LED.kind===k}">${k}</button>`).join('')}</div>
    <input type="search" id="ledQ" placeholder="사용처 · 카테고리 · 메모 검색" value="${esc(LED.q)}">
  </div>
  <div class="block">
    <table><thead><tr><th style="width:70px">날짜</th><th>내용</th><th style="width:74px">구분</th>
      <th class="r" style="width:130px">금액</th></tr></thead>
    <tbody>${rows.length ? rows.slice(0,300).map(txRow).join('')
      : '<tr><td colspan="4" class="empty">조건에 맞는 거래가 없습니다. 필터를 넓혀보세요.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">${rows.length}건${rows.length>300?' (300건까지 표시)':''}</td>
      <td class="r sub">수입 / 지출</td>
      <td class="r"><span style="color:var(--income)">+${won(sum('수입'))}</span>
        <span class="sub"> / </span><span style="color:var(--expense)">−${won(sum('지출'))}</span></td></tr></tfoot>
    </table>
  </div>
  ${stub('원장 설계 원칙','거래는 append-only로 쌓습니다. 정정이 필요하면 반대 거래를 새로 기록하고 과거 행은 덮어쓰지 않습니다. kind는 transactions에 없고 categories 조인으로 따라옵니다.',
    [{t:'기간 · 금액대 복합 필터'},{t:'미분류 거래 일괄 분류 뷰'},
     {t:'상인명 → 카테고리 자동 매핑 (merchants 테이블)',has:true},
     {t:'Good/Bad 태깅 집계 — 후회한 지출 추적'},
     {t:'company_paid 회사 대납 건 분리 집계'}])}`;
};

/* ── 현금흐름 · 고정비 ── */
P['flow:fixed'] = async () => {
  const [tx, merch] = await Promise.all([DB.transactions(), DB.fixedMerchants()]);
  const fixed = tx.filter(t => t.is_fixed && isSpend(t));       // 규칙① 이체·자산 제외

  const byName = {};
  fixed.forEach(t => {
    const k = t.merchant || t.category;
    (byName[k] ??= { name:k, category:t.category, rows:[] }).rows.push(t);
  });
  /* 규칙③ 핵심 — 나누는 값은 "등장한 달 수"가 아니라 "첫 등장 이후 경과한 달 수"다.
     출현 개월로 나누면 연 1회 결제가 월 20만원짜리 고정비로 둔갑한다.
     (기존 해달에서 이미 한 번 잡았던 버그) */
  const lastYm = completed(tx).map(t=>ymOf(t.date)).sort().at(-1) || CUR_YM;
  const spanTo = ym => {
    const [y1,m1] = ym.split('-').map(Number), [y2,m2] = lastYm.split('-').map(Number);
    return Math.max(1, (y2-y1)*12 + (m2-m1) + 1);
  };

  const items = Object.values(byName).map(o => {
    const done = completed(o.rows);                             // 규칙② 진행 중인 달 제외
    if (!done.length) return null;
    const yms = [...new Set(done.map(r=>ymOf(r.date)))].sort();
    const span = spanTo(yms[0]);                                // 경과 개월
    const seen = yms.length;                                    // 출현 개월
    const total = done.reduce((s,r)=>s+r.amount,0);
    const ratio = seen/span;
    return { ...o, monthly: total/span, span, seen, total, last: o.rows[0],
      cycle: ratio >= 0.8 ? '월납' : (span >= 10 && seen <= 2) ? '연납' : '비정기' };
  }).filter(Boolean).sort((a,b)=>b.monthly-a.monthly);

  const total = items.reduce((s,x)=>s+x.monthly,0);
  const rising = risingFixed(tx);

  return `<div class="flow" style="margin-bottom:22px">
    <div class="flow-card e"><h4>월 고정비</h4>
      <div class="v num" style="color:var(--expense)">${won(total)}</div>
      <div class="m">첫 등장 이후 경과 개월로 나눔 · 진행 중인 달 제외</div></div>
    <div class="flow-card"><h4>항목 수</h4><div class="v num">${items.length}</div>
      <div class="m">고정 상인 등록 ${merch.length}건</div></div>
    <div class="flow-card ${rising.length?'e':''}"><h4>연속 상승</h4>
      <div class="v num" style="color:${rising.length?'var(--expense)':'var(--ink-2)'}">${rising.length}</div>
      <div class="m">3개월 연속 오른 항목</div></div>
  </div>

  <div class="block">
    <header><h2>고정비 목록</h2><p>transactions.is_fixed 기준</p></header>
    <table><thead><tr><th>항목</th><th style="width:96px">주기</th><th style="width:88px">최근 청구</th>
      <th class="r" style="width:116px">월 환산</th><th style="width:84px">상태</th></tr></thead>
    <tbody>${items.length ? items.map(x=>{
      const up = rising.find(r=>r.name===x.name);
      return `<tr><td>${esc(x.name)}<div class="sub">${esc(x.category)}</div></td>
        <td class="sub">${x.cycle}<div class="sub">${x.span}개월 중 ${x.seen}회</div></td>
        <td class="sub num">${x.last.date.slice(5).replace('-','.')}</td>
        <td class="r" style="font-weight:600">${won(x.monthly)}
          <div class="sub num">누적 ${won(x.total)}</div></td>
        <td>${up?'<span class="chip c-지출">상승</span>':'<span class="sub">—</span>'}</td></tr>`;}).join('')
      : '<tr><td colspan="5" class="empty">고정비로 표시된 거래가 없습니다. 설정에서 상인을 고정비로 지정하세요.</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="3">월 환산 합계</td><td class="r">${won(total)}</td><td></td></tr></tfoot></table>
  </div>
  ${stub('적용된 계산 규칙','기존 해달에서 잡았던 계산 버그 3건을 코드 레벨에서 막습니다. 이식할 때 이 규칙이 깨지지 않도록 유지하세요.',
    [{t:'<b>이체·자산 이동은 지출 합계에서 제외</b> — v_transactions.kind로 걸러냄',has:true},
     {t:'<b>진행 중인 달은 평균 산출에서 제외</b> — completed()가 담당',has:true},
     {t:'<b>출현 개월이 아니라 경과 개월로 나눔</b> — 연 1회 결제가 월 20만원으로 둔갑하는 것을 막음',has:true},
     {t:'<b>3개월 연속 상승 시 홈 할 일로 자동 승격</b>',has:true},
     {t:'merchants.is_fixed 지정 시 과거 거래 소급 전파'}])}`;
};

/* ── 자산 현황 · 순자산 ── */
P['assets:networth'] = async () => {
  const snap = await DB.snapshots();
  const series = netWorthByMonth(snap);
  const last = series.at(-1)?.[0];
  const cur = snap.filter(r => r.ym === last);
  const byClass = {};
  cur.forEach(r => byClass[r.asset_class] = (byClass[r.asset_class]||0) + r.amount);
  const total = Object.values(byClass).reduce((a,b)=>a+b,0);
  const COL = {'현금 자산':'transfer','투자 자산':'asset','저축 자산':'save','연금 자산':'pension'};

  return `<div class="block">
    <header><h2>순자산 추이</h2><p>${series[0]?.[0]} ~ ${last} · ${series.length}개월</p></header>
    <div class="slab">${sparkline(series.map(x=>x[1]), 760, 150).replace('class="spark"','style="width:100%;height:150px"')}
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-3);margin-top:6px">
        <span>${series[0]?.[0]||''}</span><span>${last||''}</span></div></div>
  </div>

  <div class="block">
    <header><h2>자산군 구성</h2><p>${last} 기준</p></header>
    <table><thead><tr><th>자산군</th><th style="width:170px">비중</th><th class="r" style="width:130px">평가액</th></tr></thead>
    <tbody>${Object.entries(byClass).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr>
      <td><span class="chip c-${k==='현금 자산'?'이체':k==='투자 자산'?'자산':'w'}">${esc(k)}</span></td>
      <td><div class="bar"><i style="width:${v/total*100}%;background:var(--${COL[k]||'ink-3'})"></i></div>
        <div class="sub num">${(v/total*100).toFixed(1)}%</div></td>
      <td class="r">${man(v)}</td></tr>`).join('')}
    </tbody>
    <tfoot><tr><td colspan="2">합계</td><td class="r" style="font-size:15px">${man(total)}</td></tr></tfoot></table>
  </div>
  ${stub('스냅샷 설계','자산 평가액은 시점 데이터입니다. 거래 원장과 같은 테이블에 두지 않고 asset_snapshots로 분리해, 자동 수집이 원장을 건드리지 않게 합니다.',
    [{t:'계좌별 잔액과 원장 누적 잔액 대조 — 불일치 자동 감지'},
     {t:'부채 자산군 추가 — 현재 asset_class에 부채 항목 없음'},
     {t:'월 스냅샷 누락 감지 — 기록 안 된 달 표시'}])}`;
};

/* ── 자산 현황 · 계좌 ── */
P['assets:accounts'] = async () => {
  const [acc, snap] = await Promise.all([DB.accounts(), DB.snapshots()]);
  const last = netWorthByMonth(snap).at(-1)?.[0];
  const bal = {}; snap.filter(r=>r.ym===last).forEach(r => bal[r.account] = (bal[r.account]||0)+r.amount);

  return `<div class="block">
    <header><h2>계좌</h2><p>${last} 스냅샷 기준 · 활성 ${acc.length}개</p></header>
    <table><thead><tr><th>계좌</th><th style="width:120px">자산군</th><th>메모</th>
      <th class="r" style="width:120px">잔액</th></tr></thead>
    <tbody>${acc.map(a=>`<tr><td>${esc(a.name)}</td><td class="sub">${esc(a.asset_class)}</td>
      <td class="sub">${esc(a.note||'')}</td>
      <td class="r">${bal[a.name]!=null?man(bal[a.name]):'<span class="sub">스냅샷 없음</span>'}</td></tr>`).join('')}
    </tbody></table>
  </div>
  ${stub('계좌 패널','accounts 테이블이 마스터, asset_snapshots가 월별 잔액입니다. 스냅샷에 없는 계좌는 그 달 기록이 누락된 것입니다.',
    [{t:'계좌별 금리 · 만기일 컬럼 추가'},
     {t:'비상금 환산 — 월 평균 지출 대비 몇 개월분'},
     {t:'ISA 계좌 유형(신탁형/중개형)과 납입 한도 잔여'}])}`;
};

/* ── 투자 · 포트폴리오 ── */
P['invest:port'] = async () => {
  const [h, th] = await Promise.all([DB.holdings(), DB.thesis()]);
  if (!h.length) return wipbar('holdings 테이블에 스냅샷이 없습니다. 토스 수집 파이프라인을 먼저 돌려주세요.');
  const thByTicker = Object.fromEntries(th.map(t=>[t.ticker,t]));
  const total = h.reduce((s,x)=>s+x.value,0);
  const over  = h.filter(x=>x.value/total > 0.15);
  const dust  = h.filter(x=>x.value/total < 0.003);
  /* thesis 테이블이 아직 비어 있다. 74종목 전부에 경고를 띄우면 아무것도 안 보이므로,
     비중 1% 이상인 것만 "매도 조건 없음"으로 센다. 먼지는 어차피 정리 대상이다. */
  const meaningful = h.filter(x => x.value/total >= 0.01);
  const noStop = meaningful.filter(x => !thByTicker[x.ticker]?.sell_trigger).length;
  const wSum = h.reduce((s,x)=>s+(x.pnl_pct??0)*x.value,0)/total;

  return `<div class="flow" style="margin-bottom:20px">
    <div class="flow-card a"><h4>보유 종목</h4>
      <div class="v num">${h.length}<span style="font-size:15px;color:var(--ink-3)"> / 35</span></div>
      <div class="m">축소 목표까지 ${Math.max(0,h.length-35)}개</div></div>
    <div class="flow-card ${wSum<0?'e':'i'}"><h4>가중 수익률</h4>
      <div class="v num" style="color:var(--${wSum<0?'expense':'income'})">${wSum.toFixed(2)}%</div>
      <div class="m">진입가는 판단 기준이 아닙니다</div></div>
    <div class="flow-card ${noStop?'e':''}"><h4>매도 조건 미설정</h4>
      <div class="v num" style="color:${noStop?'var(--expense)':'var(--ink-2)'}">${noStop}<span
        style="font-size:15px;color:var(--ink-3)"> / ${meaningful.length}</span></div>
      <div class="m">비중 1% 이상 종목 기준 · thesis 미입력</div></div>
  </div>

  <div class="block">
    <header><h2>보유 종목</h2><p>지금 현금으로 이 가격에 다시 살 것인가</p>
      <span class="sub">먼지 포지션 ${dust.length}개 · 과대비중 ${over.length}개</span></header>
    <table><thead><tr><th>종목</th><th style="width:150px">비중</th><th class="r" style="width:104px">평가액</th>
      <th class="r" style="width:86px">수익률</th><th style="width:104px">상태</th></tr></thead>
    <tbody>${h.slice(0,60).map(x=>{
      const w = x.value/total*100, t = thByTicker[x.ticker];
      const flag = w>15 ? '<span class="chip c-지출">과대비중</span>'
                 : w<0.3 ? '<span class="chip c-w">먼지</span>'
                 : (t?.logic && w<1.5) ? '<span class="chip c-자산">과소비중</span>'
                 : (w>=1 && !t?.sell_trigger) ? '<span class="chip c-지출">조건 없음</span>'
                 : '<span class="sub">—</span>';
      return `<tr><td>${esc(x.name)}${x.ticker?`(${esc(x.ticker)})`:''}
          ${memo3([t?.logic,t?.sell_trigger,t?.type].filter(Boolean).length)}</td>
        <td><div class="bar"><i style="width:${Math.min(100,w*4)}%;background:var(--${w>15?'expense':'asset'})"></i></div>
          <div class="sub num">${w.toFixed(2)}%</div></td>
        <td class="r">${man(x.value)}</td>
        <td class="r" style="color:var(--${x.pnl_pct==null?'ink-3':x.pnl_pct>=0?'income':'expense'})">
          ${x.pnl_pct==null?'—':x.pnl_pct.toFixed(1)+'%'}</td>
        <td>${flag}</td></tr>`;}).join('')}
    </tbody>
    <tfoot><tr><td colspan="2">합계 ${h.length}종목</td><td class="r">${man(total)}</td><td colspan="2"></td></tr></tfoot></table>
  </div>
  ${stub('이 패널이 매번 먼저 보여주는 것','논리 발견 → 가격 확인 → 촉매 날짜 확인 3단계 중 1단계에 머무는 걸 구조로 막습니다. 종목 수와 매도 조건 미설정 건수를 상단에 고정했습니다.',
    [{t:'<b>과대비중 15% 초과 자동 플래그</b>',has:true},
     {t:'<b>먼지 포지션 0.3% 미만 자동 표시</b>',has:true},
     {t:'<b>thesis.sell_trigger 없으면 경고</b> — 란자테크 재발 방지',has:true},
     {t:'thesis 테이블이 비어 있음 — 보유 74종목의 논리 입력 필요'},
     {t:'stocks.themes 기준 섹터·테마별 배분 뷰'}])}`;
};

/* ── 투자 · 관심종목 ── */
P['invest:watch'] = async () => {
  const w = await DB.watchlist();
  const T = {1:{l:'대기발주',d:'조건 충족 시 즉시 매수',cap:3},
             2:{l:'트리거대기',d:'관찰 지표가 조건에 닿으면 L1으로 승격',cap:8},
             3:{l:'아이디어',d:'90일 경과 시 정리',cap:null}};
  return `<div class="block">
    <header><h2>관심종목</h2><p>study_cards.watch_level · 단계마다 한도가 있어 무한히 쌓이지 않습니다</p></header>
    ${[1,2,3].map(t=>{
      const items = w.filter(x=>x.tier===t), cap = T[t].cap;
      return `<div class="tier"><header><span class="rank">L${t}</span><b>${T[t].l}</b><span>${T[t].d}</span>
        <span class="cap num ${cap&&items.length>=cap?'full':''}">${items.length}${cap?` / ${cap}`:''}</span></header>
        <ul>${items.length ? items.map(x=>`<li>
          <div><b>${esc(x.name)}${x.ticker?`(${esc(x.ticker)})`:''}</b>${memo3(x.thesis)}
            ${x.type?`<div class="sub">${esc(x.type)}</div>`:''}</div>
          <p>${esc(x.watch_trigger || x.buy_reason || '논리 미정리')}
            ${x.daysLeft!=null && t===3 ? `<span class="sub"> · 남은 기간 ${x.daysLeft}일</span>`:''}
            ${x.thesis<3 && t<3 ? '<span class="sub"> · 3문장 미완성</span>':''}</p></li>`).join('')
          : `<li><p class="sub">비어 있습니다.</p></li>`}</ul></div>`;}).join('')}
    ${(() => {
      const un = w.filter(x => x.tier === 0);
      if (!un.length) return '';
      return `<div class="tier"><header><span class="rank">—</span><b>단계 미배정</b>
        <span>study_cards에 있지만 watch_level이 비어 있는 카드</span>
        <span class="cap num">${un.length}</span></header>
        <ul>${un.map(x=>`<li><div><b>${esc(x.name)}${x.ticker?`(${esc(x.ticker)})`:''}</b>${memo3(x.thesis)}
          ${x.type?`<div class="sub">${esc(x.type)}</div>`:''}</div>
          <p>${esc(x.buy_reason || x.verdict || '논리 미정리')}</p></li>`).join('')}</ul></div>`;
    })()}
  </div>
  ${stub('승격 규칙','L3 → L2 승격은 3문장 메모가 모두 채워졌을 때만 허용합니다. 위 초록 막대가 그 3칸이고, 각각 study_cards의 컬럼에 대응합니다.',
    [{t:'<b>① 왜 사는가</b> = buy_reason',has:true},
     {t:'<b>② 언제 파는가</b> = stop · take',has:true},
     {t:'<b>③ 틀렸다는 신호</b> = falsify1 · falsify2',has:true},
     {t:'<b>L1 3개 · L2 8개 한도</b> — 초과 시 승격 차단',has:true},
     {t:'<b>L3 90일 정리</b> — watch_date 기준 잔여일 표시',has:true},
     {t:'단계 이동 UI — 현재는 읽기 전용'},
     {t:'스태핑·HR 업종 채용 선행지표를 watch_trigger로 등록'}])}`;
};

/* ── 목표 ── */
P['goals:targets'] = async () => {
  const [g, snap] = await Promise.all([DB.goals(), DB.snapshots()]);
  const series = netWorthByMonth(snap);
  const pace = series.length>1 ? (series.at(-1)[1]-series[0][1])/(series.length-1) : 0;
  const cleared = g.reduce((s,x)=>s+(x.cleared||0),0);
  const nwGoal = g.find(x => x.metric_source === 'total_asset');
  const eta = nwGoal && pace>0 ? Math.ceil((nwGoal.target - nwGoal.current)/pace) : null;

  return `<div class="block">
    <header><h2>재무 목표</h2><p>goal_progress 뷰 · 지금 겨누는 이정표만</p>
      <span class="sub">지난 이정표 ${cleared}개는 접어 두었습니다</span></header>
    ${g.length ? g.map(goalRow).join('') : '<div class="empty">등록된 재무 목표가 없습니다.</div>'}
  </div>
  <div class="flow">
    <div class="flow-card a"><h4>월 평균 순자산 증가</h4><div class="v num">${man(pace)}</div>
      <div class="m">${series.length}개월 관측 · 진행 중인 달 제외</div></div>
    <div class="flow-card t"><h4>${nwGoal?esc(nwGoal.item)+' 도달':'관측 기간'}</h4>
      <div class="v num">${eta ? `${Math.floor(eta/12)}년 ${eta%12}개월` : series.length+'개월'}</div>
      <div class="m">${nwGoal?`${man(nwGoal.target)} 기준 · 현재 속도 유지 시`:`${series[0]?.[0]} ~ ${series.at(-1)?.[0]}`}</div></div>
    <div class="flow-card s"><h4>자동 계산</h4>
      <div class="v num" style="color:var(--save)">${g.filter(x=>x.metric_source).length}<span
        style="font-size:15px;color:var(--ink-3)"> / ${g.length}</span></div>
      <div class="m">나머지는 수동 입력</div></div>
  </div>
  ${stub('이 층이 하는 일','목표 진행률이 홈 "지금 확인할 것"의 우선순위를 결정합니다. 기록과 투자는 이 화면을 위해 존재합니다.',
    [{t:'metric_source 자동 계산 — goal_progress 뷰 활용',has:true},
     {t:'목표 간 우선순위 — 자금 충돌 시 배분 규칙'},
     {t:'경제적 독립 시점 추정 — 연 지출 25배 기준 역산'},
     {t:'3개월 연속 계획 미달 시 홈 할 일 자동 승격'}])}`;
};

/* ── 설정 · 데이터 연동 ── */
P['settings:sources'] = async () => {
  const checks = await Promise.all([
    probe('v_transactions'), probe('asset_snapshots'), probe('holdings'),
    probe('study_cards'), probe('goal_progress'), probe('merchants'), probe('thesis'), probe('accounts')
  ]);
  return `<div class="block">
    <header><h2>Supabase 테이블</h2><p>${SB_URL.replace('https://','')}</p></header>
    <table><thead><tr><th>테이블</th><th>역할</th><th class="r" style="width:100px">행</th>
      <th style="width:90px">상태</th></tr></thead>
    <tbody>${checks.map(c=>`<tr><td>${c.name}</td><td class="sub">${ROLE[c.name]||''}</td>
      <td class="r num">${c.count ?? '—'}</td>
      <td>${c.ok?'<span class="chip c-수입">연결</span>':'<span class="chip c-지출">오류</span>'}</td></tr>`).join('')}
    </tbody></table>
  </div>
  ${stub('수집 · 저장 · 표현 3단 분리','소스별 특이사항은 수집 스크립트 안에서 끝내고, 저장소에는 정규화된 형태로만 들어옵니다. 화면은 app.js 상단 DB 객체만 봅니다.',
    [{t:'<b>기존 app.js는 Google Sheets CSV를 함께 읽습니다</b> — v2는 Supabase만 봅니다'},
     {t:'토스 수집 파이프라인 실행 상태 · 마지막 수집 시각'},
     {t:'스냅샷 누락 월 감지'},
     {t:'수집 실패 로그 및 재시도'}])}`;
};
const ROLE = {v_transactions:'거래 원장 뷰 — kind·category 펼침', asset_snapshots:'월별 계좌 잔액',
  holdings:'보유 종목 스냅샷', study_cards:'종목 연구 카드 · 관심종목 L1~L3',
  goal_progress:'목표 뷰 — metric_source 기준 현재값 자동 계산',
  merchants:'상인 마스터 · 고정비 지정', thesis:'투자 논리 원장 (비어 있음)',
  accounts:'계좌 마스터'};
async function probe(name){
  const { count, error } = await sb.from(name).select('*',{count:'exact',head:true});
  return { name, count, ok: !error };
}

/* ── 현금흐름 · 예산 ──
   예산 금액의 출처는 legacy와 같은 순서를 따른다.
   1순위 goal_progress 의 monthly_expense 목표, 2순위 마감된 최근 3개월 실지출 평균.
   실지출 = company_paid(회사 환급) 제외. 예산과 집행을 같은 기준으로 맞춘다. */
P['flow:budget'] = async () => {
  const [tx, goals] = await Promise.all([DB.transactions(), DB.goals()]);
  const real = t => isSpend(t) && !t.company_paid;
  const prev3 = prevMonths(3);

  const cur = tx.filter(t => ymOf(t.date)===CUR_YM && real(t));
  const spent = cur.reduce((s,t)=>s+t.amount,0);

  const base3 = tx.filter(t => prev3.includes(ymOf(t.date)) && real(t));
  const avg3 = base3.reduce((s,t)=>s+t.amount,0) / (prev3.length || 1);

  const goalCap = goals.find(g => g.metric_source === 'monthly_expense');
  const budget = goalCap ? { amount:goalCap.target, src:'목표 · '+goalCap.item }
               : avg3    ? { amount:avg3, src:'최근 3개월 실지출 평균' } : null;

  /* 경과율 — 달의 몇 %가 지났는가. 소진율이 이걸 앞지르면 속도가 빠른 것이다. */
  const d = KST(), days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const elapsed = d.getDate()/days*100;
  const used = budget ? spent/budget.amount*100 : 0;
  const left = budget ? budget.amount - spent : 0;
  const perDay = budget && days-d.getDate() > 0 ? left/(days-d.getDate()) : null;

  /* 카테고리별 기준선은 같은 3개월 평균에서 뽑는다. 별도 예산 테이블이 없다. */
  const byCat = {};
  cur.forEach(t => (byCat[t.category] ??= {cur:0,avg:0}).cur += t.amount);
  base3.forEach(t => (byCat[t.category] ??= {cur:0,avg:0}).avg += t.amount/(prev3.length||1));
  const cats = Object.entries(byCat).sort((a,b)=>b[1].avg-a[1].avg);

  return `${budget ? `<div class="flow" style="margin-bottom:22px">
    <div class="flow-card ${used>elapsed?'e':'i'}"><h4>소진율</h4>
      <div class="v num" style="color:var(--${used>elapsed?'expense':'income'})">${used.toFixed(0)}%</div>
      <div class="m">이 달 ${elapsed.toFixed(0)}% 경과 · ${used>elapsed?'속도가 빠릅니다':'여유 있습니다'}</div></div>
    <div class="flow-card ${left<0?'e':''}"><h4>남은 예산</h4>
      <div class="v num" style="color:${left<0?'var(--expense)':'var(--ink)'}">${won(left)}</div>
      <div class="m">${won(spent)} / ${won(budget.amount)}</div></div>
    <div class="flow-card t"><h4>하루 허용액</h4>
      <div class="v num" style="color:var(--transfer)">${perDay!=null?won(Math.max(0,perDay)):'—'}</div>
      <div class="m">${days-d.getDate()}일 남음</div></div>
  </div>
  <div class="block"><header><h2>예산 기준</h2><p>${budget.src}</p></header>
    <div class="slab"><div class="track" style="height:10px">
      <i style="width:${Math.min(100,used)}%;background:var(--${used>elapsed?'expense':'income'})"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-3);margin-top:7px">
        <span>소진 ${used.toFixed(1)}%</span><span>경과 ${elapsed.toFixed(1)}%</span></div></div>
  </div>` : wipbar('예산 기준을 정할 수 없습니다. 목표 탭에 월 지출 목표를 등록하거나, 마감된 달이 3개 이상 쌓여야 합니다.')}

  <div class="block">
    <header><h2>카테고리별 집행</h2><p>기준선은 최근 3개월 평균 · 회사 환급분 제외</p></header>
    <table><thead><tr><th>카테고리</th><th style="width:180px">이번 달 / 기준선</th>
      <th class="r" style="width:110px">이번 달</th><th class="r" style="width:110px">기준선</th>
      <th style="width:80px">상태</th></tr></thead>
    <tbody>${cats.length ? cats.map(([name,v])=>{
      const r = v.avg ? v.cur/v.avg*100 : (v.cur?200:0);
      const hot = v.avg && r > Math.max(100, elapsed*1.2);
      return `<tr><td>${esc(name)}</td>
        <td><div class="bar"><i style="width:${Math.min(100,r)}%;background:var(--${hot?'expense':'income'})"></i></div>
          <div class="sub num">${v.avg?r.toFixed(0)+'%':'기준 없음'}</div></td>
        <td class="r">${won(v.cur)}</td><td class="r sub">${won(v.avg)}</td>
        <td>${hot?'<span class="chip c-지출">초과</span>':'<span class="sub">—</span>'}</td></tr>`;}).join('')
      : '<tr><td colspan="5" class="empty">이번 달 지출 기록이 아직 없습니다.</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="2">합계</td><td class="r">${won(spent)}</td>
      <td class="r sub">${won(avg3)}</td><td></td></tr></tfoot></table>
  </div>
  ${stub('예산을 쓰는 방식','예산은 지키는 목표가 아니라 이탈을 알아채는 장치입니다. 소진율이 경과율을 넘으면 홈 할 일로 올라갑니다. 카테고리별 예산 테이블은 따로 두지 않고, 본인의 최근 3개월 평균을 기준선으로 씁니다.',
    [{t:'<b>목표 monthly_expense를 1순위 기준으로 사용</b> — legacy와 동일',has:true},
     {t:'<b>company_paid 회사 환급분 제외</b> — 예산·집행 기준 통일',has:true},
     {t:'카테고리별 예산 직접 지정 (지금은 3개월 평균 고정)'},
     {t:'고정비 제외 변동비만 보는 토글'}])}`;
};
function prevMonths(n){
  const out = [], d = KST();
  for (let i=1;i<=n;i++){ const x=new Date(d.getFullYear(), d.getMonth()-i, 1);
    out.push(x.toISOString().slice(0,7)); }
  return out;
}

/* ── 투자 · 종목 상세 ──
   thesis 테이블이 비어 있다. 이 화면은 그걸 채우는 입구를 겸한다. */
let HOLD_SEL = null;
P['invest:holding'] = async () => {
  const [h, th, cards] = await Promise.all([DB.holdings(), DB.thesis(), DB.watchlist()]);
  if (!h.length) return wipbar('holdings 스냅샷이 없습니다.');
  const total = h.reduce((s,x)=>s+x.value,0);
  const sel = h.find(x => (x.ticker||x.name) === HOLD_SEL) || h[0];
  const t = th.find(x => x.ticker === sel.ticker) || {};
  const card = cards.find(c => c.ticker === sel.ticker) || {};
  const w = sel.value/total*100;

  return `<div class="toolbar">
    <select id="holdPick" style="background:var(--surface);border:1px solid var(--line-soft);
      border-radius:8px;color:var(--ink);font:inherit;font-size:13px;padding:7px 11px;min-width:280px">
      ${h.map(x=>`<option value="${esc(x.ticker||x.name)}" ${x===sel?'selected':''}>
        ${esc(x.name)}${x.ticker?`(${esc(x.ticker)})`:''} · ${(x.value/total*100).toFixed(1)}%</option>`).join('')}
    </select>
    <span class="sub">${h.length}종목 중</span>
  </div>

  <div class="flow" style="margin-bottom:22px">
    <div class="flow-card a"><h4>평가액</h4><div class="v num">${man(sel.value)}</div>
      <div class="m">비중 ${w.toFixed(2)}%${w>15?' · 과대비중':w<0.3?' · 먼지':''}</div></div>
    <div class="flow-card ${(sel.pnl_pct??0)<0?'e':'i'}"><h4>수익률</h4>
      <div class="v num" style="color:var(--${(sel.pnl_pct??0)<0?'expense':'income'})">
        ${sel.pnl_pct==null?'—':sel.pnl_pct.toFixed(1)+'%'}</div>
      <div class="m">진입가는 판단 기준이 아닙니다</div></div>
    <div class="flow-card ${t.sell_trigger?'':'e'}"><h4>매도 조건</h4>
      <div class="v num" style="color:var(--${t.sell_trigger?'income':'expense'});font-size:18px">
        ${t.sell_trigger?'설정됨':'없음'}</div>
      <div class="m">${t.reviewed_on?`최근 검토 ${t.reviewed_on}`:'검토 기록 없음'}</div></div>
  </div>

  <div class="block">
    <header><h2>3문장 메모</h2><p>세 칸이 다 차야 판단할 준비가 된 것입니다</p></header>
    <div class="slab">
      ${memoField('① 왜 사는가', t.logic || card.buy_reason)}
      ${memoField('② 언제 파는가', t.sell_trigger || [card.stop,card.take].filter(Boolean).join(' · '))}
      ${memoField('③ 틀렸다는 신호는 무엇인가', [card.falsify1,card.falsify2].filter(Boolean).join(' · '))}
    </div>
  </div>

  <div class="block">
    <header><h2>연구 카드</h2><p>study_cards</p></header>
    ${card.name ? `<table><tbody>
      <tr><td style="width:130px" class="sub">유형</td><td>${esc(card.type||'—')}</td></tr>
      <tr><td class="sub">점수</td><td>${card.score ?? '—'}</td></tr>
      <tr><td class="sub">판정</td><td>${esc(card.verdict||'—')}</td></tr>
      <tr><td class="sub">관심 단계</td><td>${card.watch_level || '<span class="sub">미배정</span>'}</td></tr>
      </tbody></table>`
      : '<div class="empty">이 종목의 연구 카드가 없습니다. 관심종목 탭에서 카드를 먼저 만드세요.</div>'}
  </div>
  ${stub('여기서 다음에 할 일','thesis 테이블이 0행이라 74종목 전부가 매도 조건 없음 상태입니다. 비중 1% 이상 종목부터 채우면 포트폴리오 탭의 경고가 줄어듭니다.',
    [{t:'메모 직접 입력·저장 (현재는 읽기 전용)'},
     {t:'촉매 날짜 — study_cards.check_date 연동'},
     {t:'논리 수정 이력 — thesis.updated_at 기반 타임라인'},
     {t:'포트폴리오 행 클릭으로 이 화면 진입'}])}`;
};
const memoField = (label, v) => `<div style="padding:14px 0;border-top:1px solid var(--line-soft)">
  <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:5px">${label}</div>
  <div style="font-size:13.5px;color:var(--${v?'ink':'ink-3'})">${v?esc(v):'비어 있습니다'}</div></div>`;

/* ── 리포트 · 월간 ── */
let RPT_YM = null;
P['report:monthly'] = async () => {
  const [tx, snap, goals] = await Promise.all([DB.transactions(), DB.snapshots(), DB.goals()]);
  const months = [...new Set(tx.map(t=>ymOf(t.date)))].sort().reverse();
  const ym = RPT_YM && months.includes(RPT_YM) ? RPT_YM : (months.find(m=>m!==CUR_YM) || months[0]);
  const prev = months[months.indexOf(ym)+1];

  const of = m => tx.filter(t => ymOf(t.date)===m);
  const agg = m => { const r = of(m);
    const inc = r.filter(isIncome).reduce((s,t)=>s+t.amount,0);
    const exp = r.filter(t=>isSpend(t)&&!t.company_paid).reduce((s,t)=>s+t.amount,0);
    return { inc, exp, net: inc-exp, rate: inc ? (inc-exp)/inc*100 : 0, n: r.length }; };
  const a = agg(ym), b = prev ? agg(prev) : null;

  const nw = netWorthByMonth(snap);
  const nwCur = nw.find(x=>x[0]===ym)?.[1], nwPrev = nw.find(x=>x[0]===prev)?.[1];

  const cats = {};
  of(ym).filter(t=>isSpend(t)&&!t.company_paid).forEach(t=>cats[t.category]=(cats[t.category]||0)+t.amount);
  const pCats = {};
  if (prev) of(prev).filter(t=>isSpend(t)&&!t.company_paid).forEach(t=>pCats[t.category]=(pCats[t.category]||0)+t.amount);
  const top = Object.entries(cats).sort((x,y)=>y[1]-x[1]);

  const big = of(ym).filter(t=>isSpend(t)&&!t.company_paid).sort((x,y)=>y.amount-x.amount).slice(0,5);
  const delta = (c,p) => p==null ? '<span class="sub">—</span>'
    : `<span style="color:var(--${c>=p?'expense':'income'})">${c>=p?'+':'−'}${won(Math.abs(c-p))}</span>`;

  return `<div class="toolbar">
    <div class="seg" id="rptYm">${months.slice(0,8).map(m=>
      `<button data-m="${m}" aria-pressed="${m===ym}">${m.slice(2).replace('-','.')}</button>`).join('')}</div>
    ${ym===CUR_YM?'<span class="sub">진행 중인 달입니다</span>':''}
  </div>

  <div class="flow" style="margin-bottom:22px">
    <div class="flow-card i"><h4>수입</h4><div class="v num" style="color:var(--income)">${won(a.inc)}</div>
      <div class="m">${b?`전월 ${won(b.inc)} · `:''}${delta(a.inc,b?.inc).replace('expense','income')}</div></div>
    <div class="flow-card e"><h4>실지출</h4><div class="v num" style="color:var(--expense)">${won(a.exp)}</div>
      <div class="m">${b?`전월 대비 `:''}${delta(a.exp,b?.exp)}</div></div>
    <div class="flow-card s"><h4>저축률</h4><div class="v num" style="color:var(--save)">${a.rate.toFixed(1)}%</div>
      <div class="m">${b?`전월 ${b.rate.toFixed(1)}%`:'비교 대상 없음'}</div></div>
  </div>

  <div class="block">
    <header><h2>한 줄 요약</h2></header>
    <div class="slab"><p style="font-size:14px;line-height:1.7">
      ${ym}에 <b>${won(a.inc)}</b>원을 벌고 <b>${won(a.exp)}</b>원을 썼습니다.
      ${b ? `지출은 전월보다 ${a.exp>=b.exp?'<b style="color:var(--expense)">'+won(a.exp-b.exp)+'원 늘었고</b>':'<b style="color:var(--income)">'+won(b.exp-a.exp)+'원 줄었고</b>'},` : ''}
      저축률은 <b>${a.rate.toFixed(1)}%</b>였습니다.
      ${nwCur!=null && nwPrev!=null ? `순자산은 ${man(nwPrev)}에서 <b>${man(nwCur)}</b>으로
        ${nwCur>=nwPrev?'<span style="color:var(--income)">'+man(nwCur-nwPrev)+' 늘었습니다':'<span style="color:var(--expense)">'+man(nwPrev-nwCur)+' 줄었습니다'}</span>.` : ''}
      ${top[0] ? `가장 많이 쓴 곳은 <b>${esc(top[0][0])}</b>(${won(top[0][1])}원)입니다.` : ''}
    </p></div>
  </div>

  <div class="block">
    <header><h2>카테고리별</h2><p>회사 환급분 제외 · 전월 대비</p></header>
    <table><thead><tr><th>카테고리</th><th style="width:150px">비중</th>
      <th class="r" style="width:110px">이번 달</th><th class="r" style="width:110px">전월 대비</th></tr></thead>
    <tbody>${top.map(([k,v])=>`<tr><td>${esc(k)}</td>
      <td><div class="bar"><i style="width:${v/a.exp*100}%;background:var(--expense)"></i></div>
        <div class="sub num">${(v/a.exp*100).toFixed(1)}%</div></td>
      <td class="r">${won(v)}</td><td class="r">${delta(v, prev?(pCats[k]||0):null)}</td></tr>`).join('')}
    </tbody>
    <tfoot><tr><td colspan="2">합계</td><td class="r">${won(a.exp)}</td>
      <td class="r">${delta(a.exp,b?.exp)}</td></tr></tfoot></table>
  </div>

  <div class="block">
    <header><h2>큰 지출 5건</h2></header>
    <table><thead><tr><th style="width:70px">날짜</th><th>내용</th><th style="width:74px">구분</th>
      <th class="r" style="width:120px">금액</th></tr></thead>
    <tbody>${big.length?big.map(txRow).join('')
      :'<tr><td colspan="4" class="empty">이 달 지출 기록이 없습니다.</td></tr>'}</tbody></table>
  </div>

  <div class="block">
    <header><h2>목표 진행</h2><p>${ym} 시점이 아니라 현재 값입니다</p></header>
    ${goals.slice(0,4).map(goalRow).join('')}
  </div>
  ${stub('월간 리포트','대시보드를 매번 직접 훑지 않아도 되게 만드는 게 목적입니다. 지금은 현재 시점 값으로 그리고, 월말 스냅샷이 쌓이면 그 달 시점 값으로 바꿉니다.',
    [{t:'<b>수입·실지출·저축률 전월 대비</b>',has:true},
     {t:'<b>카테고리별 증감과 큰 지출</b>',has:true},
     {t:'목표 진행률을 그 달 시점 값으로 고정'},
     {t:'다음 달 확인 항목 — 만기 · 갱신 · 촉매 날짜'},
     {t:'PDF 내보내기'}])}`;
};

/* ── 자산 현황 · 연금 ──
   납입 기록이 원장에 거의 없다. 세액공제 한도는 계산하지 않고,
   스냅샷으로 확인 가능한 것(잔액·추이·증감)만 보여준다. */
P['assets:pension'] = async () => {
  const [snap, tx] = await Promise.all([DB.snapshots(), DB.transactions()]);
  const pen = snap.filter(r => r.asset_class === '연금 자산');
  if (!pen.length) return wipbar('연금 자산 스냅샷이 없습니다.');

  const months = [...new Set(pen.map(r=>r.ym))].sort();
  const last = months.at(-1), prevYm = months.at(-2), yearAgo = months.at(-13) || months[0];
  const at = ym => pen.filter(r=>r.ym===ym);
  const sum = ym => at(ym).reduce((s,r)=>s+r.amount,0);
  const total = sum(last), dPrev = total - sum(prevYm||last), dYear = total - sum(yearAgo);

  const totals = months.map(m => sum(m));
  const accounts = [...new Set(pen.map(r=>r.account))];

  /* 원장에 연금 납입이 잡히는지 확인한다. 없으면 세액공제 계산을 안 한다고 밝힌다. */
  const paid = tx.filter(t => (t.category||'').includes('연금') && t.amount > 0
                           && t.date >= `${new Date().getFullYear()}-01-01`);
  const paidSum = paid.reduce((s,t)=>s+t.amount,0);

  return `<div class="flow" style="margin-bottom:22px">
    <div class="flow-card" style="border-left-color:var(--pension)"><h4>연금 합계</h4>
      <div class="v num" style="color:var(--pension)">${man(total)}</div>
      <div class="m">${last} 기준 · 계좌 ${accounts.length}개</div></div>
    <div class="flow-card ${dPrev>=0?'i':'e'}"><h4>전월 대비</h4>
      <div class="v num" style="color:var(--${dPrev>=0?'income':'expense'})">
        ${dPrev>=0?'+':'−'}${won(Math.abs(dPrev))}</div>
      <div class="m">${prevYm||'비교 대상 없음'}</div></div>
    <div class="flow-card ${dYear>=0?'i':'e'}"><h4>${yearAgo} 대비</h4>
      <div class="v num" style="color:var(--${dYear>=0?'income':'expense'})">
        ${dYear>=0?'+':'−'}${man(Math.abs(dYear))}</div>
      <div class="m">${months.length}개월 관측</div></div>
  </div>

  <div class="block">
    <header><h2>연금 자산 추이</h2><p>${months[0]} ~ ${last}</p></header>
    <div class="slab">${sparkline(totals, 760, 150)
      .replace('class="spark"','style="width:100%;height:150px"')
      .replaceAll('var(--asset)','var(--pension)').replaceAll('var(--asset-bg)','var(--pension-bg)')}
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-3);margin-top:6px">
        <span>${months[0]}</span><span>${last}</span></div></div>
  </div>

  <div class="block">
    <header><h2>계좌별</h2><p>${last} 스냅샷</p></header>
    <table><thead><tr><th>계좌</th><th style="width:170px">비중</th>
      <th class="r" style="width:120px">적립금</th><th class="r" style="width:110px">전월 대비</th></tr></thead>
    <tbody>${accounts.map(a=>{
      const v = at(last).find(r=>r.account===a)?.amount || 0;
      const p = prevYm ? (at(prevYm).find(r=>r.account===a)?.amount ?? null) : null;
      const d = p==null ? null : v-p;
      return `<tr><td>${esc(a)}</td>
        <td><div class="bar"><i style="width:${v/total*100}%;background:var(--pension)"></i></div>
          <div class="sub num">${(v/total*100).toFixed(1)}%</div></td>
        <td class="r">${won(v)}</td>
        <td class="r" style="color:var(--${d==null?'ink-3':d>=0?'income':'expense'})">
          ${d==null?'—':(d>=0?'+':'−')+won(Math.abs(d))}</td></tr>`;}).join('')}
    </tbody>
    <tfoot><tr><td colspan="2">합계</td><td class="r">${won(total)}</td>
      <td class="r" style="color:var(--${dPrev>=0?'income':'expense'})">
        ${dPrev>=0?'+':'−'}${won(Math.abs(dPrev))}</td></tr></tfoot></table>
  </div>
  ${stub('세액공제는 아직 계산하지 않습니다',
    `올해 원장에 잡힌 연금 납입이 ${paid.length}건 ${won(paidSum)}원뿐입니다. 실제 납입액이 원장에 들어오지 않으면 한도 소진율을 계산할 수 없어, 틀린 숫자를 띄우느니 비워 둡니다.`,
    [{t:'연금 납입 거래를 원장에 기록 — 그래야 한도 계산이 가능해집니다'},
     {t:'연간 납입액 대비 세액공제 한도 잔여 (900만원 기준)'},
     {t:'계좌별 운용 상품 · 수익률 — 현재 스냅샷에 잔액만 있음'},
     {t:'예상 수령액 시뮬레이션'}])}`;
};

/* ── 설정 · 카테고리 ──
   고정비 지정은 읽기만 해서는 쓸모가 없다. merchants.is_fixed 를 직접 바꾼다. */
P['settings:cats'] = async () => {
  const [cats, merch, tx] = await Promise.all([DB.categories(), DB.merchants(), DB.transactions()]);
  const use = {};
  tx.forEach(t => { const k = t.category+'|'+(t.sub||'');
    (use[k] ??= {n:0,amt:0}); use[k].n++; use[k].amt += t.amount; });

  const byKind = {};
  cats.forEach(c => ((byKind[c.kind] ??= {})[c.category] ??= []).push(c));

  const merchUse = {};
  tx.forEach(t => { if (t.merchant) merchUse[t.merchant] = (merchUse[t.merchant]||0)+1; });
  const sorted = [...merch].sort((a,b)=>(b.is_fixed-a.is_fixed) || (merchUse[b.name]||0)-(merchUse[a.name]||0));

  return `<div class="block">
    <header><h2>고정비 지정</h2><p>여기서 켠 상인의 거래가 고정비 패널에 집계됩니다</p>
      <span class="sub">${merch.filter(m=>m.is_fixed).length} / ${merch.length} 지정됨</span></header>
    <table><thead><tr><th>상인</th><th style="width:150px">그룹</th>
      <th class="r" style="width:90px">거래 건수</th><th style="width:80px">고정비</th></tr></thead>
    <tbody>${sorted.map(m=>`<tr><td>${esc(m.name)}</td>
      <td class="sub">${esc(m.merchant_group||'—')}</td>
      <td class="r sub">${merchUse[m.name]||0}</td>
      <td><button class="fixtog" data-id="${m.id}" data-on="${m.is_fixed}"
        style="border:0;background:none;cursor:pointer;font:inherit;padding:0">
        <span class="chip ${m.is_fixed?'c-지출':'c-w'}">${m.is_fixed?'고정비':'일반'}</span>
      </button></td></tr>`).join('')}
    </tbody></table>
  </div>

  <div class="block">
    <header><h2>카테고리 체계</h2><p>categories ${cats.length}건 · kind → category → subcategory</p></header>
    ${Object.entries(byKind).map(([kind,groups])=>`
      <div class="tier"><header><span class="chip c-${kind}">${kind}</span>
        <span>${Object.keys(groups).length}개 분류</span>
        <span class="cap num">${Object.values(groups).flat().length}</span></header>
        <ul>${Object.entries(groups).map(([cat,subs])=>{
          const n = subs.reduce((s,c)=>s+(use[cat+'|'+(c.subcategory||'')]?.n||0),0);
          const amt = subs.reduce((s,c)=>s+(use[cat+'|'+(c.subcategory||'')]?.amt||0),0);
          return `<li><div><b>${subs[0].emoji_category||''} ${esc(cat)}</b>
            <div class="sub">${n}건 · ${won(amt)}원</div></div>
            <p>${subs.map(c=>esc(c.subcategory)).join(' · ')}</p></li>`;}).join('')}
        </ul></div>`).join('')}
  </div>
  ${stub('카테고리를 늘릴 때','분류가 늘어나면 매번 고르는 피로가 커집니다. 지금 ${cats.length}건은 관리 가능한 수준이고, 새로 만들기 전에 기존 subcategory로 흡수되는지 먼저 보세요.'.replace('${cats.length}',cats.length),
    [{t:'<b>merchants.is_fixed 토글</b> — 위 표에서 바로 저장됩니다',has:true},
     {t:'카테고리 추가 · 병합 · 삭제'},
     {t:'상인명 → 카테고리 자동 매핑 규칙 편집'},
     {t:'12개월간 거래 0건인 카테고리 정리 제안'}])}`;
};

/* ── 현금흐름 · 저축·이체 규칙 ──
   자동이체 설정 테이블이 없고, 실제 이체도 날짜가 제각각이라 "규칙"이 아니다.
   그래서 설정값을 흉내내지 않고, 원장에 남은 실제 흐름을 그대로 보여준다. */
P['flow:rules'] = async () => {
  const tx = await DB.transactions();
  const months = [...new Set(completed(tx).map(t=>ymOf(t.date)))].sort();
  const n = months.length || 1;

  const per = kind => tx.filter(t => t.kind===kind && months.includes(ymOf(t.date)));
  const incTx = per('수입'), movTx = [...per('이체'), ...per('자산')];
  const inc = incTx.reduce((s,t)=>s+t.amount,0);
  const spend = tx.filter(t=>isSpend(t)&&!t.company_paid&&months.includes(ymOf(t.date)))
                  .reduce((s,t)=>s+t.amount,0);
  const moved = movTx.reduce((s,t)=>s+t.amount,0);

  /* 급여일 — 근로소득이 들어온 날의 중앙값 */
  const payDays = incTx.filter(t=>(t.category||'').includes('근로')).map(t=>Number(t.date.slice(8,10))).sort((a,b)=>a-b);
  const payDay = payDays.length ? payDays[Math.floor(payDays.length/2)] : null;

  /* 이체 대상별 집계 — 얼마나 자주, 얼마씩, 어느 날에 */
  const dest = {};
  movTx.forEach(t => {
    const k = t.merchant || t.sub || t.category;
    const d = (dest[k] ??= {name:k, kind:t.kind, n:0, amt:0, yms:new Set(), days:[]});
    d.n++; d.amt += t.amount; d.yms.add(ymOf(t.date)); d.days.push(Number(t.date.slice(8,10)));
  });
  const rows = Object.values(dest).map(d => {
    const days = d.days.slice().sort((a,b)=>a-b);
    const med = days[Math.floor(days.length/2)];
    const spread = days.at(-1) - days[0];
    return { ...d, monthly: d.amt/n, med, spread,
      pattern: d.yms.size >= n*0.8 && spread <= 6 ? '정기' : d.yms.size >= n*0.8 ? '매월 수시' : '비정기' };
  }).sort((a,b)=>b.monthly-a.monthly);

  return `<div class="flow" style="margin-bottom:22px">
    <div class="flow-card i"><h4>월 평균 수입</h4>
      <div class="v num" style="color:var(--income)">${won(inc/n)}</div>
      <div class="m">${payDay?`급여일 대략 ${payDay}일`:'급여일 불명'} · ${n}개월 평균</div></div>
    <div class="flow-card t"><h4>월 평균 이동</h4>
      <div class="v num" style="color:var(--transfer)">${won(moved/n)}</div>
      <div class="m">수입의 ${inc?(moved/inc*100).toFixed(0):'—'}%가 다른 계좌로</div></div>
    <div class="flow-card e"><h4>월 평균 실지출</h4>
      <div class="v num" style="color:var(--expense)">${won(spend/n)}</div>
      <div class="m">수입의 ${inc?(spend/inc*100).toFixed(0):'—'}%</div></div>
  </div>

  <div class="block">
    <header><h2>수입 100원이 가는 곳</h2><p>${months[0]} ~ ${months.at(-1)} 평균</p></header>
    <div class="slab"><div class="track" style="height:14px;display:flex">
      <i style="width:${inc?spend/inc*100:0}%;background:var(--expense);border-radius:0"></i>
      <i style="width:${inc?moved/inc*100:0}%;background:var(--transfer);border-radius:0"></i>
      <i style="flex:1;background:var(--income);border-radius:0"></i></div>
      <div style="display:flex;gap:16px;font-size:12px;color:var(--ink-3);margin-top:9px;flex-wrap:wrap">
        <span><span class="chip c-지출">지출</span> ${inc?(spend/inc*100).toFixed(0):0}%</span>
        <span><span class="chip c-이체">이동</span> ${inc?(moved/inc*100).toFixed(0):0}%</span>
        <span><span class="chip c-수입">계좌에 남음</span> ${inc?Math.max(0,100-(spend+moved)/inc*100).toFixed(0):0}%</span>
      </div>
      <p class="sub" style="margin-top:12px">이동은 쓴 돈이 아닙니다. 증권·CMA 계좌로 옮긴 것이라 순자산에서는 그대로 남아 있습니다.</p>
    </div>
  </div>

  <div class="block">
    <header><h2>이동 대상별</h2><p>이체·자산 이동 ${movTx.length}건</p></header>
    <table><thead><tr><th>대상</th><th style="width:110px">패턴</th>
      <th class="r" style="width:80px">횟수</th><th class="r" style="width:120px">월 평균</th>
      <th style="width:110px">주로 며칠</th></tr></thead>
    <tbody>${rows.length ? rows.map(d=>`<tr>
      <td>${esc(d.name)}<div class="sub">${d.kind}</div></td>
      <td><span class="chip ${d.pattern==='정기'?'c-이체':'c-w'}">${d.pattern}</span></td>
      <td class="r sub">${d.n}회 / ${d.yms.size}개월</td>
      <td class="r" style="font-weight:600">${won(d.monthly)}</td>
      <td class="sub num">${d.med}일${d.spread>6?` <span class="sub">(±${Math.round(d.spread/2)}일)</span>`:''}</td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="empty">이체 기록이 없습니다.</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="3">합계</td><td class="r">${won(moved/n)}</td><td></td></tr></tfoot></table>
  </div>
  ${stub('여기서 읽어야 할 것','자동이체 설정 테이블이 없어서, 설정된 규칙이 아니라 실제로 일어난 일을 보여줍니다. 선저축을 하고 있다면 급여일 직후에 정기 이동이 몰려야 하는데, 지금은 토스 증권 입금이 달마다 날짜가 흩어져 있습니다.',
    [{t:'급여일 직후 정기 이동 여부 판정',has:true},
     {t:'이동을 지출과 분리해 표시',has:true},
     {t:'선저축 비율 목표를 세우고 실제와 대조'},
     {t:'자동이체 설정 테이블 추가 — 계획 대비 실행 비교'}])}`;
};

/* ── 목표 · 진행률 ──
   목표별 계획 궤적과 실제 궤적을 겹쳐 본다. 한 달 등락이 아니라 추세선을 보는 화면. */
P['goals:progress'] = async () => {
  const [goals, snap] = await Promise.all([DB.goals(), DB.snapshots()]);
  const series = netWorthByMonth(snap);
  if (series.length < 2) return wipbar('스냅샷이 2개월 이상 쌓여야 궤적을 그릴 수 있습니다.');

  const pace = (series.at(-1)[1] - series[0][1]) / (series.length - 1);
  const pace3 = series.length >= 4
    ? (series.at(-1)[1] - series.at(-4)[1]) / 3 : pace;
  const trend = pace3 > pace*1.1 ? '가속' : pace3 < pace*0.9 ? '둔화' : '유지';

  const assetGoals = goals.filter(g => ['total_asset','available_asset'].includes(g.metric_source));

  return `<div class="flow" style="margin-bottom:22px">
    <div class="flow-card a"><h4>전체 평균 속도</h4><div class="v num">${man(pace)}</div>
      <div class="m">${series.length}개월 · 월 평균 증가</div></div>
    <div class="flow-card ${trend==='가속'?'i':trend==='둔화'?'e':''}"><h4>최근 3개월 속도</h4>
      <div class="v num" style="color:var(--${trend==='가속'?'income':trend==='둔화'?'expense':'ink'})">${man(pace3)}</div>
      <div class="m">전체 평균 대비 ${trend}</div></div>
    <div class="flow-card t"><h4>관측 구간</h4><div class="v num">${series.length}개월</div>
      <div class="m">${series[0][0]} ~ ${series.at(-1)[0]}</div></div>
  </div>

  <div class="block">
    <header><h2>순자산 궤적</h2><p>실선 실제 · 점선 현재 속도 유지 시 12개월 예상</p></header>
    <div class="slab">${trajectory(series, pace, assetGoals)}</div>
  </div>

  ${assetGoals.map(g => {
    const need = g.target - g.current;
    const mo = pace > 0 ? Math.ceil(need/pace) : null;
    const mo3 = pace3 > 0 ? Math.ceil(need/pace3) : null;
    return `<div class="block"><header><h2>${esc(g.item)} · ${man(g.target)}</h2></header>
      <table><tbody>
        <tr><td style="width:180px" class="sub">남은 금액</td><td class="num">${man(need)}</td></tr>
        <tr><td class="sub">전체 평균 속도 기준</td>
          <td class="num">${mo?`${Math.floor(mo/12)}년 ${mo%12}개월 · ${etaLabel(mo)}`:'현재 속도로는 도달 불가'}</td></tr>
        <tr><td class="sub">최근 3개월 속도 기준</td>
          <td class="num">${mo3?`${Math.floor(mo3/12)}년 ${mo3%12}개월 · ${etaLabel(mo3)}`:'현재 속도로는 도달 불가'}</td></tr>
        ${g.target_on?`<tr><td class="sub">설정한 기한</td><td class="num">${g.target_on}</td></tr>`:''}
      </tbody></table></div>`;}).join('')}

  ${stub('이 화면을 보는 법','한 달 등락은 시장이 흔든 것이고, 3개월 속도가 전체 평균과 벌어지면 그건 습관이 바뀐 것입니다. 둘이 크게 다를 때만 행동을 바꾸세요.',
    [{t:'전체 평균 속도와 최근 3개월 속도 비교',has:true},
     {t:'목표별 도달 시점 역산',has:true},
     {t:'3개월 연속 계획 미달 시 홈 할 일 자동 승격'},
     {t:'저축률 ±5% 변동 시나리오'}])}`;
};
function etaLabel(mo){
  const d = KST(); d.setMonth(d.getMonth() + mo);
  return d.toISOString().slice(0,7) + ' 무렵';
}
/* 실제 궤적 + 현재 속도 연장선. 목표선은 가로 점선으로 얹는다. */
function trajectory(series, pace, goals){
  const W = 760, H = 190, PAD = 8;
  const future = 12;
  const projected = Array.from({length:future}, (_,i)=> series.at(-1)[1] + pace*(i+1));
  const all = [...series.map(x=>x[1]), ...projected, ...goals.map(g=>g.target)];
  const lo = Math.min(...all)*0.97, hi = Math.max(...all)*1.03, r = hi-lo || 1;
  const n = series.length + future - 1;
  const X = i => PAD + i/(n)*(W-PAD*2);
  const Y = v => H - PAD - ((v-lo)/r)*(H-PAD*2);
  const real = series.map((s,i)=>`${X(i).toFixed(1)},${Y(s[1]).toFixed(1)}`).join(' ');
  const proj = [series.at(-1)[1], ...projected]
    .map((v,i)=>`${X(series.length-1+i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px" aria-label="순자산 궤적">
    ${goals.map(g=>`<line x1="${PAD}" y1="${Y(g.target).toFixed(1)}" x2="${W-PAD}" y2="${Y(g.target).toFixed(1)}"
        stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 4" opacity=".65"/>
      <text x="${W-PAD}" y="${(Y(g.target)-6).toFixed(1)}" text-anchor="end"
        font-size="11" fill="var(--accent)">${esc(g.item)} ${man(g.target)}</text>`).join('')}
    <polyline points="${real} ${X(series.length-1).toFixed(1)},${H-PAD} ${PAD},${H-PAD}"
      fill="var(--asset-bg)" stroke="none"/>
    <polyline points="${real}" fill="none" stroke="var(--asset)" stroke-width="2.5" stroke-linejoin="round"/>
    <polyline points="${proj}" fill="none" stroke="var(--asset)" stroke-width="2"
      stroke-dasharray="5 5" opacity=".6"/>
  </svg>
  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-3);margin-top:6px">
    <span>${series[0][0]}</span><span>${series.at(-1)[0]}</span><span>+12개월 예상</span></div>`;
}

/* ── 리포트 · 연간 ── */
let RPT_YEAR = null;
P['report:yearly'] = async () => {
  const thisYear = KST().getFullYear();
  const year = RPT_YEAR || thisYear;
  const [rows, prev] = await Promise.all([DB.yearly(year), DB.yearly(year-1)]);

  const agg = r => {
    const inc = r.filter(isIncome).reduce((s,t)=>s+t.amount,0);
    const exp = r.filter(t=>isSpend(t)&&!t.company_paid).reduce((s,t)=>s+t.amount,0);
    const reimb = r.filter(t=>isSpend(t)&&t.company_paid).reduce((s,t)=>s+t.amount,0);
    const fixed = r.filter(t=>isSpend(t)&&t.is_fixed&&!t.company_paid).reduce((s,t)=>s+t.amount,0);
    return { inc, exp, reimb, fixed, n:r.length, rate: inc?(inc-exp)/inc*100:0 };
  };
  const a = agg(rows), b = prev.length ? agg(prev) : null;
  const partial = year === thisYear;
  const monthsIn = partial ? KST().getMonth()+1 : 12;

  const cats = {}; rows.filter(t=>isSpend(t)&&!t.company_paid)
    .forEach(t=>cats[t.category]=(cats[t.category]||0)+t.amount);
  const pcats = {}; prev.filter(t=>isSpend(t)&&!t.company_paid)
    .forEach(t=>pcats[t.category]=(pcats[t.category]||0)+t.amount);

  const byMonth = Array.from({length:12},(_,i)=>{
    const ym = `${year}-${String(i+1).padStart(2,'0')}`;
    const r = rows.filter(t=>ymOf(t.date)===ym);
    return { ym, inc: r.filter(isIncome).reduce((s,t)=>s+t.amount,0),
             exp: r.filter(t=>isSpend(t)&&!t.company_paid).reduce((s,t)=>s+t.amount,0) };
  }).filter(m=>m.inc||m.exp);

  const years = [thisYear, thisYear-1, thisYear-2];
  const delta = (c,p,lowerBetter=true) => p==null||!p ? '<span class="sub">—</span>'
    : `<span style="color:var(--${(c>=p)===lowerBetter?'expense':'income'})">${c>=p?'+':'−'}${won(Math.abs(c-p))}</span>`;

  return `<div class="toolbar">
    <div class="seg" id="rptYear">${years.map(y=>
      `<button data-y="${y}" aria-pressed="${y===year}">${y}</button>`).join('')}</div>
    ${partial?`<span class="sub">${monthsIn}개월 진행 중 · 전년 전체와 직접 비교하지 마세요</span>`:''}
  </div>

  <div class="flow" style="margin-bottom:22px">
    <div class="flow-card i"><h4>연 수입</h4><div class="v num" style="color:var(--income)">${man(a.inc)}</div>
      <div class="m">월 평균 ${won(a.inc/monthsIn)}</div></div>
    <div class="flow-card e"><h4>연 실지출</h4><div class="v num" style="color:var(--expense)">${man(a.exp)}</div>
      <div class="m">월 평균 ${won(a.exp/monthsIn)} · 고정비 ${won(a.fixed/monthsIn)}</div></div>
    <div class="flow-card s"><h4>저축률</h4><div class="v num" style="color:var(--save)">${a.rate.toFixed(1)}%</div>
      <div class="m">${b?`${year-1}년 ${b.rate.toFixed(1)}%`:'비교 대상 없음'}</div></div>
  </div>

  <div class="block">
    <header><h2>월별 흐름</h2><p>${byMonth.length}개월 기록</p></header>
    <table><thead><tr><th style="width:90px">월</th><th class="r" style="width:130px">수입</th>
      <th class="r" style="width:130px">실지출</th><th style="width:170px">비율</th>
      <th class="r" style="width:100px">저축률</th></tr></thead>
    <tbody>${byMonth.map(m=>{
      const rate = m.inc ? (m.inc-m.exp)/m.inc*100 : null;
      return `<tr><td class="num">${m.ym.slice(5)}월</td>
        <td class="r" style="color:var(--income)">${won(m.inc)}</td>
        <td class="r" style="color:var(--expense)">${won(m.exp)}</td>
        <td><div class="bar"><i style="width:${m.inc?Math.min(100,m.exp/m.inc*100):100}%;
          background:var(--${rate!=null&&rate<0?'expense':'transfer'})"></i></div></td>
        <td class="r">${rate==null?'<span class="sub">—</span>'
          :`<span style="color:var(--${rate<0?'expense':'income'})">${rate.toFixed(0)}%</span>`}</td></tr>`;}).join('')}
    </tbody>
    <tfoot><tr><td>합계</td><td class="r">${won(a.inc)}</td><td class="r">${won(a.exp)}</td>
      <td></td><td class="r">${a.rate.toFixed(1)}%</td></tr></tfoot></table>
  </div>

  <div class="block">
    <header><h2>카테고리별</h2><p>${year-1}년 대비</p></header>
    <table><thead><tr><th>카테고리</th><th style="width:150px">비중</th>
      <th class="r" style="width:120px">${year}</th><th class="r" style="width:120px">${year-1}</th>
      <th class="r" style="width:110px">증감</th></tr></thead>
    <tbody>${Object.entries(cats).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`<tr>
      <td>${esc(k)}</td>
      <td><div class="bar"><i style="width:${v/a.exp*100}%;background:var(--expense)"></i></div>
        <div class="sub num">${(v/a.exp*100).toFixed(1)}%</div></td>
      <td class="r">${won(v)}</td><td class="r sub">${won(pcats[k]||0)}</td>
      <td class="r">${delta(v, pcats[k]??null)}</td></tr>`).join('')}
    </tbody></table>
  </div>

  <div class="block">
    <header><h2>연말정산 참고</h2><p>세무 신고용 원자료 — 그대로 쓰지 말고 증빙과 대조하세요</p></header>
    <table><tbody>
      <tr><td style="width:220px" class="sub">총 수입 (원장 기준)</td><td class="r num">${won(a.inc)}</td></tr>
      <tr><td class="sub">총 실지출 (환급 제외)</td><td class="r num">${won(a.exp)}</td></tr>
      <tr><td class="sub">회사 대납·환급분</td><td class="r num">${won(a.reimb)}</td></tr>
      <tr><td class="sub">고정비 합계</td><td class="r num">${won(a.fixed)}</td></tr>
      <tr><td class="sub">거래 건수</td><td class="r num">${a.n}건</td></tr>
    </tbody></table>
  </div>
  ${stub('아직 못 채운 항목','연금 납입액과 금융소득은 원장에 거래로 남아야 집계할 수 있습니다. 지금은 스냅샷에 잔액만 있어 계산하지 않습니다.',
    [{t:'<b>수입·실지출·고정비·환급분 연간 집계</b>',has:true},
     {t:'<b>월별 흐름과 카테고리 전년 대비</b>',has:true},
     {t:'연금 납입액 및 세액공제 대상 금액'},
     {t:'금융소득 — 배당 · 이자 · 양도차익'},
     {t:'기부금 · 의료비 등 공제 항목'}])}`;
};

/* ── 준비중 패널 ── */
const WIP = {
'assets:debt':['accounts.asset_class 제약이 현금·투자·저축·연금 네 가지뿐이라 부채를 넣을 칸이 없습니다. 제약을 넓히는 마이그레이션이 먼저입니다.','부채',
  '순자산의 마이너스 항이자 고정비의 원천입니다.',
  [{t:'대출별 잔액 · 금리 · 만기 · 월 상환액'},{t:'상환 스케줄 → 고정비 패널 자동 연동'},
   {t:'asset_class check 제약에 부채 추가 필요'}], skel('',72,3)],
'invest:history':['holdings 스냅샷이 1개(2026-08-24)뿐이라 차분을 낼 수 없습니다. 토스 수집을 정기 실행해 스냅샷이 2개 이상 쌓이면 자동으로 그려집니다.','매매 이력',
  '판 다음에 무슨 일이 있었는지를 보는 곳. 과대비중·과소비중 패턴을 끊으려면 이게 필요합니다.',
  [{t:'holdings 스냅샷 차분으로 매도 추정 가능'},
   {t:'매도 사유 vs 실제 결과 대조'},
   {t:'−50% 이상 손실 확정 건 아카이브'},
   {t:'분기별 복기 — 과대비중 실패 / 과소비중 기회손실'}], skel('',64,4)],
'settings:alerts':['임계값을 저장할 곳이 없습니다. 설정 테이블을 하나 만들면 바로 붙습니다.','알림',
  '홈 "지금 확인할 것"에 무엇이 올라올지를 정하는 곳. 알림 기준이 곧 판단 기준입니다.',
  [{t:'고정비 연속 상승 감지 개월 수 (현재 3개월 고정)'},
   {t:'지출 평균 초과 임계값'},{t:'매도 조건 미설정 경고 주기'},
   {t:'목표 미달 감지 기준'}], skel('',60,4)]
};
Object.entries(WIP).forEach(([k,[b,h,d,i,s]]) => P[k] = async () => wipbar(b) + stub(h,d,i,s));

/* merchants.is_fixed 를 직접 바꾼다. RLS가 owner_id로 막아 주므로 본인 행만 수정된다.
   낙관적으로 먼저 칠하고, 실패하면 되돌리고 알린다. */
async function toggleFixed(btn){
  const id = Number(btn.dataset.id), next = btn.dataset.on !== 'true';
  const chip = btn.querySelector('.chip');
  const paint = on => { chip.className = 'chip ' + (on ? 'c-지출' : 'c-w');
                        chip.textContent = on ? '고정비' : '일반';
                        btn.dataset.on = String(on); };
  paint(next);
  const { error } = await sb.from('merchants').update({ is_fixed: next }).eq('id', id);
  if (error) { paint(!next); toast('저장하지 못했습니다 · ' + error.message); }
  else { DB._c = {}; toast(next ? '고정비로 지정했습니다' : '고정비에서 해제했습니다'); }
}
function toast(msg){
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role','status');
            document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(window._tt);
  window._tt = setTimeout(()=>t.classList.remove('on'), 2200);
}

/* ═════════════════════════════════════════════════════════
   6. 셸 · 라우팅 · 로그인
   ═════════════════════════════════════════════════════════ */
const $app = document.getElementById('app');
let cur = { sec:'home', tab:'today' };

function shell(){
  $app.innerHTML = `<div class="app">
    <nav class="rail" aria-label="주 메뉴">
      <div class="brand"><b>해달</b><span>자산관리</span></div>
      <div class="rail-group">
        <button class="nav-item" data-sec="home"><i class="dot"></i>홈</button></div>
      <div class="rail-group"><h6>기록 <em>— 사실을 쌓는 곳</em></h6>
        <button class="nav-item" data-sec="flow"><i class="dot"></i>현금흐름</button>
        <button class="nav-item" data-sec="assets"><i class="dot"></i>자산 현황</button></div>
      <div class="rail-group"><h6>판단 <em>— 결정을 내리는 곳</em></h6>
        <button class="nav-item" data-sec="invest"><i class="dot"></i>투자<span class="badge" id="navBadge"></span></button>
        <button class="nav-item" data-sec="goals"><i class="dot"></i>목표</button></div>
      <div class="rail-group"><h6>관리</h6>
        <button class="nav-item" data-sec="report"><i class="dot"></i>리포트</button>
        <button class="nav-item" data-sec="settings"><i class="dot"></i>설정</button></div>
      <a class="signout" href="legacy.html">이전 버전 열기</a>
      <button class="signout" id="signout">로그아웃</button>
    </nav>
    <main class="main">
      <div class="topbar"><h1 id="secTitle">홈</h1>
        <div class="src" id="src"><i></i><span>연결 확인 중</span></div></div>
      <div class="subtabs" id="subtabs" role="tablist"></div>
      <div id="panels"></div>
    </main></div>`;

  $app.querySelector('.rail').addEventListener('click', e => {
    if (e.target.closest('#signout')) { sb.auth.signOut().then(()=>location.reload()); return; }
    const b = e.target.closest('.nav-item'); if(!b) return;
    cur = { sec:b.dataset.sec, tab:TREE[b.dataset.sec].tabs[0].id };
    route(); render();
  });
  document.getElementById('subtabs').addEventListener('click', e => {
    const b = e.target.closest('.subtab'); if(!b) return;
    cur.tab = b.dataset.tab; route(); render();
  });
  const $p = document.getElementById('panels');
  $p.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { const [s,t] = g.dataset.go.split(':'); cur={sec:s,tab:t}; route(); render(); return; }
    const tk = e.target.closest('.tick');
    if (tk) { tk.closest('.todo-row').classList.toggle('done'); badge(); return; }
    const k = e.target.closest('#ledKind button');
    if (k) { LED.kind = k.dataset.k; render(); return; }
    const m = e.target.closest('#rptYm button');
    if (m) { RPT_YM = m.dataset.m; render(); return; }
    const y = e.target.closest('#rptYear button');
    if (y) { RPT_YEAR = Number(y.dataset.y); render(); return; }
    const ft = e.target.closest('.fixtog');
    if (ft) { toggleFixed(ft); }
  });
  $p.addEventListener('change', e => {
    if (e.target.id === 'holdPick') { HOLD_SEL = e.target.value; render(); }
  });
  $p.addEventListener('input', e => {
    if (e.target.id !== 'ledQ') return;
    LED.q = e.target.value;
    clearTimeout(window._deb);
    window._deb = setTimeout(async () => { await render();
      const i = document.getElementById('ledQ');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 240);
  });
  window.addEventListener('hashchange', () => { if (readRoute()) render(); });
}

function readRoute(){
  const [s,t] = location.hash.replace('#','').split('/');
  if (!TREE[s]) return false;
  const tab = TREE[s].tabs.some(x=>x.id===t) ? t : TREE[s].tabs[0].id;
  if (cur.sec===s && cur.tab===tab) return false;
  cur = { sec:s, tab }; return true;
}
function route(){ history.replaceState(null,'',`${location.pathname}#${cur.sec}/${cur.tab}`); }

async function render(){
  const def = TREE[cur.sec];
  document.getElementById('secTitle').textContent = def.title;
  document.querySelectorAll('.nav-item').forEach(b => b.setAttribute('aria-current', b.dataset.sec===cur.sec));
  document.getElementById('subtabs').innerHTML = def.tabs.length>1 ? def.tabs.map(t=>
    `<button class="subtab" role="tab" data-tab="${t.id}" aria-selected="${t.id===cur.tab}">${t.label}${
      t.ready?'':'<i class="wip" title="준비중"></i>'}</button>`).join('') : '';

  const $p = document.getElementById('panels');
  $p.innerHTML = '<div class="panel"><div class="loading">불러오는 중…</div></div>';
  const key = `${cur.sec}:${cur.tab}`;
  try {
    const html = P[key] ? await P[key]() : wipbar('준비중입니다.');
    $p.innerHTML = `<div class="panel">${html}</div>`;
    setSrc('live', 'Supabase 연결됨');
  } catch (err) {
    console.error(err);
    $p.innerHTML = `<div class="panel">${wipbar('데이터를 불러오지 못했습니다. ' + esc(err.message||''))}</div>`;
    setSrc('err', '연결 오류');
  }
  window.scrollTo({top:0});
  badge();
}
function setSrc(cls, text){
  const el = document.getElementById('src');
  if (el) { el.className = 'src ' + cls; el.querySelector('span').textContent = text; }
}
function badge(){
  const n = document.querySelectorAll('.todo-row:not(.done)').length;
  const b = document.getElementById('navBadge');
  if (b) { b.textContent = n || ''; b.style.display = n ? '' : 'none'; }
}

/* ── 로그인 게이트 (RLS가 걸려 있어 세션이 없으면 빈 값이 온다) ── */
function gate(msg=''){
  $app.innerHTML = `<div class="gate"><form id="login">
    <h1>해달</h1><p>자산 데이터를 보려면 로그인하세요.</p>
    <label for="em">이메일</label><input id="em" type="email" autocomplete="username" required>
    <label for="pw">비밀번호</label><input id="pw" type="password" autocomplete="current-password" required>
    <button type="submit">로그인</button>
    <div class="err">${esc(msg)}</div>
  </form></div>`;
  document.getElementById('login').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('em').value,
      password: document.getElementById('pw').value });
    if (error) gate(error.message); else start();
  });
}

async function start(){
  DB.clear();
  shell();
  readRoute();
  route();
  await render();
}

(async () => {
  const { data:{ session } } = await sb.auth.getSession();
  if (session) start(); else gate();
})();
