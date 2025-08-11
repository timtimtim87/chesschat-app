// src/components/Login.js - Username registration component
import React, { useState } from 'react';

export default function Login({ onLogin, connectionStatus, error }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (username.length < 3) {
      alert('Username must be at least 3 characters long');
      return;
    }
    
    if (connectionStatus !== 'connected') {
      alert('Not connected to server. Please wait and try again.');
      return;
    }

    setIsLoading(true);
    onLogin(username.trim(), displayName.trim() || username.trim());
  };

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-title">ChessChat</h1>
          <p className="login-subtitle">Play chess with friends via video chat</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username" className="form-label">
              Choose Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username (3-20 characters)"
              className="form-input"
              minLength={3}
              maxLength={20}
              required
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="displayName" className="form-label">
              Display Name (Optional)
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              className="form-input"
              maxLength={30}
              disabled={isLoading}
            />
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
            disabled={isLoading || connectionStatus !== 'connected' || username.length < 3}
          >
            {isLoading ? 'Joining...' : 'Join ChessChat'}
          </button>
        </form>

        <div className="login-footer">
          <p className="footer-text">
            Create a username to play with friends or find random opponents
          </p>
        </div>
      </div>
    </div>
  );
}
