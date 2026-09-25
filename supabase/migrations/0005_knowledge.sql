-- =============================================================================
-- 0005 · Knowledge bases (RAG): documents, chunks with pgvector embeddings and
-- full-text search, hybrid retrieval (vector + keyword, RRF fusion).
--
-- The vector dimension is fixed at 1536 (EMBEDDING_DIMENSIONS). Embedding
-- models with a different native size must be called with an explicit
-- `dimensions` parameter (OpenAI text-embedding-3-*, Gemini
-- outputDimensionality). Changing it requires a new migration + reindex.
-- =============================================================================

create extension if not exists vector with schema extensions;

create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  embedding_model text not null,
  chunk_tokens int not null default 400 check (chunk_tokens between 100 and 2000),
  chunk_overlap int not null default 60 check (chunk_overlap between 0 and 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_bases_org_idx on public.knowledge_bases(organization_id);
call app.apply_tenant_policies('public.knowledge_bases', '{owner,admin,member}', true);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  source_type text not null check (source_type in ('pdf', 'docx', 'txt', 'md', 'csv', 'html', 'url')),
  source_uri text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  error text,
  chunk_count int not null default 0,
  token_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_kb_idx on public.documents(knowledge_base_id, created_at desc);
create unique index documents_kb_checksum_idx on public.documents(knowledge_base_id, checksum) where checksum is not null;
call app.apply_tenant_policies('public.documents', '{owner,admin,member}', true);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  heading text,
  tokens int not null default 0,
  embedding extensions.vector(1536),
  tsv tsvector generated always as (to_tsvector('simple', coalesce(heading, '') || ' ' || content)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index document_chunks_kb_idx on public.document_chunks(knowledge_base_id);
create index document_chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_tsv_idx on public.document_chunks using gin (tsv);
call app.apply_tenant_policies('public.document_chunks', '{}');

-- ---------------------------------------------------------------------------
-- Hybrid retrieval. Called by trusted server code with an explicit org id;
-- the org filter is part of the function so it cannot be forgotten.
-- ---------------------------------------------------------------------------
create or replace function app.search_chunks(
  p_org uuid,
  p_kb_ids uuid[],
  p_embedding extensions.vector(1536),
  p_query text,
  p_k int default 6,
  p_candidates int default 30
)
returns table (id uuid, document_id uuid, title text, heading text, content text, score double precision, vector_rank int, text_rank int)
language sql stable security definer set search_path = '' as $$
  with vec as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_embedding) as r
    from public.document_chunks c
    where c.organization_id = p_org and c.knowledge_base_id = any(p_kb_ids) and c.embedding is not null
    order by c.embedding operator(extensions.<=>) p_embedding
    limit p_candidates
  ),
  txt as (
    select c.id, row_number() over (order by ts_rank_cd(c.tsv, q) desc) as r
    from public.document_chunks c, websearch_to_tsquery('simple', coalesce(p_query, '')) q
    where c.organization_id = p_org and c.knowledge_base_id = any(p_kb_ids) and c.tsv @@ q
    order by ts_rank_cd(c.tsv, q) desc
    limit p_candidates
  ),
  fused as (
    select coalesce(v.id, t.id) as id,
           coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + t.r), 0) as score,
           v.r::int as vector_rank, t.r::int as text_rank
    from vec v full outer join txt t on t.id = v.id
  )
  select c.id, c.document_id, d.title, c.heading, c.content, f.score, f.vector_rank, f.text_rank
  from fused f
  join public.document_chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id and d.status = 'ready'
  order by f.score desc
  limit p_k
$$;
revoke all on function app.search_chunks(uuid, uuid[], extensions.vector, text, int, int) from public, authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Storage bucket for original files (only when Storage exists).
-- Path convention: <organization_id>/<document_id>/<filename>
-- ---------------------------------------------------------------------------
do $$
begin
  -- Only when Storage is fully migrated (the blob store also ensures the bucket at runtime).
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 20971520)
    on conflict (id) do nothing;
    execute $p$
      create policy documents_bucket_read on storage.objects for select to authenticated
      using (bucket_id = 'documents' and app.can_access(((storage.foldername(name))[1])::uuid))
    $p$;
  end if;
end $$;
