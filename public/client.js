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
    log(`created room ${res.room.code}`);
    enterGame(res.room);
  });
};

el('joinBtn').onclick = () => {
  socket.emit(
    'join-room',
    { roomCode: el('roomCode').value, playerName: el('playerName').value },
    (res) => {
      if (res.error) return log(`error: ${res.error}`);
      log(`joined room ${res.room.code}`);
      enterGame(res.room);
    }
  );
};

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

el('minigameCompleteBtn').onclick = () => {
  socket.emit('minigame-complete');
  el('minigame').style.display = 'none';
};

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

socket.on('minigame-start', ({ type, timeout }) => {
  el('minigameType').textContent = type;
  el('minigame').style.display = 'block';
  log(`minigame started: ${type} (${timeout}s)`);
});

socket.on('minigame-end', () => {
  el('minigame').style.display = 'none';
  log('minigame ended, back to focus mode');
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
