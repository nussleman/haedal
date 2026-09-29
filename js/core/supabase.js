/* ================= Supabase : 로그인 · 가계부 기록 · 전체 내역 ================= */

const EN = {
  sb: null, cats: [], catById: {}, freq: {}, merchants: [], merchCat: {}, merchFixed: {},
  catId: null, neg: false, loaded: false,
  lg: { q: '', kind: 'all', cat: 'all', from: '', to: '', quick: '3m', sort: 'date_desc', page: 1, size: 60, nogroup: false },
  draft: []
};
const EN_WD = ['일', '월', '화', '수', '목', '금', '토'];

async function enClient() {
  if (EN.sb) return EN.sb;
  EN.sb = await haedalSupabase();
  return EN.sb;
}
/* app_settings 한 줄(key → json)을 읽고 쓴다.
   legacyKey 를 주면: DB 에 아직 값이 없고 브라우저에 예전 값이 있을 때 그 값을 DB 로 옮긴다(한 번). */
async function appSettingLoad(key, legacyKey) {
  try {
    const sb = await enClient();
    const { data, error } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    if (data && data.value != null) return data.value;
    if (legacyKey) {
      let raw = null;
      try { raw = localStorage.getItem(legacyKey); } catch (e) {}
      if (raw) {
        const v = JSON.parse(raw);
        await appSettingSave(key, v, true);
        return v;
      }
    }
  } catch (e) { console.error('설정을 불러오지 못함', key, e); }
  return null;
}
async function appSettingSave(key, value, quiet) {
  try {
    const sb = await enClient();
    const { error } = await sb.from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,key' });
    if (error) throw error;
    return true;
  } catch (e) {
    if (!quiet) enToast('설정을 저장하지 못했습니다 — ' + (e.message || e));
    return false;
  }
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
  cacheClear();
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


/* 사용처를 사전에만 등록한다 — 거래 없이도 자동완성에 뜨게 */
async function enRegisterMerchant(name, group) {
  const nm = String(name || '').trim();
  if (!nm) return false;
  const sb = await enClient();
  const { error } = await sb.from('merchants')
    .upsert({ name: nm, merchant_group: group || null }, { onConflict: 'owner_id,name' });
  if (error) return false;
  /* 참조 데이터가 아직 안 온 상태에서 불릴 수 있다 — 캐시가 없으면 여기서 만든다 */
  EN.merchants = EN.merchants || [];
  EN.merchGroup = EN.merchGroup || {};
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
  const [catRes, recentRes, fixRes, grpRes] = await Promise.all([
    sb.from('categories').select('id,kind,category,subcategory,emoji_category,sort_order')
      .neq('kind', '자산').eq('is_active', true).order('sort_order'),
    /* 여기서는 '자주 쓰는 분류' 계산용이라 최근 1000건이면 충분하다.
       전체 사용처 목록은 enLoadAllMerchants 가 따로 끝까지 읽는다. */
    sb.from('transactions').select('category_id,merchant,merchant_group').gte('date', since)
      .order('date', { ascending: false }).limit(1000),
    /* 고정비로 지정된 사용처는 많지 않다. 첫 그림부터 맞게 그리려면 여기서 같이 받아야 한다. */
    sb.from('merchants').select('name').eq('is_fixed', true),
    /* 사용처 그룹에 붙인 그림 — 직접 지정한 값이 기본 그림보다 앞선다 */
    sb.from('merchant_groups').select('name,emoji')
  ]);
  EN.cats = catRes.data || [];
  EN.catById = {};
  EN.cats.forEach(c => { EN.catById[c.id] = c; });

  EN.freq = {};
  const mc = {};
  EN.merchGroup = {};
  (recentRes.data || []).forEach(r => {
    EN.freq[r.category_id] = (EN.freq[r.category_id] || 0) + 1;
    /* 앞뒤 공백을 여기서 떼지 않으면 '사용처 '와 '사용처'가 목록에 따로 뜬다 */
    const mname = String(r.merchant || '').trim();
    if (mname) {
      mc[mname] = mc[mname] || {};
      mc[mname][r.category_id] = (mc[mname][r.category_id] || 0) + 1;
      if (r.merchant_group && !EN.merchGroup[mname]) EN.merchGroup[mname] = r.merchant_group;
    }
  });
  EN.merchFixed = {};
  (fixRes && fixRes.data || []).forEach(r => {
    const m = String(r.name || '').trim();
    if (m) EN.merchFixed[m] = true;
  });
  EN.groupEmoji = {};
  ((grpRes && grpRes.data) || []).forEach(r => {
    const n = String(r.name || '').trim();
    if (n) EN.groupEmoji[n] = String(r.emoji == null ? '' : r.emoji);
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
