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
    <span class="c" data-ed="cat" title="눌러서 분류 변경"><span class="ct">${[r.minor, r.item].filter(Boolean).map(rxEsc).join(' › ') || '-'}</span></span>
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
