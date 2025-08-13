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
  const navigate = useNavigate();

  const handleEnterQueue = () => {
    socket.emit('enter-matchmaking-queue', { sessionId: getSessionId() });
    setIsWaiting(true);
  };

  const handleLeaveQueue = () => {
    socket.emit('leave-matchmaking-queue', { sessionId: getSessionId() });
    setIsWaiting(false);
  };
  
  useEffect(() => {
    // This hook handles navigation if a featured room exists
    if (featuredRoomId) {
      navigate(`/room/${featuredRoomId}`);
    }
  }, [featuredRoomId, navigate]);

  useEffect(() => {
    return () => {
      if (isWaiting) {
        handleLeaveQueue();
      }
    };
  }, [isWaiting]);

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

        {/* Matchmaking Section */}
        <div style={{ textAlign: 'center', background: 'rgba(40, 40, 45, 0.5)', backdropFilter: 'blur(10px)', padding: '30px', borderRadius: '15px', marginBottom: '40px', border: '1px solid var(--background-tertiary)' }}>
          {!isWaiting ? (
            <div>
              <h2 style={{ color: 'var(--text-primary)', marginTop: 0 }}>Want to be next?</h2>
              <button 
                style={{ fontSize: '20px', padding: '12px 25px', cursor: 'pointer', border: 'none', background: 'var(--accent-primary)', color: 'white', borderRadius: '10px' }} 
                onClick={handleEnterQueue}
              >
                Step Into the Spotlight
              </button>
            </div>
          ) : (
            <div>
              <button style={{ fontSize: '20px', padding: '12px 25px', background: 'var(--background-tertiary)', color: 'var(--text-secondary)', border: 'none', borderRadius: '10px' }} disabled>
                Waiting for a match...
              </button>
              <button style={{ marginLeft: '10px', padding: '8px 15px', cursor: 'pointer', background: 'var(--background-secondary)', color: 'var(--text-primary)', border: '1px solid var(--background-tertiary)', borderRadius: '10px' }} onClick={handleLeaveQueue}>
                Cancel
              </button>
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
