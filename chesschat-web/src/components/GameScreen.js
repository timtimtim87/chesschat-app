// src/components/GameScreen.js - Simplified with username matching
import React, { useState, useEffect } from 'react';
import ChessBoard from './ChessBoard';
import Timer from './Timer';
import VideoCall from './VideoCall';
import socketService from '../services/socketService';
import { Chess } from 'chess.js';

// Audio context for sounds
class AudioManager {
  constructor() {
    this.audioContext = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.initialized = true;
    } catch (error) {
      console.warn('Audio not available:', error);
    }
  }

  playTone(frequency, duration, type = 'move') {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    oscillator.type = 'sine';

    if (type === 'move') {
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
    }

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  playMoveSound() {
    this.playTone(800, 0.1, 'move');
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
      const timer = setTimeout(onClose, 4000);
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

// Online Users Component - Click to Invite
function OnlineUsersModal({ isVisible, onClose, onInviteUser, currentUser }) {
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    if (isVisible) {
      socketService.getOnlineUsers();
    }
  }, [isVisible]);

  useEffect(() => {
    const handleOnlineUsers = (data) => {
      setOnlineUsers(data.users);
    };

    socketService.on('online-users-list', handleOnlineUsers);

    return () => {
      socketService.off('online-users-list', handleOnlineUsers);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div className="friends-overlay">
      <div className="friends-panel">
        <div className="friends-header">
          <h2 className="friends-title">Online Players</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="friends-content">
          <div className="friends-list-section">
            <h3 className="section-title">
              Click on a player to invite them to a game
            </h3>
            
            {onlineUsers.length === 0 ? (
              <div className="empty-friends">
                <p className="empty-text">No other players online</p>
                <p className="empty-subtext">Share the app with friends to play together!</p>
              </div>
            ) : (
              <div className="friends-list">
                {onlineUsers.map((user) => (
                  <div key={user} className="friend-item">
                    <div className="friend-info">
                      <div className="friend-name">
                        <span className="friend-username">{user}</span>
                        <span className="friend-status online">🟢 Online</span>
                      </div>
                    </div>
                    <button
                      onClick={() => onInviteUser(user)}
                      className="invite-button"
                    >
                      Invite to Game
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Game Invitation Modal - Accept/Decline
function GameInvitationModal({ invitation, onAccept, onDecline }) {
  if (!invitation) return null;

  return (
    <div className="friends-overlay">
      <div className="invitation-modal">
        <h3 className="invitation-title">Game Invitation</h3>
        <p className="invitation-text">
          <strong>{invitation.from}</strong> wants to play chess with you!
        </p>
        <div className="invitation-actions">
          <button 
            onClick={() => onAccept(invitation)}
            className="accept-button"
          >
            Accept
          </button>
          <button 
            onClick={() => onDecline(invitation)}
            className="decline-button"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GameScreen({ currentUser }) {
  const [board, setBoard] = useState([]);
  const [displayBoard, setDisplayBoard] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [gameStatus, setGameStatus] = useState('idle');
  const [whiteTime, setWhiteTime] = useState(10 * 60);
  const [blackTime, setBlackTime] = useState(10 * 60);
  const [gameWinner, setGameWinner] = useState(null);
  
  // Multiplayer state
  const [playerColor, setPlayerColor] = useState(null);
  const [currentTurn, setCurrentTurn] = useState('white');
  const [roomId, setRoomId] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [gameChess, setGameChess] = useState(new Chess());
  
  // UI state
  const [notification, setNotification] = useState(null);
  const [gameStatusIndicator, setGameStatusIndicator] = useState(null);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [gameInvitation, setGameInvitation] = useState(null);

  // Initialize audio on first user interaction
  useEffect(() => {
    const initializeAudio = () => {
      audioManager.initialize();
      document.removeEventListener('click', initializeAudio);
      document.removeEventListener('keydown', initializeAudio);
    };

    document.addEventListener('click', initializeAudio);
    document.addEventListener('keydown', initializeAudio);

    return () => {
      document.removeEventListener('click', initializeAudio);
      document.removeEventListener('keydown', initializeAudio);
    };
  }, []);

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

  // Socket event handlers
  useEffect(() => {
    // Game invitation events
    const handleGameInvitationReceived = (data) => {
      setGameInvitation(data);
      showNotification(`Game invitation from ${data.from}!`, 'info');
    };

    const handleInvitationSent = (data) => {
      showNotification(data.message, 'success');
      setShowOnlineUsers(false);
    };

    const handleInvitationDeclined = (data) => {
      showNotification(data.message, 'warning');
    };

    // Game events
    const handleMatchFound = (data) => {
      setRoomId(data.roomId);
      setPlayerColor(data.color);
      setOpponent(data.opponent);
      setGameStatus('playing');
      setShowOnlineUsers(false);
      setGameInvitation(null);
      
      const chess = new Chess(data.gameState.fen);
      setGameChess(chess);
      setBoard(fenToBoard(data.gameState.fen));
      setCurrentTurn(data.gameState.currentTurn);
      setWhiteTime(data.gameState.whiteTime);
      setBlackTime(data.gameState.blackTime);
      
      showNotification(`Game started! Playing as ${data.color} vs ${data.opponent.username}`, 'success');
      audioManager.playMoveSound();
    };

    const handleMoveMade = (data) => {
      const chess = new Chess(data.fen);
      setGameChess(chess);
      setBoard(fenToBoard(data.fen));
      setCurrentTurn(data.currentTurn);
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
      setSelectedSquare(null);
      
      audioManager.playMoveSound();
      
      if (chess.isCheck()) {
        if (chess.isCheckmate()) {
          showGameStatus('CHECKMATE!', 'checkmate', 3000);
        } else {
          showGameStatus('CHECK!', 'check', 2000);
        }
      }
      
      if (data.gameEnded) {
        setGameStatus('ended');
        setGameWinner(data.winner);
        
        let message = 'Game Over! ';
        if (data.winner) {
          message += `${data.winner} wins by ${data.reason}!`;
        } else {
          message += `Draw by ${data.reason}!`;
        }
        showNotification(message, 'info');
      }
    };

    const handleInvalidMove = (data) => {
      showNotification(`Invalid move: ${data.reason}`, 'error');
      setSelectedSquare(null);
    };

    const handleGameEnded = (data) => {
      setGameStatus('ended');
      setGameWinner(data.winner);
      
      let message = 'Game Over! ';
      if (data.reason === 'resignation') {
        message += `${data.winner} wins! ${data.resignedPlayer} resigned.`;
      } else if (data.reason === 'timeout') {
        message += `${data.winner} wins! ${data.timeoutPlayer} ran out of time.`;
      } else if (data.reason === 'disconnection') {
        message += `${data.winner} wins! ${data.disconnectedPlayer} disconnected.`;
      }
      showNotification(message, 'warning');
    };

    const handleTimeUpdate = (data) => {
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
    };

    const handleError = (data) => {
      showNotification(`Error: ${data.message}`, 'error');
    };

    // Add event listeners
    socketService.on('game-invitation-received', handleGameInvitationReceived);
    socketService.on('invitation-sent', handleInvitationSent);
    socketService.on('invitation-declined', handleInvitationDeclined);
    socketService.on('match-found', handleMatchFound);
    socketService.on('move-made', handleMoveMade);
    socketService.on('invalid-move', handleInvalidMove);
    socketService.on('game-ended', handleGameEnded);
    socketService.on('time-update', handleTimeUpdate);
    socketService.on('error', handleError);

    return () => {
      // Cleanup event listeners
      socketService.off('game-invitation-received', handleGameInvitationReceived);
      socketService.off('invitation-sent', handleInvitationSent);
      socketService.off('invitation-declined', handleInvitationDeclined);
      socketService.off('match-found', handleMatchFound);
      socketService.off('move-made', handleMoveMade);
      socketService.off('invalid-move', handleInvalidMove);
      socketService.off('game-ended', handleGameEnded);
      socketService.off('time-update', handleTimeUpdate);
      socketService.off('error', handleError);
    };
  }, []);

  // Chess move handling
  const handleSquarePress = (row, col) => {
    if (gameStatus !== 'playing') return;
    if (currentTurn !== playerColor && roomId) {
      showNotification("It's not your turn!", 'warning');
      return;
    }
    
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
          if (roomId) {
            socketService.makeMove(roomId, {
              from: fromSquare,
              to: toSquare,
              promotion: 'q'
            }, playerColor);
          } else {
            // Local game
            setGameChess(testChess);
            setBoard(fenToBoard(testChess.fen()));
            setCurrentTurn(testChess.turn() === 'w' ? 'white' : 'black');
            setSelectedSquare(null);
            audioManager.playMoveSound();
            
            if (testChess.isCheck()) {
              if (testChess.isCheckmate()) {
                showGameStatus('CHECKMATE!', 'checkmate', 3000);
                setGameStatus('ended');
                setGameWinner(testChess.turn() === 'w' ? 'black' : 'white');
              } else {
                showGameStatus('CHECK!', 'check', 2000);
              }
            }
          }
        } else {
          showNotification('Invalid move!', 'error');
          setSelectedSquare(null);
        }
      } catch (error) {
        showNotification('Invalid move!', 'error');
        setSelectedSquare(null);
      }
    } else {
      const piece = displayBoard[row] && displayBoard[row][col];
      if (piece) {
        const isWhitePiece = piece === piece.toUpperCase();
        const isPlayersPiece = !roomId || 
          (playerColor === 'white' && isWhitePiece) || 
          (playerColor === 'black' && !isWhitePiece);
        
        if (isPlayersPiece) {
          setSelectedSquare([row, col]);
        } else {
          showNotification("You can't move your opponent's pieces!", 'warning');
        }
      }
    }
  };

  const startLocalGame = () => {
    const chess = new Chess();
    setGameChess(chess);
    const initialBoard = fenToBoard(chess.fen());
    setBoard(initialBoard);
    setDisplayBoard(initialBoard);
    setGameStatus('playing');
    setCurrentTurn('white');
    setPlayerColor('white');
    setWhiteTime(10 * 60);
    setBlackTime(10 * 60);
    setGameWinner(null);
    setRoomId(null);
    setOpponent(null);
    showNotification('Practice game started', 'info');
  };

  const handleInviteUser = (username) => {
    socketService.inviteUserToGame(username);
  };

  const handleAcceptInvitation = (invitation) => {
    socketService.acceptGameInvitation({
      fromUsername: invitation.from,
      inviterSocket: invitation.inviterSocket
    });
    setGameInvitation(null);
  };

  const handleDeclineInvitation = (invitation) => {
    socketService.declineGameInvitation({
      fromUsername: invitation.from,
      inviterSocket: invitation.inviterSocket
    });
    setGameInvitation(null);
  };

  const resignGame = () => {
    console.log('Resign clicked - roomId:', roomId, 'playerColor:', playerColor, 'gameStatus:', gameStatus);
    
    if (window.confirm("Are you sure you want to resign?")) {
      if (roomId && playerColor) {
        console.log('Sending resign to server');
        socketService.resign(roomId, playerColor);
      } else {
        console.log('Local game resignation');
        setGameWinner(playerColor === 'white' ? 'black' : 'white');
        setGameStatus('ended');
        showNotification('You resigned', 'info');
      }
    }
  };

  const resetToIdle = () => {
    setGameStatus('idle');
    setGameWinner(null);
    setRoomId(null);
    setOpponent(null);
    setPlayerColor(null);
    setBoard([]);
    setDisplayBoard([]);
    setCurrentTurn('white');
    setSelectedSquare(null);
    hideNotification();
  };

  // Get display names for players
  const getPlayerName = (color) => {
    if (!opponent) return color === 'white' ? 'White' : 'Black';
    
    if (playerColor === color) {
      return 'You';
    } else {
      return opponent.username || 'Opponent';
    }
  };

  const getCurrentPlayerName = () => {
    if (!opponent) return currentTurn;
    
    if (currentTurn === playerColor) {
      return 'Your turn';
    } else {
      return `${opponent.username || 'Opponent'}'s turn`;
    }
  };

  return (
    <div className="game-screen">
      <NotificationBar notification={notification} onClose={hideNotification} />
      
      <div className="header">
        <button 
          className={`header-button start-match-button ${gameStatus === 'playing' ? 'disabled-button' : ''}`}
          onClick={() => setShowOnlineUsers(true)}
          disabled={gameStatus === 'playing'}
        >
          Find Players
        </button>

        <div className="title-container">
          <div className="title">ChessChat</div>
          <div className="status">
            {gameStatus === 'idle' && `Welcome ${currentUser?.username}!`}
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
        <div className="video-left">
          <VideoCall 
            isOpponent={true}
            timer={<Timer time={blackTime} isActive={currentTurn === 'black' && gameStatus === 'playing'} />}
            playerLabel={getPlayerName('black')}
          />
        </div>

        <div className="chess-board-container">
          <ChessBoard
            board={displayBoard}
            selectedSquare={selectedSquare}
            onSquarePress={handleSquarePress}
          />
          <GameStatusIndicator status={gameStatusIndicator} />
        </div>

        <div className="video-right">
          <VideoCall 
            isOpponent={false}
            timer={<Timer time={whiteTime} isActive={currentTurn === 'white' && gameStatus === 'playing'} />}
            playerLabel={getPlayerName('white')}
          />
        </div>
      </div>

      <div className="controls">
        {gameStatus === 'ended' && (
          <button className="control-button new-game-button" onClick={resetToIdle}>
            New Game
          </button>
        )}
        
        {gameStatus === 'idle' && (
          <button className="control-button start-button" onClick={startLocalGame}>
            Practice Mode
          </button>
        )}
      </div>

      {/* Online Users Modal */}
      <OnlineUsersModal
        isVisible={showOnlineUsers}
        onClose={() => setShowOnlineUsers(false)}
        onInviteUser={handleInviteUser}
        currentUser={currentUser}
      />

      {/* Game Invitation Modal */}
      <GameInvitationModal
        invitation={gameInvitation}
        onAccept={handleAcceptInvitation}
        onDecline={handleDeclineInvitation}
      />
    </div>
  );
}
