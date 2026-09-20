const { customAlphabet } = require('nanoid');
const { MAX_PLAYERS_PER_ROOM } = require('../config');

const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

class RoomManager {
  constructor() {
    // roomCode -> room object
    this.rooms = new Map();
    // socketId -> roomCode
    this.socketToRoom = new Map();
  }

  createRoom(teamName, isPrivate) {
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = {
      code,
      teamName: teamName || `Team ${code}`,
      isPrivate: !!isPrivate,
      players: new Map(), // socketId -> { id, name, focused }
      state: 'lobby', // lobby | armed | exploded | defused
      bombTimeRemaining: null,
      bombDuration: null,
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  joinRoom(code, socketId, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.state !== 'lobby') return { error: 'Game already in progress' };
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) return { error: 'Room is full' };

    room.players.set(socketId, {
      id: socketId,
      name: playerName || `Player ${room.players.size + 1}`,
      focused: true,
      unfocusedSeconds: 0,
    });
    this.socketToRoom.set(socketId, code);
    return { room };
  }

  leaveSocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (room) {
      room.players.delete(socketId);
      if (room.players.size === 0) {
        this.rooms.delete(code);
      }
    }
    this.socketToRoom.delete(socketId);
    return code;
  }

  getRoomForSocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  setFocus(socketId, focused) {
    const room = this.getRoomForSocket(socketId);
    if (!room) return null;
    const player = room.players.get(socketId);
    if (!player) return null;
    player.focused = focused;
    return room;
  }

  listJoinableRooms() {
    return Array.from(this.rooms.values())
      .filter((r) => r.state === 'lobby' && !r.isPrivate)
      .map((r) => ({
        code: r.code,
        teamName: r.teamName,
        playerCount: r.players.size,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
      }));
  }

  roomPublicState(room) {
    return {
      code: room.code,
      teamName: room.teamName,
      isPrivate: room.isPrivate,
      state: room.state,
      bombTimeRemaining: room.bombTimeRemaining,
      bombDuration: room.bombDuration,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        focused: p.focused,
        unfocusedSeconds: p.unfocusedSeconds,
      })),
    };
  }
}

module.exports = RoomManager;
