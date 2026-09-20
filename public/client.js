const socket = io({ transports: ['websocket'] });

const el = (id) => document.getElementById(id);
const log = (msg) => {
  const box = el('log');
  box.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + box.textContent;
};

let focused = true;
let mySocketId = null;
let localStream = null;
let lastRoom = null;

async function ensureLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (lastRoom) renderRoom(lastRoom); // refresh so our camera box picks up the stream
  } catch (e) {
    log(`camera unavailable: ${e.message}`);
  }
  return localStream;
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

function renderRoom(room) {
  lastRoom = room;
  el('stateLabel').textContent = room.state + (room.isPrivate ? ' (private)' : '');
  const playersDiv = el('players');
  playersDiv.innerHTML = '';
  room.players.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'playerCard' + (p.focused ? '' : ' unfocused');

    const cam = document.createElement('div');
    cam.className = 'cameraBox';
    if (p.id === mySocketId && localStream) {
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = localStream;
      cam.appendChild(video);
    } else {
      // placeholder until real peer video streaming is wired up
      cam.textContent = '📷';
    }

    const name = document.createElement('div');
    name.className = 'playerName';
    name.textContent = p.name + (p.id === mySocketId ? ' (you)' : '');

    card.appendChild(cam);
    card.appendChild(name);
    playersDiv.appendChild(card);
  });
}

socket.on('room-state', renderRoom);

const formatClock = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

socket.on('bomb-tick', ({ bombBuffer, bombBufferMax, sessionElapsed, sessionDuration, unfocusedCount }) => {
  el('bombFill').style.width = `${(bombBuffer / bombBufferMax) * 100}%`;
  el('sessionFill').style.width = `${(sessionElapsed / sessionDuration) * 100}%`;
  el('sessionTimer').textContent = `${formatClock(sessionElapsed)} / ${formatClock(sessionDuration)}`;
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
socket.on('bomb-defused', (data) => {
  log('Session complete! Bomb defused.');
  renderRoundSummary(data);
});

socket.on('leaderboard-update', ({ entries }) => {
  const list = el('leaderboard');
  list.innerHTML = '';
  entries.forEach((e) => {
    const li = document.createElement('li');
    li.textContent = `${e.teamName} — ${e.survivalSeconds}s — ${e.defused ? 'DEFUSED' : 'exploded'} (${e.playerCount} players)`;
    list.appendChild(li);
  });
});
