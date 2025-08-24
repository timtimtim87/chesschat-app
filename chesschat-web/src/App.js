// src/App.js - Updated error handling: "game is not active" → "Returning to Lobby"
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

    // ENHANCED: Game ended - clean up video immediately and notify server
    socketService.on('game-ended', async (data) => {
      console.log('🏁 Game ended event received:', data);
      
      // Immediate video cleanup
      try {
        if (dailyService.isCallActive()) {
          console.log('📹 Game ended - cleaning up video call immediately');
          await dailyService.leaveCall();
          console.log('✅ Video cleaned up after game end');
        }
      } catch (error) {
        console.error('❌ Video cleanup error after game end:', error);
        dailyService.cleanup();
      }
      
      // REMOVED: Auto-return to splash - let players manually exit
      // Players can now chat after game ends and manually exit when ready
      console.log('🎮 Game ended naturally - players can chat and manually exit');
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

  // CRITICAL FIX: Enhanced handleBackToSplash with proper game termination
  const handleBackToSplash = async () => {
    console.log('🏠 Going back to splash - terminating game and cleaning up...');
    
    // Debug current state
    console.log('🔍 State BEFORE cleanup:', {
      gameState,
      hasGameData: !!gameData,
      hasCurrentUser: !!currentUser,
      dailyServiceActive: dailyService.isCallActive(),
      participantCount: dailyService.getParticipantCount()
    });
    
    // STEP 1: If we're in an active game, send resignation to terminate for both players
    if (gameState === 'playing' && gameData && gameData.roomId) {
      try {
        console.log('📤 Active game detected - sending resignation to terminate game for both players');
        
        // Send resignation to server to end the game for BOTH players
        socketService.resign(gameData.roomId, gameData.color);
        console.log('✅ Resignation sent to server - game will end for both players');
        
        // Small delay to let server process the resignation
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('❌ Error sending resignation:', error);
      }
    }
    
    // STEP 2: Clean up video call
    try {
      const wasVideoActive = dailyService.isCallActive();
      if (wasVideoActive) {
        console.log('📹 Active video call detected - cleaning up video');
        await dailyService.leaveCall();
        console.log('✅ Video call cleaned up successfully');
      } else {
        console.log('ℹ️ No active video call to clean up');
      }
    } catch (error) {
      console.error('❌ Error cleaning up video call:', error);
      // Force cleanup anyway
      dailyService.cleanup();
    }
    
    // STEP 3: Reset all state
    setGameState('splash');
    setGameData(null);
    setCurrentUser(null);
    setWaitingMessage('');
    setError('');
    
    // Debug state after cleanup
    console.log('🔍 State AFTER cleanup:', {
      gameState: 'splash',
      hasGameData: false,
      hasCurrentUser: false,
      dailyServiceActive: dailyService.isCallActive(),
      participantCount: dailyService.getParticipantCount()
    });
    
    console.log('✅ Returned to splash - game terminated for both players, video cleaned up');
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