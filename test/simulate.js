/*
 * fakes a bunch of players against a running server so you can watch the
 * bomb/minigame/explode/defuse logic play out without opening a browser
 *
 * usage: npm run simulate -- --players=4 --url=http://localhost:3000
 */
const { io } = require('socket.io-client');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const URL = args.url || 'http://localhost:3000';
const PLAYER_COUNT = Number(args.players || 3);
const UNFOCUS_CHANCE = Number(args.unfocusChance || 0.05); // per player per tick

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

async function main() {
  const sockets = [];
  const creator = io(URL);

  await new Promise((resolve) => creator.on('connect', resolve));
  sockets.push(creator);

  const room = await new Promise((resolve, reject) => {
    creator.emit('create-room', { teamName: 'Simulated Squad' }, (res) => {
      if (res.error) return reject(new Error(res.error));
      resolve(res.room);
    });
  });
  log(`created room ${room.code}`);

  for (let i = 1; i < PLAYER_COUNT; i++) {
    const s = io(URL);
    await new Promise((resolve) => s.on('connect', resolve));
    await new Promise((resolve, reject) => {
      s.emit('join-room', { roomCode: room.code, playerName: `Bot${i}` }, (res) => {
        if (res.error) return reject(new Error(res.error));
        resolve(res.room);
      });
    });
    sockets.push(s);
    log(`bot ${i} joined`);
  }

  sockets.forEach((s, idx) => {
    s.on('bomb-tick', ({ bombBuffer, bombBufferMax, sessionElapsed, sessionDuration }) => {
      if (idx === 0) {
        log(
          `tick buffer=${bombBuffer}/${bombBufferMax} session=${sessionElapsed}/${sessionDuration}`
        );
      }
    });
    s.on('minigame-start', ({ type }) => {
      log(`[player ${idx}] minigame-start: ${type}`);
      setTimeout(() => s.emit('minigame-complete'), 500 + Math.random() * 1000);
    });
    s.on('bomb-exploded', () => log('*** BOOM: bomb exploded ***'));
    s.on('bomb-defused', () => log('*** SUCCESS: bomb defused ***'));
    s.on('leaderboard-update', ({ entries }) => log('leaderboard:', JSON.stringify(entries)));
  });

  creator.emit('start-game', {}, (res) => {
    if (res.error) log('start-game error:', res.error);
    else log('game started');
  });

  // Randomly toggle focus per player to simulate looking away.
  const focusState = new Map(sockets.map((s) => [s, true]));
  const interval = setInterval(() => {
    sockets.forEach((s) => {
      if (Math.random() < UNFOCUS_CHANCE) {
        const next = !focusState.get(s);
        focusState.set(s, next);
        s.emit('focus-update', { focused: next });
      }
    });
  }, 1000);

  process.on('SIGINT', () => {
    clearInterval(interval);
    sockets.forEach((s) => s.close());
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
