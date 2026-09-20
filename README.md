# Controlled Charge — Server

The idea: 2-5 people join a team, there's a shared "bomb" in the middle, and it only starts getting dangerous if someone stops paying attention (looks down or away from their screen) — the more people looking away at once, the faster it drains. There's no time limit — the session just runs forever, and the goal is to survive as long as possible before someone's unfocus streak blows it up. Longest survival time goes on the leaderboard. Teams can be public (shown on the home page, click to join) or private (only joinable if you have the code).

This repo is just the server side — Node + Socket.IO. There's also a barebones test page in here so you can mess with the game logic, plus a real webcam focus tracker (`ML-Tracking.py`) that plugs into it — see "real focus detection" below.

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

1. tab 1 hits "Create Bomb Defusal Team"
2. everyone else sees it show up under "Active Bomb Defusal Teams" and clicks "Join" (or types the team code manually)
3. each tab will prompt for camera access (unless you're running the real tracker — see below), allow it
4. hit "Start Session" once you've got 2+ people in — it runs indefinitely, no timer to hit
5. click "I'm FOCUSED" in a tab to fake looking away — watch the bomb bar drain live in every tab at once, faster the more tabs are "unfocused" simultaneously
6. it only ends when it explodes — a round summary shows everyone's total unfocused time, tagging the MVP (least unfocused) and Weak Link (most unfocused), and the leaderboard updates with how long you survived

### testing without opening a browser

`test/simulate.js` fakes a bunch of players over socket.io and randomly toggles their focus, so you can watch the bomb logic play out in a terminal instead of clicking through tabs:

```powershell
npm start
npm run simulate -- --players=4 --unfocusChance=0.05
```

Crank `unfocusChance` up (like 0.3) to force an explosion quickly for testing — there's no time limit, so left at 0 it'll just run forever.

## real focus detection (webcam, not the manual toggle)

`ML-Tracking.py` is a real webcam focus tracker — MediaPipe Face Mesh reads your head pose, calibrates a "looking at the screen" baseline, and flags you as unfocused if you look away past a grace period. It plugs into the game with **zero server changes**: it serves its live reading on a local HTTP endpoint, and `public/client.js` polls that endpoint and forwards it through the exact same `focus-update` event the manual toggle button uses.

```powershell
pip install -r requirements.txt
python ML-Tracking.py
```

Then open the game in your browser as usual (`http://localhost:3000` or the tunnel url) and join/create a team. On load, the page checks `http://localhost:8765/focus` for about a second — if `ML-Tracking.py` is already running, it skips asking for camera permission (avoids two things fighting over your one webcam) and the "Your Focus" button becomes a live readout instead of something you click. If it's not running yet, everything falls back to the manual toggle + browser camera preview exactly like before, and it'll pick up the tracker automatically if you start it a bit later (checked every second).

Notes:
- Start `ML-Tracking.py` **before** opening/joining the game in the browser to avoid a brief moment where both try to grab the camera.
- The first few seconds are calibration ("look at your screen normally") — readings during that window aren't sent to the game.
- `--camera N` picks a different webcam if you have more than one, `--yaw-tol`/`--pitch-tol` loosen or tighten how far you can turn your head before it counts as looking away. Run `python ML-Tracking.py --help` for the full list.
- This only tracks *your own* focus locally — it doesn't send video anywhere, just a `{focused, focusScore, distractions, calibrating}` reading to your own browser tab on the same machine.

## demoing it live

### option A: deploy it for real

Tunneling from a laptop (option B) is flaky — free tunnel services can drop randomly, and the whole thing dies if your laptop sleeps or loses wifi. Deploying to Render gives a url that just works, independent of your laptop:

1. push to GitHub
2. go to https://dashboard.render.com/blueprints and connect the repo — Render reads `render.yaml` in the root and configures the build/start commands and Node version automatically
3. click deploy, wait ~2-3 min for the first build. you'll get a permanent url like `https://controlled-charge-server.onrender.com`

heads up: free tier disk is wiped on every redeploy so `leaderboard.db` won't persist across deploys, and free tier services spin down after 15 min idle (takes ~30s to wake on the next request — ping it yourself before a demo).

### option B: tunnel from your laptop

- **same wifi:** run the server, everyone connects to `http://<your laptop's LAN IP>:3000` (find your IP with `ipconfig`)
- **outside your wifi:** use a tunnel so people hit a public url that forwards to your laptop:

  ```powershell
  npm run tunnel
  ```

  this uses ngrok with a free static domain (set in the `tunnel` script) — requires `ngrok config add-authtoken <your token>` once on the machine (free account at ngrok.com). first-time visitors hit an ngrok interstitial page, that's normal, they click through once. `npm run tunnel:localtunnel` is a no-account fallback but drops more often.

  either way this only works while your laptop is on, awake, and the server process is running.

### heads up: camera requires a secure context

The camera view in the test client uses `getUserMedia`, which browsers only allow over **https** or on **localhost** — it silently fails to `http://<LAN-IP>:3000` (plain http). So camera works when testing at `localhost:3000` or through the https tunnel/deploy url, but not over a bare LAN IP.

## socket events (the actual api)

client sends:
| event | payload | you get back |
|---|---|---|
| `list-rooms` | `{}` | `{ rooms }` — joinable (lobby-state) rooms only |
| `create-room` | `{ teamName, playerName, isPrivate }` | `{ room }` or `{ error }` |
| `join-room` | `{ roomCode, playerName }` | `{ room }` or `{ error }` |
| `start-game` | `{}` | `{ ok: true }` or `{ error }` |
| `focus-update` | `{ focused: boolean }` | nothing, just fire it |
| `get-leaderboard` | `{}` | `{ entries }` |

server broadcasts:
| event | scope | payload |
|---|---|---|
| `rooms-list` | everyone connected | `{ rooms: [{ code, teamName, playerCount, maxPlayers }] }` — public, lobby-state rooms only; sent on connect and whenever the list changes |
| `room-state` | the room | `{ code, teamName, isPrivate, state, players: [{ id, name, focused, unfocusedSeconds }], ... }` |
| `bomb-tick` | the room | `{ bombBuffer, bombBufferMax, sessionElapsed, anyUnfocused, unfocusedCount }` — no target duration, `sessionElapsed` just counts up forever |
| `bomb-exploded` | the room | `{ sessionElapsed, players, mvp, weakLink }` — round summary, see below. This is the only way a round ends. |
| `leaderboard-update` | the room | `{ entries }` — `entries` is `[{ teamName, survivalSeconds, playerCount, createdAt }]`, sorted longest survival first |

`players` in the round summary is `[{ id, name, unfocusedSeconds }]` for everyone in the room. `mvp` is whoever had the least unfocused time, `weakLink` is whoever had the most — both are single `{ id, name, unfocusedSeconds }` objects picked from that same array, so you can match by `id`.

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
ML-Tracking.py            real webcam focus tracker (Python) - serves live readings on :8765/focus
requirements.txt          pip deps for ML-Tracking.py
```
