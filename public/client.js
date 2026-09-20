import { FilesetResolver, FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

const socket = io({ transports: ['websocket'] });

const el = (id) => document.getElementById(id);
const log = (msg) => {
  const box = el('log');
  box.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + box.textContent;
};

let focused = true;
let mySocketId = null;
let localStream = null;
let localVideoEl = null;
let detectorReady = false;
let currentRoom = null;

async function ensureLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    localVideoEl = document.createElement('video');
    localVideoEl.autoplay = true;
    localVideoEl.muted = true;
    localVideoEl.playsInline = true;
    localVideoEl.srcObject = localStream;
    attachLocalVideoIfReady(); // picks up the stream without tearing down other players' cards
    initBrowserFocusDetector(localVideoEl); // runs entirely in this browser, no server/python needed
  } catch (e) {
    log(`camera unavailable: ${e.message}`);
  }
  // Whether it succeeded or failed, we now know our own camera state - safe
  // to start/answer peer connections (see the webrtc section below for why
  // this matters).
  localMediaResolved = true;
  const offers = pendingOffers;
  pendingOffers = [];
  offers.forEach((msg) => handleOffer(msg).catch((e) => log(`webrtc offer error: ${e.message}`)));
  if (currentRoom) syncPeerConnections(currentRoom);
  return localStream;
}

// ---- in-browser focus detection (MediaPipe Face Landmarker, runs on-device) ----
// Same algorithm as the ML-Tracking.py prototype (calibrate a "looking at
// screen" baseline, grace period before a look-away counts as a distraction,
// rolling focus score) but ported to JS so it runs automatically in every
// player's own browser - no Python install, no local server, no per-machine setup.
const CALIB_SECONDS = 3;
const GRACE_SECONDS = 3;
const YAW_TOL = 0.35; // in interocular-distance units, not degrees - see headPoseProxy
const PITCH_TOL = 0.35; // in face-height units
const WINDOW_SECONDS = 300;

// landmark indices, same points the ML-Tracking.py prototype used
const LM = { nose: 1, chin: 152, leftEye: 33, rightEye: 263 };

let faceLandmarker = null;
let detectorRunning = false;
let calib = null;
let awaySince = null;
let inDistraction = false;
let distractions = 0;
let focusSamples = [];

const resetCalibration = () => ({ start: performance.now() / 1000, yaws: [], pitches: [], base: null });

const median = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Scale-invariant head-direction proxy from raw landmark positions (avoids
// depending on the exact row/column-major layout of the transformation
// matrix output, which isn't documented and we can't verify without a
// browser to test against). Nose position relative to the eye midpoint,
// normalized by interocular distance/face height, shifts measurably as the
// head turns - not real degrees, but consistent and good enough to compare
// against a calibrated "looking at the screen" baseline.
function headPoseProxy(landmarks) {
  const nose = landmarks[LM.nose];
  const chin = landmarks[LM.chin];
  const leftEye = landmarks[LM.leftEye];
  const rightEye = landmarks[LM.rightEye];

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const interocular = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) || 1e-6;
  const faceHeight = Math.hypot(chin.x - eyeMidX, chin.y - eyeMidY) || 1e-6;

  return {
    yaw: (nose.x - eyeMidX) / interocular,
    pitch: (nose.y - eyeMidY) / faceHeight,
  };
}

async function initBrowserFocusDetector(videoEl) {
  el('focusToggle').textContent = 'Loading focus detector...';
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        delegate: 'CPU', // more consistently supported across teammates' different browsers/hardware than GPU
      },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
  } catch (e) {
    log(`couldn't load in-browser focus detector (${e.message}) - falling back to manual toggle`);
    faceLandmarker = null;
    return;
  }

  detectorReady = true;
  calib = resetCalibration();
  focusSamples = [];
  awaySince = null;
  inDistraction = false;
  distractions = 0;
  detectorRunning = true;
  el('focusToggle').disabled = true;
  log('in-browser focus detector ready - tracking automatically, no python needed');
  requestAnimationFrame(() => detectLoop(videoEl));
}

function detectLoop(videoEl) {
  if (!detectorRunning) return;
  if (videoEl.readyState < 2) {
    requestAnimationFrame(() => detectLoop(videoEl));
    return;
  }

  const now = performance.now() / 1000;
  const result = faceLandmarker.detectForVideo(videoEl, performance.now());
  const pose =
    result.faceLandmarks && result.faceLandmarks.length > 0 ? headPoseProxy(result.faceLandmarks[0]) : null;

  if (!calib.base) {
    const elapsed = now - calib.start;
    if (pose) {
      calib.yaws.push(pose.yaw);
      calib.pitches.push(pose.pitch);
    }
    el('focusToggle').textContent = `Calibrating... look at your screen (${Math.max(0, CALIB_SECONDS - elapsed).toFixed(0)}s)`;
    if (elapsed >= CALIB_SECONDS && calib.yaws.length > 10) {
      calib.base = { yaw: median(calib.yaws), pitch: median(calib.pitches) };
      focusSamples = [];
      awaySince = null;
      inDistraction = false;
    }
  } else {
    const attentive = pose
      ? Math.abs(pose.yaw - calib.base.yaw) < YAW_TOL && Math.abs(pose.pitch - calib.base.pitch) < PITCH_TOL
      : false; // no face in frame counts as away

    if (attentive) {
      awaySince = null;
      inDistraction = false;
    } else {
      if (awaySince === null) awaySince = now;
      if (now - awaySince >= GRACE_SECONDS && !inDistraction) {
        inDistraction = true;
        distractions++;
      }
    }

    const isFocused = !inDistraction;
    focusSamples.push({ t: now, focused: isFocused });
    while (focusSamples.length && now - focusSamples[0].t > WINDOW_SECONDS) focusSamples.shift();
    const focusScore = focusSamples.reduce((s, x) => s + (x.focused ? 1 : 0), 0) / focusSamples.length;

    el('focusToggle').textContent =
      `${isFocused ? 'FOCUSED' : 'LOOKING AWAY'} (auto-tracked - focus score ${Math.round(focusScore * 100)}%, ` +
      `${distractions} distraction${distractions === 1 ? '' : 's'})`;

    if (isFocused !== focused) {
      focused = isFocused;
      socket.emit('focus-update', { focused });
    }
  }

  requestAnimationFrame(() => detectLoop(videoEl));
}

socket.on('connect', () => {
  mySocketId = socket.id;
  log(`connected as ${mySocketId}`);
});

el('createBtn').onclick = () => {
  socket.emit(
    'create-room',
    {
      teamName: el('teamName').value,
      playerName: el('createPlayerName').value,
      isPrivate: el('isPrivateCheckbox').checked,
    },
    (res) => {
      if (res.error) return log(`error: ${res.error}`);
      log(`created bomb defusal team ${res.room.code}`);
      enterGame(res.room);
    }
  );
};

el('joinBtn').onclick = () => joinRoomByCode(el('roomCode').value);

el('startBtn').onclick = () => {
  socket.emit('start-game', {}, (res) => {
    if (res.error) return log(`error: ${res.error}`);
    log('session started');
  });
};

el('focusToggle').onclick = () => {
  if (detectorReady) return; // auto-tracked, manual toggle is disabled
  focused = !focused;
  socket.emit('focus-update', { focused });
  el('focusToggle').textContent = focused
    ? "I'm FOCUSED (click to look away)"
    : "LOOKING AWAY (click to refocus)";
};

function joinRoomByCode(code) {
  socket.emit('join-room', { roomCode: code, playerName: el('playerName').value }, (res) => {
    if (res.error) return log(`error: ${res.error}`);
    log(`joined bomb defusal team ${res.room.code}`);
    enterGame(res.room);
  });
}

function renderRoomList({ rooms }) {
  const listDiv = el('roomList');
  listDiv.innerHTML = '';
  el('roomListEmpty').style.display = rooms.length ? 'none' : 'block';
  rooms.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'roomRow';
    const label = document.createElement('span');
    label.textContent = `${r.teamName} (${r.code}) — ${r.playerCount}/${r.maxPlayers} players`;
    const joinBtn = document.createElement('button');
    joinBtn.textContent = 'Join';
    joinBtn.disabled = r.playerCount >= r.maxPlayers;
    joinBtn.onclick = () => joinRoomByCode(r.code);
    row.appendChild(label);
    row.appendChild(joinBtn);
    listDiv.appendChild(row);
  });
}

socket.on('rooms-list', renderRoomList);

function enterGame(room) {
  el('lobby').classList.add('hidden');
  el('game').classList.remove('hidden');
  el('roomCodeLabel').textContent = room.code;
  el('roundSummary').classList.add('hidden');
  ensureLocalStream();
  renderRoom(room);
}

// Player cards are created once and updated in place, never torn down and
// rebuilt - room-state broadcasts fire constantly (every focus change from
// every player), and repeatedly removing/reinserting a live <video> element
// on every re-render made browsers stop actually painting it, even though
// the underlying stream kept feeding frames to the detector just fine.
const playerCards = new Map(); // playerId -> { card, cam, name }

function attachLocalVideoIfReady() {
  if (!localVideoEl) return;
  const entry = playerCards.get(mySocketId);
  if (entry && !entry.cam.contains(localVideoEl)) {
    entry.cam.textContent = '';
    entry.cam.appendChild(localVideoEl);
  }
}

// ---- peer-to-peer video between players (WebRTC, mesh topology) ----
// The server only relays signaling messages (webrtc-offer/answer/ice-
// candidate) between two specific sockets in the same room - it never
// touches the actual video. Whoever has the lexicographically smaller
// socket id always initiates a given connection, so both sides agree on
// who calls whom without extra coordination. Connections are only ever
// set up once BOTH sides have resolved their own camera permission
// (granted or denied) - deliberately sidesteps WebRTC renegotiation
// entirely, since we can't test that against a real browser here; the
// tradeoff is a peer's video only appears once whichever of you is
// slower to grant camera permission finishes doing so.
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const peerConnections = new Map(); // otherPlayerId -> RTCPeerConnection
const remoteVideoEls = new Map(); // otherPlayerId -> video element
let localMediaResolved = false;
let pendingOffers = [];

function attachRemoteVideoIfReady(otherId) {
  const videoEl = remoteVideoEls.get(otherId);
  const entry = playerCards.get(otherId);
  if (videoEl && entry && !entry.cam.contains(videoEl)) {
    entry.cam.textContent = '';
    entry.cam.appendChild(videoEl);
  }
}

function getOrCreatePeerConnection(otherId) {
  let pc = peerConnections.get(otherId);
  if (pc) return pc;

  pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections.set(otherId, pc);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-ice-candidate', { to: otherId, candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    let videoEl = remoteVideoEls.get(otherId);
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      remoteVideoEls.set(otherId, videoEl);
    }
    videoEl.srcObject = e.streams[0];
    attachRemoteVideoIfReady(otherId);
  };

  return pc;
}

async function initiateConnection(otherId) {
  const pc = getOrCreatePeerConnection(otherId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { to: otherId, sdp: pc.localDescription });
}

async function handleOffer({ from, sdp }) {
  const pc = getOrCreatePeerConnection(from);
  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: from, sdp: pc.localDescription });
}

function closePeerConnection(otherId) {
  const pc = peerConnections.get(otherId);
  if (pc) pc.close();
  peerConnections.delete(otherId);
  remoteVideoEls.delete(otherId);
}

socket.on('webrtc-offer', (msg) => {
  if (!localMediaResolved) {
    pendingOffers.push(msg); // wait until we know our own camera state before answering
    return;
  }
  handleOffer(msg).catch((e) => log(`webrtc offer error: ${e.message}`));
});

socket.on('webrtc-answer', async ({ from, sdp }) => {
  const pc = peerConnections.get(from);
  if (pc) await pc.setRemoteDescription(sdp);
});

socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
  const pc = peerConnections.get(from);
  if (pc && candidate) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      log(`ice candidate error: ${e.message}`);
    }
  }
});

function syncPeerConnections(room) {
  if (!localMediaResolved) return; // wait until we know our own camera state before calling anyone
  const roomPlayerIds = new Set(room.players.map((p) => p.id));

  room.players.forEach((p) => {
    if (p.id === mySocketId || peerConnections.has(p.id)) return;
    if (mySocketId < p.id) {
      initiateConnection(p.id).catch((e) => log(`webrtc connect error: ${e.message}`));
    }
  });

  for (const id of peerConnections.keys()) {
    if (!roomPlayerIds.has(id)) closePeerConnection(id);
  }
}

function renderRoom(room) {
  currentRoom = room;
  el('stateLabel').textContent = room.state + (room.isPrivate ? ' (private)' : '');
  const playersDiv = el('players');
  const seen = new Set();

  room.players.forEach((p) => {
    seen.add(p.id);
    let entry = playerCards.get(p.id);
    if (!entry) {
      const card = document.createElement('div');
      const cam = document.createElement('div');
      cam.className = 'cameraBox';
      cam.textContent = '📷'; // placeholder until their video connects (or ours, if it's our own card)
      const name = document.createElement('div');
      name.className = 'playerName';
      card.appendChild(cam);
      card.appendChild(name);
      playersDiv.appendChild(card);
      entry = { card, cam, name };
      playerCards.set(p.id, entry);
    }
    entry.card.className = 'playerCard' + (p.focused ? '' : ' unfocused');
    entry.name.textContent = p.name + (p.id === mySocketId ? ' (you)' : '');
  });

  for (const [id, entry] of playerCards) {
    if (!seen.has(id)) {
      entry.card.remove();
      playerCards.delete(id);
      closePeerConnection(id);
    }
  }

  attachLocalVideoIfReady();
  room.players.forEach((p) => {
    if (p.id !== mySocketId) attachRemoteVideoIfReady(p.id);
  });
  syncPeerConnections(room);
}

socket.on('room-state', renderRoom);

const formatClock = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

socket.on('bomb-tick', ({ bombBuffer, bombBufferMax, sessionElapsed, unfocusedCount }) => {
  el('bombFill').style.width = `${(bombBuffer / bombBufferMax) * 100}%`;
  el('sessionTimer').textContent = formatClock(sessionElapsed);
  el('bufferTimer').textContent =
    unfocusedCount > 0 ? `${bombBuffer}s until it blows (${unfocusedCount} unfocused)` : `${bombBuffer}s until it blows`;
});

function renderRoundSummary({ players, mvp, weakLink }) {
  const list = el('statsList');
  list.innerHTML = '';
  const sorted = [...players].sort((a, b) => a.unfocusedSeconds - b.unfocusedSeconds);
  sorted.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'statRow';
    let badge = '';
    if (p.id === mvp.id) {
      badge = '<span class="badge mvp">MVP — most focused</span>';
    } else if (p.id === weakLink.id && weakLink.unfocusedSeconds > 0 && weakLink.id !== mvp.id) {
      badge = '<span class="badge weak">Weak Link — most unfocused</span>';
    }
    row.innerHTML = `<span>${p.name}${p.id === mySocketId ? ' (you)' : ''}</span><span>${p.unfocusedSeconds}s unfocused ${badge}</span>`;
    list.appendChild(row);
  });
  el('roundSummary').classList.remove('hidden');
}

socket.on('bomb-exploded', (data) => {
  log('BOOM! The bomb exploded. Someone lost focus too long.');
  renderRoundSummary(data);
});

socket.on('leaderboard-update', ({ entries }) => {
  const list = el('leaderboard');
  list.innerHTML = '';
  entries.forEach((e) => {
    const li = document.createElement('li');
    li.textContent = `${e.teamName} — survived ${e.survivalSeconds}s (${e.playerCount} players)`;
    list.appendChild(li);
  });
});
