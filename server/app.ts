import * as Sentry from "@sentry/hono/node";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import type { User } from "@supabase/supabase-js";
import OpenAI from "openai";
import exifParser from "exif-parser";
import { supabaseAdmin } from "./supabase";
import { errorMessage, log, truncate } from "./log";
import { PARSE_MODEL, buildParseRequest, checkParsedScore, extractParsedJson, normalizePlayerNames } from "./parsePrompt";
import type { Score } from "../shared/schema";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Variables = { user: User; requestId: string };
type AppContext = Context<{ Variables: Variables }>;

const app = new Hono<{ Variables: Variables }>();

// Sentry first: names the transaction after the matched route and reports
// unhandled errors. Sentry.init lives in server/instrument.ts.
app.use(Sentry.sentry(app));

// Request correlation. Accepts a client-supplied X-Request-Id (so a client error
// report can carry the same id) or mints one, tags every Sentry event / log /
// span for this request with it, echoes it back, and writes one access-log line
// per request (Vercel Hobby keeps runtime logs for only an hour).
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

// The process-wide isolation scope, captured outside any request. Sentry's HTTP
// instrumentation normally forks a fresh one per request; if a runtime ever
// skips that, tags/user set below would leak across concurrent requests, so we
// fork one ourselves.
const defaultIsolationScope = Sentry.getIsolationScope();

app.use("*", async (c, next) => {
  if (Sentry.isEnabled() && Sentry.getIsolationScope() === defaultIsolationScope) {
    return Sentry.withIsolationScope(() => tagRequest(c, next));
  }
  return tagRequest(c, next);
});

async function tagRequest(c: AppContext, next: () => Promise<void>) {
  const incoming = c.req.header("X-Request-Id");
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  // The route that will handle this request. app.use() middleware matches with
  // method "ALL", so the first other match is the handler's path pattern.
  // (c.req.routePath here would be this middleware's own "*".)
  const route = matchedRoutes(c).find((r) => r.method !== "ALL")?.path ?? "unmatched";
  const method = c.req.method;

  c.set("requestId", requestId);
  Sentry.setTags({ request_id: requestId, route, method });
  Sentry.setAttributes({ request_id: requestId, route, method });
  c.header("X-Request-Id", requestId);

  const start = performance.now();
  await next();

  if (method !== "OPTIONS") {
    log.info("request.completed", {
      method,
      route,
      status: c.res.status,
      duration_ms: Math.round(performance.now() - start),
      request_id: requestId,
    });
  }
}

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
    allowHeaders: ["Content-Type", "Authorization", "sentry-trace", "baggage", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id"],
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
  // Identify the user on Sentry events and logs: id + display name only, never email.
  const displayName = user.user_metadata?.display_name;
  Sentry.setUser({
    id: user.id,
    ...(typeof displayName === "string" && displayName ? { username: displayName } : {}),
  });
  Sentry.setAttribute("user_id", user.id);
  await next();
});

app.use("/api/*", requireAuth);

// Reports an unexpected error to Sentry and logs `<event>.failed`.
function reportError(event: string, err: unknown) {
  const message = errorMessage(err);
  // Supabase returns plain-object errors (code/message/details/hint). Wrap them
  // so the Sentry issue gets a real message instead of "Object captured as
  // exception with keys: ...".
  Sentry.captureException(
    err instanceof Error ? err : new Error(`${event}: ${message}`, { cause: err }),
    { tags: { failed_event: event } },
  );
  log.error(`${event}.failed`, { error_message: message });
}

// Shared catch-all for route errors: reports the error, then returns the
// route's existing 500 message plus the request id (so a user-reported failure
// can be looked up in Sentry).
function fail(c: AppContext, event: string, err: unknown, message: string) {
  reportError(event, err);
  return c.json({ error: message, requestId: c.get("requestId") }, 500);
}

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
      const statusSource = downloadError as { status?: unknown; statusCode?: unknown } | null;
      log.warn("storage.download_failed", {
        image_path: truncate(String(imagePath), 256), // client-supplied: cap it
        error_message: downloadError ? errorMessage(downloadError) : "no data returned",
        error_status: String(statusSource?.status ?? statusSource?.statusCode ?? ""),
      });
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
      log.debug("exif.parse_failed", { error_message: errorMessage(exifErr) });
    }

    const parseStart = performance.now();
    const response = await openai.chat.completions.create(
      buildParseRequest(`data:${mimeType};base64,${base64Image}`),
    );

    const content = response.choices[0]?.message?.content || "";
    // The reply is score JSON (no PII). Never log the request: it holds the image.
    log.info("parse.completed", {
      model: response.model || PARSE_MODEL,
      duration_ms: Math.round(performance.now() - parseStart),
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
      finish_reason: response.choices[0]?.finish_reason,
      image_bytes: buffer.length,
      has_exif_date: photoTakenDate !== null,
      content: truncate(content),
    });

    let parsed: Record<string, unknown>;
    const extracted = extractParsedJson(content);
    if (extracted) {
      parsed = normalizePlayerNames(extracted);
      const problems = checkParsedScore(parsed);
      if (problems.length > 0) {
        log.warn("parse.sanity_check_failed", { problems: problems.join("; ") });
        parsed.warning = problems.join("; ");
      }
    } else {
      log.error("parse.no_json", { content: truncate(content) });
      parsed = { error: "Could not parse scores from this image" };
    }

    if (photoTakenDate) {
      parsed.photoTakenDate = photoTakenDate;
    }
    // Echoed for client analytics (score_parse_succeeded.model).
    parsed.model = PARSE_MODEL;

    return c.json(parsed);
  } catch (error: unknown) {
    return fail(c, "parse", error, "Failed to analyze image. Please try again.");
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
    return fail(c, "scores.list", error, "Failed to fetch scores");
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
    log.info("scores.inserted", { score_id: data.id, team_score: data.team_score });
    return c.json(toScore(data));
  } catch (error: unknown) {
    return fail(c, "scores.insert", error, "Failed to save score");
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
    log.info("scores.player_names_updated", { score_id: id });
    return c.json(toScore(data));
  } catch (error: unknown) {
    return fail(c, "scores.player_names", error, "Failed to update player names");
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
    log.info("scores.played_date_updated", { score_id: id });
    return c.json(toScore(data[0]));
  } catch (error: unknown) {
    return fail(c, "scores.played_date", error, "Failed to update played date");
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
      log.warn("storage.signed_url_failed", {
        score_id: id,
        image_path: row.image_path,
        error_message: errorMessage(error),
      });
      return c.json({ url: null });
    }

    return c.json({ url: data.signedUrl });
  } catch (error: unknown) {
    // This route degrades to { url: null } (200) rather than a 500; keep that.
    reportError("scores.image_url", error);
    return c.json({ url: null });
  }
});

app.delete("/api/scores/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const user = c.get("user");

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("scores")
      .select("user_id, image_path")
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

    // Best-effort: remove the now-orphaned image. The row is already gone, so a
    // storage failure is logged but doesn't fail the request.
    if (existing.image_path) {
      const { error: removeError } = await supabaseAdmin.storage
        .from("scores")
        .remove([existing.image_path]);
      if (removeError) {
        log.warn("storage.remove_failed", {
          score_id: id,
          image_path: existing.image_path,
          error_message: errorMessage(removeError),
        });
      }
    }
    log.info("scores.deleted", { score_id: id });
    return c.json({ success: true });
  } catch (error: unknown) {
    return fail(c, "scores.delete", error, "Failed to delete score");
  }
});

export default app;
