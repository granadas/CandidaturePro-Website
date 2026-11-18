alter policy "Upload own candidature documents" on storage.objects to authenticated
with check (
  bucket_id = 'candidature-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('cv', 'lettre', 'certificat', 'diplome', 'autre')
  and cardinality(storage.foldername(name)) = 2
  and lower(storage.extension(name)) = 'pdf'
);
alter policy "Delete own candidature documents" on storage.objects to authenticated
using (
  bucket_id = 'candidature-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('cv', 'lettre', 'certificat', 'diplome', 'autre')
  and cardinality(storage.foldername(name)) = 2
);
