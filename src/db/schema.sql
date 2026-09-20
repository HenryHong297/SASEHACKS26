CREATE TABLE IF NOT EXISTS leaderboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name TEXT NOT NULL,
  survival_seconds INTEGER NOT NULL,
  defused INTEGER NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score
  ON leaderboard (defused DESC, survival_seconds DESC);
