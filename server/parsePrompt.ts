// Scoreboard-parsing prompt + OpenAI request builder for POST /api/parse-score.
// Kept in its own module so offline validation scripts exercise the exact
// production prompt, model, and request options.
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

// gpt-4.1-mini over gpt-4o-mini (2026-11-24 validation, 5 prod boards × 5 runs):
// gpt-4o-mini misread the glare-washed Aug 25 board's "Rescue Spider-Man" 37,000
// as 70,000 in 5/5 runs; gpt-4.1-mini was 25/25 exact on every field, and is
// cheaper per image (~6k vs ~26k input tokens for a phone photo).
export const PARSE_MODEL = "gpt-4.1-mini";

export const PLAYER_COLORS = ["blue", "yellow", "red", "purple"] as const;
export const PANEL_POSITIONS = ["top-left", "bottom-left", "top-right", "bottom-right"] as const;

export const PARSE_SYSTEM_PROMPT = `You are a scoreboard parser for a theme park ride game (like Marvel's Web Slingers or similar). You MUST extract numbers from the image and return valid JSON. Never refuse to parse — always do your best to read the numbers.

The scoreboard layout is:
- CENTER TOP: Above the large team score number, there is a text label. It may say "TEAM SCORE" or it may show an achievement like "BEST THIS HOUR", "2ND THIS HOUR", "3RD THIS HOUR", etc. This is the achievement field.
- CENTER: A large team score (the biggest number on screen, e.g. 881,900). This is the teamScore.
- CENTER BOTTOM: Three objective scores labeled "FIGHT GIANT BOT" (left), "RESCUE SPIDER-MAN" (middle), "DESTROY GIANT BOT" (right), each with a number below.
- LEFT SIDE and RIGHT SIDE: Four player score panels in total — two stacked vertically on the left, two stacked vertically on the right. Each panel shows one player's score number.

How to identify each player's color (read carefully):
- There are exactly 4 players: blue, yellow, red and purple. Each color appears on exactly one panel.
- Panel positions VARY between ride vehicles. Any color can be in any of the four positions — for example, one vehicle has blue top-left and yellow bottom-left, another has yellow top-left and blue bottom-left. NEVER assume or guess a color from a panel's position.
- Determine each panel's color ONLY from that panel's own appearance: its background color (the tinted fill, the colored border, and the colored header bar along its edge) and the color of its score digits.
- Score digits are sometimes plain WHITE. White digits say nothing about the color — use that panel's background color instead. When the digits are colored, they match the panel's background color.
- Yellow panels can look orange, gold or amber. Red panels are a deeper red. Purple panels can look violet. Blue panels are a medium/royal blue.
- Work panel by panel: for each of the four positions, look at that panel's background (and digit color if not white), decide its color, and read its score. Then confirm that blue, yellow, red and purple are each used exactly once.

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
      "name": "<the player's color name, capitalized, e.g. Blue — the board shows no player names>",
      "score": <number>,
      "color": "<one of: blue, yellow, red, purple — taken from the panel's own color, never its position>",
      "position": "<one of: top-left, bottom-left, top-right, bottom-right — where this panel is on screen>"
    }
  ]
}

Rules:
- "players" has exactly 4 entries, one per panel, and the colors blue, yellow, red and purple are each used exactly once
- A player's color comes from the panel's background color and digit color — never from where the panel sits
- "position" records where the panel is on screen; it must not influence the color
- The teamScore is the largest number displayed in the center of the screen
- Read the text label ABOVE the team score. If it says "TEAM SCORE", set achievement to null. If it says anything else (like "BEST THIS HOUR", "2ND THIS HOUR", "3RD THIS HOUR"), set achievement to that text exactly as shown
- Read the three objective scores from below the team score
- Numbers may have commas (e.g. 881,900). Remove commas and return as integers
- The game is likely "Web Slingers: A Spider-Man Adventure" or similar
- ALWAYS return the JSON with your best reading of the numbers. Never return an error if you can see any numbers at all
- Return ONLY the JSON, no markdown, no explanation, no code fences`;

export const PARSE_USER_TEXT =
  "Parse this theme park ride game scoreboard. Extract the large team score in the center, the three objective scores (Fight Giant Bot, Rescue Spider-Man, Destroy Giant Bot) below it, and the four player scores from the colored panels. Panel colors are not in a fixed position — identify each panel's color (blue, yellow, red or purple) from its own background and digit color, and record its on-screen position separately.";

export const PARSE_MAX_COMPLETION_TOKENS = 1024;

// Builds the chat.completions request for a scoreboard image.
// `imageDataUrl` is a `data:<mime>;base64,<...>` URL.
export function buildParseRequest(
  imageDataUrl: string,
  model: string = PARSE_MODEL,
): ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: PARSE_USER_TEXT },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: PARSE_MAX_COMPLETION_TOKENS,
  };
}

// Extracts the JSON object from the model's reply. JSON mode should make the
// whole reply valid JSON; the regex is a fallback for stray prose/code fences.
export function extractParsedJson(content: string): Record<string, unknown> | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The board shows no player names, and the model may still return "" (or omit
// the field) for `name`. Fill any missing/blank name with the capitalized color
// ("Yellow") so the UI never renders a blank label. Mutates and returns `parsed`.
export function normalizePlayerNames(parsed: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(parsed.players)) return parsed;
  for (const player of parsed.players as { name?: unknown; color?: unknown }[]) {
    if (!player || typeof player !== "object") continue;
    const name = typeof player.name === "string" ? player.name.trim() : "";
    const color = typeof player.color === "string" ? player.color.trim().toLowerCase() : "";
    if (name) continue;
    if (color) player.name = color.charAt(0).toUpperCase() + color.slice(1);
  }
  return parsed;
}

// Sanity checks on a parsed scoreboard. Returns a list of human-readable
// problems (empty if everything checks out):
//  (a) exactly 4 players whose colors are exactly {blue, yellow, red, purple}
//  (b) sum of player scores + the 3 objective scores === teamScore
export function checkParsedScore(parsed: Record<string, unknown>): string[] {
  const problems: string[] = [];

  const players = Array.isArray(parsed.players)
    ? (parsed.players as { color?: unknown; score?: unknown }[])
    : [];
  const colors = players.map((p) => String(p?.color ?? "").toLowerCase());
  const expected = [...PLAYER_COLORS].sort();
  if (players.length !== 4 || [...colors].sort().join(",") !== expected.join(",")) {
    problems.push(
      `expected 4 players colored ${PLAYER_COLORS.join("/")}, got ${players.length}: [${colors.join(", ")}]`,
    );
  }

  const objectives = (parsed.objectiveScores ?? {}) as Record<string, unknown>;
  const parts = [
    ...players.map((p) => p?.score),
    objectives.fightGiantBot,
    objectives.rescueSpiderMan,
    objectives.destroyGiantBot,
  ];
  const teamScore = parsed.teamScore;
  if (typeof teamScore !== "number" || parts.some((n) => typeof n !== "number")) {
    problems.push("teamScore, player scores, or objective scores missing or not numbers");
  } else {
    const sum = (parts as number[]).reduce((a, b) => a + b, 0);
    if (sum !== teamScore) {
      problems.push(
        `player scores + objective scores = ${sum}, but teamScore = ${teamScore} (off by ${teamScore - sum})`,
      );
    }
  }

  return problems;
}
