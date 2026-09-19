const num = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);

module.exports = {
  PORT: process.env.PORT || 3000,
  MAX_PLAYERS_PER_ROOM: num('MAX_PLAYERS_PER_ROOM', 5),
  MIN_PLAYERS_PER_ROOM: num('MIN_PLAYERS_PER_ROOM', 2),

  // Total time the team must stay "in session" to win (defuse).
  SESSION_DURATION_SECONDS: num('SESSION_DURATION_SECONDS', 180),

  // The bomb's danger buffer: full when everyone is focused, drains when
  // anyone looks away. Hits 0 -> explosion -> loss.
  BUFFER_MAX_SECONDS: num('BUFFER_MAX_SECONDS', 20),
  BUFFER_DRAIN_PER_TICK: num('BUFFER_DRAIN_PER_TICK', 2), // drains this fast while >=1 player unfocused
  BUFFER_REGEN_PER_TICK: num('BUFFER_REGEN_PER_TICK', 1), // regens this fast while everyone focused

  TICK_INTERVAL_MS: num('TICK_INTERVAL_MS', 1000),

  // Study-break mini-games interrupt the session on a timer.
  MINIGAME_INTERVAL_SECONDS: num('MINIGAME_INTERVAL_SECONDS', 45),
  MINIGAME_TIMEOUT_SECONDS: num('MINIGAME_TIMEOUT_SECONDS', 15),
};
