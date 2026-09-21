// Mirrors the socket event contract documented in README.md - keep in sync
// with src/rooms/RoomManager.js and src/rooms/BombEngine.js.

export interface Player {
  id: string
  name: string
  focused: boolean
  unfocusedSeconds: number
}

export type RoomStatus = 'lobby' | 'armed' | 'exploded'

export interface Room {
  code: string
  teamName: string
  isPrivate: boolean
  state: RoomStatus
  players: Player[]
}

export interface RoomListEntry {
  code: string
  teamName: string
  playerCount: number
  maxPlayers: number
}

export interface BombTick {
  bombBuffer: number
  bombBufferMax: number
  sessionElapsed: number
  anyUnfocused: boolean
  unfocusedCount: number
}

export interface RoundSummaryPlayer {
  id: string
  name: string
  unfocusedSeconds: number
}

export interface RoundSummary {
  sessionElapsed: number
  players: RoundSummaryPlayer[]
  mvp: RoundSummaryPlayer
  weakLink: RoundSummaryPlayer
}

export interface LeaderboardEntry {
  teamName: string
  survivalSeconds: number
  playerCount: number
  createdAt: string
}
