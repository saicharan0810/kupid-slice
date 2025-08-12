import { io } from 'socket.io-client';

// Create a singleton socket instance to prevent multiple connections
let socketInstance: any = null;

export const socket = (() => {
  if (!socketInstance) {
    socketInstance = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000', {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
      forceNew: false,
      transports: ['websocket', 'polling'],
      // Add more robust reconnection settings
      randomizationFactor: 0.5
    });

    // Add connection event listeners for debugging
    socketInstance.on('connect', () => {
      console.log('🔌 Socket connected:', socketInstance.id);
    });

    socketInstance.on('disconnect', (reason: string) => {
      console.log('🔌 Socket disconnected:', reason);
    });

    socketInstance.on('reconnect', (attemptNumber: number) => {
      console.log('🔌 Socket reconnected after', attemptNumber, 'attempts');
    });

    socketInstance.on('reconnect_error', (error: any) => {
      console.log('🔌 Socket reconnection error:', error);
    });

    socketInstance.on('connect_error', (error: any) => {
      console.log('🔌 Socket connection error:', error);
    });

    (window as any).socket = socketInstance;
  }
  
  return socketInstance;
})();