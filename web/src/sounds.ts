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
  // Don't stop the danger beep loop here - it's a timer chain independent of
  // audio output, and tone() already no-ops while muted. Leaving it running
  // means un-muting mid-alarm is heard immediately instead of staying silent
  // until the danger state next toggles.
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

/** Low buzz for a wrong key while entering the arming code. */
export function playWrongKey() {
  tone(180, 130, { type: 'sawtooth', gain: 0.12 })
}

// ── Danger loop (continuous alarm while the screen is flashing red) ──────────
// A single long-lived oscillator wobbled by an LFO, instead of retriggering a
// one-shot blip - a DEFCON-style beeping countdown that speeds up and rises
// in pitch as `dangerLevel` climbs toward 1 (bomb buffer nearly empty), and
// stops the instant nobody's unfocused anymore.
let dangerLoopActive = false
let dangerTimeoutId: ReturnType<typeof setTimeout> | null = null
let dangerLevel = 0 // 0 = buffer full/safe, 1 = buffer empty/about to blow

/** Called continuously with how close the bomb is to exploding (0-1) so the
 * beep loop can escalate live, independent of when it started beeping. */
export function setDangerLevel(level: number) {
  dangerLevel = Math.min(1, Math.max(0, level))
}

function dangerBeep() {
  if (!dangerLoopActive) return
  const freq = 620 + dangerLevel * 560 // higher pitch the closer to exploding
  tone(freq, 85, { type: 'square', gain: 0.13 })
  const interval = 850 - dangerLevel * 700 // 850ms calm -> ~150ms about to blow
  dangerTimeoutId = setTimeout(dangerBeep, interval)
}

export function startDangerLoop() {
  if (dangerLoopActive) return
  dangerLoopActive = true
  dangerBeep()
}

export function stopDangerLoop() {
  dangerLoopActive = false
  if (dangerTimeoutId) {
    clearTimeout(dangerTimeoutId)
    dangerTimeoutId = null
  }
}

/** Layered retro arcade-style "boom" for the bomb going off - a sharp crack, a
 * descending square-wave sweep, and a filtered noise crash, all decaying together. */
export function playExplosion() {
  if (muted) return
  const audioCtx = getCtx()
  if (!audioCtx) return

  const now = audioCtx.currentTime
  const duration = 0.9

  // low retro square-wave sweep - the classic 8-bit "doom" descent
  const boom = audioCtx.createOscillator()
  boom.type = 'square'
  boom.frequency.setValueAtTime(220, now)
  boom.frequency.exponentialRampToValueAtTime(28, now + duration)
  const boomGain = audioCtx.createGain()
  boomGain.gain.setValueAtTime(0.4, now)
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
  boom.connect(boomGain)
  boomGain.connect(audioCtx.destination)
  boom.start(now)
  boom.stop(now + duration + 0.05)

  // filtered noise for the crash texture
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
  filter.frequency.setValueAtTime(2200, now)
  filter.frequency.exponentialRampToValueAtTime(60, now + duration)
  const noiseGain = audioCtx.createGain()
  noiseGain.gain.setValueAtTime(0.5, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
  noise.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(audioCtx.destination)
  noise.start(now)

  // sharp initial crack for impact
  const crack = audioCtx.createOscillator()
  crack.type = 'square'
  crack.frequency.setValueAtTime(1400, now)
  crack.frequency.exponentialRampToValueAtTime(200, now + 0.08)
  const crackGain = audioCtx.createGain()
  crackGain.gain.setValueAtTime(0.25, now)
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
  crack.connect(crackGain)
  crackGain.connect(audioCtx.destination)
  crack.start(now)
  crack.stop(now + 0.1)
}
