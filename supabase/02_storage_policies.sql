-- Adds RLS policies for the private `scores` Storage bucket.
--
-- IMPORTANT: The bucket itself must be created manually in the Supabase dashboard
-- before running this file:
--   Storage → New bucket → name: "scores" → Public bucket: OFF
--
-- These policies allow authenticated users to upload and read objects in the bucket.
-- The server (service role key) bypasses these policies entirely.

create policy "Authenticated users can upload score images"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'scores');

create policy "Authenticated users can read score images"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'scores');
