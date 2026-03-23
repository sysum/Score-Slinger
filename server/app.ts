import { Hono } from "hono";
import { cors } from "hono/cors";
import OpenAI from "openai";
import exifParser from "exif-parser";
import { db } from "./db";
import { scores } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      const isLocalhost =
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:");
      if (isLocalhost) return origin;
      const allowed = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

app.post("/api/parse-score", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return c.json({ error: "No image provided" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Image = buffer.toString("base64");
    const mimeType = file.type || "image/jpeg";

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

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a scoreboard parser for a theme park ride game (like Marvel's Web Slingers or similar). You MUST extract numbers from the image and return valid JSON. Never refuse to parse — always do your best to read the numbers.

The scoreboard layout is:
- CENTER TOP: Above the large team score number, there is a text label. It may say "TEAM SCORE" or it may show an achievement like "BEST THIS HOUR", "2ND THIS HOUR", "3RD THIS HOUR", etc. This is the achievement field.
- CENTER: A large team score (the biggest number on screen, e.g. 881,900). This is the teamScore.
- CENTER BOTTOM: Three objective scores labeled "FIGHT GIANT BOT" (left), "RESCUE SPIDER-MAN" (middle), "DESTROY GIANT BOT" (right), each with a number below.
- LEFT SIDE: Two player score panels stacked vertically. The top-left panel is BLUE, the bottom-left panel is YELLOW. Each shows a score number.
- RIGHT SIDE: Two player score panels stacked vertically. The top-right panel is RED, the bottom-right panel is PURPLE. Each shows a score number.

Return ONLY valid JSON with this exact structure:
{
  "teamScore": <number>,
  "achievement": "<text above the team score, or null if it just says 'TEAM SCORE'>",
  "objectiveScores": {
    "fightGiantBot": <number>,
    "rescueSpiderMan": <number>,
    "destroyGiantBot": <number>
  },
  "gameName": "<detected game name or 'Unknown'>",
  "players": [
    {
      "name": "<player name or identifier>",
      "score": <number>,
      "color": "<one of: blue, red, yellow, purple>"
    }
  ]
}

Rules:
- There are exactly 4 players: blue (top-left), yellow (bottom-left), red (top-right), purple (bottom-right)
- Read the score number from each colored panel
- The teamScore is the largest number displayed in the center of the screen
- Read the text label ABOVE the team score. If it says "TEAM SCORE", set achievement to null. If it says anything else (like "BEST THIS HOUR", "2ND THIS HOUR", "3RD THIS HOUR"), set achievement to that text exactly as shown
- Read the three objective scores from below the team score
- Numbers may have commas (e.g. 881,900). Remove commas and return as integers
- The game is likely "Web Slingers: A Spider-Man Adventure" or similar
- ALWAYS return the JSON with your best reading of the numbers. Never return an error if you can see any numbers at all
- Return ONLY the JSON, no markdown, no explanation, no code fences`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "Parse this theme park ride game scoreboard. Extract the large team score in the center, the three objective scores (Fight Giant Bot, Rescue Spider-Man, Destroy Giant Bot) below it, and the four player scores from the colored panels (blue top-left, yellow bottom-left, red top-right, purple bottom-right).",
            },
          ],
        },
      ],
      max_completion_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log("AI response content:", content);

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error("No JSON found in AI response");
        parsed = { error: "Could not parse scores from this image" };
      }
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Content:", content);
      parsed = { error: "Could not parse scores from this image" };
    }

    if (photoTakenDate) {
      parsed.photoTakenDate = photoTakenDate;
    }

    return c.json(parsed);
  } catch (error: unknown) {
    console.error("Error parsing score:", error);
    return c.json(
      { error: "Failed to analyze image. Please try again." },
      500,
    );
  }
});

app.get("/api/scores", async (c) => {
  try {
    const allScores = await db
      .select()
      .from(scores)
      .orderBy(desc(scores.createdAt));
    return c.json(allScores);
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
      imageBase64,
      imageMimeType,
      playedDate,
    } = await c.req.json();

    if (!uploaderName || teamScore === undefined || !players) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const [newScore] = await db
      .insert(scores)
      .values({
        uploaderName,
        teamScore,
        achievement: achievement || null,
        gameName: gameName || "Unknown",
        objectiveScores: objectiveScores || null,
        players,
        playerNames: playerNames || null,
        imageBase64: imageBase64 || null,
        imageMimeType: imageMimeType || null,
        playedDate: playedDate || null,
      })
      .returning();

    return c.json(newScore);
  } catch (error: unknown) {
    console.error("Error saving score:", error);
    return c.json({ error: "Failed to save score" }, 500);
  }
});

app.patch("/api/scores/:id/player-names", async (c) => {
  try {
    const id = c.req.param("id");
    const { playerNames: names } = await c.req.json();
    const [updated] = await db
      .update(scores)
      .set({ playerNames: names || null })
      .where(eq(scores.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Score not found" }, 404);
    }

    return c.json(updated);
  } catch (error: unknown) {
    console.error("Error updating player names:", error);
    return c.json({ error: "Failed to update player names" }, 500);
  }
});

app.delete("/api/scores/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [deleted] = await db
      .delete(scores)
      .where(eq(scores.id, id))
      .returning();

    if (!deleted) {
      return c.json({ error: "Score not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error: unknown) {
    console.error("Error deleting score:", error);
    return c.json({ error: "Failed to delete score" }, 500);
  }
});

export default app;
