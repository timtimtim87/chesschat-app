// src/App.js - Updated for simplified room joining flow
import React, { useState, useEffect } from 'react';
import './App.css';
import GameScreen from './components/GameScreen';
import Login from './components/Login';
import socketService from './services/socketService';

function App() {
  const [gameState, setGameState] = useState('splash'); // 'splash', 'waiting', 'playing'
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [waitingMessage, setWaitingMessage] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [gameData, setGameData] = useState(null);

  useEffect(() => {
    // Connect to server
    socketService.connect();

    // Set up connection event handlers
    socketService.on('connected', () => {
      setConnectionStatus('connected');
    });

    socketService.on('disconnected', () => {
      setConnectionStatus('disconnected');
      // Reset to splash screen on disconnect
      setGameState('splash');
      setCurrentUser(null);
      setGameData(null);
      setError('');
      setWaitingMessage('');
    });

    socketService.on('connection_error', () => {
      setConnectionStatus('disconnected');
    });

    // Room joining events
    socketService.on('code-entered', (data) => {
      if (data.waiting) {
        setGameState('waiting');
        setWaitingMessage(data.message);
        setError('');
      }
    });

    socketService.on('match-found', (matchData) => {
      console.log('🎮 Match found, starting game!');
      setGameState('playing');
      setGameData(matchData);
      setWaitingMessage('');
      setError('');
    });

    // Error handling
    socketService.on('error', (errorData) => {
      setError(errorData.message || 'An error occurred');
      // If we were waiting, go back to splash
      if (gameState === 'waiting') {
        setGameState('splash');
        setWaitingMessage('');
      }
    });

    // Game ended - go back to splash
    socketService.on('game-ended', () => {
      // Small delay to see final game state
      setTimeout(() => {
        setGameState('splash');
        setGameData(null);
        setCurrentUser(null);
        setWaitingMessage('');
        setError('');
      }, 3000);
    });

    return () => {
      socketService.disconnect();
    };
  }, [gameState]);

  const handleJoinRoom = (displayName, roomCode) => {
    setError('');
    setWaitingMessage('');
    
    // Store user info
    const user = {
      displayName: displayName,
      username: displayName.toLowerCase().replace(/\s+/g, '') + '_' + Math.random().toString(36).substr(2, 4)
    };
    setCurrentUser(user);
    
    // Immediately try to enter the room code with display name
    socketService.enterMatchCode(roomCode, displayName);
  };

  const handleBackToSplash = () => {
    setGameState('splash');
    setGameData(null);
    setCurrentUser(null);
    setWaitingMessage('');
    setError('');
  };

  // Render appropriate screen based on game state
  if (gameState === 'splash' || gameState === 'waiting') {
    return (
      <Login 
        onJoinRoom={handleJoinRoom}
        connectionStatus={connectionStatus}
        error={error}
        waitingMessage={waitingMessage}
      />
    );
  }

  if (gameState === 'playing' && gameData && currentUser) {
    return (
      <div className="App">
        <GameScreen 
          currentUser={currentUser}
          gameData={gameData}
          onBackToSplash={handleBackToSplash}
        />
      </div>
    );
  }

  // Fallback loading state
  return (
    <div className="App">
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        color: 'white',
        fontSize: '18px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div>
          <div>Loading ChessChat...</div>
        </div>
      </div>
    </div>
  );
}

export default App;