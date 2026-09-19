# Controlled Charge — Server

The idea: 2-5 people join a room, there's a shared "bomb" in the middle, and it only starts getting dangerous if someone stops paying attention (looks down or away from their screen). Stay locked in as a team long enough and you defuse it. Mini-games pop up every so often as "study breaks" to reset everyone's focus before it becomes a problem. Runs go on a leaderboard.

This repo is just the server side — Node + Socket.IO. There's also a barebones test page in here so you can mess with the game logic before the real webcam focus-detection UI exists.

## what you need

- Node **22.5+**. We're using the built-in `node:sqlite` module instead of a normal npm sqlite package — saves everyone from needing Visual Studio Build Tools installed just to get a database working (learned that one the hard way). Check with `node -v`.

## getting it running

```powershell
git clone https://github.com/mdang0/SASEHACKS26.git
cd SASEHACKS26
npm install
copy .env.example .env   # optional, defaults work fine
npm run dev                # http://localhost:3000, restarts itself when you save a file
```

Open that url in 2+ browser tabs:

1. tab 1 hits "Create Room"
2. everyone else joins with that room code
3. hit "Start Session" once you've got 2+ people in
4. click "I'm FOCUSED" in a tab to fake looking away — watch the bomb bar drain live in every tab at once
5. every 45s a mini-game pops up everywhere, click through it in each tab to keep the session going
6. it ends in either boom or defused, leaderboard updates either way

### testing without opening a browser

`test/simulate.js` fakes a bunch of players over socket.io and randomly toggles their focus, so you can watch the bomb logic play out in a terminal instead of clicking through tabs:

```powershell
npm start
npm run simulate -- --players=4 --unfocusChance=0.05
```

Crank `unfocusChance` up (like 0.3) to force an explosion, or down to 0 to watch it survive and hit mini-games. Also, don't wait 3 minutes every time you test — shrink the timers:

```powershell
$env:SESSION_DURATION_SECONDS=15; $env:MINIGAME_INTERVAL_SECONDS=5; npm run dev
```

## splitting up the work

1. clone it, branch off (`git checkout -b feat/whatever-youre-doing`), PR into `main`
2. rough split:
   - **server (this repo)** — tuning how the bomb feels, handling people disconnecting mid-game, leaderboard stuff
   - **focus detection (client side)** — face-api.js or MediaPipe in the browser to figure out when someone's looking away, then just call `socket.emit('focus-update', { focused })`. `public/client.js` already does this, copy the pattern
   - **UI** — replace the ugly test page with real bomb visuals, a timer animation, mini-game art, a leaderboard screen. The socket events below are basically your API, build against those
3. pick one person to own the numbers in `src/config.js` so the game doesn't feel completely different every time someone tweaks it right before the demo

## demoing it live

everything runs off your own laptop — no external hosting.

- **same wifi:** run the server, everyone connects to `http://<your laptop's LAN IP>:3000` (find your IP with `ipconfig`)
- **outside your wifi** (or venue wifi blocks device-to-device traffic): use a tunnel so people hit a public url that forwards to your laptop:

  ```powershell
  npm run tunnel
  ```

  this tries to grab `https://controlledchargedemo.loca.lt` specifically (set via `--subdomain` in the `tunnel` script). Subdomains aren't reserved accounts though — it's first-come-first-served, so if someone else has it when you run this, localtunnel falls back to a random name instead and you just send whatever url it prints. First time anyone opens the link in a browser they'll hit a "click to continue" interstitial page, that's normal for localtunnel, just click through.

  it's a free shared proxy with no uptime guarantee, so expect it to drop occasionally — if a link stops responding, kill it and rerun `npm run tunnel` for a fresh one.

either way: this only works while your laptop is on, awake, and the server process is running. closing the lid or losing wifi takes it down for everyone connected.

## socket events (the actual api)

client sends:
| event | payload | you get back |
|---|---|---|
| `create-room` | `{ teamName, playerName }` | `{ room }` or `{ error }` |
| `join-room` | `{ roomCode, playerName }` | `{ room }` or `{ error }` |
| `start-game` | `{}` | `{ ok: true }` or `{ error }` |
| `focus-update` | `{ focused: boolean }` | nothing, just fire it |
| `minigame-complete` | `{}` | nothing |
| `get-leaderboard` | `{}` | `{ entries }` |

server broadcasts to the room:
| event | payload |
|---|---|
| `room-state` | `{ code, teamName, state, players[], ... }` |
| `bomb-tick` | `{ bombBuffer, bombBufferMax, sessionElapsed, sessionDuration, anyUnfocused }` |
| `bomb-exploded` | `{ sessionElapsed }` |
| `bomb-defused` | `{ sessionElapsed }` |
| `minigame-start` | `{ type, timeout }` |
| `minigame-end` | `{}` |
| `leaderboard-update` | `{ entries }` |

## where everything lives

```
src/
  index.js              express + socket.io setup
  config.js             all the tunable numbers (override via env vars)
  rooms/
    RoomManager.js       who's in what room
    BombEngine.js         the actual game loop — buffer drain/regen, mini-games, win/lose
  db/
    leaderboard.js        node:sqlite, writes to leaderboard.db
    schema.sql
  socket/
    handlers.js           hooks socket events up to the room manager / bomb engine
public/
  index.html, client.js   throwaway test client, swap for the real ui
test/
  simulate.js             fake players for testing without a browser
```
