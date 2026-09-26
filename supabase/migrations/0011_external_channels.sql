-- External channels (WhatsApp Cloud API, email): delivery tracking and idempotency.

alter table public.messages
  add column external_id text,
  add column delivery_status text check (delivery_status in ('pending', 'delivered', 'failed', 'not_sent')),
  add column delivery_error text,
  add column delivered_at timestamptz;

-- Provider message ids (wamid…, Message-ID) are processed once per organization.
create unique index messages_org_external_idx on public.messages(organization_id, external_id) where external_id is not null;

-- A WhatsApp number can only be linked to one channel on the whole platform:
-- inbound webhooks are routed to the tenant by phone_number_id.
create unique index channels_whatsapp_number_idx on public.channels((config->>'phone_number_id')) where type = 'whatsapp';

-- Conversation lookup for returning WhatsApp/email contacts.
create index conversations_channel_visitor_idx on public.conversations(channel_id, visitor_id, created_at desc) where visitor_id is not null;
