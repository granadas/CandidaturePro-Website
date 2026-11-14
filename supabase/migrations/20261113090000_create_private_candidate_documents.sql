insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidature-documents', 'candidature-documents', false, 10485760, array['application/pdf']);

create policy "Read own candidature documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'candidature-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Upload own candidature documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'candidature-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('cv', 'lettre')
  and cardinality(storage.foldername(name)) = 2
  and lower(storage.extension(name)) = 'pdf'
);
