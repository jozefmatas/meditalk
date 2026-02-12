-- MediTalk POC: Initial Schema
-- Run this against your Supabase project via SQL Editor or CLI

-- 1) Enable pgvector extension
create extension if not exists vector;

-- 2) Transcripts table
create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  audio_path text,
  raw_text text,
  language text not null default 'en',
  created_at timestamptz not null default now()
);

-- 3) Transcript chunks table
create table public.transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

-- 4) IVFFlat index for fast cosine similarity search
-- Note: This index requires at least ~100 rows to be effective.
-- For very small datasets, pgvector will fall back to sequential scan.
create index on public.transcript_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 5) match_chunks function for semantic search
create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_count int default 10,
  p_transcript_id uuid default null
)
returns table (
  id uuid,
  transcript_id uuid,
  chunk_index int,
  content text,
  similarity float
)
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
begin
  return query
  select
    tc.id,
    tc.transcript_id,
    tc.chunk_index,
    tc.content,
    1 - (tc.embedding <=> query_embedding) as similarity
  from public.transcript_chunks tc
  inner join public.transcripts t on t.id = tc.transcript_id
  where
    t.user_id = auth.uid()
    and (p_transcript_id is null or tc.transcript_id = p_transcript_id)
  order by tc.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 6) Enable Row Level Security
alter table public.transcripts enable row level security;
alter table public.transcript_chunks enable row level security;

-- Transcripts: users can only access their own rows
create policy "Users can select own transcripts"
  on public.transcripts for select
  using (auth.uid() = user_id);

create policy "Users can insert own transcripts"
  on public.transcripts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own transcripts"
  on public.transcripts for update
  using (auth.uid() = user_id);

create policy "Users can delete own transcripts"
  on public.transcripts for delete
  using (auth.uid() = user_id);

-- Transcript chunks: access via join to transcripts ownership
create policy "Users can select own transcript chunks"
  on public.transcript_chunks for select
  using (
    exists (
      select 1 from public.transcripts t
      where t.id = transcript_chunks.transcript_id
        and t.user_id = auth.uid()
    )
  );

create policy "Users can insert own transcript chunks"
  on public.transcript_chunks for insert
  with check (
    exists (
      select 1 from public.transcripts t
      where t.id = transcript_chunks.transcript_id
        and t.user_id = auth.uid()
    )
  );

create policy "Users can delete own transcript chunks"
  on public.transcript_chunks for delete
  using (
    exists (
      select 1 from public.transcripts t
      where t.id = transcript_chunks.transcript_id
        and t.user_id = auth.uid()
    )
  );

-- 7) Storage bucket "audio"

insert into storage.buckets (id, name, public)
values ('audio', 'audio', false);

-- Storage RLS policies (users upload/read within their own folder):

create policy "Users can upload audio"
  on storage.objects for insert
  with check (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own audio"
  on storage.objects for select
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own audio"
  on storage.objects for delete
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
