// src/components/Login.js - Simplified splash screen for immediate room joining
import React, { useState } from 'react';

export default function Login({ onJoinRoom, connectionStatus, error, waitingMessage }) {
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (displayName.length < 2) {
      alert('Display name must be at least 2 characters long');
      return;
    }

    if (roomCode.length < 3) {
      alert('Room code must be at least 3 characters long');
      return;
    }
    
    if (connectionStatus !== 'connected') {
      alert('Not connected to server. Please wait and try again.');
      return;
    }

    setIsJoining(true);
    onJoinRoom(displayName.trim(), roomCode.trim());
  };

  const generateRandomCode = () => {
    const adjectives = ['Quick', 'Smart', 'Cool', 'Fast', 'Epic', 'Super', 'Mega', 'Ultra'];
    const nouns = ['Game', 'Match', 'Battle', 'Duel', 'Fight', 'Chess', 'Play', 'Room'];
    const numbers = Math.floor(Math.random() * 1000);
    
    const randomCode = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${numbers}`;
    setRoomCode(randomCode);
  };

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-title">ChessChat</h1>
          <p className="login-subtitle">Play chess with friends via video chat</p>
        </div>

        {/* Waiting state */}
        {isJoining && waitingMessage && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            <div style={{ color: '#f59e0b', fontSize: '16px', fontWeight: '600' }}>
              Waiting for opponent...
            </div>
            <div style={{ color: '#9ca3af', fontSize: '14px', marginTop: '4px' }}>
              {waitingMessage}
            </div>
            <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '8px' }}>
              Share room code "{roomCode}" with your friend
            </div>
          </div>
        )}

        {/* Main form */}
        {!isJoining && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="displayName" className="form-label">
                Your Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="form-input"
                minLength={2}
                maxLength={30}
                required
                disabled={isJoining}
              />
            </div>

            <div className="form-group">
              <label htmlFor="roomCode" className="form-label">
                Room Code
              </label>
              <input
                id="roomCode"
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="Enter room code (e.g., chess123)"
                className="form-input"
                minLength={3}
                maxLength={20}
                required
                disabled={isJoining}
              />
              <div style={{ textAlign: 'center', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={generateRandomCode}
                  disabled={isJoining}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: 'white',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s'
                  }}
                >
                  🎲 Generate Random Code
                </button>
              </div>
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="connection-status">
              <span className={`status-indicator ${connectionStatus}`}>
                {connectionStatus === 'connected' && '🟢 Connected'}
                {connectionStatus === 'connecting' && '🟡 Connecting...'}
                {connectionStatus === 'disconnected' && '🔴 Disconnected'}
              </span>
            </div>

            <button
              type="submit"
              className="login-button"
              disabled={isJoining || connectionStatus !== 'connected' || displayName.length < 2 || roomCode.length < 3}
            >
              {isJoining ? 'Joining...' : '🎮 Join Game'}
            </button>
          </form>
        )}

        <div className="login-footer">
          <p className="footer-text">
            Both players enter the same room code to start playing
          </p>
          
          {/* Instructions */}
          <div style={{ 
            background: 'rgba(59, 130, 246, 0.1)', 
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '8px',
            padding: '12px',
            marginTop: '16px',
            fontSize: '12px'
          }}>
            <div style={{ color: '#60a5fa', fontWeight: '600', marginBottom: '4px' }}>
              How it works:
            </div>
            <div style={{ color: '#9ca3af', lineHeight: '1.4' }}>
              1. Share a room code with your friend<br/>
              2. Both enter the same code<br/>
              3. Game starts automatically with video!
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}