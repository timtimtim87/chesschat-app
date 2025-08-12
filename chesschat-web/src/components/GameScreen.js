// src/components/GameScreen.js - Enhanced with user system integration
import React, { useState, useEffect, useRef } from 'react';
import ChessBoard from './ChessBoard';
import Timer from './Timer';
import VideoCall from './VideoCall';
import Friends from './Friends';
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
    } else if (type === 'check') {
      gainNode.gain.setValueAtTime(0.4, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
      oscillator.type = 'triangle';
    } else if (type === 'checkmate') {
      gainNode.gain.setValueAtTime(0.5, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.2, this.audioContext.currentTime + duration * 0.3);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
      oscillator.type = 'sawtooth';
    }

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  playMoveSound() {
    this.playTone(800, 0.1, 'move');
  }

  playCheckSound() {
    this.playTone(1200, 0.3, 'check');
    setTimeout(() => this.playTone(900, 0.3, 'check'), 100);
  }

  playCheckmateSound() {
    this.playTone(400, 0.8, 'checkmate');
    setTimeout(() => this.playTone(300, 0.6, 'checkmate'), 200);
    setTimeout(() => this.playTone(200, 0.4, 'checkmate'), 400);
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

// Game Invitation Modal
function GameInvitationModal({ invitation, onAccept, onDecline }) {
  if (!invitation) return null;

  return (
    <div className="friends-overlay">
      <div className="invitation-modal">
        <h3 className="invitation-title">Game Invitation</h3>
        <p className="invitation-text">
          <strong>{invitation.fromDisplayName}</strong> wants to play chess with you!
        </p>
        <p className="invitation-details">Game type: {invitation.gameType}</p>
        <div className="invitation-actions">
          <button 
            onClick={() => onAccept(invitation.inviteId)}
            className="accept-button"
          >
            Accept
          </button>
          <button 
            onClick={() => onDecline(invitation.inviteId)}
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
  const [matchmakingMessage, setMatchmakingMessage] = useState('');
  
  // UI state
  const [notification, setNotification] = useState(null);
  const [gameStatusIndicator, setGameStatusIndicator] = useState(null);
  const [showFriends, setShowFriends] = useState(false);
  
  // Friends state
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
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

  // Load friends list on component mount
  useEffect(() => {
    if (currentUser) {
      socketService.getFriends();
    }
  }, [currentUser]);

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
    // Friend system events
    socketService.on('friends-list', (data) => {
      setFriends(data.friends || []);
      setPendingRequests(data.pendingRequests || []);
    });

    socketService.on('friend-request-received', (data) => {
      showNotification(`Friend request from ${data.displayName || data.from}`, 'info');
      setPendingRequests(prev => [...prev, data]);
    });

    socketService.on('friend-added', (data) => {
      showNotification(`${data.username} is now your friend!`, 'success');
      socketService.getFriends(); // Refresh friends list
    });

    socketService.on('friend-status-update', (data) => {
      setFriends(prev => prev.map(friend => 
        friend.username === data.username 
          ? { ...friend, online: data.status === 'online' }
          : friend
      ));
    });

    socketService.on('game-invitation-received', (data) => {
      setGameInvitation(data);
      showNotification(`Game invitation from ${data.fromDisplayName}!`, 'info');
    });

    socketService.on('game-invitation-sent', (data) => {
      showNotification(`Invitation sent to ${data.to}`, 'success');
    });

    socketService.on('game-invitation-declined', (data) => {
      showNotification(`${data.by} declined your invitation`, 'warning');
    });

    // Matchmaking events
    socketService.on('matchmaking-joined', (data) => {
      setMatchmakingMessage(data.message || 'Searching for opponent...');
      showNotification('Searching for random opponent...', 'info');
    });

    socketService.on('match-found', (data) => {
      setRoomId(data.roomId);
      setPlayerColor(data.color);
      setOpponent(data.opponent);
      setGameStatus('playing');
      setMatchmakingMessage('');
      setGameInvitation(null); // Clear any pending invitation
      
      const chess = new Chess(data.gameState.fen);
      setGameChess(chess);
      setBoard(fenToBoard(data.gameState.fen));
      setCurrentTurn(data.gameState.currentTurn);
      setWhiteTime(data.gameState.whiteTime);
      setBlackTime(data.gameState.blackTime);
      
      showNotification(`Match found! Playing as ${data.color} vs ${data.opponent.username}`, 'success');
      audioManager.playMoveSound();
    });

    socketService.on('waiting-for-opponent', (data) => {
      setMatchmakingMessage(`Waiting for opponent... (Position: ${data.position})`);
    });

    // Game events
    socketService.on('move-made', (data) => {
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
          audioManager.playCheckmateSound();
        } else {
          showGameStatus('CHECK!', 'check', 2000);
          audioManager.playCheckSound();
        }
      }
      
      if (data.gameEnded) {
        setGameStatus('ended');
        setGameWinner(data.winner);
        
        let message = 'Game Over! ';
        if (data.winner) {
          message += `${data.winner} wins by ${data.reason}!`;
          if (data.reason === 'checkmate') {
            audioManager.playCheckmateSound();
          }
        } else {
          message += `Draw by ${data.reason}!`;
        }
        showNotification(message, 'info');
      }
    });

    socketService.on('invalid-move', (data) => {
      showNotification(`Invalid move: ${data.reason}`, 'error');
      setSelectedSquare(null);
    });

    socketService.on('game-ended', (data) => {
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
    });

    socketService.on('opponent-disconnected', (data) => {
      showNotification('Opponent disconnected. You will win if they don\'t reconnect in 30s.', 'warning');
    });

    socketService.on('time-update', (data) => {
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
    });

    socketService.on('error', (data) => {
      showNotification(`Error: ${data.message}`, 'error');
    });

    return () => {
      // Cleanup event listeners
      socketService.off('friends-list');
      socketService.off('friend-request-received');
      socketService.off('friend-added');
      socketService.off('friend-status-update');
      socketService.off('game-invitation-received');
      socketService.off('game-invitation-sent');
      socketService.off('game-invitation-declined');
      socketService.off('matchmaking-joined');
      socketService.off('match-found');
      socketService.off('waiting-for-opponent');
      socketService.off('move-made');
      socketService.off('invalid-move');
      socketService.off('game-ended');
      socketService.off('opponent-disconnected');
      socketService.off('time-update');
      socketService.off('error');
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
                audioManager.playCheckmateSound();
                setGameStatus('ended');
                setGameWinner(testChess.turn() === 'w' ? 'black' : 'white');
              } else {
                showGameStatus('CHECK!', 'check', 2000);
                audioManager.playCheckSound();
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

  const enterMatchmaking = () => {
    if (!socketService.isUserRegistered()) {
      showNotification('Please register a username first', 'error');
      return;
    }
    
    setGameStatus('waiting');
    setMatchmakingMessage('Joining matchmaking...');
    
    socketService.joinMatchmaking({
      preferredTime: '10min'
    });
  };

  const resignGame = () => {
    if (window.confirm("Are you sure you want to resign?")) {
      if (roomId && playerColor) {
        socketService.resign(roomId, playerColor);
      } else {
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
    setMatchmakingMessage('');
    hideNotification();
  };

  // Friend management functions
  const handleAddFriend = (username) => {
    socketService.sendFriendRequest(username);
  };

  const handleAcceptFriend = (username) => {
    socketService.acceptFriendRequest(username);
  };

  const handleDeclineFriend = (username) => {
    socketService.declineFriendRequest(username);
  };

  const handleInviteFriend = (friendUsername) => {
    socketService.inviteFriend(friendUsername, '10min');
    setShowFriends(false);
  };

  const handleAcceptInvitation = (inviteId) => {
    socketService.acceptGameInvitation(inviteId);
    setGameInvitation(null);
  };

  const handleDeclineInvitation = (inviteId) => {
    socketService.declineGameInvitation(inviteId);
    setGameInvitation(null);
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
          onClick={enterMatchmaking}
          disabled={gameStatus === 'playing'}
        >
          {gameStatus === 'waiting' ? 'Searching...' : 'Start Match'}
        </button>

        <div className="title-container">
          <div className="title">ChessChat</div>
          <div className="status">
            {gameStatus === 'idle' && `Welcome ${currentUser?.username}!`}
            {gameStatus === 'waiting' && matchmakingMessage}
            {gameStatus === 'playing' && getCurrentPlayerName()}
            {gameStatus === 'ended' && `${gameWinner} wins!`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            onClick={() => setShowFriends(true)}
            className="friends-button"
          >
            👥 Friends ({friends.length})
          </button>
          
          <button 
            className={`header-button resign-button ${gameStatus !== 'playing' ? 'disabled-button' : ''}`}
            onClick={resignGame}
            disabled={gameStatus !== 'playing'}
          >
            Resign
          </button>
        </div>
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

      {/* Friends Panel */}
      <Friends
        friends={friends}
        pendingRequests={pendingRequests}
        onAddFriend={handleAddFriend}
        onAcceptFriend={handleAcceptFriend}
        onDeclineFriend={handleDeclineFriend}
        onInviteFriend={handleInviteFriend}
        currentUser={currentUser}
        isVisible={showFriends}
        onClose={() => setShowFriends(false)}
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
