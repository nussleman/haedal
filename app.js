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

  /* 거래 원장 — kind는 transactions에 없다. categories를 조인해서 가져온다. */
  transactions(months = 14){
    return this._once('tx:'+months, async () => {
      const from = new Date(); from.setMonth(from.getMonth() - months);
      const { data, error } = await sb.from('transactions')
        .select('id,date,amount,merchant,merchant_group,note,is_fixed,good_bad,company_paid,'
              + 'categories(kind,category,subcategory,emoji_category)')
        .gte('date', from.toISOString().slice(0,10))
        .order('date', { ascending:false });
      if (error) throw error;
      return (data||[]).map(t => ({
        ...t,
        kind:     t.categories?.kind || '지출',
        category: t.categories?.category || '미분류',
        sub:      t.categories?.subcategory || '',
        amount:   Number(t.amount)
      }));
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
        .not('watch_level','is',null).order('watch_level');
      if (error) throw error;
      return (data||[]).map(c => ({
        ...c,
        tier: Number(c.watch_level.replace('L','')),
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

  /* 재무 목표 — target_amount 가 있는 것만 (target_value는 비금융 목표) */
  goals(){
    return this._once('goals', async () => {
      const { data, error } = await sb.from('goals')
        .select('item,kind,period,target_amount,target_ratio,current_value,status,note,'
              + 'metric_source,target_on,emoji,position')
        .not('target_amount','is',null).neq('status','중단')
        .order('position',{nullsFirst:false});
      if (error) throw error;
      return (data||[]).map(g => ({ ...g, target_amount:Number(g.target_amount),
        current_value: g.current_value==null ? null : Number(g.current_value) }));
    });
  },

  /* 고정비 상인 — merchants.is_fixed 가 마스터 */
  fixedMerchants(){
    return this._once('fixm', async () => {
      const { data } = await sb.from('merchants').select('name,merchant_group,is_fixed').eq('is_fixed',true);
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
    {id:'ledger',label:'거래 내역',ready:true},{id:'budget',label:'예산'},
    {id:'fixed',label:'고정비',ready:true},{id:'rules',label:'저축·이체 규칙'}]},
  assets:{title:'자산 현황',tabs:[
    {id:'networth',label:'순자산',ready:true},{id:'accounts',label:'계좌',ready:true},
    {id:'pension',label:'연금'},{id:'debt',label:'부채'}]},
  invest:{title:'투자',tabs:[
    {id:'port',label:'포트폴리오',ready:true},{id:'holding',label:'종목 상세'},
    {id:'watch',label:'관심종목',ready:true},{id:'history',label:'매매 이력'}]},
  goals:{title:'목표',tabs:[{id:'targets',label:'재무 목표',ready:true},{id:'progress',label:'진행률'}]},
  report:{title:'리포트',tabs:[{id:'monthly',label:'월간'},{id:'yearly',label:'연간'}]},
  settings:{title:'설정',tabs:[{id:'sources',label:'데이터 연동',ready:true},
    {id:'cats',label:'카테고리'},{id:'alerts',label:'알림'}]}
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
  const exp = cur.filter(isSpend).reduce((s,t)=>s+t.amount,0);
  const avgExp = monthlyAverage(tx.filter(isSpend));
  const rate = inc ? ((inc-exp)/inc*100).toFixed(1) : '—';

  /* 할 일은 규칙에서 나온다 — 손으로 적지 않는다 */
  const todos = [];
  const rising = risingFixed(tx);
  rising.forEach(r => todos.push({t:`${r.name} 고정비 ${r.months}개월 연속 상승`,
    m:`${won(r.first)} → ${won(r.last)}원 · 요금제나 약정 확인 필요`}));
  if (exp > avgExp && avgExp) todos.push({t:'이번 달 지출이 평균을 넘었습니다',
    m:`${won(exp)}원 · 최근 평균 ${won(avgExp)}원`});
  goals.filter(g => g.current_value!=null && g.target_amount)
       .filter(g => g.current_value/g.target_amount < 0.1)
       .slice(0,1).forEach(g => todos.push({t:`${g.item} 진행이 더딥니다`,
    m:`${man(g.current_value)} / ${man(g.target_amount)} · 납입 계획 점검`}));

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
    <div class="flow-card s"><h4>저축률</h4>
      <div class="v num" style="color:var(--save)">${rate}%</div><div class="m">(수입 − 지출) ÷ 수입</div></div>
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

function goalRow(g){
  const cur = g.current_value ?? 0, pct = g.target_amount ? cur/g.target_amount*100 : 0;
  return `<div class="goal"><header><b>${g.emoji?g.emoji+' ':''}${esc(g.item)}</b>
    <span class="num">${man(cur)} / ${man(g.target_amount)} · ${Math.round(pct)}%</span></header>
    <div class="track"><i style="width:${Math.min(100,Math.max(0,pct))}%"></i></div>
    <footer>${g.note?`<span>${esc(g.note)}</span>`:''}
      ${g.target_on?`<span>기한 ${g.target_on}</span>`:''}
      ${g.metric_source?`<span>자동 계산 · ${g.metric_source}</span>`:'<span>수동 입력</span>'}</footer></div>`;
}

/* ── 현금흐름 · 거래 내역 ── */
let LED = { kind:'전체', q:'' };
P['flow:ledger'] = async () => {
  const all = await DB.transactions();
  const rows = all.filter(t =>
    (LED.kind==='전체' || t.kind===LED.kind) &&
    (!LED.q || (t.merchant+t.category+(t.note||'')).toLowerCase().includes(LED.q.toLowerCase())));
  const sum = k => rows.filter(t=>t.kind===k).reduce((s,t)=>s+t.amount,0);

  return `<div class="toolbar">
    <div class="seg" id="ledKind">${['전체','수입','지출','이체','자산'].map(k=>
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
  const items = Object.values(byName).map(o => {
    const done = completed(o.rows);                             // 규칙② 진행 중인 달 제외
    const months = new Set(done.map(r=>ymOf(r.date))).size || 1;
    const total = done.reduce((s,r)=>s+r.amount,0);
    return { ...o, monthly: total/months, months, last: o.rows[0], cycle: months && done.length/months < 0.6 ? '비정기' : '월납' };
  }).sort((a,b)=>b.monthly-a.monthly);

  const total = items.reduce((s,x)=>s+x.monthly,0);
  const rising = risingFixed(tx);

  return `<div class="flow" style="margin-bottom:22px">
    <div class="flow-card e"><h4>월 고정비</h4>
      <div class="v num" style="color:var(--expense)">${won(total)}</div>
      <div class="m">완료된 달 기준 평균 · 연납은 자동 12분의 1</div></div>
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
        <td class="sub">${x.cycle} · ${x.months}개월 관측</td>
        <td class="sub num">${x.last.date.slice(5).replace('-','.')}</td>
        <td class="r" style="font-weight:600">${won(x.monthly)}</td>
        <td>${up?'<span class="chip c-지출">상승</span>':'<span class="sub">—</span>'}</td></tr>`;}).join('')
      : '<tr><td colspan="5" class="empty">고정비로 표시된 거래가 없습니다. 설정에서 상인을 고정비로 지정하세요.</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="3">월 환산 합계</td><td class="r">${won(total)}</td><td></td></tr></tfoot></table>
  </div>
  ${stub('적용된 계산 규칙','기존 해달에서 잡았던 계산 버그 3건을 코드 레벨에서 막습니다. 이식할 때 이 규칙이 깨지지 않도록 유지하세요.',
    [{t:'<b>이체·자산 이동은 지출 합계에서 제외</b> — categories.kind로 걸러냄',has:true},
     {t:'<b>진행 중인 달은 평균 산출에서 제외</b> — completed()가 담당',has:true},
     {t:'<b>연납은 관찰 기간이 아니라 경과 개월로 나눔</b> — 12개월 관측 시 자동 12분의 1',has:true},
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
  const noStop = h.filter(x => !thByTicker[x.ticker]?.sell_trigger).length;
  const dust  = h.filter(x=>x.value/total < 0.003);
  const wSum = h.reduce((s,x)=>s+(x.pnl_pct??0)*x.value,0)/total;

  return `<div class="flow" style="margin-bottom:20px">
    <div class="flow-card a"><h4>보유 종목</h4>
      <div class="v num">${h.length}<span style="font-size:15px;color:var(--ink-3)"> / 35</span></div>
      <div class="m">축소 목표까지 ${Math.max(0,h.length-35)}개</div></div>
    <div class="flow-card ${wSum<0?'e':'i'}"><h4>가중 수익률</h4>
      <div class="v num" style="color:var(--${wSum<0?'expense':'income'})">${wSum.toFixed(2)}%</div>
      <div class="m">진입가는 판단 기준이 아닙니다</div></div>
    <div class="flow-card ${noStop?'e':''}"><h4>매도 조건 미설정</h4>
      <div class="v num" style="color:${noStop?'var(--expense)':'var(--ink-2)'}">${noStop}</div>
      <div class="m">기준 없으면 −90%까지 방치됩니다</div></div>
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
                 : !t?.sell_trigger ? '<span class="chip c-지출">조건 없음</span>' : '<span class="sub">—</span>';
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
  return `<div class="block">
    <header><h2>재무 목표</h2><p>goals 테이블 · target_amount 기준 ${g.length}건</p></header>
    ${g.length ? g.map(goalRow).join('') : '<div class="empty">등록된 재무 목표가 없습니다.</div>'}
  </div>
  <div class="flow">
    <div class="flow-card a"><h4>월 평균 순자산 증가</h4><div class="v num">${man(pace)}</div>
      <div class="m">${series.length}개월 관측 · 진행 중인 달 제외</div></div>
    <div class="flow-card t"><h4>관측 기간</h4><div class="v num">${series.length}개월</div>
      <div class="m">${series[0]?.[0]} ~ ${series.at(-1)?.[0]}</div></div>
    <div class="flow-card s"><h4>자동 계산 목표</h4>
      <div class="v num" style="color:var(--save)">${g.filter(x=>x.metric_source).length}</div>
      <div class="m">나머지 ${g.filter(x=>!x.metric_source).length}건은 수동 입력</div></div>
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
    probe('transactions'), probe('asset_snapshots'), probe('holdings'),
    probe('study_cards'), probe('goals'), probe('merchants'), probe('thesis'), probe('stocks')
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
const ROLE = {transactions:'거래 원장 (단일 소스)', asset_snapshots:'월별 계좌 잔액',
  holdings:'보유 종목 스냅샷', study_cards:'종목 연구 카드 · 관심종목 L1~L3',
  goals:'목표 (금융 + 비금융)', merchants:'상인 마스터 · 고정비 지정',
  thesis:'투자 논리 원장', stocks:'종목 마스터 · 테마'};
async function probe(name){
  const { count, error } = await sb.from(name).select('*',{count:'exact',head:true});
  return { name, count, ok: !error };
}

/* ── 준비중 패널 ── */
const WIP = {
'flow:budget':['카테고리별 예산 구조가 정해지면 붙습니다.','예산',
  '예산은 "지키는 목표"가 아니라 "이탈을 알아채는 장치"로 씁니다. 초과하면 홈 할 일로 올라오게 만드는 게 목적입니다.',
  [{t:'카테고리별 예산 설정 및 잔여 소진율'},{t:'속도 경고 — 월 중반에 70% 초과 시'},
   {t:'고정비 제외 변동비 기준 예산'},{t:'최근 6개월 실집행 기반 예산 제안'},
   {t:'예산 테이블이 아직 없음 — 스키마 추가 필요'}], skel('row3',88)+skel('',240,1)],
'flow:rules':['자동이체 데이터가 원장에 구분돼 들어오면 붙습니다.','저축 · 이체 규칙',
  '급여일 이후 자금이 어디로 흘러가는지가 한눈에 보여야 합니다.',
  [{t:'급여일 기준 자동이체 순서와 금액'},{t:'선저축 비율 및 실제 집행률'},
   {t:'kind=자산 거래를 계좌 간 이동으로 해석하는 규칙'},
   {t:'연금 계좌 납입 스케줄 — DC · IRP · 연금저축'}], skel('',56,5)],
'assets:pension':['연금 계좌가 accounts에 분리 등록되면 붙습니다.','연금 · 은퇴자산',
  '세액공제 한도 소진 여부가 매년 12월에 필요한 숫자입니다.',
  [{t:'연금 자산군 계좌별 적립금 · 운용 상품'},{t:'연간 납입액 및 세액공제 한도 잔여'},
   {t:'예상 수령액 시뮬레이션'}], skel('row3',96)],
'assets:debt':['asset_class에 부채 항목이 없습니다. 스키마 확장 후 붙습니다.','부채',
  '순자산의 마이너스 항이자 고정비의 원천입니다.',
  [{t:'대출별 잔액 · 금리 · 만기 · 월 상환액'},{t:'상환 스케줄 → 고정비 패널 자동 연동'},
   {t:'asset_class check 제약에 부채 추가 필요'}], skel('',72,3)],
'invest:holding':['포트폴리오 행 클릭 진입 구조로 만들 예정입니다.','종목 상세',
  '진입가는 표시하되 판단 기준으로 쓰지 않습니다. 이 화면의 질문은 언제나 "지금 현금으로 이 가격에 다시 살 것인가"입니다.',
  [{t:'study_cards 게이트 0~2 전체 표시',has:true},
   {t:'thesis.logic · sell_trigger · reviewed_on',has:true},
   {t:'촉매 날짜 — study_cards.check_date',has:true},
   {t:'논리 수정 이력 — updated_at 기반'}], skel('row2',180,2)],
'invest:history':['매도 이력 테이블이 없습니다. 스키마 추가가 먼저입니다.','매매 이력',
  '판 다음에 무슨 일이 있었는지를 보는 곳. 과대비중·과소비중 패턴을 끊으려면 이게 필요합니다.',
  [{t:'holdings 스냅샷 차분으로 매도 추정 가능'},
   {t:'매도 사유 vs 실제 결과 대조'},
   {t:'−50% 이상 손실 확정 건 아카이브'},
   {t:'분기별 복기 — 과대비중 실패 / 과소비중 기회손실'}], skel('',64,4)],
'goals:progress':['궤적 데이터가 3개월 이상 쌓이면 의미가 생깁니다.','진행률 추적',
  '한 달 등락보다 12개월 추세선이 중요한 화면입니다.',
  [{t:'목표별 계획 궤적 vs 실제 궤적 오버레이'},{t:'이탈 감지 — 3개월 연속 미달'},
   {t:'시나리오 — 저축률 ±5% 변동 시 도달 시점'}], skel('',200,1)],
'report:monthly':['각 패널이 안정된 뒤 자동 생성으로 붙입니다.','월간 리포트',
  '대시보드를 매번 직접 훑지 않아도 되게 만드는 게 목적입니다.',
  [{t:'수입 · 지출 · 저축률 전월 대비'},{t:'예산 초과 카테고리와 원인 거래'},
   {t:'포트폴리오 비중 변화'},{t:'목표 진행률 변동'},
   {t:'다음 달 확인 항목 — 만기 · 갱신 · 촉매 날짜'}], skel('',110,3)],
'report:yearly':['연말정산 시즌에 첫 산출 예정입니다.','연간 리포트',
  '연말정산과 세금 신고에 그대로 쓸 수 있는 형태로 뽑습니다. 나중에 소급 정리하면 손이 훨씬 많이 갑니다.',
  [{t:'연간 수입 · 지출 · 저축 총계'},{t:'연금 납입액 및 세액공제 대상'},
   {t:'금융소득 — 배당 · 이자 · 양도차익'},{t:'company_paid 제외 실지출 집계'},
   {t:'연간 투자 복기'}], skel('row3',96)],
'settings:cats':['categories 62건 편집 UI를 붙일 자리입니다.','카테고리',
  '카테고리가 늘어나면 분류 피로가 커지므로 상한을 두는 게 좋습니다.',
  [{t:'kind · category · subcategory 3단 구조 편집',has:true},
   {t:'merchants → category 자동 매핑 규칙',has:true},
   {t:'merchants.is_fixed 지정 및 소급 전파',has:true},
   {t:'미사용 카테고리 정리 제안'}], skel('row2',220,2)],
'settings:alerts':['각 패널 완성 후 임계값을 한 번에 정합니다.','알림',
  '홈 "지금 확인할 것"에 무엇이 올라올지를 정하는 곳. 알림 기준이 곧 판단 기준입니다.',
  [{t:'고정비 연속 상승 감지 개월 수 (현재 3개월 고정)'},
   {t:'지출 평균 초과 임계값'},{t:'매도 조건 미설정 경고 주기'},
   {t:'목표 미달 감지 기준'}], skel('',60,4)]
};
Object.entries(WIP).forEach(([k,[b,h,d,i,s]]) => P[k] = async () => wipbar(b) + stub(h,d,i,s));

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
    if (k) { LED.kind = k.dataset.k; render(); }
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
