create policy "Delete own candidature documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'candidature-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('cv', 'lettre')
  and cardinality(storage.foldername(name)) = 2
);
