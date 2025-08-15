import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidV4 } from 'uuid';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Global state
const rooms = {};
const sessionMap = new Map();
let matchmakingQueue = [];
let mainStage = { roomId: null, endsAt: null, timer: null };
const currentRounds = {};
const compatibilityScores = {};
const audienceInteractions = {};

// Queue management functions - REMOVED
// const participantQueue = new Map();
// const addToParticipantQueue = (participantId, spectatorId) => { ... };
// const getNextFromParticipantQueue = (participantId) => { ... };
// const removeFromParticipantQueue = (participantId, spectatorId) => { ... };

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
  console.log(`🏠 Broadcasting active rooms: ${activeRooms.length}`, activeRooms);
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
  // Rapid rounds are already started when room gets 2 participants
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
  // Clear rounds for this room (but rounds continue if room still has 2+ participants)
  clearRoundsForRoom(roomId);
};

const clearRoundsForRoom = (roomId) => {
  // Clear rounds for any room
  if (currentRounds[roomId]) {
    if (currentRounds[roomId].timer) clearTimeout(currentRounds[roomId].timer);
    delete currentRounds[roomId];
    console.log(`🎬 Cleared Rapid Rounds for room ${roomId}`);
  }
};

// Compatibility scoring functions
const COMPATIBILITY_FACTORS = {
  // Topic matching (shared interests)
  TOPIC_MATCH: {
    weight: 0.3,
    keywords: {
      'travel': ['travel', 'vacation', 'trip', 'adventure', 'explore', 'destination'],
      'music': ['music', 'song', 'artist', 'concert', 'playlist', 'genre'],
      'food': ['food', 'cooking', 'restaurant', 'cuisine', 'recipe', 'dining'],
      'movies': ['movie', 'film', 'cinema', 'actor', 'director', 'genre'],
      'sports': ['sport', 'fitness', 'workout', 'gym', 'running', 'team'],
      'books': ['book', 'reading', 'author', 'novel', 'literature', 'story'],
      'technology': ['tech', 'gadget', 'app', 'software', 'programming', 'innovation'],
      'nature': ['nature', 'outdoor', 'hiking', 'camping', 'environment', 'green']
    }
  },
  // Response patterns (energy matching)
  RESPONSE_PATTERN: {
    weight: 0.25,
    indicators: {
      'enthusiastic': ['!', '😍', '🔥', 'amazing', 'love', 'awesome', 'incredible'],
      'thoughtful': ['hmm', 'interesting', 'good point', 'well', 'consider'],
      'humorous': ['haha', 'lol', '😂', 'funny', 'joke', 'hilarious'],
      'curious': ['why', 'how', 'what', 'tell me more', 'interesting']
    }
  },
  // Interaction quality (engagement)
  INTERACTION_QUALITY: {
    weight: 0.25,
    factors: {
      'response_time': { weight: 0.4, threshold: 30000 }, // 30 seconds
      'message_length': { weight: 0.3, min_length: 10 },
      'question_asking': { weight: 0.3, bonus: 10 }
    }
  },
  // Personality indicators
  PERSONALITY_MATCH: {
    weight: 0.2,
    traits: {
      'extrovert': ['party', 'social', 'people', 'crowd', 'energy'],
      'introvert': ['quiet', 'alone', 'peaceful', 'calm', 'reflection'],
      'adventurous': ['adventure', 'risk', 'new', 'explore', 'challenge'],
      'cautious': ['safe', 'careful', 'plan', 'think', 'consider']
    }
  }
};

const analyzeMessage = (message) => {
  const analysis = {
    topics: [],
    patterns: [],
    personality: [],
    quality: {
      length: message.length,
      hasQuestion: /\?/.test(message),
      hasEmoji: /[😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠💀👻👽🤖😺😸😹😻😼😽🙀😿😾🙈🙉🙊💌💘💝💖💗💓💞💕💟❣️💔❤️🧡💛💚💙💜🖤🤍🤎💯💢💥💫💦💨🕳️💬🗨️🗯️💭💤]/u.test(message),
      hasExclamation: /!/.test(message)
    }
  };

  const lowerMessage = message.toLowerCase();

  // Analyze topics
  Object.entries(COMPATIBILITY_FACTORS.TOPIC_MATCH.keywords).forEach(([topic, keywords]) => {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      analysis.topics.push(topic);
    }
  });

  // Analyze response patterns
  Object.entries(COMPATIBILITY_FACTORS.RESPONSE_PATTERN.indicators).forEach(([pattern, indicators]) => {
    if (indicators.some(indicator => lowerMessage.includes(indicator))) {
      analysis.patterns.push(pattern);
    }
  });

  // Analyze personality
  Object.entries(COMPATIBILITY_FACTORS.PERSONALITY_MATCH.traits).forEach(([trait, keywords]) => {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      analysis.personality.push(trait);
    }
  });

  return analysis;
};

const calculateCompatibilityScore = (roomId) => {
  if (!rooms[roomId] || rooms[roomId].participants.length < 2) return null;

  const room = rooms[roomId];
  const chatHistory = room.chatHistory || [];
  
  if (chatHistory.length < 2) return null;

  let score = 50; // Base score
  const factors = {
    topicMatch: 0,
    responsePattern: 0,
    interactionQuality: 0,
    personalityMatch: 0
  };

  // Analyze all messages
  const analyses = chatHistory.map(msg => analyzeMessage(msg.message));
  const participantIds = room.participants.map(p => p.sessionId);
  
  // Topic matching
  const allTopics = analyses.flatMap(a => a.topics);
  const topicCounts = {};
  allTopics.forEach(topic => {
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  });
  
  const sharedTopics = Object.values(topicCounts).filter(count => count > 1).length;
  factors.topicMatch = Math.min(sharedTopics * 15, 30); // Max 30 points

  // Response pattern matching
  const patterns = analyses.flatMap(a => a.patterns);
  const patternDiversity = new Set(patterns).size;
  factors.responsePattern = Math.min(patternDiversity * 8, 25); // Max 25 points

  // Interaction quality
  const avgLength = analyses.reduce((sum, a) => sum + a.quality.length, 0) / analyses.length;
  const questionCount = analyses.filter(a => a.quality.hasQuestion).length;
  const emojiCount = analyses.filter(a => a.quality.hasEmoji).length;
  
  factors.interactionQuality = Math.min(
    (avgLength / 20) * 10 + // Length bonus
    questionCount * 3 + // Question bonus
    emojiCount * 2, // Emoji bonus
    25
  );

  // Personality matching
  const personalities = analyses.flatMap(a => a.personality);
  const personalityDiversity = new Set(personalities).size;
  factors.personalityMatch = Math.min(personalityDiversity * 5, 20); // Max 20 points

  // Calculate final score
  score += factors.topicMatch + factors.responsePattern + factors.interactionQuality + factors.personalityMatch;
  score = Math.max(0, Math.min(100, score)); // Clamp between 0-100

  return {
    score: Math.round(score),
    factors,
    lastUpdate: Date.now()
  };
};

const updateCompatibilityScore = (roomId) => {
  const newScore = calculateCompatibilityScore(roomId);
  if (newScore) {
    compatibilityScores[roomId] = newScore;
    console.log(`💕 Compatibility score for room ${roomId}: ${newScore.score}/100`);
    io.to(roomId).emit('compatibility-update', newScore);
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
            // Clear rounds if participants drop below 2
            if (room.participants.length < 2 && currentRounds[roomId]) {
                clearRoundsForRoom(roomId);
            }
            
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
    // Send current active rooms on lobby join
    const activeRooms = Object.entries(rooms)
      .filter(([, roomData]) => roomData.participants.length >= 1)
      .map(([roomId, roomData]) => ({
        roomId,
        viewerCount: roomData.participants.length + roomData.spectators.length,
      }));
    socket.emit('active-rooms-update', { rooms: activeRooms });
  });
  socket.on('leave-lobby', () => socket.leave('lobby'));

  // Manual room creation - user provides room ID
  socket.on('create-room', ({ sessionId, roomId }) => {
    if (!roomId) {
      socket.emit('room-error', { message: 'Room ID is required' });
      return;
    }
    
    if (rooms[roomId]) {
      socket.emit('room-error', { message: 'Room already exists' });
      return;
    }
    
    console.log(`🏠 User ${sessionId} creating room ${roomId}`);
    rooms[roomId] = { participants: [], spectators: [], chatHistory: [] };
    socket.emit('room-created', { roomId });
  });

  // Automatic matchmaking queue
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
    // Ensure session is registered
    if (!sessionId) {
      console.log(`⚠️ No sessionId provided for join-room from socket ${socket.id}`);
      return;
    }
    
    // Register session if not already registered
    if (!sessionMap.has(socket.id)) {
      sessionMap.set(socket.id, sessionId);
      console.log(`✅ Auto-registered session: Socket ${socket.id} is session ${sessionId}`);
    }
    
    console.log(`🚪 User ${sessionId} (socket ${socket.id}) joining room ${roomId}`);
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { participants: [], spectators: [], chatHistory: [] };
      console.log(`🏠 Created new room ${roomId}`);
    }
    
    // Remove user from both participants and spectators to avoid duplicates
    rooms[roomId].participants = rooms[roomId].participants.filter(p => p.sessionId !== sessionId);
    rooms[roomId].spectators = rooms[roomId].spectators.filter(s => s.sessionId !== sessionId);

    const newUser = { socketId: socket.id, sessionId };
    console.log(`👥 Room ${roomId} currently has ${rooms[roomId].participants.length} participants`);
    
    // Check if user is already a participant in this room (same session ID)
    const isAlreadyParticipant = rooms[roomId].participants.some(p => p.sessionId === sessionId);
    
    if (rooms[roomId].participants.length < 2 && !isAlreadyParticipant) {
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
      
      // Don't automatically start rapid rounds - users will trigger manually
      if (rooms[roomId].participants.length === 2) {
        console.log(`👥 Room ${roomId} now has 2 participants - waiting for manual round start`);
      }
    } else {
      console.log(`👀 Adding ${sessionId} as spectator (room is full or already participant)`);
      rooms[roomId].spectators.push(newUser);
      const participantIds = rooms[roomId].participants.map(p => p.sessionId);
      io.to(socket.id).emit('current-participants', { participantIds });
    }
    socket.emit('chat-history', { history: rooms[roomId].chatHistory });
    broadcastViewerCount(roomId);
    // Broadcast active rooms after spectator join too
    broadcastActiveRooms();
  });

  // Add new matchmaking feature for spectators - REMOVED
  // const createMatchFromSpectator = (spectatorId, participantId) => { ... };

  // New event for spectator matchmaking - REMOVED
  // socket.on('spectator-match-request', ({ roomId, targetParticipantId, spectatorId }) => { ... });

  // New event for participants to check their queue - REMOVED
  // socket.on('check-participant-queue', ({ participantId }) => { ... });

  // New event for participants to accept next person from queue - REMOVED
  // socket.on('accept-next-from-queue', ({ participantId }) => { ... });

  // New event for spectators to remove themselves from participant's queue - REMOVED
  // socket.on('remove-from-participant-queue', ({ participantId, spectatorId }) => { ... });

  socket.on('send-chat-message', ({ roomId, message, sessionId }) => {
    if (!sessionId) {
      console.log(`⚠️ No sessionId provided for chat message from socket ${socket.id}`);
      return;
    }
    
    // Register session if not already registered
    if (!sessionMap.has(socket.id)) {
      sessionMap.set(socket.id, sessionId);
      console.log(`✅ Auto-registered session: Socket ${socket.id} is session ${sessionId}`);
    }
    
    if (rooms[roomId]) {
      const newMessage = { id: uuidV4(), senderId: sessionId, message: message, timestamp: new Date().toISOString() };
      rooms[roomId].chatHistory.push(newMessage);
      io.to(roomId).emit('new-chat-message', { message: newMessage });
      
      // Update compatibility score after each message
      if (rooms[roomId].participants.length >= 2) {
        updateCompatibilityScore(roomId);
      }
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
    if (sessionId) {
      removeUser(socket.id);
      // Clear rounds if participant left any room
      for (const roomId in rooms) {
        const r = rooms[roomId];
        if (!r) continue;
        const isParticipant = r.participants.find(p => p.sessionId === sessionId);
        if (isParticipant) {
          clearRoundsForRoom(roomId);
          break;
        }
      }
    } else {
      console.log(`⚠️ No session found for disconnected socket ${socket.id}`);
    }
  });

  // Debug command to log all rooms
  socket.on('debug-rooms', () => {
    logAllRooms();
  });
  
  // Get room participants for manual connection establishment
  socket.on('get-room-participants', ({ roomId }) => {
    const sessionId = sessionMap.get(socket.id);
    if (!sessionId) {
      console.log(`⚠️ No session found for socket ${socket.id} in get-room-participants`);
      return;
    }
    
    console.log(`🔍 User ${sessionId} requesting participants for room ${roomId}`);
    if (rooms[roomId]) {
      const currentUserId = sessionId;
      const participantIds = rooms[roomId].participants
        .map(p => p.sessionId)
        .filter(id => id !== currentUserId); // Exclude the current user
      console.log(`📡 Sending ${participantIds.length} participants to ${currentUserId}: ${participantIds.join(', ')}`);
      socket.emit('existing-participants', { participantIds });
    } else {
      console.log(`❌ Room ${roomId} not found`);
    }
  });

  // Provide current rapid round state to late joiners
  socket.on('get-current-round', ({ roomId }) => {
    const state = currentRounds[roomId];
    if (!state) {
      socket.emit('current-round', { roomId, round: null });
    } else {
      socket.emit('current-round', {
        roomId,
        round: {
          index: state.currentIndex,
          title: state.title,
          prompt: state.prompt,
          endsAt: state.endsAt,
          totalRounds: state.sessionRounds?.length || 0
        }
      });
    }
  });

  // Manual round restart (for testing or if rounds get stuck)
  socket.on('restart-rounds', ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId].participants.length >= 2) {
      console.log(`🔄 Manually restarting rounds for room ${roomId}`);
      clearRoundsForRoom(roomId);
      startRapidRounds(roomId);
    }
  });

  // Manual start of rapid rounds
  socket.on('start-rounds', ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId].participants.length >= 2) {
      console.log(`🎬 Manually starting rapid rounds for room ${roomId}`);
      startRapidRounds(roomId);
    } else {
      socket.emit('rounds-error', { message: 'Need at least 2 participants to start rounds' });
    }
  });

  // Audience voting system
  socket.on('audience-vote', ({ roomId, voteType, option }) => {
    if (!rooms[roomId]) return;
    
    if (!audienceInteractions[roomId]) {
      audienceInteractions[roomId] = { votes: {}, questions: [], polls: {} };
    }
    
    const sessionId = sessionMap.get(socket.id);
    const voteKey = `${voteType}-${option}`;
    
    if (!audienceInteractions[roomId].votes[voteKey]) {
      audienceInteractions[roomId].votes[voteKey] = new Set();
    }
    
    // Remove previous vote from this user for this vote type
    Object.keys(audienceInteractions[roomId].votes).forEach(key => {
      if (key.startsWith(voteType + '-')) {
        audienceInteractions[roomId].votes[key].delete(sessionId);
      }
    });
    
    // Add new vote
    audienceInteractions[roomId].votes[voteKey].add(sessionId);
    
    // Broadcast updated vote counts
    const voteCounts = {};
    Object.keys(audienceInteractions[roomId].votes).forEach(key => {
      if (key.startsWith(voteType + '-')) {
        voteCounts[key] = audienceInteractions[roomId].votes[key].size;
      }
    });
    
    console.log(`🗳️ Audience vote in room ${roomId}: ${voteType} - ${option} (${audienceInteractions[roomId].votes[voteKey].size} votes)`);
    io.to(roomId).emit('audience-vote-update', { voteType, voteCounts });
  });

  // Audience questions
  socket.on('submit-audience-question', ({ roomId, question }) => {
    if (!rooms[roomId]) return;
    
    if (!audienceInteractions[roomId]) {
      audienceInteractions[roomId] = { votes: {}, questions: [], polls: {} };
    }
    
    const sessionId = sessionMap.get(socket.id);
    const newQuestion = {
      id: uuidV4(),
      question,
      submitterId: sessionId,
      timestamp: Date.now(),
      upvotes: new Set([sessionId]) // Self-upvote
    };
    
    audienceInteractions[roomId].questions.push(newQuestion);
    
    console.log(`❓ Audience question in room ${roomId}: "${question}"`);
    io.to(roomId).emit('new-audience-question', { 
      question: newQuestion,
      totalQuestions: audienceInteractions[roomId].questions.length
    });
  });

  // Upvote audience questions
  socket.on('upvote-question', ({ roomId, questionId }) => {
    if (!rooms[roomId] || !audienceInteractions[roomId]) return;
    
    const sessionId = sessionMap.get(socket.id);
    const question = audienceInteractions[roomId].questions.find(q => q.id === questionId);
    
    if (question) {
      question.upvotes.add(sessionId);
      console.log(`👍 Question upvoted in room ${roomId}: ${question.upvotes.size} upvotes`);
      io.to(roomId).emit('question-upvote-update', { questionId, upvotes: question.upvotes.size });
    }
  });

  // Start audience poll
  socket.on('start-audience-poll', ({ roomId, question, options }) => {
    if (!rooms[roomId]) return;
    
    if (!audienceInteractions[roomId]) {
      audienceInteractions[roomId] = { votes: {}, questions: [], polls: {} };
    }
    
    const pollId = uuidV4();
    audienceInteractions[roomId].polls[pollId] = {
      question,
      options,
      votes: {},
      endTime: Date.now() + 30000, // 30 seconds
      active: true
    };
    
    console.log(`📊 Starting audience poll in room ${roomId}: "${question}"`);
    io.to(roomId).emit('audience-poll-start', { 
      pollId, 
      question, 
      options, 
      endTime: audienceInteractions[roomId].polls[pollId].endTime 
    });
    
    // Auto-end poll after 30 seconds
    setTimeout(() => {
      if (audienceInteractions[roomId]?.polls[pollId]) {
        audienceInteractions[roomId].polls[pollId].active = false;
        const results = {};
        options.forEach(option => {
          results[option] = audienceInteractions[roomId].polls[pollId].votes[option]?.size || 0;
        });
        io.to(roomId).emit('audience-poll-end', { pollId, results });
      }
    }, 30000);
  });

  // Vote in audience poll
  socket.on('vote-in-poll', ({ roomId, pollId, option }) => {
    if (!rooms[roomId] || !audienceInteractions[roomId]?.polls[pollId]) return;
    
    const sessionId = sessionMap.get(socket.id);
    const poll = audienceInteractions[roomId].polls[pollId];
    
    if (!poll.active) return;
    
    // Remove previous vote
    Object.keys(poll.votes).forEach(opt => {
      poll.votes[opt]?.delete(sessionId);
    });
    
    // Add new vote
    if (!poll.votes[option]) {
      poll.votes[option] = new Set();
    }
    poll.votes[option].add(sessionId);
    
    console.log(`🗳️ Poll vote in room ${roomId}: ${option} (${poll.votes[option].size} votes)`);
    io.to(roomId).emit('poll-vote-update', { pollId, option, votes: poll.votes[option].size });
  });

  socket.on('join-room', ({ roomId, sessionId }) => {
    // Ensure session is registered
    if (!sessionId) {
      console.log(`⚠️ No sessionId provided for join-room from socket ${socket.id}`);
      return;
    }
    
    // Register session if not already registered
    if (!sessionMap.has(socket.id)) {
      sessionMap.set(socket.id, sessionId);
      console.log(`✅ Auto-registered session: Socket ${socket.id} is session ${sessionId}`);
    }
    
    console.log(`🚪 User ${sessionId} (socket ${socket.id}) joining room ${roomId}`);
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { participants: [], spectators: [], chatHistory: [] };
      console.log(`🏠 Created new room ${roomId}`);
    }
    
    // Remove user from both participants and spectators to avoid duplicates
    rooms[roomId].participants = rooms[roomId].participants.filter(p => p.sessionId !== sessionId);
    rooms[roomId].spectators = rooms[roomId].spectators.filter(s => s.sessionId !== sessionId);

    const newUser = { socketId: socket.id, sessionId };
    console.log(`👥 Room ${roomId} currently has ${rooms[roomId].participants.length} participants`);
    
    // Check if user is already a participant in this room (same session ID)
    const isAlreadyParticipant = rooms[roomId].participants.some(p => p.sessionId === sessionId);
    
    if (rooms[roomId].participants.length < 2 && !isAlreadyParticipant) {
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
      
      // Don't automatically start rapid rounds - users will trigger manually
      if (rooms[roomId].participants.length === 2) {
        console.log(`👥 Room ${roomId} now has 2 participants - waiting for manual round start`);
      }
    } else {
      console.log(`👀 Adding ${sessionId} as spectator (room is full or already participant)`);
      rooms[roomId].spectators.push(newUser);
      const participantIds = rooms[roomId].participants.map(p => p.sessionId);
      io.to(socket.id).emit('current-participants', { participantIds });
    }
    socket.emit('chat-history', { history: rooms[roomId].chatHistory });
    broadcastViewerCount(roomId);
    // Broadcast active rooms after spectator join too
    broadcastActiveRooms();
  });
});

// Helper to promote next two users from queue into a new room
function tryPromoteFromQueue() {
  if (matchmakingQueue.length >= 2) {
    const user1 = matchmakingQueue.shift();
    const user2 = matchmakingQueue.shift();
    const newRoomId = uuidV4();
    console.log(`🎯 Match found! Creating room ${newRoomId} for ${user1.sessionId} and ${user2.sessionId}`);
    io.to(user1.socketId).to(user2.socketId).emit('match-found', { roomId: newRoomId });
  }
}

// Rapid rounds helpers
const ROUNDS = [
  // Icebreaker rounds
  { title: 'Round 1 · Icebreaker', prompt: 'Two truths and a lie. Go!', duration: 60 },
  { title: 'Round 1 · Quick Fire', prompt: 'What\'s your most chaotic midnight snack?', duration: 45 },
  { title: 'Round 1 · Energy Check', prompt: 'Show us your best dance move in 3 seconds!', duration: 30 },
  
  // Personality rounds
  { title: 'Round 2 · Personality', prompt: 'Describe your perfect chaotic weekend in 15 seconds.', duration: 60 },
  { title: 'Round 2 · Hot Takes', prompt: 'Pineapple on pizza: defend your stance!', duration: 45 },
  { title: 'Round 2 · Vibes Only', prompt: 'What\'s your most ick-worthy habit? (Keep it PG!)', duration: 45 },
  
  // Connection rounds
  { title: 'Round 3 · Connection', prompt: 'What\'s the weirdest thing you\'ve ever googled?', duration: 60 },
  { title: 'Round 3 · Future Plans', prompt: 'Describe your dream date in exactly 10 words.', duration: 45 },
  { title: 'Round 3 · Truth Time', prompt: 'What\'s your biggest red flag? (Be honest!)', duration: 60 },
  
  // Bonus rounds
  { title: 'Round 4 · Wild Card', prompt: 'Act out your favorite movie scene in 20 seconds!', duration: 60 },
  { title: 'Round 4 · Speed Round', prompt: 'Answer these 5 questions in 30 seconds: 1) Coffee or tea? 2) Beach or mountains? 3) Morning or night? 4) Sweet or savory? 5) Introvert or extrovert?', duration: 45 },
  { title: 'Round 4 · Final Question', prompt: 'What\'s one thing you\'d change about dating apps?', duration: 60 }
];

// Round configuration
const ROUND_CONFIG = {
  totalRounds: parseInt(process.env.ROUNDS_PER_SESSION) || 3, // Number of rounds per session
  baseDuration: parseInt(process.env.ROUND_BASE_DURATION) || 60, // Base duration in seconds
  randomizePrompts: process.env.RANDOMIZE_PROMPTS !== 'false', // Whether to randomize prompt selection
  allowBonusRounds: process.env.ALLOW_BONUS_ROUNDS === 'true' // Whether to allow extra rounds
};

console.log('🎬 Rapid Rounds Configuration:', ROUND_CONFIG);

function getRandomRounds(count = ROUND_CONFIG.totalRounds) {
  const shuffled = [...ROUNDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function startRapidRounds(roomId) {
  // Get random rounds for this session
  const sessionRounds = ROUND_CONFIG.randomizePrompts 
    ? getRandomRounds(ROUND_CONFIG.totalRounds)
    : ROUNDS.slice(0, ROUND_CONFIG.totalRounds);
  
  // Store session rounds
  currentRounds[roomId] = {
    sessionRounds,
    currentIndex: 0
  };
  
  // Begin at round 0
  scheduleRound(roomId, 0);
}

function scheduleRound(roomId, index) {
  // Clear previous timer
  if (currentRounds[roomId]?.timer) clearTimeout(currentRounds[roomId].timer);
  
  const sessionData = currentRounds[roomId];
  if (!sessionData || index >= sessionData.sessionRounds.length) {
    // Finished all rounds
    io.to(roomId).emit('round-end', { roomId, message: 'All rounds complete! 🎉' });
    delete currentRounds[roomId];
    return;
  }
  
  const round = sessionData.sessionRounds[index];
  const durationMs = (round.duration || ROUND_CONFIG.baseDuration) * 1000;
  const endsAt = Date.now() + durationMs;
  
  // Update current round state
  currentRounds[roomId] = {
    ...sessionData,
    currentIndex: index,
    title: round.title,
    prompt: round.prompt,
    endsAt,
    timer: setTimeout(() => scheduleRound(roomId, index + 1), durationMs)
  };
  
  console.log(`🎬 Starting round ${index + 1}/${sessionData.sessionRounds.length} in room ${roomId}: "${round.title}"`);
  
  io.to(roomId).emit('round-start', {
    roomId,
    index,
    title: round.title,
    prompt: round.prompt,
    endsAt,
    totalRounds: sessionData.sessionRounds.length
  });
}

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server is listening on http://localhost:${PORT}`);
});
