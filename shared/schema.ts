import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const scores = pgTable("scores", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
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
  imageBase64: text("image_base64"),
  imageMimeType: text("image_mime_type"),
  playedDate: text("played_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Score = typeof scores.$inferSelect;
