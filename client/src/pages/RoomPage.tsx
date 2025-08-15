import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { getSessionId } from '../sessionId';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';

interface ChatMessage { id: string; senderId: string; message: string; timestamp: string; }
interface RoomPageProps {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteStreams: { [key: string]: MediaStream };
  userRole: 'participant' | 'spectator' | null;
  reactions: { id: number; emoji: string }[];
  isMuted: boolean;
  isVideoOff: boolean;
  toggleMute: () => void;
  toggleVideo: () => void;
  viewerCount: number;
  callState: 'waiting' | 'active' | 'ended';
  chatMessages: ChatMessage[];
  cameraError: string | null;
  retryCameraAccess: () => void;
  mediaStateByUser: { [userId: string]: { muted: boolean; videoOff: boolean } };
}

export const RoomPage: React.FC<RoomPageProps> = ({ 
  localVideoRef, 
  remoteStreams, 
  userRole, 
  reactions, 
  isMuted, 
  isVideoOff, 
  toggleMute, 
  toggleVideo, 
  viewerCount, 
  callState, 
  chatMessages, 
  cameraError, 
  retryCameraAccess, 
  mediaStateByUser,
}: RoomPageProps) => {
  console.log(`🎭 RoomPage render - userRole: ${userRole}`);
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAudiencePanel, setShowAudiencePanel] = useState(false);
  const [roundTitle, setRoundTitle] = useState<string | null>(null);
  const [roundPrompt, setRoundPrompt] = useState<string | null>(null);
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(null);
  const [audienceVotes, setAudienceVotes] = useState<{ [voteType: string]: { [option: string]: number } }>({});
  const [audienceQuestions, setAudienceQuestions] = useState<{ id: string; question: string; upvotes: number; timestamp: number }[]>([]);
  const [currentPoll, setCurrentPoll] = useState<{ id: string; question: string; options: string[]; votes: { [option: string]: number }; endsAt: number } | null>(null);
  const [compatibilityScore, setCompatibilityScore] = useState<number | null>(null);
  const [compatibilityAnalysis, setCompatibilityAnalysis] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Compatibility scoring state
  const [, forceTick] = useState(0);
  const remoteVideoRefs = useRef<{ [userId: string]: HTMLVideoElement | null }>({});
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Update remote video elements when streams change
  useEffect(() => {
    Object.entries(remoteStreams).forEach(([userId, stream]) => {
      const videoElement = remoteVideoRefs.current[userId];
      if (videoElement && videoElement.srcObject !== stream) {
        console.log(`🎥 Setting srcObject for ${userId}`);
        videoElement.srcObject = stream;
      }
    });
  }, [remoteStreams]);

  // Cleanup video refs when streams are removed
  useEffect(() => {
    const currentUserIds = Object.keys(remoteStreams);
    Object.keys(remoteVideoRefs.current).forEach(userId => {
      if (!currentUserIds.includes(userId)) {
        console.log(`🧹 Cleaning up video ref for ${userId}`);
        remoteVideoRefs.current[userId] = null;
      }
    });
  }, [remoteStreams]);

  // Rapid rounds listeners
  useEffect(() => {
    const onRoundStart = ({ title, prompt, endsAt, index, totalRounds }: { 
      title: string; 
      prompt: string; 
      endsAt: number; 
      index: number;
      totalRounds: number;
    }) => {
      console.log(`🎬 Round ${index + 1}/${totalRounds} started: ${title}`);
      setRoundTitle(title);
      setRoundPrompt(prompt);
      setRoundEndsAt(endsAt);
    };
    const onRoundEnd = ({ message }: { message?: string }) => {
      console.log(`🎬 Rounds ended: ${message || 'All rounds complete!'}`);
      setRoundTitle(null);
      setRoundPrompt(null);
      setRoundEndsAt(null);
    };
    socket.on('round-start', onRoundStart);
    socket.on('round-end', onRoundEnd);
    // Ask for current round on mount for late joiners
    socket.emit('get-current-round', { roomId });
    socket.on('current-round', ({ round }: any) => {
      if (round) {
        setRoundTitle(round.title);
        setRoundPrompt(round.prompt);
        setRoundEndsAt(round.endsAt);
      }
    });
    // Local timer tick each second
    const t = setInterval(() => forceTick(v => v + 1), 1000);
    return () => {
      clearInterval(t);
      socket.off('round-start', onRoundStart);
      socket.off('round-end', onRoundEnd);
      socket.off('current-round');
    };
  }, [roomId]);

  // Audience interaction listeners
  useEffect(() => {
    const onAudienceVoteUpdate = ({ voteType, voteCounts }: { voteType: string; voteCounts: { [key: string]: number } }) => {
      setAudienceVotes(prev => ({
        ...prev,
        [voteType]: voteCounts
      }));
    };

    const onNewAudienceQuestion = ({ question }: { question: { id: string; question: string; upvotes: Set<string>; timestamp: number } }) => {
      setAudienceQuestions(prev => [...prev, {
        id: question.id,
        question: question.question,
        upvotes: question.upvotes.size,
        timestamp: question.timestamp
      }]);
    };

    const onQuestionUpvoteUpdate = ({ questionId, upvotes }: { questionId: string; upvotes: number }) => {
      setAudienceQuestions(prev => prev.map(q => 
        q.id === questionId ? { ...q, upvotes } : q
      ));
    };

    const onAudiencePollStart = ({ pollId, question, options, endTime }: { pollId: string; question: string; options: string[]; endTime: number }) => {
      setCurrentPoll({ id: pollId, question, options, votes: {}, endsAt: endTime });
    };

    const onPollVoteUpdate = ({ pollId, option, votes }: { pollId: string; option: string; votes: number }) => {
      setCurrentPoll(prev => prev && prev.id === pollId ? { ...prev, votes: { ...prev.votes, [option]: votes } } : prev);
    };

    const onAudiencePollEnd = ({ results: _results }: { pollId: string; results: { [option: string]: number } }) => {
      setCurrentPoll(null);
      // Show results for 5 seconds then clear
      setTimeout(() => setCurrentPoll(null), 5000);
    };

    const onCompatibilityUpdate = (data: { score: number; factors: any; lastUpdate: number }) => {
      console.log('💕 Compatibility update:', data);
      setCompatibilityScore(data.score);
      setCompatibilityAnalysis(JSON.stringify(data.factors, null, 2));
    };

    socket.on('audience-vote-update', onAudienceVoteUpdate);
    socket.on('new-audience-question', onNewAudienceQuestion);
    socket.on('question-upvote-update', onQuestionUpvoteUpdate);
    socket.on('audience-poll-start', onAudiencePollStart);
    socket.on('poll-vote-update', onPollVoteUpdate);
    socket.on('audience-poll-end', onAudiencePollEnd);
    socket.on('compatibility-update', onCompatibilityUpdate);

    return () => {
      socket.off('audience-vote-update', onAudienceVoteUpdate);
      socket.off('new-audience-question', onNewAudienceQuestion);
      socket.off('question-upvote-update', onQuestionUpvoteUpdate);
      socket.off('audience-poll-start', onAudiencePollStart);
      socket.off('poll-vote-update', onPollVoteUpdate);
      socket.off('audience-poll-end', onAudiencePollEnd);
      socket.off('compatibility-update', onCompatibilityUpdate);
    };
  }, [navigate]);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Room link copied to clipboard!');
  };

  const sendReaction = (reaction: string) => {
    if (!roomId) return;
    socket.emit('send-reaction', { roomId, reaction });
  };
  const handleFindNewDate = () => navigate('/');
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim() && roomId) {
      socket.emit('send-chat-message', { roomId, message: chatInput, sessionId: getSessionId() });
      setChatInput('');
      setShowEmojiPicker(false);
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setChatInput(prevInput => prevInput + emojiData.emoji);
  };

  // Audience interaction handlers
  const handleAudienceVote = (voteType: string, option: string) => {
    if (!roomId) return;
    socket.emit('audience-vote', { roomId, voteType, option });
  };

  const handleSubmitQuestion = (question: string) => {
    if (!roomId || !question.trim()) return;
    socket.emit('submit-audience-question', { roomId, question: question.trim() });
  };

  const handleUpvoteQuestion = (questionId: string) => {
    if (!roomId) return;
    socket.emit('upvote-question', { roomId, questionId });
  };

  const handleVoteInPoll = (pollId: string, option: string) => {
    if (!roomId) return;
    socket.emit('vote-in-poll', { roomId, pollId, option });
  };

  // Poll functionality removed - participants should not start polls
  // const handleStartPoll = (question: string, options: string[]) => {
  //   if (!roomId || !question.trim() || options.length < 2) return;
  //   socket.emit('start-audience-poll', { roomId, question: question.trim(), options });
  // };

  const isParticipant = userRole === 'participant';
  const hasRemoteStreams = Object.keys(remoteStreams).length > 0;
  const participantCount = Object.keys(remoteStreams).length + (isParticipant ? 1 : 0);
  const canStartRounds = participantCount >= 2 && !roundTitle;

  const StatusMessage = () => {
    if (callState === 'active') return null;
    
    // Show camera error if there is one
    if (cameraError && userRole === 'participant') {
      return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <h2 style={{ color: '#e74c3c' }}>Camera Access Error</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>{cameraError}</p>
          <button 
            style={{ fontSize: '18px', padding: '10px 20px', cursor: 'pointer', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px' }} 
            onClick={retryCameraAccess}
          >
            Retry Camera Access
          </button>
        </div>
      );
    }
    
    if (userRole === 'spectator' && !hasRemoteStreams) return <h2 style={{ color: 'var(--text-secondary)' }}>Waiting for participants to connect...</h2>;
    
    // Show "Start Dating" button when 2+ participants but no rounds active
    if (canStartRounds && isParticipant) {
      return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '20px' }}>Ready to start dating! 🎬</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Both participants are connected. Click to start the Rapid Rounds!</p>
          <button 
            style={{ fontSize: '18px', padding: '12px 24px', cursor: 'pointer', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600' }} 
            onClick={() => {
              if (roomId) {
                socket.emit('start-rounds', { roomId });
              }
            }}
          >
            🎬 Start Dating Rounds
          </button>
        </div>
      );
    }
    
    if (isParticipant) {
      if (callState === 'waiting' && !hasRemoteStreams) return <h2 style={{ color: 'var(--text-secondary)' }}>Waiting for the other participant...</h2>;
      if (callState === 'ended') {
        return (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <h2 style={{ color: '#e74c3c' }}>The other participant has left.</h2>
            <button style={{ fontSize: '18px', padding: '10px 20px', cursor: 'pointer', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px' }} onClick={handleFindNewDate}>
              Find a New Date
            </button>
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <div className="gradient-background"></div>
      
      {/* Auto Spectator Mode Notification */}
      {/* Removed autoSpectatorMode prop and related UI elements */}

      {/* Match Made Notification Overlay */}
      {/* Removed matchMadeNotification and related UI elements */}

      {/* Redirect to Matchmaking Notification */}
      {/* Removed redirectNotification */}

      {/* Added to Queue Notification */}
      {/* Removed addedToQueueNotification */}

      {/* Queue Notification */}
      {/* Removed queueNotification */}
      
      {/* Main Content: Videos and Reactions */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', zIndex: 1 }}>
        <header style={{ padding: '15px 25px', background: 'rgba(24, 24, 27, 0.5)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--background-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Room: <span style={{ color: 'var(--text-secondary)' }}>{roomId?.substring(0,8)}</span></h1>
            {userRole === 'spectator' && <h2 style={{ margin: '5px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>You are watching as a Spectator</h2>}
            {userRole === 'participant' && <h2 style={{ margin: '5px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>You are a Participant</h2>}
            
            {/* Queue Status for Participants */}
            {/* Removed queue status display */}

            {roundTitle && (
              <div style={{ 
                marginTop: 8, 
                padding: '12px 16px', 
                background: 'linear-gradient(135deg, rgba(145,70,255,0.2), rgba(255,105,180,0.2))', 
                borderRadius: 12, 
                border: '1px solid rgba(145,70,255,0.3)', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 8,
                backdropFilter: 'blur(10px)',
                boxShadow: '0 4px 20px rgba(145,70,255,0.2)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#9146ff' }}>🎬 RAPID ROUNDS</span>
                  {roundEndsAt && (
                    <span style={{ 
                      background: 'rgba(255,255,255,0.2)', 
                      color: 'white', 
                      padding: '4px 8px', 
                      borderRadius: 8, 
                      fontSize: '12px',
                      fontWeight: 'bold',
                      minWidth: '40px',
                      textAlign: 'center'
                    }}>
                      {Math.max(0, Math.floor((roundEndsAt - Date.now())/1000))}s
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: 'white' }}>{roundTitle}</div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.9)', lineHeight: '1.4' }}>{roundPrompt}</div>
              </div>
            )}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
              {userRole === 'spectator' ? (
                <>Call State: {callState} | Watching: {Object.keys(remoteStreams).length} participants</>
              ) : (
                <>Call State: {callState} | Remote Streams: {Object.keys(remoteStreams).length}</>
              )}
            </div>
            
            {/* Compatibility Score Display */}
            {compatibilityScore && isParticipant && (
              <div style={{ 
                marginTop: '10px', 
                padding: '8px 12px', 
                background: 'linear-gradient(135deg, rgba(255,105,180,0.2), rgba(145,70,255,0.2))', 
                borderRadius: '12px', 
                border: '1px solid rgba(255,105,180,0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>💕</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'white' }}>Compatibility</span>
                </div>
                <div style={{ 
                  background: 'rgba(255,255,255,0.2)', 
                  padding: '4px 8px', 
                  borderRadius: '8px',
                  minWidth: '50px',
                  textAlign: 'center'
                }}>
                  <span style={{ 
                    fontSize: '16px', 
                    fontWeight: 'bold', 
                    color: compatibilityScore >= 80 ? '#4ade80' : 
                           compatibilityScore >= 60 ? '#fbbf24' : 
                           compatibilityScore >= 40 ? '#f97316' : '#ef4444'
                  }}>
                    {compatibilityScore}%
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)' }}>
                  {compatibilityScore >= 80 ? '🔥 Perfect Match!' :
                   compatibilityScore >= 60 ? '✨ Great Vibes!' :
                   compatibilityScore >= 40 ? '🤝 Getting There!' : '💭 Keep Talking!'}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem', color: 'var(--text-primary)', background: 'var(--background-secondary)', padding: '5px 10px', borderRadius: '8px' }}>
              👀 {viewerCount}
            </span>
            
            {/* Queue Check Button for Participants */}
            {/* Removed queue check button */}
            
            {/* Poll button removed - participants should not start polls */}
            
            {/* Go to Homepage button for spectators */}
            {userRole === 'spectator' && (
              <button 
                onClick={() => navigate('/')}
                style={{ 
                  background: 'linear-gradient(135deg, #ff69b4, #9146ff)', 
                  color: 'white', 
                  border: 'none', 
                  padding: '8px 15px', 
                  borderRadius: '8px', 
                  cursor: 'pointer', 
                  fontWeight: '600',
                  fontSize: '12px'
                }}
              >
                🏠 Go to Homepage
              </button>
            )}
            
            <button onClick={copyLink} style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>Copy Invite Link</button>
          </div>
        </header>

        <main style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2%', padding: '20px', overflow: 'auto' }}>
          {isParticipant && (
            <div style={{ position: 'relative', width: hasRemoteStreams ? '25%' : '60%', maxWidth: '400px', aspectRatio: '16/9', borderRadius: '12px', overflow: 'hidden', boxShadow: `0 0 20px var(--glow-participant)`, transition: 'width 0.5s ease' }}>
              <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', background: '#000' }} />
              <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '10px', background: 'rgba(0,0,0,0.5)', padding: '8px 12px', borderRadius: '20px' }}>
                <button onClick={toggleMute} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer', color: 'white' }}>{isMuted ? '🔇' : '🎤'}</button>
                <button onClick={toggleVideo} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer', color: 'white' }}>{isVideoOff ? '📸' : '📷'}</button>
              </div>
            </div>
          )}

          {Object.entries(remoteStreams).map(([userId]) => {
            return (
              <div key={userId} style={{ position: 'relative', width: '60%', maxWidth: '900px', aspectRatio: '16/9', borderRadius: '12px', overflow: 'hidden', boxShadow: `0 0 25px var(--glow-remote)`, background: 'var(--background-secondary)' }}>
                <video 
                  key={`video-${userId}`}
                  ref={video => { 
                    remoteVideoRefs.current[userId] = video;
                  }} 
                  autoPlay 
                  playsInline 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                />
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: '8px' }}>
                  {mediaStateByUser[userId]?.muted !== undefined && (
                    <span style={{ background: 'rgba(0,0,0,0.5)', color: 'white', padding: '4px 6px', borderRadius: '6px', fontSize: '12px' }}>
                      {mediaStateByUser[userId]?.muted ? '🔇' : '🎤'}
                    </span>
                  )}
                  {mediaStateByUser[userId]?.videoOff !== undefined && (
                    <span style={{ background: 'rgba(0,0,0,0.5)', color: 'white', padding: '4px 6px', borderRadius: '6px', fontSize: '12px' }}>
                      {mediaStateByUser[userId]?.videoOff ? '📸' : '📷'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {!hasRemoteStreams && <StatusMessage />}
        </main>
        
        <div className="reactions-container" style={{ position: 'fixed', pointerEvents: 'none', left: 0, right: 0, bottom: 120, zIndex: 999 }}>
          {reactions.map((r) => <span key={r.id} className="reaction-emoji" style={{ left: `${10 + (Math.random() * 60)}%` }}>{r.emoji}</span>)}
        </div>
        {userRole === 'spectator' && (
          <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'var(--background-secondary)', padding: '10px', borderRadius: '30px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
            <button style={{ fontSize: '24px', margin: '0 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }} onClick={() => sendReaction('❤️')}>❤️</button>
            <button style={{ fontSize: '24px', margin: '0 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }} onClick={() => sendReaction('🔥')}>🔥</button>
            <button style={{ fontSize: '24px', margin: '0 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }} onClick={() => sendReaction('😂')}>😂</button>
            <button style={{ fontSize: '24px', margin: '0 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }} onClick={() => sendReaction('😮')}>😮</button>
          </div>
        )}
      </div>

      {/* Chat & Audience Panel */}
      <aside style={{ width: '350px', borderLeft: '1px solid var(--background-tertiary)', display: 'flex', flexDirection: 'column', background: 'var(--background-secondary)', zIndex: 1 }}>
        <div style={{ padding: '15px', borderBottom: '1px solid var(--background-tertiary)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button 
              onClick={() => setShowAudiencePanel(false)}
              style={{ 
                padding: '8px 16px', 
                background: !showAudiencePanel ? 'var(--accent-primary)' : 'var(--background-tertiary)', 
                color: 'white', 
                border: 'none', 
                borderRadius: '8px', 
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              💬 Chat
            </button>
            {userRole === 'spectator' && (
              <button 
                onClick={() => setShowAudiencePanel(true)}
                style={{ 
                  padding: '8px 16px', 
                  background: showAudiencePanel ? 'var(--accent-primary)' : 'var(--background-tertiary)', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '8px', 
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                🎭 Audience
              </button>
            )}
          </div>
          <h3 style={{ margin: 0 }}>{showAudiencePanel ? 'Audience Interactions' : 'Live Chat'}</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
          {!showAudiencePanel ? (
            // Chat Messages
            <>
              {chatMessages.map((msg) => (
                <div key={msg.id} style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', alignItems: msg.senderId === getSessionId() ? 'flex-end' : 'flex-start' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', padding: '0 8px' }}>
                    <strong style={{ color: msg.senderId === getSessionId() ? 'var(--accent-secondary)' : 'var(--text-primary)' }}>
                      {msg.senderId.substring(0, 6)}
                    </strong>
                  </div>
                  <div style={{ background: msg.senderId === getSessionId() ? 'var(--accent-secondary)' : 'var(--background-tertiary)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '18px', maxWidth: '80%', wordWrap: 'break-word' }}>
                    {msg.message}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </>
          ) : (
            // Audience Interactions
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Quick Voting */}
              <div style={{ background: 'var(--background-tertiary)', padding: '15px', borderRadius: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>🗳️ Quick Votes</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => handleAudienceVote('chemistry', 'amazing')}
                      style={{ 
                        flex: 1, 
                        padding: '8px', 
                        background: 'var(--accent-primary)', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      💕 Amazing Chemistry
                    </button>
                    <button 
                      onClick={() => handleAudienceVote('chemistry', 'good')}
                      style={{ 
                        flex: 1, 
                        padding: '8px', 
                        background: 'var(--accent-secondary)', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      👍 Good Vibes
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => handleAudienceVote('energy', 'high')}
                      style={{ 
                        flex: 1, 
                        padding: '8px', 
                        background: '#ff6b6b', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      🔥 High Energy
                    </button>
                    <button 
                      onClick={() => handleAudienceVote('energy', 'chill')}
                      style={{ 
                        flex: 1, 
                        padding: '8px', 
                        background: '#4ecdc4', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      😌 Chill Vibes
                    </button>
                  </div>
                </div>
                {/* Vote Results */}
                {Object.keys(audienceVotes).length > 0 && (
                  <div style={{ marginTop: '10px', padding: '10px', background: 'var(--background-primary)', borderRadius: '8px' }}>
                    <h5 style={{ margin: '0 0 8px 0', color: 'var(--text-secondary)' }}>Results:</h5>
                    {Object.entries(audienceVotes).map(([voteType, options]) => (
                      <div key={voteType} style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                          {voteType === 'chemistry' ? 'Chemistry:' : 'Energy:'}
                        </div>
                        {Object.entries(options).map(([option, count]) => (
                          <div key={option} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '2px' }}>
                            <span style={{ color: 'var(--text-primary)' }}>{option}</span>
                            <span style={{ color: 'var(--accent-primary)' }}>{count} votes</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Audience Questions */}
              <div style={{ background: 'var(--background-tertiary)', padding: '15px', borderRadius: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>❓ Audience Questions</h4>
                <div style={{ marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="Ask a question for the participants..."
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid var(--background-primary)',
                      borderRadius: '8px',
                      background: 'var(--background-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '14px'
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                        handleSubmitQuestion(e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </div>
                {audienceQuestions.length > 0 && (
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {audienceQuestions.slice(-5).map((q) => (
                      <div key={q.id} style={{ 
                        padding: '8px', 
                        background: 'var(--background-primary)', 
                        borderRadius: '8px', 
                        marginBottom: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div style={{ flex: 1, fontSize: '12px', color: 'var(--text-primary)' }}>
                          {q.question}
                        </div>
                        <button 
                          onClick={() => handleUpvoteQuestion(q.id)}
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            cursor: 'pointer', 
                            color: 'var(--accent-primary)',
                            fontSize: '12px',
                            padding: '4px 8px'
                          }}
                        >
                          👍 {q.upvotes}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Poll */}
              {currentPoll && (
                <div style={{ background: 'var(--background-tertiary)', padding: '15px', borderRadius: '12px' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>📊 Live Poll</h4>
                  <div style={{ marginBottom: '10px', fontSize: '14px', color: 'var(--text-primary)' }}>
                    {currentPoll.question}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {currentPoll.options.map((option) => (
                      <button 
                        key={option}
                        onClick={() => handleVoteInPoll(currentPoll.id, option)}
                        style={{ 
                          padding: '8px 12px', 
                          background: 'var(--accent-primary)', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: '8px', 
                          cursor: 'pointer',
                          fontSize: '12px',
                          textAlign: 'left'
                        }}
                      >
                        {option} {currentPoll.votes[option] ? `(${currentPoll.votes[option]} votes)` : ''}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Ends in {Math.max(0, Math.floor((currentPoll.endsAt - Date.now()) / 1000))}s
                  </div>
                </div>
              )}

              {/* Poll Results */}
              {currentPoll && Object.keys(currentPoll.votes).length > 0 && (
                <div style={{ background: 'var(--background-tertiary)', padding: '15px', borderRadius: '12px' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>📊 Poll Results</h4>
                  {Object.entries(currentPoll.votes).map(([option, votes]) => (
                    <div key={option} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--background-secondary)'
                    }}>
                      <span style={{ color: 'var(--text-primary)' }}>{option}</span>
                      <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{votes} votes</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Compatibility Breakdown */}
              {compatibilityScore && (
                <div style={{ background: 'var(--background-tertiary)', padding: '15px', borderRadius: '12px' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>💕 Compatibility Analysis</h4>
                  <div style={{ 
                    background: 'var(--background-primary)', 
                    padding: '10px', 
                    borderRadius: '8px', 
                    marginBottom: '10px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-primary)', marginBottom: '5px' }}>
                      {compatibilityScore}%
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {compatibilityScore >= 80 ? '🔥 Perfect Match!' :
                       compatibilityScore >= 60 ? '✨ Great Vibes!' :
                       compatibilityScore >= 40 ? '🤝 Getting There!' : '💭 Keep Talking!'}
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <div style={{ marginBottom: '5px' }}>
                      <strong>Topic Match:</strong> +{compatibilityAnalysis?.includes('topicMatch') ? JSON.parse(compatibilityAnalysis).topicMatch : 0} points
                    </div>
                    <div style={{ marginBottom: '5px' }}>
                      <strong>Response Pattern:</strong> +{compatibilityAnalysis?.includes('responsePattern') ? JSON.parse(compatibilityAnalysis).responsePattern : 0} points
                    </div>
                    <div style={{ marginBottom: '5px' }}>
                      <strong>Interaction Quality:</strong> +{compatibilityAnalysis?.includes('interactionQuality') ? JSON.parse(compatibilityAnalysis).interactionQuality : 0} points
                    </div>
                    <div>
                      <strong>Personality Match:</strong> +{compatibilityAnalysis?.includes('personalityMatch') ? JSON.parse(compatibilityAnalysis).personalityMatch : 0} points
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {userRole === 'spectator' && (
          <div style={{ position: 'relative' }}>
            {showEmojiPicker && (
              <div style={{ position: 'absolute', bottom: '75px', left: '15px' }}>
                <EmojiPicker onEmojiClick={onEmojiClick} theme = {Theme.LIGHT} />
              </div>
            )}
            <form onSubmit={handleSendChat} style={{ padding: '15px', borderTop: '1px solid var(--background-tertiary)', flexShrink: 0, background: 'var(--background-secondary)'}}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: 'var(--background-primary)', borderRadius: '20px' }}>
                {/* --- THIS IS THE UI FIX --- */}
                <button 
                  type="button" 
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '8px 12px', display: 'flex', alignItems: 'center' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                    <line x1="9" y1="9" x2="9.01" y2="9"></line>
                    <line x1="15" y1="9" x2="15.01" y2="9"></line>
                  </svg>
                </button>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Say something..."
                  style={{ 
                    width: '100%', 
                    padding: '10px 50px 10px 5px',
                    border: 'none', 
                    background: 'transparent', 
                    color: 'var(--text-primary)', 
                    outline: 'none',
                    fontSize: '1rem'
                  }}
                />
                <div style={{ position: 'absolute', right: '10px', display: 'flex', alignItems: 'center' }}>
                  <button 
                    type="submit"
                    disabled={!chatInput.trim()}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      color: chatInput.trim() ? 'var(--accent-secondary)' : 'var(--background-tertiary)',
                      transition: 'color 0.2s ease',
                      padding: '5px'
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </aside>
    </div>
  );
}
