-- Supabase 보안 경고(function_search_path_mutable) 해소
alter function public.trade_log_touch() set search_path = '';
alter function public.date_couple_emails() set search_path = '';
alter function public.date_is_editor() set search_path = '';
