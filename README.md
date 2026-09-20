# Controlled Charge — Server

The idea: 2-5 people join a team, there's a shared "bomb" in the middle, and it only starts getting dangerous if someone stops paying attention (looks down or away from their screen) — the more people looking away at once, the faster it drains. There's no time limit — the session just runs forever, and the goal is to survive as long as possible before someone's unfocus streak blows it up. Longest survival time goes on the leaderboard. Teams can be public (shown on the home page, click to join) or private (only joinable if you have the code).

This repo is just the server side — Node + Socket.IO. There's also a barebones test page in here so you can mess with the game logic. Focus detection is real, not a placeholder: it runs on-device in each player's own browser via MediaPipe — see "real focus detection" below.

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
3. each tab will prompt for camera access — allow it. This isn't just a preview: your browser starts genuinely detecting whether you're looking at the screen (see "real focus detection" below), no extra setup needed
4. hit "Start Session" once you've got 2+ people in — it runs indefinitely, no timer to hit
5. look away from your screen for a few seconds in one tab — watch the bomb bar drain live in every tab at once, faster the more people are "unfocused" simultaneously. (If camera access was denied or the detector failed to load, that tab falls back to a manual "I'm FOCUSED" toggle button instead.)
6. it only ends when it explodes — a round summary shows everyone's total unfocused time, tagging the MVP (least unfocused) and Weak Link (most unfocused), and the leaderboard updates with how long you survived

### testing without opening a browser

`test/simulate.js` fakes a bunch of players over socket.io and randomly toggles their focus, so you can watch the bomb logic play out in a terminal instead of clicking through tabs:

```powershell
npm start
npm run simulate -- --players=4 --unfocusChance=0.05
```

Crank `unfocusChance` up (like 0.3) to force an explosion quickly for testing — there's no time limit, so left at 0 it'll just run forever.

## real focus detection (webcam, not the manual toggle)

Focus detection runs **entirely in each player's own browser** — no install, no separate terminal, no per-player setup. The moment you grant camera access, `public/client.js` loads MediaPipe's Face Landmarker (via `@mediapipe/tasks-vision`, straight from a CDN, on-device — no server or network round-trip once it's loaded) and:

1. Calibrates a "looking at the screen" baseline over the first few seconds (look at your screen normally)
2. Every frame, checks whether your head position has drifted from that baseline past a tolerance
3. Only counts it as a distraction after a short grace period, so quick glances away don't hurt you
4. Calls `socket.emit('focus-update', ...)` whenever your focused/unfocused state actually changes — the exact same event the manual toggle button uses, so the server and `BombEngine` don't know or care where the signal came from

While it's active, the "Your Focus" button becomes a disabled live readout (`FOCUSED (auto-tracked - focus score 92%, 1 distraction)` etc.) instead of something you click, and your own camera box on the game page shows your live video feed.

If camera permission is denied, or the detector fails to load (offline, CDN blocked, etc.), it falls back cleanly to the manual toggle button — nothing crashes, you just click it yourself instead.

Notes:
- Needs a **secure context** — works on `localhost` or any `https://` url (the ngrok tunnel, a real deploy), but browsers block `getUserMedia` entirely on a plain `http://<LAN-IP>:3000` link. See the callout further down.
- The head-direction math is a simple, scale-invariant proxy from raw landmark positions (nose position relative to the eye midpoint, normalized by interocular distance), not real yaw/pitch degrees — deliberately avoids depending on the exact matrix layout MediaPipe's transformation-matrix output uses, which isn't documented and wasn't practical to verify without a browser in the loop while building this. It's calibrated per-person per-session, so the units don't need to mean anything universal, just be consistent.
- Tunable constants are in `public/client.js`: `CALIB_SECONDS`, `GRACE_SECONDS`, `YAW_TOL`/`PITCH_TOL`, `WINDOW_SECONDS`.
- This only runs locally in your browser — no video or focus data is ever sent anywhere except the plain `{focused: true/false}` signal to the game server, same as the manual toggle always did.

### ML-Tracking.py (optional standalone alternative)

`ML-Tracking.py` is a separate, earlier prototype of the same idea, built in Python with OpenCV — same calibration/grace-period/rolling-score approach, ported to MediaPipe's Tasks API. It's no longer required for the game (the browser does its own detection now), but it still works standalone if you want a Python-side experiment or a second opinion on your focus score:

```powershell
pip install -r requirements.txt
python ML-Tracking.py
```

It doesn't open a desktop window — it streams its annotated video (FOCUSED/UNFOCUSED overlay burned into the frame) over a local MJPEG endpoint at `http://localhost:8765/video`, and its JSON reading at `http://localhost:8765/focus`, purely for standalone viewing/debugging. It's not currently wired into the game page (that integration was replaced by the in-browser detector above). In the terminal, type `r` + Enter to force a recalibration, `q` + Enter (or Ctrl+C) to quit. First run downloads `face_landmarker.task` (~4MB, Google's official model asset) and caches it next to the script.

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

Real focus detection needs `getUserMedia`, which browsers only allow over **https** or on **localhost** — it silently fails to `http://<LAN-IP>:3000` (plain http). So it works when testing at `localhost:3000` or through the https tunnel/deploy url, but not over a bare LAN IP (that tab just falls back to the manual toggle instead).

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
  index.html, client.js   test client - client.js does real in-browser focus detection (MediaPipe), swap the UI for the real one whenever
test/
  simulate.js             fake players for testing without a browser
ML-Tracking.py            optional standalone Python focus tracker (not wired into the game anymore)
requirements.txt          pip deps for ML-Tracking.py, if you use it
```
