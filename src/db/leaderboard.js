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
      INSERT INTO leaderboard (team_name, survival_seconds, defused, player_count)
      VALUES (@teamName, @survivalSeconds, @defused, @playerCount)
    `);

    this._topStmt = this.db.prepare(`
      SELECT team_name AS teamName, survival_seconds AS survivalSeconds,
             defused, player_count AS playerCount, created_at AS createdAt
      FROM leaderboard
      ORDER BY defused DESC, survival_seconds DESC
      LIMIT ?
    `);
  }

  recordRun({ teamName, survivalSeconds, defused, playerCount }) {
    this._insertStmt.run({
      teamName,
      survivalSeconds,
      defused: defused ? 1 : 0,
      playerCount,
    });
  }

  top(limit = 10) {
    return this._topStmt.all(limit).map((row) => ({ ...row, defused: !!row.defused }));
  }

  close() {
    this.db.close();
  }
}

module.exports = Leaderboard;
