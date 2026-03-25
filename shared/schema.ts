// Shared types between client and server.
// Schema is managed via the Supabase dashboard — no ORM or migration tool needed.

export type Score = {
  id: string;
  userId: string | null;
  uploaderName: string;
  teamScore: number;
  achievement: string | null;
  gameName: string;
  objectiveScores: {
    fightGiantBot: number;
    rescueSpiderMan: number;
    destroyGiantBot: number;
  } | null;
  players: Array<{
    name: string;
    score: number;
    color: string;
  }>;
  playerNames: Record<string, string> | null;
  imagePath: string | null;
  playedDate: string | null;
  createdAt: Date;
};
