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
            content: `You are a video game scoreboard parser. Analyze the provided screenshot and extract score information. Return ONLY valid JSON with this exact structure:
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
      "color": "<one of: red, blue, green, yellow - based on the player's UI color in the game>"
    }
  ]
}

Rules:
- Extract up to 4 team members maximum
- Assign colors based on the actual colors visible in the game UI for each player
- If colors aren't distinguishable, assign them in order: blue, red, green, yellow
- There may be multiple team-related scores visible. The overall Team score (teamScore) is the LARGEST number visible in the image. Do NOT sum individual player scores — look for the biggest number displayed, which represents the overall team score.
- Below the main team score there are additional objective scores displayed left to right. Extract them as objectiveScores: "fightGiantBot" (leftmost), "rescueSpiderMan" (middle), "destroyGiantBot" (rightmost). If any are not visible, use 0.
- If you can identify the game, include its name
- If you cannot parse scores from the image, return: {"error": "Could not parse scores from this image"}
- Return ONLY the JSON, no markdown or explanation`
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
                text: "Parse this game scoreboard screenshot and extract all player scores and the total team score.",
              },
            ],
          },
        ],
        max_completion_tokens: 1024,
      });

      const content = response.choices[0]?.message?.content || "";

      let parsed;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          parsed = { error: "Could not parse scores from this image" };
        }
      } catch {
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
