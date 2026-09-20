# Controlled Charge — Server

The idea: 2-5 people join a room, there's a shared "bomb" in the middle, and it only starts getting dangerous if someone stops paying attention (looks down or away from their screen). Stay locked in as a team long enough and you defuse it. Runs go on a leaderboard. The lobby shows open rooms so people can just click "Join" instead of needing a room code passed around.

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
2. everyone else sees it show up under "Active Rooms" and clicks "Join" (or types the room code manually)
3. hit "Start Session" once you've got 2+ people in
4. click "I'm FOCUSED" in a tab to fake looking away — watch the bomb bar drain live in every tab at once
5. it ends in either boom or defused, leaderboard updates either way

### testing without opening a browser

`test/simulate.js` fakes a bunch of players over socket.io and randomly toggles their focus, so you can watch the bomb logic play out in a terminal instead of clicking through tabs:

```powershell
npm start
npm run simulate -- --players=4 --unfocusChance=0.05
```

Crank `unfocusChance` up (like 0.3) to force an explosion, or down to 0 to watch it survive to the end. Also, don't wait 3 minutes every time you test — shrink the session length:

```powershell
$env:SESSION_DURATION_SECONDS=15; npm run dev
```

## splitting up the work

1. clone it, branch off (`git checkout -b feat/whatever-youre-doing`), PR into `main`
2. rough split:
   - **server (this repo)** — tuning how the bomb feels, handling people disconnecting mid-game, leaderboard stuff
   - **focus detection (client side)** — face-api.js or MediaPipe in the browser to figure out when someone's looking away, then just call `socket.emit('focus-update', { focused })`. `public/client.js` already does this, copy the pattern
   - **UI** — replace the ugly test page with real bomb visuals, a timer animation, a leaderboard screen. The socket events below are basically your API, build against those
3. pick one person to own the numbers in `src/config.js` so the game doesn't feel completely different every time someone tweaks it right before the demo

## demoing it live

### option A: deploy it for real (recommended)

Tunneling from a laptop (option B) is flaky — localtunnel's free service drops randomly, sometimes multiple times an hour, and the whole thing dies if your laptop sleeps or loses wifi. Deploy to Render instead for a url that just works:

1. push to GitHub (already done if you're reading this from the repo)
2. go to https://dashboard.render.com/blueprints and connect this repo — Render reads `render.yaml` in the root and configures the build/start commands and Node version automatically
3. click deploy, wait ~2-3 min for the first build. you'll get a permanent url like `https://controlled-charge-server.onrender.com`

heads up:
- free tier disk is wiped on every redeploy/restart, so `leaderboard.db` won't persist across deploys — fine for a demo, just don't expect leaderboard history to survive you pushing a fix mid-event
- free tier services spin down after 15 min with no traffic and take ~30s to wake back up on the next request — ping the url yourself right before your demo slot so it's already awake

### option B: tunnel from your laptop

- **same wifi:** run the server, everyone connects to `http://<your laptop's LAN IP>:3000` (find your IP with `ipconfig`)
- **outside your wifi** (or venue wifi blocks device-to-device traffic): use a tunnel so people hit a public url that forwards to your laptop:

  ```powershell
  npm run tunnel
  ```

  this uses ngrok with a free static domain (`geologic-tinfoil-evade.ngrok-free.dev`), not localtunnel — ngrok's free tier lets you claim one fixed domain that doesn't change every time you restart, and its connection is meaningfully more reliable than localtunnel's (which kept randomly 502/503ing on us). requires `ngrok config add-authtoken <your token>` to have been run once on the machine (free account at ngrok.com, no credit card). first-time visitors hit an ngrok interstitial page ("you are about to visit...") — that's normal, they click through once.

  if you don't have ngrok set up on a given machine, `npm run tunnel:localtunnel` falls back to the old localtunnel approach — no account needed, but expect it to drop occasionally since it's a free shared proxy with no uptime guarantee.

  either way: this only works while your laptop is on, awake, and the server process is running. closing the lid or losing wifi takes it down for everyone connected.

## socket events (the actual api)

client sends:
| event | payload | you get back |
|---|---|---|
| `list-rooms` | `{}` | `{ rooms }` — joinable (lobby-state) rooms only |
| `create-room` | `{ teamName, playerName }` | `{ room }` or `{ error }` |
| `join-room` | `{ roomCode, playerName }` | `{ room }` or `{ error }` |
| `start-game` | `{}` | `{ ok: true }` or `{ error }` |
| `focus-update` | `{ focused: boolean }` | nothing, just fire it |
| `get-leaderboard` | `{}` | `{ entries }` |

server broadcasts:
| event | scope | payload |
|---|---|---|
| `rooms-list` | everyone connected | `{ rooms: [{ code, teamName, playerCount, maxPlayers }] }` — sent on connect and whenever the joinable list changes |
| `room-state` | the room | `{ code, teamName, state, players[], ... }` |
| `bomb-tick` | the room | `{ bombBuffer, bombBufferMax, sessionElapsed, sessionDuration, anyUnfocused }` |
| `bomb-exploded` | the room | `{ sessionElapsed }` |
| `bomb-defused` | the room | `{ sessionElapsed }` |
| `leaderboard-update` | the room | `{ entries }` |

## where everything lives

```
src/
  index.js              express + socket.io setup
  config.js             all the tunable numbers (override via env vars)
  rooms/
    RoomManager.js       who's in what room
    BombEngine.js         the actual game loop — buffer drain/regen, win/lose
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
