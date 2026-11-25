-- Mirrors the production project's schema exactly. RLS enabled, no table policies:
-- access is enforced at the API layer (requireAuth + service role).
create table if not exists public.scores (
  id               uuid        not null default gen_random_uuid(),
  user_id          text        null,      -- auth.users.id as text; intentionally no FK
  uploader_name    text        not null,
  team_score       integer     not null,
  achievement      text        null,
  game_name        text        not null default 'Unknown',
  objective_scores jsonb       null,
  players          jsonb       not null,
  player_names     jsonb       null,
  image_path       text        null,
  played_date      text        null,      -- ISO string; text in prod, not timestamptz
  created_at       timestamptz not null default now(),
  constraint scores_pkey primary key (id)
);
alter table public.scores enable row level security;
