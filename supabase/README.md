# Supabase Setup

SQL files to reproduce the full database and storage setup from scratch. Run them in order via **Supabase Dashboard → SQL Editor**.

## Files

| File | Description |
|---|---|
| `01_scores_table.sql` | Creates the `scores` table and enables RLS |
| `02_storage_policies.sql` | Adds storage RLS policies for the `scores` bucket |

## Steps

### 1. Create the storage bucket (dashboard only)
Before running any SQL, create the private bucket manually:
- Supabase Dashboard → Storage → New bucket
- Name: `scores`
- Public bucket: **off**

### 2. Run SQL files in order
In **SQL Editor**, run each file in sequence:

1. `01_scores_table.sql`
2. `02_storage_policies.sql`

### 3. Configure Auth
- **Auth → Settings** → disable "Enable Sign Ups" (invite-only)
- **Auth → URL Configuration → Redirect URLs** → add:
  - `https://www.slingers.app/**`
  - `http://localhost:8081/**`
- **Auth → Users** → invite users manually

## Notes

- Schema is intentionally simple — no triggers, functions, or complex policies
- RLS is enabled on `scores` but no row-level policies are defined; access is controlled at the API layer via JWT + service role key
- The `objective_scores`, `players`, and `player_names` columns use JSONB for flexibility
