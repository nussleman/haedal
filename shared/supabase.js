/* =========================================================
   해달 공용 Supabase 연결 — 대시보드(index.html) · 가계부(gagyebu.html) · 데이트 통장(date/) 이 함께 쓴다.
   - 키는 공개용(anon) 키다. 데이터는 DB 의 RLS 가 지킨다.
   - 라이브러리 버전을 고정해 둔다. 올릴 때는 SB_LIB 한 줄만 바꾸고 세 화면을 다 확인할 것.
   - 세 화면이 같은 주소(nussleman.github.io)라 로그인 상태도 공유된다.
   ========================================================= */
const SB_URL  = 'https://rjxmrpifrhybucexuvli.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqeG1ycGlmcmh5YnVjZXh1dmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjU1OTAsImV4cCI6MjEwMTE0MTU5MH0.xSzE02pjZYqbx9nPLb8RVsQF9w7hJHEx2cO0JDOLLSU';
const SB_LIB  = 'https://esm.sh/@supabase/supabase-js@2.117.2';

let __haedalSB = null;
/* 한 번만 만들어 돌려쓴다. 테스트에서는 window.__SB_MOD 로 가짜 모듈을 끼운다. */
async function haedalSupabase() {
  if (__haedalSB) return __haedalSB;
  const mod = window.__SB_MOD || await import(SB_LIB);
  __haedalSB = mod.createClient(SB_URL, SB_ANON);
  return __haedalSB;
}
