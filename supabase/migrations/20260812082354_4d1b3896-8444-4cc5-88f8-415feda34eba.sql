delete from public.conversation_members where conversation_id in (select id from public.conversations where name = 'ONIQ smoke test');
delete from public.conversations where name = 'ONIQ smoke test';