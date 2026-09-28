/* 화면 안의 글자가 깨졌는지 찾는 검사 (브라우저 안에서 실행)
   - vertical: 칸이 좁아 글자가 한두 글자씩 세로로 쪼개짐
   - clipped : 글자가 overflow:hidden 칸 밖으로 나가 잘림 (말줄임표 … 처리는 정상으로 봄)
   - overlap : 서로 다른 글자끼리 겹침
   - offscreen: 글자가 화면 오른쪽 밖으로 나감 (가로 스크롤 칸 안은 제외) */
window.__layoutProbe = function (rootSel) {
  const root = document.querySelector(rootSel || '#app') || document.body;
  const vw = window.innerWidth;
  const out = { vertical: [], clipped: [], overlap: [], offscreen: [] };
  const clipBox = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return { el: p, s };
    }
    return null;
  };
  const items = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode, txt = t.textContent.trim();
    if (!txt) continue;
    const el = t.parentElement; const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('svg, canvas, script, style, [hidden], .sr-only')) continue;
    const dt = el.closest('details'); if (dt && !dt.open && !el.closest('summary')) continue;   /* 접힌 <details> 속 글자 */
    const range = document.createRange(); range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    const br = range.getBoundingClientRect();
    /* 스크롤 칸 안에서 스크롤해야 보이는 글자는 '깨짐'이 아니다 — 지금 보이는 영역 밖이면 건너뛴다 */
    let hiddenByScroll = false, fixed = false, inScroller = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.position === 'fixed') fixed = true;
      if (/(auto|scroll)/.test(ps.overflowX)) inScroller = true;
      if (/(auto|scroll)/.test(ps.overflowY) || /(auto|scroll)/.test(ps.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (br.bottom <= pr.top + 1 || br.top >= pr.bottom - 1 || br.right <= pr.left + 1 || br.left >= pr.right - 1) { hiddenByScroll = true; break; }
      }
    }
    if (hiddenByScroll) continue;
    const fs = parseFloat(cs.fontSize) || 12;
    const lh = parseFloat(cs.lineHeight) || fs * 1.3;
    const label = txt.slice(0, 16);
    /* 세로 쪼개짐: 한 줄 폭이 글자 두 개도 안 되는데 줄이 3줄 넘게 이어짐 */
    if (txt.replace(/\s/g, '').length >= 3 && rects.length >= 3 && br.width < fs * 2.4 && br.height > lh * 2.5) out.vertical.push(label);
    /* 잘림 */
    const cb = clipBox(el);
    if (cb && cs.textOverflow !== 'ellipsis' && getComputedStyle(cb.el).textOverflow !== 'ellipsis' && !/(auto|scroll)/.test(cb.s.overflowX)) {
      const c = cb.el.getBoundingClientRect();
      if (br.right > c.right + 1.5 || br.left < c.left - 1.5) out.clipped.push(label);
    }
    /* 화면 밖 (가로 스크롤 칸 안은 괜찮음) */
    const scroller = inScroller;
    if (!scroller && br.right > vw + 1) out.offscreen.push(label);
    if (!fixed) items.push({ r: br, rs: rects, label, el });   /* 떠 있는 버튼(리모컨 등)은 겹침 검사에서 뺀다 */
  }
  /* 겹침: 같은 칸끼리는 제외, 2px 넘게 겹치는 서로 다른 글자 */
  for (let i = 0; i < items.length && i < 1500; i++) {
    const a = items[i].r;
    for (let j = i + 1; j < items.length && j < 1500; j++) {
      const b = items[j].r;
      if (items[i].el === items[j].el || items[i].el.contains(items[j].el) || items[j].el.contains(items[i].el)) continue;
      const hit = (p, q) => Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 2;
      if (!hit(a, b)) continue;
      /* 여러 줄로 감긴 글자는 전체 상자가 아니라 줄마다 비교한다 (문단 속 굵은 글씨끼리 오탐 방지) */
      if (items[i].rs.some(p => items[j].rs.some(q => hit(p, q)))) out.overlap.push(items[i].label + ' ↔ ' + items[j].label);
    }
  }
  for (const k in out) out[k] = [...new Set(out[k])];
  return out;
};
