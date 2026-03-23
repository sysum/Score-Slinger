import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import multer from "multer";
import exifParser from "exif-parser";
import { db } from "./db";
import { scores } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/parse-score", upload.single("image"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image provided" });
      }

      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype || "image/jpeg";

      let photoTakenDate: string | null = null;
      try {
        const parser = exifParser.create(req.file.buffer);
        const exifResult = parser.parse();
        const tags = exifResult.tags;
        const exifTimestamp = tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate;
        if (exifTimestamp && typeof exifTimestamp === "number") {
          photoTakenDate = new Date(exifTimestamp * 1000).toISOString();
        }
      } catch (exifErr) {
        console.log("EXIF extraction failed (non-critical):", exifErr);
      }

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
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
- Return ONLY the JSON, no markdown, no explanation, no code fences`
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

      let parsed;
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
      res.json(parsed);
    } catch (error: any) {
      console.error("Error parsing score:", error);
      res.status(500).json({ error: "Failed to analyze image. Please try again." });
    }
  });

  app.get("/api/scores", async (_req: Request, res: Response) => {
    try {
      const allScores = await db.select().from(scores).orderBy(desc(scores.createdAt));
      res.json(allScores);
    } catch (error: any) {
      console.error("Error fetching scores:", error);
      res.status(500).json({ error: "Failed to fetch scores" });
    }
  });

  app.post("/api/scores", async (req: Request, res: Response) => {
    try {
      const { uploaderName, teamScore, achievement, gameName, objectiveScores, players, playerNames, imageBase64, imageMimeType, playedDate } = req.body;
      if (!uploaderName || teamScore === undefined || !players) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const [newScore] = await db.insert(scores).values({
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
      }).returning();
      res.json(newScore);
    } catch (error: any) {
      console.error("Error saving score:", error);
      res.status(500).json({ error: "Failed to save score" });
    }
  });

  app.patch("/api/scores/:id/player-names", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { playerNames: names } = req.body;
      const [updated] = await db.update(scores).set({ playerNames: names || null }).where(eq(scores.id, id)).returning();
      if (!updated) {
        return res.status(404).json({ error: "Score not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating player names:", error);
      res.status(500).json({ error: "Failed to update player names" });
    }
  });

  app.delete("/api/scores/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [deleted] = await db.delete(scores).where(eq(scores.id, id)).returning();
      if (!deleted) {
        return res.status(404).json({ error: "Score not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting score:", error);
      res.status(500).json({ error: "Failed to delete score" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
