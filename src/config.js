const num = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);

module.exports = {
  PORT: process.env.PORT || 3000,
  MAX_PLAYERS_PER_ROOM: num('MAX_PLAYERS_PER_ROOM', 5),
  MIN_PLAYERS_PER_ROOM: num('MIN_PLAYERS_PER_ROOM', 2),

  //Bomb logic drain and regen when focused or unfocused
  BUFFER_MAX_SECONDS: num('BUFFER_MAX_SECONDS', 20),
  BUFFER_DRAIN_PER_TICK: num('BUFFER_DRAIN_PER_TICK', 2), // multiplied by how many players are unfocused right now
  BUFFER_REGEN_PER_TICK: num('BUFFER_REGEN_PER_TICK', 1), // regens this fast while everyone focused
  BUFFER_DRAIN_ESCALATION_MAX: num('BUFFER_DRAIN_ESCALATION_MAX', 8), // drain speed multiplier once buffer is empty (1 = no escalation, ramps up sharply as buffer nears 0 - see BombEngine._tick)

  TICK_INTERVAL_MS: num('TICK_INTERVAL_MS', 1000),
};
