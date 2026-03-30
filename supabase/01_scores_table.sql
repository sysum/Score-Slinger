-- Creates the scores table and enables Row Level Security.
--
-- No row-level policies are defined here — access control is handled at the
-- API layer via the requireAuth middleware + service role key (server/app.ts).
-- If per-user filtering is added in the future, add policies here.

create table if not exists scores (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text        references auth.users(id),
  uploader_name    text        not null,
  team_score       integer     not null,
  achievement      text,
  game_name        text        not null,
  objective_scores jsonb,
  players          jsonb       not null,
  player_names     jsonb,
  image_path       text,
  played_date      timestamptz,
  created_at       timestamptz not null default now()
);

alter table scores enable row level security;
