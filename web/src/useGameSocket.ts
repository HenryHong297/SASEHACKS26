import { useCallback, useEffect, useState } from 'react'
import { socket } from './socket'
import type { BombTick, LeaderboardEntry, Room, RoomListEntry, RoundSummary } from './types'

export function useGameSocket() {
  const [mySocketId, setMySocketId] = useState<string | null>(null)
  const [roomsList, setRoomsList] = useState<RoomListEntry[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [bombTick, setBombTick] = useState<BombTick | null>(null)
  const [roundSummary, setRoundSummary] = useState<RoundSummary | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

  useEffect(() => {
    if (socket.id) setMySocketId(socket.id)
    const onConnect = () => setMySocketId(socket.id ?? null)
    const onRoomsList = ({ rooms }: { rooms: RoomListEntry[] }) => setRoomsList(rooms)
    const onRoomState = (r: Room) => setRoom(r)
    const onBombTick = (t: BombTick) => setBombTick(t)
    const onBombExploded = (summary: RoundSummary) => setRoundSummary(summary)
    const onLeaderboardUpdate = ({ entries }: { entries: LeaderboardEntry[] }) => setLeaderboard(entries)

    socket.on('connect', onConnect)
    socket.on('rooms-list', onRoomsList)
    socket.on('room-state', onRoomState)
    socket.on('bomb-tick', onBombTick)
    socket.on('bomb-exploded', onBombExploded)
    socket.on('leaderboard-update', onLeaderboardUpdate)

    return () => {
      socket.off('connect', onConnect)
      socket.off('rooms-list', onRoomsList)
      socket.off('room-state', onRoomState)
      socket.off('bomb-tick', onBombTick)
      socket.off('bomb-exploded', onBombExploded)
      socket.off('leaderboard-update', onLeaderboardUpdate)
    }
  }, [])

  const createRoom = useCallback((teamName: string, playerName: string, isPrivate: boolean) => {
    return new Promise<{ room?: Room; error?: string }>((resolve) => {
      socket.emit('create-room', { teamName, playerName, isPrivate }, resolve)
    })
  }, [])

  const joinRoom = useCallback((roomCode: string, playerName: string) => {
    return new Promise<{ room?: Room; error?: string }>((resolve) => {
      socket.emit('join-room', { roomCode, playerName }, resolve)
    })
  }, [])

  const startGame = useCallback(() => {
    return new Promise<{ ok?: boolean; error?: string }>((resolve) => {
      socket.emit('start-game', {}, resolve)
    })
  }, [])

  const leaveRoom = useCallback(() => {
    // There's no explicit leave-room event - disconnecting is what the server
    // already uses to clean up a departed player (removes them from the room,
    // deletes the room if it's now empty, rebroadcasts room-state/rooms-list).
    // Reconnecting right after gives us a fresh socket id to create/join with.
    socket.disconnect()
    socket.connect()
    setRoom(null)
    setBombTick(null)
    setRoundSummary(null)
  }, [])

  return { mySocketId, roomsList, room, bombTick, roundSummary, leaderboard, createRoom, joinRoom, startGame, leaveRoom }
}
