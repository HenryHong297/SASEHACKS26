const num = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);

module.exports = {
  PORT: process.env.PORT || 3000,
  MAX_PLAYERS_PER_ROOM: num('MAX_PLAYERS_PER_ROOM', 5),
  MIN_PLAYERS_PER_ROOM: num('MIN_PLAYERS_PER_ROOM', 2),

  // how long the team has to stay focused to win
  SESSION_DURATION_SECONDS: num('SESSION_DURATION_SECONDS', 180),

  //Bomb logic drain and regen when focused or unfocused 
  BUFFER_MAX_SECONDS: num('BUFFER_MAX_SECONDS', 20),
  BUFFER_DRAIN_PER_TICK: num('BUFFER_DRAIN_PER_TICK', 2), // multiplied by how many players are unfocused right now
  BUFFER_REGEN_PER_TICK: num('BUFFER_REGEN_PER_TICK', 1), // regens this fast while everyone focused

  TICK_INTERVAL_MS: num('TICK_INTERVAL_MS', 1000),
};
