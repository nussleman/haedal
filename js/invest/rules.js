/* ================= 매매원칙 =================
   원칙은 손실 중인 종목을 보면서 만들면 안 된다. 그래서 규칙을 화면에 고정해 둔다. */

const TR_BUY_RULES = [
  ['BUY-1', '3줄 메모를 썼다', '① 왜 사는가 ② 언제 파는가(사건·지표) ③ 무엇이 보이면 내가 틀린 것인가'],
  ['BUY-2', '최소 매수 금액 충족', '전체 자산의 0.5% 이상. 그보다 작으면 사지 않는다'],
  ['BUY-3', '월간 점검일에 산다', '그 외에는 관심종목에 적어두고 한 달 기다린다'],
  ['BUY-X', '규칙 밖 매수', '원칙에 없는 매수 — 그래도 적는다. 안 적으면 고칠 수 없다']
];

const TR_SELL_RULES = [
  ['SELL-1', '비중 상한 초과', '개별 15% · 테마 5% 위반 → 초과분만. 익절이 아니라 리밸런싱이다'],
  ['SELL-2', '② 번이 실현됨', '계속 보유하려면 새 3줄 메모를 써야 하고, 못 쓰면 판다'],
  ['SELL-3', '그 돈이 실제로 필요함', '원래는 돈 A(활주로 자금)에 있어야 했던 돈'],
  ['SELL-4', '③ 번이 현실이 됨', '유일하고 진짜인 손절 사유. 손실률 무관 — −5%여도 팔고 −60%여도 판다'],
  ['SELL-5', '왜 샀는지 설명 못 함', '3줄 메모가 없거나 스스로 납득이 안 되는 종목. 논리 없는 보유는 방치다'],
  ['SELL-6', '더 나은 곳에 자본이 필요', '연 2~3회 제한. 갈아탈 종목의 3줄 메모를 먼저 쓴 뒤에만'],
  ['SELL-7', '연말 손익통산 (12월)', '해외주식 양도세 연 250만원 공제. 단 SELL-4/5 해당 종목만'],
  ['SELL-P', '가격 손절선 −25%', '논리를 세울 수 없는 테마·모멘텀 종목 전용. 대신 개별 비중 1% 이하'],
  ['SELL-X', '규칙 밖 매도', '7가지 중 어디에도 안 맞는 매도 — 그래도 적는다']
];

const TR_EMOTIONS = ['많이 떨어져서', '많이 올라서', '내부자가 팔아서', '뉴스가 무서워서',
  '남들이 파니까', '본전 오면 팔려고', '지루해서'];

const TR_RULE_LABEL = (() => {
  const m = {};
  [...TR_BUY_RULES, ...TR_SELL_RULES].forEach(([k, l]) => { m[k] = l; });
  return m;
})();

function renderRulesPage(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const sec = (n, title, body) => `
    <div class="panel s12 rl-sec">
      <div class="rl-hd"><span class="no">${n}</span><h3>${title}</h3></div>
      ${body}
    </div>`;
  const ruleList = (rules, cls) => `<div class="rl-rules ${cls}">${rules.map(([k, l, d]) => `
    <div class="rl-rule" data-rule="${k}">
      <span class="k">${k}</span>
      <span class="l">${l}</span>
      <span class="d">${d}</span>
    </div>`).join('')}</div>`;

  host.innerHTML = `
    <div class="g"><div class="panel s12 rl-top">
      <div class="rl-toplead">
        <h2>매매원칙</h2>
        <p>투자는 목적이 아니라 <b>창작으로 먹고살 자유를 사는 수단</b>이다.
           자산 목표는 숫자가 아니라 “돈 때문에 하기 싫은 일을 하지 않아도 되는 기간”으로
           환산될 때만 의미가 있다. 계좌를 보는 시간이 창작 시간을 갉아먹으면,
           수익률과 무관하게 규칙이 잘못된 것이다.</p>
      </div>
      <div class="rl-money">
        <div class="rl-mcell a"><span class="t">돈 A — 활주로 자금</span>
          <p>전세 보증금 + 창작 기간 생활비. 목적은 수익률이 아니라 <b>잃지 않는 것</b>.
             예금·MMF·단기채로 분리한다. <b>주식 계좌에 두지 않는다.</b></p></div>
        <div class="rl-mcell b"><span class="t">돈 B — 증식 자금</span>
          <p>현재 주식 계좌. <b>10년 안 건드려도 되는 돈</b>일 때만 고위험 종목이 값을 한다.</p></div>
      </div>
    </div></div>

    <div class="g">
      ${sec('01', '매수', ruleList(TR_BUY_RULES.filter(r => r[0] !== 'BUY-X'), 'buy'))}
    </div>

    <div class="g">
      ${sec('02', '비중', `
        <div class="rl-size">
          <div><span class="n">15%</span><span class="l">개별 종목 상한</span></div>
          <div><span class="n">5%</span><span class="l">테마 상한 — 같이 움직이는 묶음은 하나의 베팅<br><i>양자 · 우주 · 원자력 · 레버리지</i></span></div>
          <div class="wide"><span class="n">초과분만</span><span class="l">상한을 넘으면 넘은 만큼만 판다. 전량 매도 금지.</span></div>
        </div>`)}
    </div>

    <div class="g">
      ${sec('03', '매도 — 이 7개에 해당하지 않으면 팔지 않는다', `
        <p class="rl-note">익절이 정당한 3가지 · 손절이 정당한 4가지. 그 밖은 매도가 아니라 충동이다.</p>
        ${ruleList(TR_SELL_RULES.filter(r => /^SELL-\d$/.test(r[0])), 'sell')}
        <div class="rl-exc">
          <span class="t">예외 — 논리를 세울 수 없는 종목</span>
          <p>테마·모멘텀으로 산 종목은 ③번을 쓸 수 없다. 그래서 <b>가격 손절선 −25%</b>를 기계적으로 건다.
             대신 개별 비중은 <b>1% 이하</b>로 묶는다.</p>
        </div>
        <div class="rl-emo">
          <span class="t">팔면 안 되는 이유 — 이 중 하나가 떠올랐다면 그날은 아무것도 하지 않는다</span>
          <div class="chips">${TR_EMOTIONS.map(e => `<span>${e}</span>`).join('')}</div>
        </div>`)}
    </div>

    <div class="g">
      ${sec('04', '점검 — 매월 첫째 주 토요일, 30분', `
        <ol class="rl-steps">
          <li>비중부터 본다 (15% / 5% 초과 여부)</li>
          <li>지난달 실적 발표가 있었던 종목만 연다 → ②③ 확인</li>
          <li>3줄 메모가 없는 종목 목록 확인 → 이번 달에 쓰거나 판다 (월 3개씩)</li>
          <li>매수 후보 검토 (아직도 사고 싶은 것만)</li>
          <li>30분이 지나면 덮는다. 결론이 안 나면 다음 달로.</li>
        </ol>
        <p class="rl-note">그 외의 날에는 계좌를 열지 않는다.</p>`)}
    </div>

    <div class="g"><div class="panel s12 rl-foot">
      <p>규칙은 고쳐도 되지만 <b>손실 중인 종목을 보면서 고치지는 않는다.</b>
         개정은 월간 점검일에만, 이유를 함께 적는다.</p>
      <p class="dim">개인 투자 원칙 정리이며 투자 자문이 아닙니다. 최종 판단과 책임은 본인에게 있습니다.</p>
    </div></div>`;

}

