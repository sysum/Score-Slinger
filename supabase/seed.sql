-- Local dev seed. Runs automatically after migrations on `supabase start`
-- (first run) and on every `supabase db reset`. LOCAL ONLY — never run against prod.

-- ---------------------------------------------------------------------------
-- Dev auth user: dev@local.test (confirmed). Sign in via magic link — the email
-- lands in Mailpit at http://127.0.0.1:54324. A bcrypt password ("devpassword")
-- is also set for convenience/scripted testing.
--
-- GoTrue gotcha: the token/varchar columns below must be '' rather than NULL,
-- otherwise GoTrue fails to scan the row ("converting NULL to string is
-- unsupported") and sign-in returns a 500.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'dev@local.test',
  extensions.crypt('devpassword', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Dev"}',
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
);

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"dev@local.test","email_verified":true,"phone_verified":false}',
  'email',
  now(),
  now(),
  now()
);

-- ---------------------------------------------------------------------------
-- Two fake scores owned by the dev user. image_path is null (no image in
-- local storage), so the detail screen shows no photo for these.
-- ---------------------------------------------------------------------------
insert into public.scores (
  user_id,
  uploader_name,
  team_score,
  achievement,
  game_name,
  objective_scores,
  players,
  player_names,
  image_path,
  played_date,
  created_at
) values
(
  '00000000-0000-0000-0000-000000000001',
  'Dev',
  412850,
  'BEST THIS HOUR',
  'Web Slingers: A Spider-Man Adventure',
  '{"fightGiantBot": 118400, "rescueSpiderMan": 96250, "destroyGiantBot": 198200}',
  '[
    {"name": "P1", "score": 128300, "color": "blue"},
    {"name": "P2", "score": 104750, "color": "yellow"},
    {"name": "P3", "score": 97400,  "color": "red"},
    {"name": "P4", "score": 82400,  "color": "purple"}
  ]',
  '{"blue": "Dev", "yellow": "Alex"}',
  null,
  '2026-11-20T14:32:00.000Z',
  now() - interval '1 day'
),
(
  '00000000-0000-0000-0000-000000000001',
  'Dev',
  287640,
  null,
  'Web Slingers: A Spider-Man Adventure',
  '{"fightGiantBot": 81200, "rescueSpiderMan": 70940, "destroyGiantBot": 135500}',
  '[
    {"name": "P1", "score": 91220, "color": "blue"},
    {"name": "P2", "score": 74310, "color": "yellow"},
    {"name": "P3", "score": 66480, "color": "red"},
    {"name": "P4", "score": 55630, "color": "purple"}
  ]',
  null,
  null,
  '2026-11-22T19:05:00.000Z',
  now()
);
