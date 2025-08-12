import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { getSessionId } from '../sessionId';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';

type CallState = 'waiting' | 'active' | 'ended';
interface ChatMessage { id: string; senderId: string; message: string; timestamp: string; }
interface RoomPageProps {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteStreams: { [key: string]: MediaStream };
  userRole: 'participant' | 'spectator' | null;
  reactions: { id: number, emoji: string }[];
  isMuted: boolean;
  isVideoOff: boolean;
  toggleMute: () => void;
  toggleVideo: () => void;
  viewerCount: number;
  callState: CallState;
  chatMessages: ChatMessage[];
  cameraError: string | null;
  retryCameraAccess: () => void;
  mediaStateByUser: { [userId: string]: { muted: boolean; videoOff: boolean } };
}

export function RoomPage({
  localVideoRef, remoteStreams, userRole, reactions, isMuted, isVideoOff,
  toggleMute, toggleVideo, viewerCount, callState, chatMessages, cameraError, retryCameraAccess, mediaStateByUser,
}: RoomPageProps) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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

  const isParticipant = userRole === 'participant';
  const hasRemoteStreams = Object.keys(remoteStreams).length > 0;

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
      {/* Main Content: Videos and Reactions */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', zIndex: 1 }}>
        <header style={{ padding: '15px 25px', background: 'rgba(24, 24, 27, 0.5)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--background-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Room: <span style={{ color: 'var(--text-secondary)' }}>{roomId?.substring(0,8)}</span></h1>
            {userRole === 'spectator' && <h2 style={{ margin: '5px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>You are watching as a Spectator</h2>}
            {userRole === 'participant' && <h2 style={{ margin: '5px 0 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>You are a Participant</h2>}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
              Call State: {callState} | Remote Streams: {Object.keys(remoteStreams).length}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem', color: 'var(--text-primary)', background: 'var(--background-secondary)', padding: '5px 10px', borderRadius: '8px' }}>
              👀 {viewerCount}
            </span>
            <button onClick={copyLink} style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>Copy Invite Link</button>
            <button onClick={() => socket.emit('debug-rooms')} style={{ background: 'var(--background-tertiary)', color: 'var(--text-primary)', border: 'none', padding: '8px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>Debug Rooms</button>
            <button onClick={() => {
              console.log('Manual connection retry triggered');
              // This will be handled by the retry mechanism
            }} style={{ background: 'var(--accent-secondary)', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>Retry Connection</button>
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

          {Object.entries(remoteStreams).map(([userId, stream]) => {
            return (
              <div key={userId} style={{ position: 'relative', width: '60%', maxWidth: '900px', aspectRatio: '16/9', borderRadius: '12px', overflow: 'hidden', boxShadow: `0 0 25px var(--glow-remote)`, background: 'var(--background-secondary)' }}>
                <video ref={video => { 
                  if (video) {
                    video.srcObject = stream;
                  }
                }} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

      {/* Chat Panel */}
      <aside style={{ width: '350px', borderLeft: '1px solid var(--background-tertiary)', display: 'flex', flexDirection: 'column', background: 'var(--background-secondary)', zIndex: 1 }}>
        <div style={{ padding: '15px', borderBottom: '1px solid var(--background-tertiary)', flexShrink: 0 }}>
          <h3 style={{ margin: 0 }}>Live Chat</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
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
