import { useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import { socket } from './socket';
import { getSessionId } from './sessionId';

const peerConnectionConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

type CallState = 'waiting' | 'active' | 'ended';
interface ChatMessage { id: string; senderId: string; message: string; timestamp: string; }
interface ActiveRoom { roomId: string; viewerCount: number; }

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
  const pendingCandidatesRef = useRef<{ [key: string]: RTCIceCandidateInit[] }>({});
  const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [userRole, setUserRole] = useState<'participant' | 'spectator' | null>(null);
  const [reactions, setReactions] = useState<{ id: number, emoji: string }[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [callState, setCallState] = useState<CallState>('waiting');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [featuredRoomId, setFeaturedRoomId] = useState<string | null>(null);
  const [featuredEndsAt, setFeaturedEndsAt] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mediaStateByUser, setMediaStateByUser] = useState<{ [userId: string]: { muted: boolean; videoOff: boolean } }>({});
  const currentRoomRef = useRef<string | null>(null);
  const joinTimeoutRef = useRef<number | null>(null);
  const connectionRetryTimeoutRef = useRef<number | null>(null);
  const isInRoomRef = useRef<boolean>(false);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      });
      const roomId = location.pathname.split('/')[2];
      socket.emit('media-state', { roomId, sessionId: getSessionId(), muted: !localStream.getAudioTracks()[0].enabled, videoOff: isVideoOff });
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsVideoOff(!track.enabled);
      });
      const roomId = location.pathname.split('/')[2];
      socket.emit('media-state', { roomId, sessionId: getSessionId(), muted: isMuted, videoOff: !localStream.getVideoTracks()[0].enabled });
    }
  };

  const retryCameraAccess = () => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log('Camera and microphone access granted on retry');
        setLocalStream(stream);
        setUserRole('participant');
        setCameraError(null);
      })
      .catch(error => {
        console.error('Failed to get camera/microphone access on retry:', error);
        setCameraError(error.message || 'Camera access denied');
      });
  };

  // HOOK 1: Get user media and register session
  useEffect(() => {
    const sessionId = getSessionId();
    socket.emit('register-session', { sessionId });
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        // local media ready
        setLocalStream(stream);
        setUserRole('participant');
        setCameraError(null);
      })
      .catch(error => {
        console.error('Failed to get camera/microphone access:', error);
        setUserRole('spectator');
        setCameraError(error.message || 'Camera access denied');
      });
  }, []);

  // HOOK 2: Display local stream
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // HOOK 3: Handles global events - only run once
  useEffect(() => {
    const onMatchFound = ({ roomId }: { roomId: string }) => navigate(`/room/${roomId}`);
    const onActiveRoomsUpdate = ({ rooms }: { rooms: ActiveRoom[] }) => setActiveRooms(rooms);
    const onMainStageStatus = ({ roomId, endsAt }: { roomId: string | null; endsAt?: number | null }) => {
      setFeaturedRoomId(roomId || null);
      setFeaturedEndsAt(endsAt ?? null);
    };
    const onMainStageUpdate = ({ roomId, endsAt }: { roomId: string | null; endsAt?: number | null }) => {
      setFeaturedRoomId(roomId || null);
      setFeaturedEndsAt(endsAt ?? null);
    };

    socket.on('match-found', onMatchFound);
    socket.on('active-rooms-update', onActiveRoomsUpdate);
    socket.on('main-stage-status', onMainStageStatus);
    socket.on('main-stage-update', onMainStageUpdate);

    // Only join lobby and get status once
      socket.emit('join-lobby');
    socket.emit('get-main-stage-status');

    return () => {
      socket.off('match-found', onMatchFound);
      socket.off('active-rooms-update', onActiveRoomsUpdate);
      socket.off('main-stage-status', onMainStageStatus);
      socket.off('main-stage-update', onMainStageUpdate);
    };
  }, []); // Empty dependency array - only run once

  // HOOK 4: The main "In-Room" logic
  useEffect(() => {
    const roomId = location.pathname.split('/')[2];
    if (!roomId || !userRole) return;
    if (userRole === 'participant' && !localStream) return;

    // Prevent multiple setups for the same room
    if (currentRoomRef.current === roomId && isInRoomRef.current) {
      console.log(`⚠️ Already set up for room ${roomId}, skipping`);
      return;
    }

    // set up per-room wiring
    setCallState('waiting');
    setRemoteStreams({});
    setChatMessages([]);
    
    // Set the current room immediately to prevent duplicate setups
    currentRoomRef.current = roomId;
    isInRoomRef.current = true;
    
    // Always join the room when setting up room logic
    const currentSessionId = getSessionId();
    socket.emit('join-room', { roomId, sessionId: currentSessionId });
    
    // Set up a timeout to check if we need to establish connections manually
    setTimeout(() => {
        if (callState === 'waiting' && Object.keys(remoteStreams).length === 0) {
            console.log(`⏰ Timeout reached, checking for manual connection establishment`);
            // Try to get current participants from server
            socket.emit('get-room-participants', { roomId });
        }
    }, 3000);

    const createPeerConnection = (otherUserId: string, isInitiator: boolean) => {
        const currentUserId = getSessionId();
        if (otherUserId === currentUserId) {
            return;
        }
        
        // Check if we already have a connection to this user
        if (peerConnectionsRef.current[otherUserId]) {
            // already have a connection to this user
            // If we already have a connection, don't create a new one, but ensure it's in the right state
            const pc = peerConnectionsRef.current[otherUserId];
            if (isInitiator && pc.signalingState === 'stable' && pc.connectionState !== 'closed') {
                
                pc.createOffer()
                    .then(offer => pc.setLocalDescription(offer))
                    .then(() => socket.emit('webrtc-offer', { toUserId: otherUserId, sdp: pc.localDescription }))
                    .catch(err => console.error('Error creating offer for existing connection:', err));
            }
            return;
        }
        
        
        const pc = new RTCPeerConnection(peerConnectionConfig);
        peerConnectionsRef.current[otherUserId] = pc;
        
        if (userRole === 'participant' && localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        } else if (userRole === 'spectator') {
            // Spectator should explicitly request to receive media
            try {
                pc.addTransceiver('video', { direction: 'recvonly' });
                pc.addTransceiver('audio', { direction: 'recvonly' });
            } catch {}
        }
        
            pc.ontrack = event => {
               setRemoteStreams(prev => {
                   const newStreams = { ...prev, [otherUserId]: event.streams[0] };
                   return newStreams;
               });
           };
        
        pc.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', { toUserId: otherUserId, candidate: event.candidate });
            }
        };
        
            pc.onconnectionstatechange = () => {
               if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                   setRemoteStreams(prev => {
                       const newStreams = { ...prev };
                       delete newStreams[otherUserId];
                       return newStreams;
                   });
               }
           };
           
            pc.oniceconnectionstatechange = () => {};
        
        if (isInitiator) {
            pc.createOffer()
              .then(offer => {
                return pc.setLocalDescription(offer);
              })
              .then(() => {
                socket.emit('webrtc-offer', { toUserId: otherUserId, sdp: pc.localDescription });
              })
              .catch(err => console.error('Error creating offer:', err));
        }
    };
    
    const onWebRTCOffer = async ({ sdp, fromUserId }: { sdp: RTCSessionDescriptionInit, fromUserId: string }) => {
        try {
        createPeerConnection(fromUserId, false);
            const pc = peerConnectionsRef.current[fromUserId];
            
            // Check if peer connection is still valid
            if (!pc || pc.connectionState === 'closed') {
                console.warn(`Peer connection to ${fromUserId} is closed, cannot process offer`);
                return;
            }
            
            // Check if we can set the remote description
            if (pc.signalingState === 'stable') {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                
                
                // Process any pending ICE candidates
                if (pendingCandidatesRef.current[fromUserId]) {
                    for (const candidate of pendingCandidatesRef.current[fromUserId]) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (err) {
                            console.error('Error adding pending ICE candidate:', err);
                        }
                    }
                    delete pendingCandidatesRef.current[fromUserId];
                }
                
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('webrtc-answer', { toUserId: fromUserId, sdp: answer });
            } else if (pc.signalingState === 'have-local-offer') {
                // Handle glare condition - we already have a local offer, so we need to rollback
                try {
                    await pc.setLocalDescription({ type: 'rollback' });
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { toUserId: fromUserId, sdp: answer });
                } catch (rollbackError) {
                    console.error('❌ Rollback failed:', rollbackError);
                    // If rollback fails, try to close and recreate the connection
                    pc.close();
                    delete peerConnectionsRef.current[fromUserId];
                    createPeerConnection(fromUserId, false);
                }
            } else {
                // ignore unexpected state
            }
        } catch (err) {
            console.error('Error handling WebRTC offer:', err);
        }
    };
    
    const onWebRTCAnswer = async ({ sdp, fromUserId }: { sdp: RTCSessionDescriptionInit, fromUserId: string }) => {
        const pc = peerConnectionsRef.current[fromUserId];
        if (!pc) {
            console.error('No peer connection found for', fromUserId);
            return;
        }
        
        // Check if peer connection is still valid
        if (pc.connectionState === 'closed') {
            console.warn(`Peer connection to ${fromUserId} is closed, cannot process answer`);
            return;
        }
        
        try {
            // Check if we can set the remote description
            if (pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log('Remote description set from answer');
                
                // Process any pending ICE candidates
                if (pendingCandidatesRef.current[fromUserId]) {
                    for (const candidate of pendingCandidatesRef.current[fromUserId]) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (err) {
                            console.error('Error adding pending ICE candidate:', err);
                        }
                    }
                    delete pendingCandidatesRef.current[fromUserId];
                }
            } else if (pc.signalingState === 'stable') {
                // already in good shape
            } else {
                // ignore unexpected state
            }
        } catch (err) {
            console.error('Error handling WebRTC answer:', err);
        }
    };
    const onWebRTCIceCandidate = ({ candidate, fromUserId }: { candidate: RTCIceCandidateInit, fromUserId: string }) => {
        const pc = peerConnectionsRef.current[fromUserId];
        
        // Always store candidates for later processing if we can't add them immediately
        if (!pendingCandidatesRef.current[fromUserId]) {
            pendingCandidatesRef.current[fromUserId] = [];
        }
        
        if (pc && pc.signalingState !== 'closed' && pc.remoteDescription) {
            pc.addIceCandidate(new RTCIceCandidate(candidate))
                .then(() => console.log('ICE candidate added successfully'))
                .catch(err => {
                    console.error("Error adding ICE candidate:", err);
                    // If adding fails, store for later
                    pendingCandidatesRef.current[fromUserId].push(candidate);
                });
        } else {
            // Store the candidate for later
            pendingCandidatesRef.current[fromUserId].push(candidate);
        }
    };
    const onCurrentParticipants = ({ participantIds }: { participantIds: string[] }) => {
        console.log(`Current participants: ${participantIds.join(', ')}`);
        participantIds.forEach(id => createPeerConnection(id, true));
        if (participantIds.length > 0) setCallState('active');
    };
    


    const onUserJoined = ({ userId }: { userId: string }) => {
        // When a new user joins, create a peer connection to them
        const currentUserId = getSessionId();
        if (userId === currentUserId) {
            console.log(`⚠️ Ignoring user-joined event for self: ${userId}`);
            return;
        }
        
        // The user who was already in the room (receiving user-joined) should be the initiator
        createPeerConnection(userId, true);
        setCallState('active');
        
        // Set up a retry mechanism if we don't receive remote streams
        if (connectionRetryTimeoutRef.current) {
            clearTimeout(connectionRetryTimeoutRef.current);
        }
        
        connectionRetryTimeoutRef.current = setTimeout(() => {
            const currentRemoteStreams = Object.keys(remoteStreams);
            if (currentRemoteStreams.length === 0) {
                console.log(`⏰ No remote streams received after 5 seconds, retrying connection to ${userId}`);
                createPeerConnection(userId, true);
            }
        }, 5000);
        
        // Set up a retry mechanism if we don't receive remote streams
        if (connectionRetryTimeoutRef.current) {
            clearTimeout(connectionRetryTimeoutRef.current);
        }
        
        connectionRetryTimeoutRef.current = setTimeout(() => {
            const currentRemoteStreams = Object.keys(remoteStreams);
            if (currentRemoteStreams.length === 0) {
                console.log(`No remote streams received after 5 seconds, retrying connection to ${userId}`);
                createPeerConnection(userId, true);
            }
        }, 5000);
    };

    const onExistingParticipants = ({ participantIds }: { participantIds: string[] }) => {
        console.log(`🎯 Existing participants: ${participantIds.join(', ')}`);
        const currentUserId = getSessionId();
        console.log(`🔍 Current user ID: ${currentUserId}`);
        console.log(`🔍 Session storage ID: ${sessionStorage.getItem('kupid-sessionId')}`);
        const otherParticipants = participantIds.filter(id => id !== currentUserId);
        console.log(`🔍 Other participants after filtering: ${otherParticipants.join(', ')}`);
        
        if (otherParticipants.length === 0) {
            console.log(`⚠️ No other participants found (filtered out self: ${currentUserId})`);
            return;
        }
        
        otherParticipants.forEach(id => {
            console.log(`🔗 Creating peer connection to existing participant: ${id}`);
            // The user who joins later (receiving existing-participants) should NOT be the initiator
            createPeerConnection(id, false);
        });
        
        if (otherParticipants.length > 0) {
            console.log(`✅ Setting call state to active with ${otherParticipants.length} existing participants`);
            setCallState('active');
        }
    };

    const onUserLeft = ({ userId }: { userId: string }) => {
        console.log(`User ${userId} left the room`);
        if (peerConnectionsRef.current[userId]) {
            peerConnectionsRef.current[userId].close();
        delete peerConnectionsRef.current[userId];
        }
        // Clean up pending candidates
        if (pendingCandidatesRef.current[userId]) {
            delete pendingCandidatesRef.current[userId];
        }
        setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[userId];
            return newStreams;
        });
        setCallState('ended');
    };

    const onNewReaction = ({ reaction }: { reaction: string }) => {
        const newReaction = { id: Date.now(), emoji: reaction };
        setReactions(prev => [...prev, newReaction]);
        setTimeout(() => setReactions(prev => prev.filter(r => r.id !== newReaction.id)), 3000);
    };
    const onViewerCountUpdate = ({ count }: { count: number }) => setViewerCount(count);
    const onChatHistory = ({ history }: { history: ChatMessage[] }) => setChatMessages(history);
    const onNewChatMessage = ({ message }: { message: ChatMessage }) => setChatMessages(prev => [...prev, message]);

    socket.on('current-participants', onCurrentParticipants);
    socket.on('existing-participants', onExistingParticipants);
    socket.on('user-joined', onUserJoined);
    socket.on('webrtc-offer', onWebRTCOffer);
    socket.on('webrtc-answer', onWebRTCAnswer);
    socket.on('webrtc-ice-candidate', onWebRTCIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('new-reaction', onNewReaction);
    socket.on('viewer-count-update', onViewerCountUpdate);
    socket.on('chat-history', onChatHistory);
    socket.on('new-chat-message', onNewChatMessage);
    socket.on('media-state-update', ({ userId, muted, videoOff }: { userId: string; muted: boolean; videoOff: boolean }) => {
      setMediaStateByUser(prev => ({ ...prev, [userId]: { muted, videoOff } }));
    });



    return () => {
      console.log(`🧹 Cleaning up room logic for room ${location.pathname.split('/')[2]}`);
      
      // Only close connections if we're actually leaving the room (not just re-rendering)
      const isLeavingRoom = currentRoomRef.current !== location.pathname.split('/')[2];
      
      if (isLeavingRoom) {
        for(const userId in peerConnectionsRef.current) {
          console.log(`🔌 Closing peer connection to ${userId}`);
          peerConnectionsRef.current[userId].close();
        }
      setRemoteStreams({});
        // Clean up pending candidates
        pendingCandidatesRef.current = {};
        currentRoomRef.current = null;
        isInRoomRef.current = false;
      }
      
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
      if (connectionRetryTimeoutRef.current) {
        clearTimeout(connectionRetryTimeoutRef.current);
        connectionRetryTimeoutRef.current = null;
      }
      if (isLeavingRoom) {
      socket.off('current-participants');
      socket.off('existing-participants');
      socket.off('user-joined');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice-candidate');
      socket.off('user-left');
      socket.off('new-reaction');
      socket.off('viewer-count-update');
      socket.off('chat-history');
      socket.off('new-chat-message');
        socket.off('media-state-update');
      }
    };
  }, [localStream, location.pathname, userRole]);

  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<HomePage activeRooms={activeRooms} featuredRoomId={featuredRoomId} />} />
        <Route
          path="/room/:roomId"
          element={
            <RoomPage
              localVideoRef={localVideoRef}
              remoteStreams={remoteStreams}
              userRole={userRole}
              reactions={reactions}
              isMuted={isMuted}
              isVideoOff={isVideoOff}
              toggleMute={toggleMute}
              toggleVideo={toggleVideo}
              viewerCount={viewerCount}
              callState={callState}
              chatMessages={chatMessages}
              cameraError={cameraError}
              retryCameraAccess={retryCameraAccess}
              mediaStateByUser={mediaStateByUser}
            />
          }
        />
        <Route path="/" element={<HomePage activeRooms={activeRooms} featuredRoomId={featuredRoomId} featuredEndsAt={featuredEndsAt} />} />
      </Routes>
    </div>
  );
}

export default App;
