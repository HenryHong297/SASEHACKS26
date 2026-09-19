const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const { PORT } = require('./config');
const RoomManager = require('./rooms/RoomManager');
const BombEngine = require('./rooms/BombEngine');
const Leaderboard = require('./db/leaderboard');
const registerSocketHandlers = require('./socket/handlers');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const roomManager = new RoomManager();
const leaderboard = new Leaderboard();
const bombEngine = new BombEngine(io, roomManager, leaderboard);

registerSocketHandlers(io, roomManager, bombEngine, leaderboard);

app.get('/health', (req, res) => res.json({ ok: true }));

httpServer.listen(PORT, () => {
  console.log(`Controlled Charge server listening on http://localhost:${PORT}`);
});
