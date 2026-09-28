-- 트리거 함수는 API(/rpc)로 직접 부를 필요가 없다 — Supabase 보안 경고 해소
revoke all on function public.date_tx_check_depositor() from public, anon, authenticated;
