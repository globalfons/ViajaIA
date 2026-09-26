-- Realtime updates without extra infrastructure: NOTIFY carries only ids (never
-- content); the app streams an "update" event (SSE) and the client refetches
-- through the normal, authorized endpoints.
create or replace function app.notify_conversation_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  conv uuid;
begin
  if tg_table_name = 'messages' then
    conv := new.conversation_id;
  else
    conv := new.id;
  end if;
  perform pg_notify('conversation_events', json_build_object('o', new.organization_id, 'c', conv)::text);
  return null;
end $$;

create trigger messages_notify after insert or update of status, delivery_status on public.messages
  for each row execute function app.notify_conversation_event();
create trigger conversations_notify after update of status, assigned_to, priority on public.conversations
  for each row execute function app.notify_conversation_event();
