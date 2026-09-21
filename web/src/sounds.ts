// Small synthesized sound effects via the Web Audio API - no asset files to
// ship/license, just oscillators/noise bursts. Respects a muted preference
// stored in localStorage (per-browser convenience, not shared game state).

let ctx: AudioContext | null = null
let muted = readMuted()

function readMuted(): boolean {
  try {
    return localStorage.getItem('cc-muted') === '1'
  } catch {
    return false
  }
}

export function isMuted() {
  return muted
}

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem('cc-muted', next ? '1' : '0')
  } catch {
    // ignore - private browsing / storage disabled
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function tone(freq: number, durationMs: number, opts: { type?: OscillatorType; gain?: number; sweepTo?: number } = {}) {
  if (muted) return
  const audioCtx = getCtx()
  if (!audioCtx) return

  const osc = audioCtx.createOscillator()
  const gainNode = audioCtx.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime)
  if (opts.sweepTo) {
    osc.frequency.linearRampToValueAtTime(opts.sweepTo, audioCtx.currentTime + durationMs / 1000)
  }

  const peak = opts.gain ?? 0.15
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime)
  gainNode.gain.linearRampToValueAtTime(peak, audioCtx.currentTime + 0.008)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000)

  osc.connect(gainNode)
  gainNode.connect(audioCtx.destination)
  osc.start()
  osc.stop(audioCtx.currentTime + durationMs / 1000 + 0.02)
}

/** Generic UI click - buttons, tabs, joining a room, etc. */
export function playClick() {
  tone(720, 45, { type: 'square', gain: 0.07 })
}

/** Distinct two-tone confirmation when the bomb is armed. */
export function playArm() {
  tone(420, 110, { type: 'sine', gain: 0.18 })
  setTimeout(() => tone(760, 150, { type: 'sine', gain: 0.18 }), 110)
}

/** Short warning blip when someone in the room looks away. */
export function playAlert() {
  tone(260, 140, { type: 'sawtooth', gain: 0.1 })
}

/** Decaying filtered noise burst for the bomb going off. */
export function playExplosion() {
  if (muted) return
  const audioCtx = getCtx()
  if (!audioCtx) return

  const duration = 0.7
  const bufferSize = Math.floor(audioCtx.sampleRate * duration)
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
  }

  const noise = audioCtx.createBufferSource()
  noise.buffer = buffer

  const filter = audioCtx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1400, audioCtx.currentTime)
  filter.frequency.exponentialRampToValueAtTime(70, audioCtx.currentTime + duration)

  const gainNode = audioCtx.createGain()
  gainNode.gain.setValueAtTime(0.55, audioCtx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration)

  noise.connect(filter)
  filter.connect(gainNode)
  gainNode.connect(audioCtx.destination)
  noise.start()
}
