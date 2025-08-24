// src/components/GameScreen.js - Single Exit button, no auto-return after natural game endings
import React, { useState, useEffect } from 'react';
import ChessBoard from './ChessBoard';
import Timer from './Timer';
import VideoCall from './VideoCall';
import socketService from '../services/socketService';
import dailyService from '../services/dailyService';
import { Chess } from 'chess.js';

// Enhanced Audio Manager with better mobile support
class AudioManager {
  constructor() {
    this.audioContext = null;
    this.initialized = false;
    this.moveSound = null;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Resume context if suspended (mobile Safari)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.initialized = true;
      console.log('🔊 Audio manager initialized');
    } catch (error) {
      console.warn('Audio not available:', error);
    }
  }

  playTone(frequency, duration, type = 'move') {
    if (!this.audioContext || this.audioContext.state !== 'running') {
      console.warn('Audio context not ready');
      return;
    }

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
      oscillator.type = 'sine';

      if (type === 'move') {
        gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
      } else if (type === 'error') {
        gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
      } else if (type === 'check') {
        gainNode.gain.setValueAtTime(0.12, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
      }

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration);
    } catch (error) {
      console.warn('Error playing tone:', error);
    }
  }

  playMoveSound() {
    this.playTone(800, 0.15, 'move');
  }

  playErrorSound() {
    this.playTone(300, 0.3, 'error');
  }

  playCheckSound() {
    this.playTone(1000, 0.2, 'check');
  }

  async ensureAudioReady() {
    await this.initialize();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('🔊 Audio context resumed');
      } catch (error) {
        console.warn('Could not resume audio context:', error);
      }
    }
  }
}

const audioManager = new AudioManager();

// Convert FEN to board array for display
function fenToBoard(fen) {
  const chess = new Chess(fen);
  const board = [];
  
  for (let rank = 0; rank < 8; rank++) {
    const row = [];
    for (let file = 0; file < 8; file++) {
      const square = String.fromCharCode(97 + file) + (8 - rank);
      const piece = chess.get(square);
      
      if (piece) {
        let pieceChar = piece.type.toUpperCase();
        if (piece.color === 'b') {
          pieceChar = piece.type.toLowerCase();
        }
        row.push(pieceChar);
      } else {
        row.push(null);
      }
    }
    board.push(row);
  }
  
  return board;
}

function positionToSquare(row, col, isFlipped = false) {
  if (isFlipped) {
    row = 7 - row;
    col = 7 - col;
  }
  return String.fromCharCode(97 + col) + (8 - row);
}

function flipBoard(board) {
  return board.slice().reverse().map(row => row.slice().reverse());
}

// Notification Component
function NotificationBar({ notification, onClose }) {
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(onClose, 2500);
      return () => clearTimeout(timer);
    }
  }, [notification, onClose]);

  if (!notification) return null;

  return (
    <div className={`notification-bar ${notification.type}`}>
      {notification.message}
    </div>
  );
}

// Game Status Indicator
function GameStatusIndicator({ status }) {
  if (!status) return null;

  return (
    <div className={`game-status-indicator ${status.type}`}>
      {status.message}
    </div>
  );
}

export default function GameScreen({ currentUser, gameData, onBackToSplash }) {
  const [board, setBoard] = useState([]);
  const [displayBoard, setDisplayBoard] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [gameStatus, setGameStatus] = useState('playing');
  const [whiteTime, setWhiteTime] = useState(10 * 60);
  const [blackTime, setBlackTime] = useState(10 * 60);
  const [gameWinner, setGameWinner] = useState(null);
  const [gameEndReason, setGameEndReason] = useState(null);
  
  // Game state from props
  const [playerColor, setPlayerColor] = useState(null);
  const [currentTurn, setCurrentTurn] = useState('white');
  const [roomId, setRoomId] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [gameChess, setGameChess] = useState(new Chess());
  
  // UI state
  const [notification, setNotification] = useState(null);
  const [gameStatusIndicator, setGameStatusIndicator] = useState(null);
  
  // Video state
  const [videoRoomUrl, setVideoRoomUrl] = useState(null);
  const [videoConnected, setVideoConnected] = useState(false);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  
  // FIXED: Add exit confirmation state (no window.confirm)
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Initialize game from gameData prop
  useEffect(() => {
    if (gameData) {
      console.log('🎮 Initializing game from data:', gameData);
      
      setRoomId(gameData.roomId);
      setPlayerColor(gameData.color);
      setOpponent(gameData.opponent);
      
      const chess = new Chess(gameData.gameState.fen);
      setGameChess(chess);
      setBoard(fenToBoard(gameData.gameState.fen));
      setCurrentTurn(gameData.gameState.currentTurn);
      setWhiteTime(gameData.gameState.whiteTime);
      setBlackTime(gameData.gameState.blackTime);
      
      // Set up video room
      if (gameData.videoRoom && gameData.videoRoom.url) {
        console.log('🎥 Video room available:', gameData.videoRoom.url);
        setVideoRoomUrl(gameData.videoRoom.url);
      } else {
        console.log('⚠️  No video room - playing without video');
        setVideoRoomUrl(null);
      }
      
      audioManager.playMoveSound();
    }
  }, [gameData]);

  // Initialize audio and handle user interaction
  useEffect(() => {
    const initializeAudio = async () => {
      if (!userHasInteracted) {
        setUserHasInteracted(true);
        await audioManager.ensureAudioReady();
        
        if (dailyService) {
          await dailyService.forceAudioPlay();
        }
        
        document.removeEventListener('click', initializeAudio);
        document.removeEventListener('touchstart', initializeAudio);
        document.removeEventListener('keydown', initializeAudio);
      }
    };

    document.addEventListener('click', initializeAudio);
    document.addEventListener('touchstart', initializeAudio);
    document.addEventListener('keydown', initializeAudio);

    return () => {
      document.removeEventListener('click', initializeAudio);
      document.removeEventListener('touchstart', initializeAudio);
      document.removeEventListener('keydown', initializeAudio);
    };
  }, [userHasInteracted]);

  // Update display board when game board or player color changes
  useEffect(() => {
    if (board.length > 0) {
      if (playerColor === 'black') {
        setDisplayBoard(flipBoard(board));
      } else {
        setDisplayBoard(board);
      }
    }
  }, [board, playerColor]);

  // ENHANCED: Component cleanup with video cleanup
  useEffect(() => {
    return () => {
      console.log('🧹 GameScreen component unmounting - forcing video cleanup');
      
      // Force video cleanup on unmount
      if (dailyService.isCallActive()) {
        dailyService.leaveCall().catch(error => {
          console.warn('Error during component unmount video cleanup:', error);
          dailyService.cleanup();
        });
      }
    };
  }, []);

  // REMOVED: Video disconnection monitoring (let players manually exit)
  // Players should manually exit when they want to leave

  // Notification helpers
  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
  };

  const hideNotification = () => {
    setNotification(null);
  };

  const showGameStatus = (message, type, duration = 2000) => {
    setGameStatusIndicator({ message, type });
    setTimeout(() => setGameStatusIndicator(null), duration);
  };

  // Game event handlers
  useEffect(() => {
    const handleMoveMade = async (data) => {
      console.log('♟️ Move made');
      const chess = new Chess(data.fen);
      setGameChess(chess);
      setBoard(fenToBoard(data.fen));
      setCurrentTurn(data.currentTurn);
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
      setSelectedSquare(null);
      
      await audioManager.ensureAudioReady();
      audioManager.playMoveSound();
      
      if (chess.isCheck()) {
        if (chess.isCheckmate()) {
          showGameStatus('CHECKMATE!', 'checkmate', 3000);
        } else {
          showGameStatus('CHECK!', 'check', 2000);
          audioManager.playCheckSound();
        }
      }
      
      if (data.gameEnded) {
        setGameStatus('ended');
        setGameWinner(data.winner);
        setGameEndReason(data.reason);
      }
    };

    const handleInvalidMove = (data) => {
      audioManager.playErrorSound();
      setSelectedSquare(null);
      
      // FIXED: Better error message
      if (data.reason && data.reason.includes('not active')) {
        showNotification('Returning to Lobby', 'info');
      }
    };

    // ENHANCED: Game ended handler - NO auto-return, keep video for chat
    const handleGameEnded = async (data) => {
      console.log('🏁 Game ended naturally:', data);
      setGameStatus('ended');
      setGameWinner(data.winner);
      setGameEndReason(data.reason);
      
      // DON'T clean up video - let players chat and manually exit
      console.log('🎥 Game ended naturally - keeping video for post-game chat');
      
      // Show celebration message
      if (data.reason === 'checkmate') {
        showGameStatus('CHECKMATE!', 'checkmate', 5000);
      } else if (data.reason === 'timeout') {
        showGameStatus('TIME OUT!', 'checkmate', 5000);
      } else if (data.reason === 'stalemate') {
        showGameStatus('STALEMATE!', 'check', 5000);
      } else if (data.reason === 'draw') {
        showGameStatus('DRAW!', 'check', 5000);
      }
    };

    const handleTimeUpdate = (data) => {
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
    };

    const handleError = (data) => {
      console.log('❌ Game error:', data);
      
      // FIXED: Better error message
      if (data.message && data.message.includes('not active')) {
        showNotification('Returning to Lobby', 'info');
      } else {
        showNotification(`Error: ${data.message}`, 'error');
      }
    };

    // Add event listeners
    socketService.on('move-made', handleMoveMade);
    socketService.on('invalid-move', handleInvalidMove);
    socketService.on('game-ended', handleGameEnded);
    socketService.on('time-update', handleTimeUpdate);
    socketService.on('error', handleError);

    return () => {
      socketService.off('move-made', handleMoveMade);
      socketService.off('invalid-move', handleInvalidMove);
      socketService.off('game-ended', handleGameEnded);
      socketService.off('time-update', handleTimeUpdate);
      socketService.off('error', handleError);
    };
  }, []);

  // Chess move handling
  const handleSquarePress = async (row, col) => {
    if (gameStatus !== 'playing') {
      // FIXED: Better message when trying to move after game ended
      if (gameStatus === 'ended') {
        showNotification('Game has ended - click Exit Game to return to lobby', 'info');
      }
      return;
    }
    
    if (currentTurn !== playerColor) {
      audioManager.playErrorSound();
      return;
    }
    
    await audioManager.ensureAudioReady();
    
    if (selectedSquare) {
      const [fromRow, fromCol] = selectedSquare;
      if (fromRow === row && fromCol === col) {
        setSelectedSquare(null);
        return;
      }
      
      const fromSquare = positionToSquare(fromRow, fromCol, playerColor === 'black');
      const toSquare = positionToSquare(row, col, playerColor === 'black');
      
      const testChess = new Chess(gameChess.fen());
      try {
        const move = testChess.move({
          from: fromSquare,
          to: toSquare,
          promotion: 'q'
        });
        
        if (move) {
          socketService.makeMove(roomId, {
            from: fromSquare,
            to: toSquare,
            promotion: 'q'
          }, playerColor);
        } else {
          audioManager.playErrorSound();
          setSelectedSquare(null);
        }
      } catch (error) {
        audioManager.playErrorSound();
        setSelectedSquare(null);
      }
    } else {
      const piece = displayBoard[row] && displayBoard[row][col];
      if (piece) {
        const isWhitePiece = piece === piece.toUpperCase();
        const isPlayersPiece = (playerColor === 'white' && isWhitePiece) || 
                              (playerColor === 'black' && !isWhitePiece);
        
        if (isPlayersPiece) {
          setSelectedSquare([row, col]);
        } else {
          audioManager.playErrorSound();
        }
      }
    }
  };

  // FIXED: Single "Exit Game" button - handles both resign and leaving
  const handleExitGame = () => {
    console.log('🚪 Player clicked Exit Game');
    setShowExitConfirm(true);
  };

  // FIXED: Handle exit confirmation - works for both active games and ended games
  const handleExitConfirm = async () => {
    console.log('🚪 Player confirmed exit - terminating game and cleaning up...');
    setShowExitConfirm(false);
    
    try {
      // If game is still active, send resignation to end it for both players
      if (gameStatus === 'playing') {
        console.log('📤 Active game - sending resignation to end game for both players');
        socketService.resign(roomId, playerColor);
        
        // Small delay to let server process resignation
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        console.log('ℹ️ Game already ended - just cleaning up and exiting');
      }
      
      // Clean up video and return to splash
      if (videoRoomUrl && dailyService.isCallActive()) {
        console.log('📹 Cleaning up video after exit');
        await dailyService.leaveCall();
        console.log('✅ Video cleaned up after exit');
      }
      
      // Return to splash
      onBackToSplash();
      
    } catch (error) {
      console.error('❌ Error during exit cleanup:', error);
      dailyService.cleanup();
      onBackToSplash(); // Still return to splash even if cleanup fails
    }
  };

  const handleExitCancel = () => {
    setShowExitConfirm(false);
  };

  // Get display names for players
  const getPlayerName = (color) => {
    if (playerColor === color) {
      return 'You';
    } else {
      return opponent?.username || 'Opponent';
    }
  };

  const getCurrentPlayerName = () => {
    if (gameStatus === 'ended') {
      // Show game result
      if (gameWinner === 'draw') {
        return `Draw! ${gameEndReason || ''}`;
      } else if (gameWinner === playerColor) {
        return `You won! ${gameEndReason || ''}`;
      } else {
        return `${opponent?.username || 'Opponent'} won! ${gameEndReason || ''}`;
      }
    } else if (currentTurn === playerColor) {
      return 'Your turn';
    } else {
      return `${opponent?.username || 'Opponent'}'s turn`;
    }
  };

  const getVideoStatus = () => {
    if (!videoRoomUrl) return null;
    if (videoConnected) return '🎥';
    return '📱';
  };

  // FIXED: Dynamic button text and behavior
  const getExitButtonText = () => {
    if (gameStatus === 'playing') {
      return 'Resign';
    } else {
      return 'Exit Game';
    }
  };

  const getExitButtonClass = () => {
    return 'header-button resign-button'; // Keep same styling
  };

  return (
    <div className="game-screen">
      <NotificationBar notification={notification} onClose={hideNotification} />
      
      {/* FIXED: Custom exit confirmation modal */}
      {showExitConfirm && (
        <div className="friends-overlay">
          <div className="invitation-modal">
            <h2 className="invitation-title">
              {gameStatus === 'playing' ? 'Resign Game?' : 'Exit Game?'}
            </h2>
            <p className="invitation-text">
              {gameStatus === 'playing' 
                ? 'Are you sure you want to resign this game?'
                : 'Are you sure you want to leave the game room?'
              }
            </p>
            <p className="invitation-details">
              {gameStatus === 'playing' 
                ? 'Your opponent will win and both players will return to the lobby.'
                : 'Both players will return to the lobby and the video chat will end.'
              }
            </p>
            <div className="invitation-actions">
              <button 
                onClick={handleExitConfirm}
                className="decline-button"
              >
                {gameStatus === 'playing' ? 'Yes, Resign' : 'Yes, Exit'}
              </button>
              <button 
                onClick={handleExitCancel}
                className="accept-button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="header">
        <div style={{ minWidth: '100px' }}>
          {/* Empty space for symmetry */}
        </div>

        <div className="title-container">
          <div className="title">ChessChat {getVideoStatus()}</div>
          <div className="status">
            {getCurrentPlayerName()}
          </div>
        </div>

        <button 
          className={getExitButtonClass()}
          onClick={handleExitGame}
        >
          {getExitButtonText()}
        </button>
      </div>

      <div className="game-main">
        {/* Mobile: videos side-by-side container, Desktop: individual positioning */}
        <div className="mobile-videos-container">
          <div className="video-left">
            <VideoCall 
              isOpponent={true}
              timer={<Timer time={blackTime} isActive={currentTurn === 'black' && gameStatus === 'playing'} />}
              playerLabel={getPlayerName('black')}
              videoRoomUrl={videoRoomUrl}
              userName={currentUser?.username}
            />
          </div>

          <div className="video-right">
            <VideoCall 
              isOpponent={false}
              timer={<Timer time={whiteTime} isActive={currentTurn === 'white' && gameStatus === 'playing'} />}
              playerLabel={getPlayerName('white')}
              videoRoomUrl={videoRoomUrl}
              userName={currentUser?.username}
            />
          </div>
        </div>

        <div className="chess-board-container">
          <ChessBoard
            board={displayBoard}
            selectedSquare={selectedSquare}
            onSquarePress={handleSquarePress}
          />
          <GameStatusIndicator status={gameStatusIndicator} />
        </div>
      </div>
    </div>
  );
}