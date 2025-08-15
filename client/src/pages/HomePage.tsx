import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { getSessionId } from '../sessionId';

interface ActiveRoom {
  roomId: string;
  viewerCount: number;
}

// --- THIS IS THE CORRECTED INTERFACE ---
interface HomePageProps {
  activeRooms: ActiveRoom[];
  featuredRoomId: string | null;
  featuredEndsAt?: number | null;
}

export function HomePage({ activeRooms, featuredRoomId, featuredEndsAt }: HomePageProps) {
  const [isWaiting, setIsWaiting] = useState(false);
  const [isInQueue, setIsInQueue] = useState(false);
  const [roomIdInput, setRoomIdInput] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const navigate = useNavigate();

  const handleCreateRoom = () => {
    if (!roomIdInput.trim()) {
      alert('Please enter a room ID');
      return;
    }
    socket.emit('create-room', { sessionId: getSessionId(), roomId: roomIdInput.trim() });
    setIsWaiting(true);
  };

  const handleEnterQueue = () => {
    socket.emit('enter-matchmaking-queue', { sessionId: getSessionId() });
    setIsInQueue(true);
  };

  const handleLeaveQueue = () => {
    socket.emit('leave-matchmaking-queue', { sessionId: getSessionId() });
    setIsInQueue(false);
  };


  
  // Listen for room creation and errors
  useEffect(() => {
    const handleRoomCreated = ({ roomId }: { roomId: string }) => {
      setIsWaiting(false);
      setShowCreateForm(false);
      setRoomIdInput('');
      navigate(`/room/${roomId}`);
    };

    const handleRoomError = ({ message }: { message: string }) => {
      setIsWaiting(false);
      alert(`Room creation failed: ${message}`);
    };

    const handleMatchFound = ({ roomId }: { roomId: string }) => {
      setIsInQueue(false);
      navigate(`/room/${roomId}`);
    };

    socket.on('room-created', handleRoomCreated);
    socket.on('room-error', handleRoomError);
    socket.on('match-found', handleMatchFound);
    return () => {
      socket.off('room-created', handleRoomCreated);
      socket.off('room-error', handleRoomError);
      socket.off('match-found', handleMatchFound);
    };
  }, [navigate]);



  const renderMainStageBanner = () => {
    if (!featuredRoomId) return null;
    const remaining = featuredEndsAt ? Math.max(0, featuredEndsAt - Date.now()) : null;
    const mm = remaining ? Math.floor(remaining / 60000) : null;
    const ss = remaining ? Math.floor((remaining % 60000) / 1000) : null;
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        background: 'rgba(145,70,255,0.15)',
        border: '1px solid var(--background-tertiary)',
        borderRadius: 12,
        marginBottom: 16
      }}>
        <div style={{ fontWeight: 600 }}>Main Stage is LIVE {remaining !== null && (
          <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
            {mm?.toString().padStart(2, '0')}:{ss?.toString().padStart(2, '0')}
          </span>
        )}</div>
        <button
          onClick={() => navigate(`/room/${featuredRoomId}`)}
          style={{ background: 'var(--accent-secondary)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
        >
          Go to Main Stage
        </button>
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="gradient-background"></div>
      <div style={{ position: 'relative', zIndex: 1, padding: '20px', minHeight: '100vh', maxWidth: '1200px', margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: '40px', paddingTop: '20px' }}>
          <h1 style={{ 
            fontSize: '4rem', 
            fontWeight: 'bold',
            background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Kupid Live
          </h1>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginTop: '-10px' }}>The 24/7 Live Dating Show</p>
        </header>

        {/* Main Stage CTA */}
        {renderMainStageBanner()}

        {/* Room Creation Section */}
        <div style={{ textAlign: 'center', background: 'rgba(40, 40, 45, 0.5)', backdropFilter: 'blur(10px)', padding: '30px', borderRadius: '15px', marginBottom: '40px', border: '1px solid var(--background-tertiary)' }}>
          {!showCreateForm ? (
            <div>
              <h2 style={{ color: 'var(--text-primary)', marginTop: 0 }}>Start Your Own Show</h2>
              <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button 
                  style={{ fontSize: '18px', padding: '12px 25px', cursor: 'pointer', border: 'none', background: 'var(--accent-primary)', color: 'white', borderRadius: '10px' }} 
                  onClick={() => setShowCreateForm(true)}
                >
                  Create a Room
                </button>
                <button 
                  style={{ fontSize: '18px', padding: '12px 25px', cursor: 'pointer', border: 'none', background: 'var(--accent-secondary)', color: 'white', borderRadius: '10px' }} 
                  onClick={handleEnterQueue}
                  disabled={isInQueue}
                >
                  {isInQueue ? 'Waiting for Match...' : 'Find a Match'}
                </button>
              </div>
              {isInQueue && (
                <div style={{ marginTop: '15px' }}>
                  <button 
                    style={{ fontSize: '14px', padding: '8px 15px', cursor: 'pointer', background: 'var(--background-secondary)', color: 'var(--text-primary)', border: '1px solid var(--background-tertiary)', borderRadius: '8px' }} 
                    onClick={handleLeaveQueue}
                  >
                    Cancel Matchmaking
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 style={{ color: 'var(--text-primary)', marginTop: 0 }}>Create Your Room</h2>
              <div style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  placeholder="Enter room ID (e.g., my-date-room)"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '300px',
                    padding: '12px',
                    fontSize: '16px',
                    border: '1px solid var(--background-tertiary)',
                    borderRadius: '8px',
                    background: 'var(--background-secondary)',
                    color: 'var(--text-primary)',
                    marginBottom: '15px'
                  }}
                />
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                  Choose a unique name for your room
                </div>
              </div>
              <div>
                <button 
                  style={{ fontSize: '18px', padding: '10px 20px', cursor: 'pointer', border: 'none', background: 'var(--accent-primary)', color: 'white', borderRadius: '8px', marginRight: '10px' }} 
                  onClick={handleCreateRoom}
                  disabled={isWaiting}
                >
                  {isWaiting ? 'Creating...' : 'Create Room'}
                </button>
                <button 
                  style={{ fontSize: '18px', padding: '10px 20px', cursor: 'pointer', background: 'var(--background-secondary)', color: 'var(--text-primary)', border: '1px solid var(--background-tertiary)', borderRadius: '8px' }} 
                  onClick={() => {
                    setShowCreateForm(false);
                    setRoomIdInput('');
                    setIsWaiting(false);
                  }}
                  disabled={isWaiting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live Feed Section */}
        <div>
          <h2 style={{ borderBottom: '1px solid var(--background-tertiary)', paddingBottom: '10px' }}>Live Now</h2>
          {activeRooms.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
              {activeRooms.map(room => (
                <div 
                  key={room.roomId} 
                  style={{ background: 'var(--background-secondary)', borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'transform 0.2s ease, box-shadow 0.2s ease', border: '1px solid var(--background-tertiary)' }}
                  onClick={() => navigate(`/room/${room.roomId}`)}
                  onMouseOver={e => {
                    e.currentTarget.style.transform = 'scale(1.03)';
                    e.currentTarget.style.boxShadow = '0 0 20px var(--glow-remote)';
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <h3 style={{ marginTop: 0, color: 'var(--accent-secondary)' }}>Date in Progress</h3>
                  <p style={{ color: 'var(--text-secondary)' }}>Room ID: {room.roomId.substring(0, 8)}...</p>
                  <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>👀 {room.viewerCount}</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px' }}>No dates are live right now. Be the first!</p>
          )}
        </div>
      </div>
    </div>
  );
}
