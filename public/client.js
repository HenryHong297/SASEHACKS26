// polling transport gets stuck through localtunnel (concurrent POST+GET
// confuses its free tunnel), so skip straight to websocket
const socket = io({ transports: ['websocket'] });

const el = (id) => document.getElementById(id);
const log = (msg) => {
  const box = el('log');
  box.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + box.textContent;
};

let focused = true;
let mySocketId = null;

socket.on('connect', () => {
  mySocketId = socket.id;
  log(`connected as ${mySocketId}`);
});

el('createBtn').onclick = () => {
  socket.emit('create-room', { teamName: el('teamName').value, playerName: el('createPlayerName').value }, (res) => {
    if (res.error) return log(`error: ${res.error}`);
    log(`created bomb defusal team ${res.room.code}`);
    enterGame(res.room);
  });
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
  renderRoom(room);
}

function renderRoom(room) {
  el('stateLabel').textContent = room.state;
  const playersDiv = el('players');
  playersDiv.innerHTML = '';
  room.players.forEach((p) => {
    const span = document.createElement('span');
    span.className = 'player' + (p.focused ? '' : ' unfocused');
    span.textContent = p.name + (p.id === mySocketId ? ' (you)' : '');
    playersDiv.appendChild(span);
  });
}

socket.on('room-state', renderRoom);

const formatClock = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

socket.on('bomb-tick', ({ bombBuffer, bombBufferMax, sessionElapsed, sessionDuration }) => {
  el('bombFill').style.width = `${(bombBuffer / bombBufferMax) * 100}%`;
  el('sessionFill').style.width = `${(sessionElapsed / sessionDuration) * 100}%`;
  el('sessionTimer').textContent = `${formatClock(sessionElapsed)} / ${formatClock(sessionDuration)}`;
  el('bufferTimer').textContent = `${bombBuffer}s until it blows`;
});

socket.on('bomb-exploded', () => log('BOOM! The bomb exploded. Someone lost focus too long.'));
socket.on('bomb-defused', () => log('Session complete! Bomb defused.'));

socket.on('leaderboard-update', ({ entries }) => {
  const list = el('leaderboard');
  list.innerHTML = '';
  entries.forEach((e) => {
    const li = document.createElement('li');
    li.textContent = `${e.teamName} — ${e.survivalSeconds}s — ${e.defused ? 'DEFUSED' : 'exploded'} (${e.playerCount} players)`;
    list.appendChild(li);
  });
});
