import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import multer from "multer";

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

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a scoreboard parser for a theme park ride game (like Marvel's Web Slingers or similar). You MUST extract numbers from the image and return valid JSON. Never refuse to parse — always do your best to read the numbers.

The scoreboard layout is:
- CENTER: A large team score (the biggest number on screen, e.g. 881,900). This is the teamScore.
- CENTER BOTTOM: Three objective scores labeled "FIGHT GIANT BOT" (left), "RESCUE SPIDER-MAN" (middle), "DESTROY GIANT BOT" (right), each with a number below.
- LEFT SIDE: Two player score panels stacked vertically. The top-left panel is BLUE, the bottom-left panel is YELLOW. Each shows a score number.
- RIGHT SIDE: Two player score panels stacked vertically. The top-right panel is RED, the bottom-right panel is PURPLE. Each shows a score number.

Return ONLY valid JSON with this exact structure:
{
  "teamScore": <number>,
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

      res.json(parsed);
    } catch (error: any) {
      console.error("Error parsing score:", error);
      res.status(500).json({ error: "Failed to analyze image. Please try again." });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
