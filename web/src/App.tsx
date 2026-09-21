import { useEffect, useRef, useState } from 'react'
import { useGameSocket } from './useGameSocket'
import { useFocusDetector, type DetectorState } from './useFocusDetector'
import { isMuted, playArm, playClick, playExplosion, setDangerLevel, setMuted, startDangerLoop, stopDangerLoop } from './sounds'
import type { BombTick, LeaderboardEntry, Room, RoomListEntry, RoundSummary } from './types'

type RoomWithExtras = Room & { bombTick: BombTick | null; roundSummary: RoundSummary | null }

// ── Theme ────────────────────────────────────────────────────────────────────
const RED = '#c0392b'
const RED_GLOW = 'rgba(192, 57, 43, 0.25)'
const RED_DIM = '#c0392b18'

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// viewBox-based (not fixed pixel radius) so it can be dropped into a
// container of any size via CSS - used both standalone and shrunk down to
// sit inside the bomb asset's dial in SessionView.
function Ring({ progress }: { progress: number }) {
  const size = 100
  const stroke = 4
  const r = size / 2 - stroke / 2
  const circumference = 2 * Math.PI * r
  const offset = (1 - Math.min(1, Math.max(0, progress))) * circumference
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
      {/* solid disc instead of a transparent center - reads as one complete
          black circle (matching the bomb art's drawn dial) with the red
          progress ring wrapping its outer rim, rather than a hollow track */}
      <circle cx={size / 2} cy={size / 2} r={r - stroke / 2 + 0.5} fill="#000" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={RED}
        strokeWidth={stroke}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s linear', filter: `drop-shadow(0 0 4px ${RED_GLOW})` }}
      />
    </svg>
  )
}

const monoSm: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.72rem', letterSpacing: '0.06em' }
const monoXs: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em' }

function inputStyle(active: boolean): React.CSSProperties {
  return {
    background: 'var(--secondary)',
    color: 'var(--foreground)',
    border: `1px solid ${active ? RED + '66' : 'var(--border)'}`,
    fontFamily: 'var(--font-sans)',
    caretColor: RED,
    outline: 'none',
    width: '100%',
    padding: '11px 14px',
    fontSize: '0.875rem',
    transition: 'border-color 0.2s',
  }
}

function initials(name: string) {
  return (name.trim().slice(0, 2) || '??').toUpperCase()
}

// ── Your own focus status (real MediaPipe detection, not decorative) ──────────

function describeDetector(state: DetectorState): string {
  switch (state.phase) {
    case 'idle':
    case 'requesting-camera':
      return 'Requesting camera access...'
    case 'camera-error':
      return `Camera unavailable (${state.cameraError}). Falling back to manual toggle.`
    case 'loading-model':
      return 'Loading focus detector...'
    case 'calibrating':
      return `Calibrating - look at your screen (${Math.ceil(state.calibSecondsLeft ?? 0)}s)`
    case 'tracking':
      return `${state.focused ? 'FOCUSED' : 'LOOKING AWAY'} - auto-tracked, focus score ${Math.round((state.focusScore ?? 1) * 100)}%, ${state.distractions ?? 0} distraction${(state.distractions ?? 0) === 1 ? '' : 's'}`
    case 'manual':
      return `${state.focused ? 'FOCUSED' : 'LOOKING AWAY'} (click to toggle - auto-detection unavailable)`
    default:
      return ''
  }
}

function FocusStatus({ detector, onRetry, onToggleManual }: { detector: DetectorState; onRetry: () => void; onToggleManual: () => void }) {
  const clickable = detector.phase === 'manual'
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={
          clickable
            ? () => {
                playClick()
                onToggleManual()
              }
            : undefined
        }
        disabled={!clickable}
        className="px-4 py-2 text-center transition-all"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.68rem',
          letterSpacing: '0.04em',
          border: `1px solid ${detector.focused ? 'var(--border)' : RED + '66'}`,
          background: detector.focused ? 'var(--secondary)' : RED_DIM,
          color: detector.focused ? 'var(--muted-foreground)' : RED,
          cursor: clickable ? 'pointer' : 'default',
        }}
      >
        {describeDetector(detector)}
      </button>
      {detector.phase === 'camera-error' && (
        <button
          onClick={() => {
            playClick()
            onRetry()
          }}
          className="px-3 py-1.5 text-xs uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', border: `1px solid ${RED}66`, color: RED, background: 'transparent' }}
        >
          Retry Camera
        </button>
      )}
    </div>
  )
}

// ── Members panel ─────────────────────────────────────────────────────────────

function MembersPanel({ room, mySocketId }: { room: Room; mySocketId: string | null }) {
  return (
    <aside className="flex flex-col" style={{ width: 220, borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <span style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>In Room</span>
        <span style={{ ...monoXs, color: RED }}>{room.players.length} active</span>
      </div>

      <div className="flex flex-col overflow-y-auto flex-1">
        {room.players.map((p) => {
          const isYou = p.id === mySocketId
          return (
            <div
              key={p.id}
              className={`flex items-start gap-3 px-4 py-3 ${!p.focused ? 'danger-pulse-border' : ''}`}
              style={{ borderBottom: '1px solid var(--border)', background: isYou ? RED_DIM : 'transparent' }}
            >
              <div className="relative flex-shrink-0">
                <div
                  className="w-7 h-7 flex items-center justify-center text-xs font-bold"
                  style={{
                    background: isYou ? RED_DIM : 'var(--secondary)',
                    color: isYou ? RED : 'var(--muted-foreground)',
                    border: `1px solid ${isYou ? RED + '55' : 'var(--border)'}`,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.6rem',
                  }}
                >
                  {initials(p.name)}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: -1,
                    right: -1,
                    width: 7,
                    height: 7,
                    background: p.focused ? RED : '#555',
                    border: '1px solid var(--background)',
                    boxShadow: p.focused ? `0 0 4px ${RED_GLOW}` : 'none',
                  }}
                />
              </div>

              <div className="flex flex-col gap-0.5 min-w-0">
                <span style={{ ...monoSm, color: isYou ? RED : 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isYou ? `${p.name} (you)` : p.name}
                </span>
                <span style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
                  {p.focused ? '● Focused' : '○ Looking away'}
                </span>
                <span style={{ ...monoXs, color: 'var(--muted-foreground)' }}>{Math.round(p.unfocusedSeconds)}s unfocused</span>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

// ── Home screen ───────────────────────────────────────────────────────────────

function HomeScreen({
  roomsList,
  onCreate,
  onJoin,
}: {
  roomsList: RoomListEntry[]
  onCreate: (username: string, teamName: string, isPrivate: boolean) => Promise<string | void>
  onJoin: (username: string, code: string) => Promise<string | void>
}) {
  const [username, setUsername] = useState('')
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [newRoomName, setNewRoomName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    playClick()
    if (!username.trim()) return setError('Enter a username first.')
    if (!newRoomName.trim()) return setError('Give your team a name.')
    setBusy(true)
    const err = await onCreate(username.trim(), newRoomName.trim(), isPrivate)
    setBusy(false)
    if (err) setError(err)
  }

  async function handleJoin(codeOverride?: string) {
    playClick()
    if (!username.trim()) return setError('Enter a username first.')
    const code = (codeOverride ?? joinCode).trim().toUpperCase()
    if (code.length < 4) return setError('Enter a valid team code.')
    setBusy(true)
    const err = await onJoin(username.trim(), code)
    setBusy(false)
    if (err) setError(err)
  }

  const totalPlayers = roomsList.reduce((a, r) => a + r.playerCount, 0)

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--background)' }}>
      {/* Left: main card */}
      <div className="flex flex-col items-center justify-center flex-1 p-8">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="10" width="24" height="3" fill={RED} />
              <rect x="7" y="4" width="3" height="20" fill={RED} opacity="0.6" />
              <rect x="18" y="4" width="3" height="20" fill={RED} opacity="0.6" />
              <rect x="2" y="18" width="24" height="3" fill={RED} opacity="0.4" />
            </svg>
            <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--foreground)', letterSpacing: '0.12em' }}>
              CONTROLLED <span style={{ color: RED }}>CHARGE</span>
            </h1>
          </div>
          <p style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
            Bomb defusal teams - stay focused, don't let it drop
          </p>
        </div>

        <div className="w-full max-w-md flex flex-col gap-5 p-7" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex flex-col gap-2">
            <label style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Username</label>
            <input
              style={inputStyle(!!username)}
              placeholder="How should we call you?"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setError('')
              }}
            />
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          <div className="flex" style={{ border: '1px solid var(--border)' }}>
            {(['create', 'join'] as const).map((t, i) => (
              <button
                key={t}
                onClick={() => {
                  playClick()
                  setTab(t)
                  setError('')
                }}
                className="flex-1 py-2.5 text-xs uppercase tracking-widest transition-all"
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: tab === t ? RED_DIM : 'transparent',
                  color: tab === t ? RED : 'var(--muted-foreground)',
                  borderRight: i === 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                {t === 'create' ? 'Create Team' : 'Join by Code'}
              </button>
            ))}
          </div>

          {tab === 'create' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Team Name</label>
                <input
                  style={inputStyle(!!newRoomName)}
                  placeholder="e.g. Boiler Room, Workshop..."
                  value={newRoomName}
                  onChange={(e) => {
                    setNewRoomName(e.target.value)
                    setError('')
                  }}
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() => setIsPrivate((p) => !p)}
                  className="flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ width: 16, height: 16, border: `1px solid ${isPrivate ? RED : 'var(--border)'}`, background: isPrivate ? RED_DIM : 'transparent', cursor: 'pointer' }}
                >
                  {isPrivate && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <polyline points="1.5,5 4,7.5 8.5,2.5" stroke={RED} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div>
                  <span style={{ ...monoXs, color: isPrivate ? RED : 'var(--muted-foreground)', textTransform: 'uppercase' }}>Private Team</span>
                  <p style={{ fontSize: '0.65rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {isPrivate ? 'Invite-only - share the code with your team' : 'Visible in the public teams list'}
                  </p>
                </div>
              </label>

              {error && <p style={{ ...monoXs, color: RED }}>⚠ {error}</p>}

              <button
                onClick={handleCreate}
                disabled={busy}
                className="w-full py-3 text-xs font-semibold uppercase tracking-widest transition-all hover:brightness-110 active:scale-95"
                style={{ background: RED, color: '#f0ebe4', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em', opacity: busy ? 0.6 : 1 }}
              >
                Initialize Team
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Team Code</label>
                <input
                  style={{ ...inputStyle(!!joinCode), fontFamily: 'var(--font-mono)', fontSize: '1.3rem', textAlign: 'center', letterSpacing: '0.25em', textTransform: 'uppercase' }}
                  placeholder="——————"
                  maxLength={8}
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase())
                    setError('')
                  }}
                />
                <p style={{ ...monoXs, color: 'var(--muted-foreground)' }}>5-char code from your team host</p>
              </div>

              {error && <p style={{ ...monoXs, color: RED }}>⚠ {error}</p>}

              <button
                onClick={() => handleJoin()}
                disabled={busy}
                className="w-full py-3 text-xs font-semibold uppercase tracking-widest transition-all hover:brightness-110 active:scale-95"
                style={{ background: RED, color: '#f0ebe4', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em', opacity: busy ? 0.6 : 1 }}
              >
                Enter Team
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: public teams sidebar */}
      <aside className="flex flex-col" style={{ width: 280, borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <p style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase', marginBottom: 2 }}>Active Bomb Defusal Teams</p>
          <p style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>Join without a code</p>
        </div>

        <div className="flex flex-col flex-1 overflow-y-auto">
          {roomsList.length === 0 && (
            <p className="px-5 py-4" style={{ ...monoXs, color: 'var(--muted-foreground)' }}>
              No open teams right now - create one!
            </p>
          )}
          {roomsList.map((r) => {
            const full = r.playerCount >= r.maxPlayers
            return (
              <div
                key={r.code}
                className="flex items-start justify-between gap-3 px-5 py-4 group transition-colors"
                style={{ borderBottom: '1px solid var(--border)', cursor: full ? 'default' : 'pointer' }}
                onClick={() => !full && handleJoin(r.code)}
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <span style={{ ...monoSm, color: 'var(--foreground)' }}>{r.teamName}</span>
                  <span style={{ fontSize: '0.63rem', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{r.code}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div style={{ width: 6, height: 6, background: RED, boxShadow: `0 0 4px ${RED_GLOW}` }} />
                    <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
                      {r.playerCount}/{r.maxPlayers} players
                    </span>
                  </div>
                </div>
                <button
                  disabled={full}
                  className="flex-shrink-0 px-3 py-1.5 text-xs uppercase tracking-widest transition-all"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', border: `1px solid ${RED}44`, color: RED, background: 'transparent', whiteSpace: 'nowrap', opacity: full ? 0.4 : 1 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleJoin(r.code)
                  }}
                >
                  {full ? 'Full' : 'Join →'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', letterSpacing: '0.05em' }}>
            {totalPlayers} operator{totalPlayers === 1 ? '' : 's'} online now
          </p>
        </div>
      </aside>
    </div>
  )
}

// ── Round summary ─────────────────────────────────────────────────────────────

function RoundSummaryPanel({ summary, mySocketId, onLeave }: { summary: RoundSummary; mySocketId: string | null; onLeave: () => void }) {
  const sorted = [...summary.players].sort((a, b) => a.unfocusedSeconds - b.unfocusedSeconds)
  return (
    <div className="w-full max-w-md flex flex-col gap-6 items-center">
      <div className="text-center">
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.1em', color: RED }}>BOOM</h2>
        <p style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase', marginTop: 4 }}>
          Survived {formatClock(summary.sessionElapsed)}
        </p>
      </div>

      <div className="w-full" style={{ border: '1px solid var(--border)' }}>
        {sorted.map((p, i) => {
          const isYou = p.id === mySocketId
          let badge = ''
          if (p.id === summary.mvp.id) badge = 'MVP - most focused'
          else if (p.id === summary.weakLink.id && summary.weakLink.unfocusedSeconds > 0 && summary.weakLink.id !== summary.mvp.id) badge = 'Weak Link'
          return (
            <div
              key={p.id}
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none', background: isYou ? RED_DIM : 'transparent' }}
            >
              <span style={{ ...monoSm, color: isYou ? RED : 'var(--foreground)' }}>
                {p.name}
                {isYou ? ' (you)' : ''}
              </span>
              <span style={{ ...monoXs, color: badge.startsWith('MVP') ? '#2ecc71' : badge ? RED : 'var(--muted-foreground)' }}>
                {p.unfocusedSeconds}s unfocused {badge && `- ${badge}`}
              </span>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => {
          playClick()
          onLeave()
        }}
        className="px-6 py-3 text-xs font-semibold uppercase tracking-widest transition-all hover:brightness-110 active:scale-95"
        style={{ background: RED, color: '#f0ebe4', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em' }}
      >
        Return to Base
      </button>
    </div>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function LeaderboardView({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="w-full max-w-2xl">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--foreground)' }}>
            Leaderboard
          </h2>
          <p className="mt-1" style={{ ...monoXs, color: 'var(--muted-foreground)' }}>
            Longest survival times
          </p>
        </div>
        <span style={{ ...monoXs, color: RED }}>{entries.length} runs recorded</span>
      </div>

      <div style={{ border: '1px solid var(--border)' }}>
        <div
          className="grid px-5 py-2.5"
          style={{ gridTemplateColumns: '2.5rem 1fr 8rem 6rem', background: 'var(--muted)', borderBottom: '1px solid var(--border)', ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}
        >
          <span>#</span>
          <span>Team</span>
          <span>Survived</span>
          <span>Players</span>
        </div>
        {entries.length === 0 && (
          <p className="px-5 py-4" style={{ ...monoXs, color: 'var(--muted-foreground)' }}>
            No runs yet - be the first team to blow up.
          </p>
        )}
        {entries.map((e, idx) => (
          <div
            key={`${e.teamName}-${e.createdAt}-${idx}`}
            className="grid items-center px-5 py-3.5"
            style={{
              gridTemplateColumns: '2.5rem 1fr 8rem 6rem',
              background: idx % 2 === 0 ? 'var(--card)' : 'var(--muted)',
              borderBottom: idx < entries.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{ ...monoSm, color: idx < 3 ? RED : 'var(--muted-foreground)' }}>{String(idx + 1).padStart(2, '0')}</span>
            <span style={{ ...monoSm, color: 'var(--foreground)' }}>{e.teamName}</span>
            <span style={{ ...monoSm, color: 'var(--foreground)' }}>{formatClock(e.survivalSeconds)}</span>
            <span style={{ ...monoSm, color: 'var(--foreground)' }}>{e.playerCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Session view ──────────────────────────────────────────────────────────────

function SessionView({
  room,
  mySocketId,
  username,
  leaderboard,
  onStart,
  onLeave,
}: {
  room: RoomWithExtras
  mySocketId: string | null
  username: string
  leaderboard: LeaderboardEntry[]
  onStart: () => Promise<{ ok?: boolean; error?: string }>
  onLeave: () => void
}) {
  const { state: detectorState, retryCamera, toggleManualFocus } = useFocusDetector()
  const [tab, setTab] = useState<'game' | 'leaderboard'>('game')
  const [startError, setStartError] = useState('')
  const [starting, setStarting] = useState(false)

  const bombTick = room.bombTick
  const isLobby = room.state === 'lobby'
  const isArmed = room.state === 'armed'
  const isExploded = room.state === 'exploded'
  const progress = isArmed && bombTick && bombTick.bombBufferMax > 0 ? 1 - bombTick.bombBuffer / bombTick.bombBufferMax : 0

  const dangerFlash = isArmed && (bombTick?.anyUnfocused ?? false)
  useEffect(() => {
    if (dangerFlash) startDangerLoop()
    else stopDangerLoop()
    return () => stopDangerLoop()
  }, [dangerFlash])

  // Keeps the beep loop's tempo/pitch in sync with the live buffer level,
  // independent of when the loop itself started - so it keeps accelerating
  // toward detonation even without the danger state toggling off and on.
  useEffect(() => {
    setDangerLevel(progress)
  }, [progress])

  const hasPlayedExplosion = useRef(false)
  useEffect(() => {
    if (isExploded && !hasPlayedExplosion.current) {
      hasPlayedExplosion.current = true
      playExplosion()
    }
    if (!isExploded) hasPlayedExplosion.current = false
  }, [isExploded])

  async function handleStart() {
    playArm()
    setStarting(true)
    setStartError('')
    const res = await onStart()
    setStarting(false)
    if (res.error) setStartError(res.error)
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--background)', fontFamily: 'var(--font-sans)' }}>
      {dangerFlash && (
        <div className="danger-flash" style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }} />
      )}
      {/* Header */}
      <header className="grid items-center px-6" style={{ gridTemplateColumns: '1fr auto 1fr', borderBottom: '1px solid var(--border)', minHeight: 52 }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              playClick()
              onLeave()
            }}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-60"
            style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Leave
          </button>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span style={{ ...monoSm, color: 'var(--muted-foreground)' }}>{room.teamName}</span>
          {room.isPrivate && (
            <span style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase', border: '1px solid var(--border)', padding: '1px 6px' }}>
              private
            </span>
          )}
        </div>

        {room.isPrivate ? (
          <div className="flex items-center gap-2 px-4 py-1.5" style={{ border: `1px solid ${RED}44`, background: RED_DIM }}>
            <span style={{ ...monoXs, color: RED, textTransform: 'uppercase', opacity: 0.7 }}>CODE</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92rem', fontWeight: 700, color: RED, letterSpacing: '0.22em' }}>{room.code}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-1.5" style={{ border: '1px solid var(--border)' }}>
            <span style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Public Team - {room.code}</span>
          </div>
        )}

        <div className="flex items-center gap-3 justify-end">
          <span style={{ ...monoXs, color: 'var(--muted-foreground)' }}>{username}</span>
          <div className="flex" style={{ border: '1px solid var(--border)' }}>
            {(['game', 'leaderboard'] as const).map((v, i) => (
              <button
                key={v}
                onClick={() => {
                  playClick()
                  setTab(v)
                }}
                className="px-4 py-1.5 text-xs uppercase tracking-widest transition-all"
                style={{ fontFamily: 'var(--font-mono)', background: tab === v ? RED_DIM : 'transparent', color: tab === v ? RED : 'var(--muted-foreground)', borderRight: i === 0 ? '1px solid var(--border)' : 'none' }}
              >
                {v === 'game' ? 'Bomb' : 'Board'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 flex items-center justify-center p-8">
          {tab === 'leaderboard' ? (
            <LeaderboardView entries={leaderboard} />
          ) : isExploded && room.roundSummary ? (
            <RoundSummaryPanel summary={room.roundSummary} mySocketId={mySocketId} onLeave={onLeave} />
          ) : (
            <div className="flex flex-col items-center gap-8 w-full max-w-sm">
              {/* Bomb prop - timer/ring sit inside its black dial */}
              <div style={{ position: 'relative', width: 300 }}>
                <img src="/bomb.png" alt="" draggable={false} style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none', pointerEvents: 'none' }} />
                <div
                  style={{
                    position: 'absolute',
                    left: '56.5%',
                    top: '54.4%',
                    width: '42%',
                    aspectRatio: '1 / 1',
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div style={{ position: 'absolute', inset: 0 }}>
                    <Ring progress={progress} />
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1.55rem',
                        fontWeight: 700,
                        color: isArmed ? RED : 'var(--foreground)',
                        letterSpacing: '0.01em',
                        lineHeight: 1,
                        transition: 'color 0.3s',
                        textShadow: isArmed ? `0 0 18px ${RED_GLOW}` : 'none',
                      }}
                    >
                      {isArmed && bombTick ? formatClock(bombTick.sessionElapsed) : '00:00'}
                    </span>
                    <span className="mt-1 uppercase tracking-widest text-center" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', color: 'var(--muted-foreground)' }}>
                      {isLobby ? 'Standby' : isArmed ? 'Survived' : 'Defused'}
                    </span>
                  </div>
                </div>
              </div>

              {isLobby ? (
                <div className="flex flex-col items-center gap-3">
                  <button
                    onClick={handleStart}
                    disabled={starting}
                    className="px-8 py-4 text-xs font-semibold uppercase tracking-widest transition-all hover:brightness-110 active:scale-95"
                    style={{ background: RED, color: '#f0ebe4', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em', boxShadow: `0 0 24px ${RED_GLOW}`, opacity: starting ? 0.6 : 1 }}
                  >
                    Arm The Bomb
                  </button>
                  {startError && <p style={{ ...monoXs, color: RED }}>⚠ {startError}</p>}
                </div>
              ) : isArmed && bombTick ? (
                <p style={{ ...monoXs, color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
                  {Math.ceil(bombTick.bombBuffer)}s until it blows{bombTick.unfocusedCount > 0 ? ` - ${bombTick.unfocusedCount} unfocused` : ''}
                </p>
              ) : null}

              {!isExploded && <FocusStatus detector={detectorState} onRetry={retryCamera} onToggleManual={toggleManualFocus} />}
            </div>
          )}
        </main>

        <MembersPanel room={room} mySocketId={mySocketId} />
      </div>
    </div>
  )
}

// ── Mute toggle ───────────────────────────────────────────────────────────────

function MuteToggle() {
  const [muted, setMutedState] = useState(isMuted())

  return (
    <button
      onClick={() => {
        const next = !muted
        setMuted(next)
        setMutedState(next)
        if (!next) playClick()
      }}
      title={muted ? 'Unmute sound' : 'Mute sound'}
      className="flex items-center justify-center transition-opacity hover:opacity-70"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 50,
        width: 30,
        height: 30,
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: muted ? 'var(--muted-foreground)' : RED,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.85rem',
      }}
    >
      {muted ? '\u{1F507}' : '\u{1F50A}'}
    </button>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { mySocketId, roomsList, room, bombTick, roundSummary, leaderboard, createRoom, joinRoom, startGame, leaveRoom } = useGameSocket()
  const [username, setUsername] = useState('')

  async function handleCreate(name: string, teamName: string, isPrivate: boolean) {
    const res = await createRoom(teamName, name, isPrivate)
    if (res.error) return res.error
    setUsername(name)
  }

  async function handleJoin(name: string, code: string) {
    const res = await joinRoom(code, name)
    if (res.error) return res.error
    setUsername(name)
  }

  if (!room) {
    return (
      <>
        <MuteToggle />
        <HomeScreen roomsList={roomsList} onCreate={handleCreate} onJoin={handleJoin} />
      </>
    )
  }

  // bombTick/roundSummary are separate socket streams from room-state - merge
  // them onto the room object the views expect a single source of truth from.
  const roomWithExtras = { ...room, bombTick, roundSummary }

  return (
    <>
      <MuteToggle />
      <SessionView room={roomWithExtras} mySocketId={mySocketId} username={username} leaderboard={leaderboard} onStart={startGame} onLeave={leaveRoom} />
    </>
  )
}
