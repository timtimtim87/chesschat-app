// src/App.js - Updated with new exit-game logic
import React, { useState, useEffect } from 'react';
import './App.css';
import GameScreen from './components/GameScreen';
import Login from './components/Login';
import socketService from './services/socketService';
import dailyService from './services/dailyService';

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

    // FIXED: Enhanced error handling with better messages
    socketService.on('error', (errorData) => {
      console.log('❌ Server error received:', errorData);
      
      // Transform "game is not active" errors to user-friendly message
      let displayMessage = errorData.message || 'An error occurred';
      
      if (displayMessage.toLowerCase().includes('not active') || 
          displayMessage.toLowerCase().includes('game room not found')) {
        displayMessage = 'Returning to Lobby';
        
        // If we get this error during gameplay, it means game ended - return to splash
        if (gameState === 'playing') {
          console.log('🏠 Game no longer active, returning to splash');
          setTimeout(() => {
            setGameState('splash');
            setGameData(null);
            setCurrentUser(null);
            setWaitingMessage('');
            setError('');
          }, 1500); // Brief delay to show the message
        }
      }
      
      setError(displayMessage);
      
      // If we were waiting, go back to splash
      if (gameState === 'waiting') {
        setGameState('splash');
        setWaitingMessage('');
      }
    });

    // UPDATED: Game ended - NO video cleanup, just log the event
    socketService.on('game-ended', async (data) => {
      console.log('🏁 Game ended event received:', data);
      
      // CRITICAL: Do NOT clean up video here anymore - let players stay and chat
      console.log('🎥 Game ended naturally - players can continue video chat');
      
      // The GameScreen component will handle showing the "Exit Game" button
      // Video cleanup will only happen when players explicitly click "Exit Game"
    });

    // NEW: Exit game event - this WILL clean up video and return to splash
    socketService.on('exit-game', async (data) => {
      console.log('🚪 Exit game event received - both players being removed from game');
      
      // Immediate video cleanup when exit-game event is received
      try {
        if (dailyService.isCallActive()) {
          console.log('📹 Exit game event - cleaning up video call immediately');
          await dailyService.leaveCall();
          console.log('✅ Video cleaned up after exit game event');
        }
      } catch (error) {
        console.error('❌ Video cleanup error after exit game:', error);
        dailyService.cleanup();
      }
      
      // Return to splash screen
      console.log('🏠 Returning to splash after exit game');
      setGameState('splash');
      setGameData(null);
      setCurrentUser(null);
      setWaitingMessage('');
      setError('');
    });

    return () => {
      socketService.disconnect();
    };
  }, []); // Fixed: empty dependency array to prevent disconnects on state changes

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

  // UPDATED: Simplified handleBackToSplash - just for emergency cleanup
  const handleBackToSplash = async () => {
    console.log('🏠 Emergency back to splash - cleaning up...');
    
    // Debug current state
    console.log('🔍 State BEFORE emergency cleanup:', {
      gameState,
      hasGameData: !!gameData,
      hasCurrentUser: !!currentUser,
      dailyServiceActive: dailyService.isCallActive(),
      participantCount: dailyService.getParticipantCount()
    });
    
    // Emergency video cleanup (this shouldn't normally be needed with new logic)
    try {
      if (dailyService.isCallActive()) {
        console.log('📹 Emergency video cleanup');
        await dailyService.leaveCall();
        console.log('✅ Emergency video cleanup completed');
      }
    } catch (error) {
      console.error('❌ Error during emergency video cleanup:', error);
      dailyService.cleanup();
    }
    
    // Reset all state
    setGameState('splash');
    setGameData(null);
    setCurrentUser(null);
    setWaitingMessage('');
    setError('');
    
    console.log('✅ Emergency return to splash completed');
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