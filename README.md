# Controlled Charge — Server

A real-time, focus-powered group game. 2-5 players join a room; a shared
"bomb" has a danger buffer that drains when *anyone* looks away from their
screen and refills when everyone's focused. Periodic study-break mini-games
interrupt the session. Survive the full session length to defuse; let the
buffer hit zero and it explodes. Results go on a leaderboard.

This repo is the **server only** — a Node.js + Socket.IO backend, plus a
minimal test client so you can exercise the game logic before the real
webcam-based focus detection UI is ready.

## Requirements

- Node.js **22.5+** (this project uses the built-in `node:sqlite` module —
  no native build tools required, which matters on hackathon laptops without
  Visual Studio installed). Check with `node -v`.

## Setup

```powershell
git clone <your-repo-url>
cd Contolled-Charge-Server
npm install
copy .env.example .env    # optional, defaults work out of the box
npm run dev                 # starts on http://localhost:3000, auto-restarts on file changes
```

Open `http://localhost:3000` in two or more browser tabs (or on two laptops
on the same WiFi, using your machine's LAN IP instead of `localhost`) to
manually test:

1. Tab 1: "Create Room" with a team name.
2. Tab 2+: "Join Room" using the room code shown in tab 1.
3. Once 2+ players joined, click "Start Session" in any tab.
4. Click "I'm FOCUSED" to toggle looking away and watch the bomb buffer bar
   drain/refill live across all tabs.
5. Every `MINIGAME_INTERVAL_SECONDS` (45s by default) a mini-game prompt
   appears in all tabs — click "Complete it!" in each to resume.
6. Session ends in either `bomb-exploded` or `bomb-defused`, and the
   leaderboard updates.

### Automated testing (no browser needed)

`test/simulate.js` spins up N fake players over Socket.IO, joins them into
one room, starts the session, and randomly toggles focus:

```powershell
npm start                                              # in one terminal
npm run simulate -- --players=4 --unfocusChance=0.05   # in another
```

Tune `--unfocusChance` (0-1, probability per player per tick) to force an
explosion (try `0.3`) or a clean defuse (try `0`). For fast iteration, shrink
the timers via env vars so you don't wait 3 minutes per run:

```powershell
$env:SESSION_DURATION_SECONDS=15; $env:MINIGAME_INTERVAL_SECONDS=5; npm run dev
```

## Team setup (2-5 people)

1. One person creates the GitHub repo and pushes this scaffold.
2. Everyone else: `git clone`, `npm install`, then work off feature
   branches (`git checkout -b feat/webcam-focus-detection`, etc.) and PR
   into `main`.
3. Suggested split of remaining work:
   - **Server/game logic (this repo)**: tune bomb feel, room edge cases
     (reconnects, disconnect mid-game), leaderboard queries.
   - **Focus detection (client-side)**: use `face-api.js` or MediaPipe
     FaceMesh in the browser to detect "looking away" (head pose / gaze /
     eyes-closed), and call `socket.emit('focus-update', { focused })` —
     see `public/client.js` for the exact contract already wired up.
   - **UI/UX**: replace `public/index.html`/`client.js` with the real bomb
     visual, timer animation, mini-game graphics, and leaderboard screen.
     The Socket.IO event contract below is your API — build against it.
4. Agree on one person "owning" `src/config.js` values so the game doesn't
   feel different every time someone tweaks it before the demo.

## Running for a live demo

- Fastest: run the server on one laptop, everyone connects to
  `http://<that-laptop's-LAN-IP>:3000` over the venue WiFi.
- If judges need to join from outside the LAN, tunnel it:
  `npx localtunnel --port 3000` or `ngrok http 3000`.

## Socket.IO event contract

Client → server:
| Event | Payload | Ack response |
|---|---|---|
| `create-room` | `{ teamName, playerName }` | `{ room }` or `{ error }` |
| `join-room` | `{ roomCode, playerName }` | `{ room }` or `{ error }` |
| `start-game` | `{}` | `{ ok: true }` or `{ error }` |
| `focus-update` | `{ focused: boolean }` | — |
| `minigame-complete` | `{}` | — |
| `get-leaderboard` | `{}` | `{ entries }` |

Server → client (broadcast to room):
| Event | Payload |
|---|---|
| `room-state` | `{ code, teamName, state, bombTimeRemaining... , players[] }` |
| `bomb-tick` | `{ bombBuffer, bombBufferMax, sessionElapsed, sessionDuration, anyUnfocused }` |
| `bomb-exploded` | `{ sessionElapsed }` |
| `bomb-defused` | `{ sessionElapsed }` |
| `minigame-start` | `{ type, timeout }` |
| `minigame-end` | `{}` |
| `leaderboard-update` | `{ entries }` |

## Project structure

```
src/
  index.js              Express + Socket.IO bootstrap
  config.js             All tunable game constants (env-overridable)
  rooms/
    RoomManager.js       Room/player lifecycle (create/join/leave, in-memory)
    BombEngine.js         Per-room tick loop: buffer drain/regen, minigames, win/lose
  db/
    leaderboard.js        node:sqlite wrapper (writes to leaderboard.db)
    schema.sql
  socket/
    handlers.js           Wires socket events to RoomManager/BombEngine
public/
  index.html, client.js   Minimal manual test client (swap for real UI)
test/
  simulate.js             Headless multi-client simulator
```
