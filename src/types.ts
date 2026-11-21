export type Puzzle = {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  popularity: number;
  plays: number;
  themes: string[];
  gameUrl?: string;
  openingTags?: string[];
};

export type PuzzleManifest = {
  version: number;
  generatedAt: string;
  source: string;
  total: number;
  shardSize: number;
  shards: Array<{
    file: string;
    count: number;
    minRating: number;
    maxRating: number;
    themes: string[];
  }>;
};

export type TrainerStats = {
  score: number;
  streak: number;
  solved: number;
  failed: number;
  seenIds: string[];
};
