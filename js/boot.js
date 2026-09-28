/* 로그인한 사람만 화면을 볼 수 있다. */
(async () => {
  let sb;
  try {
    sb = await enClient();
  } catch (e) {
    enShowLock('로그인 모듈을 불러오지 못했습니다. 네트워크를 확인하고 새로고침하세요.');
    return;
  }
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) init(); else enShowLock();
    sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT') location.reload(); });
  } catch (e) {
    enShowLock('로그인 상태를 확인하지 못했습니다. 다시 로그인하세요.');
  }
})();
