const { MIN_PLAYERS_PER_ROOM } = require('../config');

function registerSocketHandlers(io, roomManager, bombEngine, leaderboard) {
  io.on('connection', (socket) => {
    socket.on('create-room', ({ teamName, playerName } = {}, ack) => {
      const room = roomManager.createRoom(teamName);
      const { error } = roomManager.joinRoom(room.code, socket.id, playerName);
      if (error) return ack && ack({ error });

      socket.join(room.code);
      ack && ack({ room: roomManager.roomPublicState(room) });
      io.to(room.code).emit('room-state', roomManager.roomPublicState(room));
    });

    socket.on('join-room', ({ roomCode, playerName } = {}, ack) => {
      const code = (roomCode || '').toUpperCase().trim();
      const { room, error } = roomManager.joinRoom(code, socket.id, playerName);
      if (error) return ack && ack({ error });

      socket.join(code);
      ack && ack({ room: roomManager.roomPublicState(room) });
      io.to(code).emit('room-state', roomManager.roomPublicState(room));
    });

    socket.on('start-game', (_, ack) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return ack && ack({ error: 'Not in a room' });
      if (room.players.size < MIN_PLAYERS_PER_ROOM) {
        return ack && ack({ error: `Need at least ${MIN_PLAYERS_PER_ROOM} players` });
      }
      bombEngine.start(room.code);
      ack && ack({ ok: true });
    });

    socket.on('focus-update', ({ focused } = {}) => {
      const room = roomManager.setFocus(socket.id, !!focused);
      if (!room) return;
      io.to(room.code).emit('room-state', roomManager.roomPublicState(room));
    });

    socket.on('minigame-complete', () => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) return;
      bombEngine.playerCompletedMinigame(room.code, socket.id);
    });

    socket.on('get-leaderboard', (_, ack) => {
      ack && ack({ entries: leaderboard.top(10) });
    });

    socket.on('disconnect', () => {
      const room = roomManager.getRoomForSocket(socket.id);
      const code = roomManager.leaveSocket(socket.id);
      if (code && room) {
        io.to(code).emit('room-state', roomManager.roomPublicState(room));
      }
    });
  });
}

module.exports = registerSocketHandlers;
