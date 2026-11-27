-- Lets the client remove its own uploads: an image whose analysis was canceled
-- or failed before a score was saved (app/upload.tsx). Owner-only, so users
-- can't delete each other's images. Saved scores' images are still removed
-- server-side by DELETE /api/scores/:id (service role, bypasses RLS).
create policy "Users can delete their own uploads"
  on storage.objects for delete to authenticated
  using (bucket_id = 'scores' and owner_id = (select auth.uid())::text);
