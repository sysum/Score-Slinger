import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { User } from "@supabase/supabase-js";
import OpenAI from "openai";
import exifParser from "exif-parser";
import { supabaseAdmin } from "./supabase";
import { PARSE_MODEL, buildParseRequest, checkParsedScore, extractParsedJson, normalizePlayerNames } from "./parsePrompt";
import type { Score } from "../shared/schema";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Variables = { user: User };

const app = new Hono<{ Variables: Variables }>();

app.use(
  "*",
  cors({
    origin: (origin: string) => {
      if (!origin) return origin;
      const isLocalhost =
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:");
      if (isLocalhost) return origin;
      const allowed = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o: string) => o.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

const requireAuth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", user);
  await next();
});

app.use("/api/*", requireAuth);

// Maps a raw Supabase DB row (snake_case) to the Score type (camelCase)
function toScore(row: Record<string, unknown>): Score {
  return {
    id: row.id as string,
    userId: row.user_id as string | null,
    uploaderName: row.uploader_name as string,
    teamScore: row.team_score as number,
    achievement: row.achievement as string | null,
    gameName: row.game_name as string,
    objectiveScores: row.objective_scores as Score["objectiveScores"],
    players: row.players as Score["players"],
    playerNames: row.player_names as Score["playerNames"],
    imagePath: row.image_path as string | null,
    playedDate: row.played_date as string | null,
    createdAt: row.created_at as Date,
  };
}

app.post("/api/parse-score", async (c) => {
  try {
    const { imagePath } = await c.req.json();

    if (!imagePath) {
      return c.json({ error: "No imagePath provided" }, 400);
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("scores")
      .download(imagePath);

    if (downloadError || !fileData) {
      console.error("Storage download error:", downloadError);
      return c.json({ error: "Could not retrieve image from storage" }, 400);
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const base64Image = buffer.toString("base64");
    const ext = imagePath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    let photoTakenDate: string | null = null;
    try {
      const parser = exifParser.create(buffer);
      const exifResult = parser.parse();
      const tags = exifResult.tags;
      const exifTimestamp =
        tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate;
      if (exifTimestamp && typeof exifTimestamp === "number") {
        photoTakenDate = new Date(exifTimestamp * 1000).toISOString();
      }
    } catch (exifErr) {
      console.log("EXIF extraction failed (non-critical):", exifErr);
    }

    const response = await openai.chat.completions.create(
      buildParseRequest(`data:${mimeType};base64,${base64Image}`),
    );

    const content = response.choices[0]?.message?.content || "";
    console.log("AI response content:", content);

    let parsed: Record<string, unknown>;
    const extracted = extractParsedJson(content);
    if (extracted) {
      parsed = normalizePlayerNames(extracted);
      const problems = checkParsedScore(parsed);
      if (problems.length > 0) {
        console.warn("Parsed score failed sanity checks:", problems, "Parsed:", JSON.stringify(parsed));
        parsed.warning = problems.join("; ");
      }
    } else {
      console.error("No valid JSON found in AI response. Content:", content);
      parsed = { error: "Could not parse scores from this image" };
    }

    if (photoTakenDate) {
      parsed.photoTakenDate = photoTakenDate;
    }
    // Echoed for client analytics (score_parse_succeeded.model).
    parsed.model = PARSE_MODEL;

    return c.json(parsed);
  } catch (error: unknown) {
    console.error("Error parsing score:", error);
    return c.json({ error: "Failed to analyze image. Please try again." }, 500);
  }
});

app.get("/api/scores", async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("scores")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return c.json((data ?? []).map(toScore));
  } catch (error: unknown) {
    console.error("Error fetching scores:", error);
    return c.json({ error: "Failed to fetch scores" }, 500);
  }
});

app.post("/api/scores", async (c) => {
  try {
    const {
      uploaderName,
      teamScore,
      achievement,
      gameName,
      objectiveScores,
      players,
      playerNames,
      imagePath,
      playedDate,
    } = await c.req.json();

    if (!uploaderName || teamScore === undefined || !players) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const user = c.get("user");

    const { data, error } = await supabaseAdmin
      .from("scores")
      .insert({
        user_id: user.id,
        uploader_name: uploaderName,
        team_score: teamScore,
        achievement: achievement || null,
        game_name: gameName || "Unknown",
        objective_scores: objectiveScores || null,
        players,
        player_names: playerNames || null,
        image_path: imagePath || null,
        played_date: playedDate || null,
      })
      .select()
      .single();

    if (error) throw error;
    return c.json(toScore(data));
  } catch (error: unknown) {
    console.error("Error saving score:", error);
    return c.json({ error: "Failed to save score" }, 500);
  }
});

// security-reviewed: no ownership check is intentional — any authenticated user may
// update player names on any score (collaborative labeling feature).
app.patch("/api/scores/:id/player-names", async (c) => {
  try {
    const id = c.req.param("id");
    const { playerNames: names } = await c.req.json();

    const { data, error } = await supabaseAdmin
      .from("scores")
      .update({ player_names: names || null })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return c.json({ error: "Score not found" }, 404);
    return c.json(toScore(data));
  } catch (error: unknown) {
    console.error("Error updating player names:", error);
    return c.json({ error: "Failed to update player names" }, 500);
  }
});

// Only the uploader may change a score's played date (mirrors DELETE's ownership check).
app.patch("/api/scores/:id/played-date", async (c) => {
  try {
    const id = c.req.param("id");
    const user = c.get("user");
    const { playedDate } = await c.req.json().catch(() => ({}));

    const parsed = typeof playedDate === "string" ? new Date(playedDate) : null;
    if (!parsed || isNaN(parsed.getTime())) {
      return c.json({ error: "Invalid playedDate" }, 400);
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("scores")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) return c.json({ error: "Score not found" }, 404);
    if (existing.user_id !== user.id) return c.json({ error: "Forbidden" }, 403);

    const { data, error } = await supabaseAdmin
      .from("scores")
      .update({ played_date: parsed.toISOString() })
      .eq("id", id)
      .select();

    if (error) throw error;
    // The row may have been deleted between the ownership check and the update.
    if (!data || data.length === 0) return c.json({ error: "Score not found" }, 404);
    return c.json(toScore(data[0]));
  } catch (error: unknown) {
    console.error("Error updating played date:", error);
    return c.json({ error: "Failed to update played date" }, 500);
  }
});

app.get("/api/scores/:id/image-url", async (c) => {
  try {
    const id = c.req.param("id");

    const { data: row, error: fetchError } = await supabaseAdmin
      .from("scores")
      .select("image_path")
      .eq("id", id)
      .single();

    if (fetchError || !row?.image_path) {
      return c.json({ url: null });
    }

    const { data, error } = await supabaseAdmin.storage
      .from("scores")
      .createSignedUrl(row.image_path, 60);

    if (error) {
      console.error("Signed URL error:", error);
      return c.json({ url: null });
    }

    return c.json({ url: data.signedUrl });
  } catch (error: unknown) {
    console.error("Error generating image URL:", error);
    return c.json({ url: null });
  }
});

app.delete("/api/scores/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const user = c.get("user");

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("scores")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) return c.json({ error: "Score not found" }, 404);
    if (existing.user_id !== user.id) return c.json({ error: "Forbidden" }, 403);

    const { data, error } = await supabaseAdmin
      .from("scores")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw error;
    // A concurrent DELETE (e.g. double-tap) may already have removed the row.
    if (!data || data.length === 0) return c.json({ error: "Score not found" }, 404);
    return c.json({ success: true });
  } catch (error: unknown) {
    console.error("Error deleting score:", error);
    return c.json({ error: "Failed to delete score" }, 500);
  }
});

export default app;
