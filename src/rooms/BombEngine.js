const {
  SESSION_DURATION_SECONDS,
  BUFFER_MAX_SECONDS,
  BUFFER_DRAIN_PER_TICK,
  BUFFER_REGEN_PER_TICK,
  TICK_INTERVAL_MS,
  MINIGAME_INTERVAL_SECONDS,
  MINIGAME_TIMEOUT_SECONDS,
} = require('../config');

class BombEngine {
  constructor(io, roomManager, leaderboard) {
    this.io = io;
    this.roomManager = roomManager;
    this.leaderboard = leaderboard;
    this.intervals = new Map(); // code -> interval handle
    this.minigameTimeouts = new Map(); // code -> timeout handle
  }

  start(code) {
    const room = this.roomManager.getRoom(code);
    if (!room || room.state !== 'lobby') return;

    room.state = 'armed';
    room.bombBuffer = BUFFER_MAX_SECONDS;
    room.bombBufferMax = BUFFER_MAX_SECONDS;
    room.sessionElapsed = 0;
    room.sessionDuration = SESSION_DURATION_SECONDS;
    room.lastMinigameAt = 0;

    this._broadcastState(room);

    const handle = setInterval(() => this._tick(code), TICK_INTERVAL_MS);
    this.intervals.set(code, handle);
  }

  stop(code) {
    const handle = this.intervals.get(code);
    if (handle) clearInterval(handle);
    this.intervals.delete(code);

    const mgHandle = this.minigameTimeouts.get(code);
    if (mgHandle) clearTimeout(mgHandle);
    this.minigameTimeouts.delete(code);
  }

  _tick(code) {
    const room = this.roomManager.getRoom(code);
    if (!room || room.state !== 'armed') return;

    const players = Array.from(room.players.values());
    const anyUnfocused = players.some((p) => !p.focused);

    if (anyUnfocused) {
      room.bombBuffer = Math.max(0, room.bombBuffer - BUFFER_DRAIN_PER_TICK);
    } else {
      room.bombBuffer = Math.min(room.bombBufferMax, room.bombBuffer + BUFFER_REGEN_PER_TICK);
    }
    room.sessionElapsed += TICK_INTERVAL_MS / 1000;

    this.io.to(code).emit('bomb-tick', {
      bombBuffer: room.bombBuffer,
      bombBufferMax: room.bombBufferMax,
      sessionElapsed: room.sessionElapsed,
      sessionDuration: room.sessionDuration,
      anyUnfocused,
    });

    if (room.bombBuffer <= 0) {
      this._explode(code);
      return;
    }

    if (room.sessionElapsed >= room.sessionDuration) {
      this._defuse(code);
      return;
    }

    if (room.sessionElapsed - room.lastMinigameAt >= MINIGAME_INTERVAL_SECONDS) {
      room.lastMinigameAt = room.sessionElapsed;
      this._startMinigame(code);
    }
  }

  _startMinigame(code) {
    const room = this.roomManager.getRoom(code);
    if (!room || room.state !== 'armed') return;

    room.state = 'minigame';
    room.minigameCompletedBy = new Set();
    const type = ['reaction-tap', 'pattern-match', 'quick-math'][
      Math.floor(Math.random() * 3)
    ];
    room.minigameType = type;

    this.io.to(code).emit('minigame-start', { type, timeout: MINIGAME_TIMEOUT_SECONDS });

    const handle = setTimeout(() => this._endMinigame(code), MINIGAME_TIMEOUT_SECONDS * 1000);
    this.minigameTimeouts.set(code, handle);
  }

  playerCompletedMinigame(code, socketId) {
    const room = this.roomManager.getRoom(code);
    if (!room || room.state !== 'minigame') return;
    room.minigameCompletedBy.add(socketId);

    if (room.minigameCompletedBy.size >= room.players.size) {
      this._endMinigame(code);
    }
  }

  _endMinigame(code) {
    const room = this.roomManager.getRoom(code);
    if (!room || room.state !== 'minigame') return;

    const handle = this.minigameTimeouts.get(code);
    if (handle) clearTimeout(handle);
    this.minigameTimeouts.delete(code);

    room.state = 'armed';
    room.minigameCompletedBy = new Set();
    this.io.to(code).emit('minigame-end', {});
  }

  _explode(code) {
    const room = this.roomManager.getRoom(code);
    if (!room) return;
    room.state = 'exploded';
    this.stop(code);
    this.io.to(code).emit('bomb-exploded', { sessionElapsed: room.sessionElapsed });
    this.leaderboard.recordRun({
      teamName: room.teamName,
      survivalSeconds: Math.round(room.sessionElapsed),
      defused: false,
      playerCount: room.players.size,
    });
    this._broadcastLeaderboard(code);
  }

  _defuse(code) {
    const room = this.roomManager.getRoom(code);
    if (!room) return;
    room.state = 'defused';
    this.stop(code);
    this.io.to(code).emit('bomb-defused', { sessionElapsed: room.sessionElapsed });
    this.leaderboard.recordRun({
      teamName: room.teamName,
      survivalSeconds: Math.round(room.sessionElapsed),
      defused: true,
      playerCount: room.players.size,
    });
    this._broadcastLeaderboard(code);
  }

  _broadcastState(room) {
    this.io.to(room.code).emit('room-state', this.roomManager.roomPublicState(room));
  }

  _broadcastLeaderboard(code) {
    this.io.to(code).emit('leaderboard-update', { entries: this.leaderboard.top(10) });
  }
}

module.exports = BombEngine;
