const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const { PORT } = require('./config');
const RoomManager = require('./rooms/RoomManager');
const BombEngine = require('./rooms/BombEngine');
const Leaderboard = require('./db/leaderboard');
const registerSocketHandlers = require('./socket/handlers');
const { ensureVendorAssets } = require('./vendorAssets');

const app = express();
// The real UI (web/) is a Vite/React app built to web/dist - `npm run build`
// (root package.json) builds it. public/ still holds the self-hosted
// MediaPipe assets (src/vendorAssets.js) and the old vanilla test client
// (public/legacy-test/), so both stay mounted; express.static falls through
// to the next one when a path isn't found in the first.
app.use(
  express.static(path.join(__dirname, '..', 'web', 'dist'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
  })
);
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
  })
);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const roomManager = new RoomManager();
const leaderboard = new Leaderboard();
const bombEngine = new BombEngine(io, roomManager, leaderboard);

registerSocketHandlers(io, roomManager, bombEngine, leaderboard);

app.get('/health', (req, res) => res.json({ ok: true }));

ensureVendorAssets()
  .catch((err) => {
    console.error('failed to download vendor assets (in-browser focus detector will not load):', err.message);
  })
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`Controlled Charge server listening on http://localhost:${PORT}`);
    });
  });
