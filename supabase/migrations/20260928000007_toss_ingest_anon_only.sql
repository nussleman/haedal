-- toss_ingest 는 맥 수집기(anon 키 + 비밀값)만 부른다. 로그인 사용자 실행 권한은 필요 없어서 거둔다.
revoke execute on function public.toss_ingest(text, jsonb, jsonb) from authenticated;
