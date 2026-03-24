import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// Note: user management is handled by Supabase Auth (auth.users).
// The userId column below references auth.users(id) without a formal FK constraint.

export const scores = pgTable("scores", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id"),
  uploaderName: text("uploader_name").notNull(),
  teamScore: integer("team_score").notNull(),
  achievement: text("achievement"),
  gameName: text("game_name").notNull().default("Unknown"),
  objectiveScores: jsonb("objective_scores").$type<{
    fightGiantBot: number;
    rescueSpiderMan: number;
    destroyGiantBot: number;
  }>(),
  players: jsonb("players").$type<Array<{
    name: string;
    score: number;
    color: string;
  }>>().notNull(),
  playerNames: jsonb("player_names").$type<Record<string, string>>(),
  imagePath: text("image_path"),
  playedDate: text("played_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Score = typeof scores.$inferSelect;
