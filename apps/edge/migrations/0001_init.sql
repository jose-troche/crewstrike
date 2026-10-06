-- Mission results for the leaderboard. Players are anonymous ids stored in the browser; no accounts.
CREATE TABLE scores (
  id          TEXT PRIMARY KEY,
  player      TEXT NOT NULL,
  callsign    TEXT NOT NULL,
  mission_id  TEXT NOT NULL,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('cadet', 'pilot', 'ace', 'custom')),
  stars       INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  duration_s  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_scores_board ON scores(mission_id, difficulty, score DESC);
CREATE INDEX idx_scores_mission ON scores(mission_id, score DESC);
