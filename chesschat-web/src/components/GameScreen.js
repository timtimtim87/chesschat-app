// src/components/GameScreen.js - Simplified for direct game play
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
      const timer = setTimeout(onClose, 2500); // Changed to 2.5 seconds
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

  // Enhanced cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoRoomUrl) {
        console.log('🧹 Component unmounting - cleaning up video');
        dailyService.leaveCall().catch(err => 
          console.warn('Video cleanup error:', err)
        );
      }
    };
  }, []);

  // Notification helpers - now only for critical errors
  const showNotification = (message, type = 'info') => {
    // Only show critical system notifications
    if (type === 'error' && message.includes('connection')) {
      setNotification({ message, type });
    }
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
      }
    };

    const handleInvalidMove = (data) => {
      audioManager.playErrorSound();
      setSelectedSquare(null);
    };

    const handleGameEnded = (data) => {
      setGameStatus('ended');
      setGameWinner(data.winner);
      
      // Leave video call after game ends
      setTimeout(() => {
        if (videoRoomUrl) {
          console.log('🎥 Game ended - leaving video call');
          dailyService.leaveCall().catch(console.warn);
          setVideoRoomUrl(null);
        }
      }, 5000);
    };

    const handleTimeUpdate = (data) => {
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
    };

    const handleError = (data) => {
      console.log('❌ Game error:', data);
      showNotification(`Error: ${data.message}`, 'error');
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
  }, [videoRoomUrl]);

  // Chess move handling
  const handleSquarePress = async (row, col) => {
    if (gameStatus !== 'playing') return;
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

  const resignGame = () => {
    if (window.confirm("Are you sure you want to resign?")) {
      socketService.resign(roomId, playerColor);
    }
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
    if (currentTurn === playerColor) {
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

  return (
    <div className="game-screen">
      <NotificationBar notification={notification} onClose={hideNotification} />
      
      <div className="header">
        <button 
          className="header-button start-match-button"
          onClick={onBackToSplash}
        >
          ← New Game
        </button>

        <div className="title-container">
          <div className="title">ChessChat {getVideoStatus()}</div>
          <div className="status">
            {gameStatus === 'playing' && getCurrentPlayerName()}
            {gameStatus === 'ended' && `${gameWinner} wins!`}
          </div>
        </div>

        <button 
          className={`header-button resign-button ${gameStatus !== 'playing' ? 'disabled-button' : ''}`}
          onClick={resignGame}
          disabled={gameStatus !== 'playing'}
        >
          Resign
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