insert into storage.buckets (id, name, public)
  values ('scores', 'scores', false)
  on conflict (id) do nothing;

create policy "Authenticated users can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'scores');

create policy "Authenticated users can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'scores');
