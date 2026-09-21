import { io } from 'socket.io-client'

// Same-origin in production (Express serves this app's build output) and in
// `vite dev` (proxied to the real server - see vite.config.ts).
export const socket = io({ transports: ['websocket'] })
