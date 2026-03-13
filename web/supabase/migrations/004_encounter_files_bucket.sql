-- Create "encounter-files" storage bucket for uploaded encounter files
-- (PDFs, images, audio recordings)

insert into storage.buckets (id, name, public)
values ('encounter-files', 'encounter-files', false)
on conflict (id) do nothing;

-- Storage RLS policies: users upload/read/delete within their own folder
-- Path pattern: {userId}/{encounterId}/{fileId}-{filename}

drop policy if exists "Users can upload encounter files" on storage.objects;
drop policy if exists "Users can read own encounter files" on storage.objects;
drop policy if exists "Users can delete own encounter files" on storage.objects;

create policy "Users can upload encounter files"
  on storage.objects for insert
  with check (
    bucket_id = 'encounter-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own encounter files"
  on storage.objects for select
  using (
    bucket_id = 'encounter-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own encounter files"
  on storage.objects for delete
  using (
    bucket_id = 'encounter-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
