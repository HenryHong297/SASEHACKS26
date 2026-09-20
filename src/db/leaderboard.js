const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(process.cwd(), 'leaderboard.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

class Leaderboard {
  constructor(dbPath = DB_PATH) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    this._insertStmt = this.db.prepare(`
      INSERT INTO leaderboard (team_name, survival_seconds, player_count)
      VALUES (@teamName, @survivalSeconds, @playerCount)
    `);

    this._topStmt = this.db.prepare(`
      SELECT team_name AS teamName, survival_seconds AS survivalSeconds,
             player_count AS playerCount, created_at AS createdAt
      FROM leaderboard
      ORDER BY survival_seconds DESC
      LIMIT ?
    `);
  }

  recordRun({ teamName, survivalSeconds, playerCount }) {
    this._insertStmt.run({ teamName, survivalSeconds, playerCount });
  }

  top(limit = 10) {
    return this._topStmt.all(limit);
  }

  close() {
    this.db.close();
  }
}

module.exports = Leaderboard;
