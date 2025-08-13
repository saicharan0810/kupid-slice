import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidV4 } from 'uuid';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};
let matchmakingQueue = [];
const sessionMap = new Map(); // Maps socket.id -> sessionId
// Main Stage state
let mainStage = { roomId: null, endsAt: null, timer: null };

const broadcastViewerCount = (roomId) => {
  if (rooms[roomId]) {
    const participantCount = rooms[roomId].participants.length;
    const spectatorCount = rooms[roomId].spectators.length;
    const totalViewers = participantCount + spectatorCount;
    console.log(`📊 Room ${roomId}: ${participantCount} participants + ${spectatorCount} spectators = ${totalViewers} total viewers`);
    io.to(roomId).emit('viewer-count-update', { count: totalViewers });
  }
};

const broadcastActiveRooms = () => {
  const activeRooms = Object.entries(rooms)
    .filter(([, roomData]) => roomData.participants.length >= 1)
    .map(([roomId, roomData]) => ({
      roomId,
      viewerCount: roomData.participants.length + roomData.spectators.length,
    }));
  console.log(`🏠 Active rooms: ${activeRooms.length}`, activeRooms);
  io.to('lobby').emit('active-rooms-update', { rooms: activeRooms });
};

const broadcastMainStageStatus = () => {
  io.to('lobby').emit('main-stage-status', { roomId: mainStage.roomId, endsAt: mainStage.endsAt });
};

const setMainStage = (roomId, durationMs = 8 * 60 * 1000) => {
  if (mainStage.timer) clearTimeout(mainStage.timer);
  mainStage.roomId = roomId;
  mainStage.endsAt = Date.now() + durationMs;
  broadcastMainStageStatus();
  io.to('lobby').emit('main-stage-update', { roomId: mainStage.roomId, endsAt: mainStage.endsAt });
  mainStage.timer = setTimeout(() => {
    // Clear current and try to promote next pair from queue
    mainStage.roomId = null;
    mainStage.endsAt = null;
    broadcastMainStageStatus();
    tryPromoteFromQueue();
  }, durationMs);
};

const clearMainStageIfRoom = (roomId) => {
  if (mainStage.roomId === roomId) {
    if (mainStage.timer) clearTimeout(mainStage.timer);
    mainStage = { roomId: null, endsAt: null, timer: null };
    broadcastMainStageStatus();
  }
};

const logAllRooms = () => {
  console.log('📋 Current room status:');
  Object.entries(rooms).forEach(([roomId, roomData]) => {
    console.log(`  Room ${roomId}: ${roomData.participants.length} participants, ${roomData.spectators.length} spectators`);
    roomData.participants.forEach(p => console.log(`    Participant: ${p.sessionId} (socket: ${p.socketId})`));
    roomData.spectators.forEach(s => console.log(`    Spectator: ${s.sessionId} (socket: ${s.socketId})`));
  });
};

const findSocketId = (targetSessionId) => {
    for (const [socketId, sessionId] of sessionMap.entries()) {
        if (sessionId === targetSessionId) return socketId;
    }
    return null;
};

const removeUser = (socketId) => {
    const sessionId = sessionMap.get(socketId);
    if (!sessionId) {
        console.log(`⚠️ No session found for socket ${socketId}`);
        return;
    }
    console.log(`🗑️ Removing user ${sessionId} (socket ${socketId})`);
    
    matchmakingQueue = matchmakingQueue.filter(u => u.sessionId !== sessionId);
    for (const roomId in rooms) {
        const room = rooms[roomId];
        let userFoundAndRemoved = false;
        const pIndex = room.participants.findIndex(p => p.sessionId === sessionId);
        if (pIndex > -1) {
            room.participants.splice(pIndex, 1);
            userFoundAndRemoved = true;
            console.log(`👤 Removed participant ${sessionId} from room ${roomId}`);
            io.to(roomId).emit('user-left', { userId: sessionId });
        } else {
            const sIndex = room.spectators.findIndex(s => s.sessionId === sessionId);
            if (sIndex > -1) {
                room.spectators.splice(sIndex, 1);
                userFoundAndRemoved = true;
                console.log(`👀 Removed spectator ${sessionId} from room ${roomId}`);
            }
        }
        if (userFoundAndRemoved) {
            if (room.participants.length === 0 && room.spectators.length === 0) {
                delete rooms[roomId];
                console.log(`🏠 Deleted empty room ${roomId}`);
            }
            broadcastViewerCount(roomId);
            broadcastActiveRooms();
        }
    }
    sessionMap.delete(socketId);
};

io.on('connection', (socket) => {
  socket.on('register-session', ({ sessionId }) => {
    sessionMap.set(socket.id, sessionId);
    console.log(`✅ Session Registered: Socket ${socket.id} is session ${sessionId}`);
  });

  socket.on('join-lobby', () => {
    socket.join('lobby');
    // Send current main stage on lobby join
    socket.emit('main-stage-status', { roomId: mainStage.roomId, endsAt: mainStage.endsAt });
  });
  socket.on('leave-lobby', () => socket.leave('lobby'));

  socket.on('enter-matchmaking-queue', ({ sessionId }) => {
    console.log(`🔍 User ${sessionId} (socket ${socket.id}) entered matchmaking queue`);
    console.log(`📊 Current queue length: ${matchmakingQueue.length}`);
    
    if (!matchmakingQueue.find(u => u.sessionId === sessionId)) {
      matchmakingQueue.push({ socketId: socket.id, sessionId });
      console.log(`✅ Added ${sessionId} to queue. New length: ${matchmakingQueue.length}`);
    } else {
      console.log(`⚠️ User ${sessionId} already in queue, skipping`);
    }
    
    if (matchmakingQueue.length >= 2) tryPromoteFromQueue();
  });

  socket.on('leave-matchmaking-queue', ({ sessionId }) => {
    matchmakingQueue = matchmakingQueue.filter(u => u.sessionId !== sessionId);
  });

  socket.on('join-room', ({ roomId, sessionId }) => {
    console.log(`🚪 User ${sessionId} (socket ${socket.id}) joining room ${roomId}`);
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { participants: [], spectators: [], chatHistory: [] };
      console.log(`🏠 Created new room ${roomId}`);
    }
    
    rooms[roomId].participants = rooms[roomId].participants.filter(p => p.sessionId !== sessionId);
    rooms[roomId].spectators = rooms[roomId].spectators.filter(s => s.sessionId !== sessionId);

    const newUser = { socketId: socket.id, sessionId };
    console.log(`👥 Room ${roomId} currently has ${rooms[roomId].participants.length} participants`);
    
    if (rooms[roomId].participants.length < 2) {
      const existingParticipants = rooms[roomId].participants.map(p => p.sessionId);
      rooms[roomId].participants.push(newUser);
      console.log(`✅ Added ${sessionId} as participant. Total participants: ${rooms[roomId].participants.length}`);
      
      // Tell the NEW user who was already here. They will initiate the connection.
      if (existingParticipants.length > 0) {
        console.log(`📡 Telling ${sessionId} about existing participants: ${existingParticipants.join(', ')}`);
        socket.emit('existing-participants', { participantIds: existingParticipants });
        // Notify existing participants that a new user joined
        existingParticipants.forEach(participantId => {
          const participantSocketId = findSocketId(participantId);
          if (participantSocketId) {
            console.log(`📡 Notifying ${participantId} that ${sessionId} joined`);
            io.to(participantSocketId).emit('user-joined', { userId: sessionId });
          }
        });
      }
      // Always broadcast active rooms after any participant joins
      broadcastActiveRooms();
      // If no current main stage, promote this room
      if (!mainStage.roomId && rooms[roomId].participants.length === 2) {
        setMainStage(roomId);
      }
    } else {
      console.log(`👀 Adding ${sessionId} as spectator (room is full)`);
      rooms[roomId].spectators.push(newUser);
      const participantIds = rooms[roomId].participants.map(p => p.sessionId);
      io.to(socket.id).emit('current-participants', { participantIds });
    }
    socket.emit('chat-history', { history: rooms[roomId].chatHistory });
    broadcastViewerCount(roomId);
    // Broadcast active rooms after spectator join too
    broadcastActiveRooms();
  });

  socket.on('send-chat-message', ({ roomId, message, sessionId }) => {
    if (rooms[roomId]) {
      const newMessage = { id: uuidV4(), senderId: sessionId, message: message, timestamp: new Date().toISOString() };
      rooms[roomId].chatHistory.push(newMessage);
      io.to(roomId).emit('new-chat-message', { message: newMessage });
    }
  });

  // Spectator/participant quick reactions (❤️🔥😂😮)
  socket.on('send-reaction', ({ roomId, reaction }) => {
    if (!rooms[roomId]) return;
    // Emit to everyone in the room, including sender
    io.to(roomId).emit('new-reaction', { reaction });
  });

  socket.on('webrtc-offer', ({ sdp, toUserId }) => {
    const targetSocketId = findSocketId(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit('webrtc-offer', { sdp, fromUserId: sessionMap.get(socket.id) });
  });
  
  socket.on('webrtc-answer', ({ sdp, toUserId }) => {
    const targetSocketId = findSocketId(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit('webrtc-answer', { sdp, fromUserId: sessionMap.get(socket.id) });
  });
  
  socket.on('webrtc-ice-candidate', ({ candidate, toUserId }) => {
    const targetSocketId = findSocketId(toUserId);
    if (targetSocketId) io.to(targetSocketId).emit('webrtc-ice-candidate', { candidate, fromUserId: sessionMap.get(socket.id) });
  });

  // Media state signaling (mute/video badges)
  socket.on('media-state', ({ roomId, sessionId, muted, videoOff }) => {
    if (!rooms[roomId]) return;
    socket.to(roomId).emit('media-state-update', { userId: sessionId, muted, videoOff });
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket ${socket.id} disconnected`);
    const sessionId = sessionMap.get(socket.id);
    removeUser(socket.id);
    // If a main stage participant left, clear and try to promote next
    for (const roomId in rooms) {
      const r = rooms[roomId];
      if (!r) continue;
      const isParticipant = r.participants.find(p => p.sessionId === sessionId);
      if (isParticipant) {
        clearMainStageIfRoom(roomId);
        break;
      }
    }
    tryPromoteFromQueue();
  });

  // Debug command to log all rooms
  socket.on('debug-rooms', () => {
    logAllRooms();
  });
  
  // Get room participants for manual connection establishment
  socket.on('get-room-participants', ({ roomId }) => {
    console.log(`🔍 User ${sessionMap.get(socket.id)} requesting participants for room ${roomId}`);
    if (rooms[roomId]) {
      const currentUserId = sessionMap.get(socket.id);
      const participantIds = rooms[roomId].participants
        .map(p => p.sessionId)
        .filter(id => id !== currentUserId); // Exclude the current user
      console.log(`📡 Sending ${participantIds.length} participants to ${currentUserId}: ${participantIds.join(', ')}`);
      socket.emit('existing-participants', { participantIds });
    } else {
      console.log(`❌ Room ${roomId} not found`);
    }
  });
});

// Helper to promote next two users from queue into a new room and set as main stage
function tryPromoteFromQueue() {
  if (matchmakingQueue.length >= 2) {
    const user1 = matchmakingQueue.shift();
    const user2 = matchmakingQueue.shift();
    const newRoomId = uuidV4();
    console.log(`🎯 Match found! Creating room ${newRoomId} for ${user1.sessionId} and ${user2.sessionId}`);
    io.to(user1.socketId).to(user2.socketId).emit('match-found', { roomId: newRoomId });
    // Set as main stage when they join; fallback timer will promote again if needed
  }
}

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server is listening on http://localhost:${PORT}`);
});
