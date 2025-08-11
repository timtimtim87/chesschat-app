// server.js - Enhanced with user system and friend matching
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://your-domain.com'] 
      : ['http://localhost:3000'],
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Enhanced storage
const gameRooms = new Map();
const waitingPlayers = []; // For random matchmaking
const connectedUsers = new Map(); // socketId -> user data
const userSockets = new Map(); // username -> socketId
const friendRequests = new Map(); // username -> Set of pending requests
const userFriends = new Map(); // username -> Set of friends
const gameInvitations = new Map(); // inviteId -> invitation data

// Helper functions
function generateInviteId() {
  return `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getUserBySocket(socketId) {
  return connectedUsers.get(socketId);
}

function getUserSocket(username) {
  return userSockets.get(username);
}

function isUserOnline(username) {
  return userSockets.has(username);
}

function getFriendsList(username) {
  const friends = userFriends.get(username) || new Set();
  return Array.from(friends).map(friendName => ({
    username: friendName,
    online: isUserOnline(friendName),
    status: isUserOnline(friendName) ? 'online' : 'offline'
  }));
}

function createGameRoom(player1, player2) {
  const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const gameRoom = {
    id: roomId,
    players: {
      white: player1,
      black: player2
    },
    chess: new Chess(),
    currentTurn: 'white',
    whiteTime: 600,
    blackTime: 600,
    gameStatus: 'playing',
    createdAt: new Date(),
    lastMove: null
  };
  
  gameRooms.set(roomId, gameRoom);
  return gameRoom;
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // User registration/login
  socket.on('register-user', (userData) => {
    const { username, displayName } = userData;
    
    // Check if username is already taken by online user
    if (userSockets.has(username)) {
      socket.emit('registration-error', { 
        message: 'Username is already taken by an online user' 
      });
      return;
    }

    // Validate username
    if (!username || username.length < 3 || username.length > 20) {
      socket.emit('registration-error', { 
        message: 'Username must be 3-20 characters long' 
      });
      return;
    }

    // Register user
    const user = {
      socketId: socket.id,
      username: username,
      displayName: displayName || username,
      connectedAt: new Date(),
      status: 'online'
    };

    connectedUsers.set(socket.id, user);
    userSockets.set(username, socket.id);

    // Initialize friend lists if new user
    if (!userFriends.has(username)) {
      userFriends.set(username, new Set());
    }
    if (!friendRequests.has(username)) {
      friendRequests.set(username, new Set());
    }

    socket.emit('registration-success', {
      username: user.username,
      displayName: user.displayName,
      friends: getFriendsList(username),
      pendingRequests: Array.from(friendRequests.get(username) || new Set())
    });

    // Notify friends that user is online
    const friends = userFriends.get(username) || new Set();
    friends.forEach(friendName => {
      const friendSocket = getUserSocket(friendName);
      if (friendSocket) {
        io.to(friendSocket).emit('friend-status-update', {
          username: username,
          status: 'online'
        });
      }
    });

    console.log(`👤 User registered: ${username}`);
  });

  // Send friend request
  socket.on('send-friend-request', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { targetUsername } = data;
    
    if (targetUsername === user.username) {
      socket.emit('error', { message: "You can't add yourself as a friend" });
      return;
    }

    // Check if already friends
    const userFriendsList = userFriends.get(user.username) || new Set();
    if (userFriendsList.has(targetUsername)) {
      socket.emit('error', { message: 'Already friends with this user' });
      return;
    }

    // Add to target's pending requests
    if (!friendRequests.has(targetUsername)) {
      friendRequests.set(targetUsername, new Set());
    }
    friendRequests.get(targetUsername).add(user.username);

    // Notify target user if online
    const targetSocket = getUserSocket(targetUsername);
    if (targetSocket) {
      io.to(targetSocket).emit('friend-request-received', {
        from: user.username,
        displayName: user.displayName
      });
    }

    socket.emit('friend-request-sent', { username: targetUsername });
    console.log(`👥 Friend request: ${user.username} -> ${targetUsername}`);
  });

  // Accept friend request
  socket.on('accept-friend-request', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { fromUsername } = data;
    
    // Remove from pending requests
    const requests = friendRequests.get(user.username) || new Set();
    if (!requests.has(fromUsername)) {
      socket.emit('error', { message: 'Friend request not found' });
      return;
    }
    
    requests.delete(fromUsername);

    // Add to both users' friend lists
    const userFriendsList = userFriends.get(user.username) || new Set();
    const fromUserFriendsList = userFriends.get(fromUsername) || new Set();
    
    userFriendsList.add(fromUsername);
    fromUserFriendsList.add(user.username);

    // Notify both users
    socket.emit('friend-added', { 
      username: fromUsername,
      online: isUserOnline(fromUsername)
    });

    const fromSocket = getUserSocket(fromUsername);
    if (fromSocket) {
      io.to(fromSocket).emit('friend-added', { 
        username: user.username,
        online: true
      });
    }

    console.log(`✅ Friend added: ${user.username} <-> ${fromUsername}`);
  });

  // Decline friend request
  socket.on('decline-friend-request', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { fromUsername } = data;
    const requests = friendRequests.get(user.username) || new Set();
    requests.delete(fromUsername);

    socket.emit('friend-request-declined', { username: fromUsername });
  });

  // Get friends list
  socket.on('get-friends', () => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    socket.emit('friends-list', {
      friends: getFriendsList(user.username),
      pendingRequests: Array.from(friendRequests.get(user.username) || new Set())
    });
  });

  // Send game invitation to friend
  socket.on('invite-friend', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { friendUsername, gameType = '10min' } = data;
    
    // Check if they're friends
    const userFriendsList = userFriends.get(user.username) || new Set();
    if (!userFriendsList.has(friendUsername)) {
      socket.emit('error', { message: 'You can only invite friends to games' });
      return;
    }

    // Check if friend is online
    const friendSocket = getUserSocket(friendUsername);
    if (!friendSocket) {
      socket.emit('error', { message: 'Friend is not online' });
      return;
    }

    const inviteId = generateInviteId();
    const invitation = {
      id: inviteId,
      from: user.username,
      to: friendUsername,
      gameType: gameType,
      createdAt: new Date(),
      status: 'pending'
    };

    gameInvitations.set(inviteId, invitation);

    // Send invitation to friend
    io.to(friendSocket).emit('game-invitation-received', {
      inviteId: inviteId,
      from: user.username,
      fromDisplayName: user.displayName,
      gameType: gameType
    });

    socket.emit('game-invitation-sent', { 
      to: friendUsername,
      inviteId: inviteId 
    });

    console.log(`🎮 Game invitation: ${user.username} -> ${friendUsername}`);
  });

  // Accept game invitation
  socket.on('accept-game-invitation', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { inviteId } = data;
    const invitation = gameInvitations.get(inviteId);
    
    if (!invitation || invitation.to !== user.username || invitation.status !== 'pending') {
      socket.emit('error', { message: 'Invalid or expired invitation' });
      return;
    }

    // Get both players
    const fromSocket = getUserSocket(invitation.from);
    if (!fromSocket) {
      socket.emit('error', { message: 'Inviting player is no longer online' });
      gameInvitations.delete(inviteId);
      return;
    }

    const fromUser = getUserBySocket(fromSocket);
    
    // Create game room
    const gameRoom = createGameRoom(fromUser, user);
    
    // Join socket rooms
    socket.join(gameRoom.id);
    io.sockets.sockets.get(fromSocket).join(gameRoom.id);
    
    // Randomly assign colors
    const player1Color = Math.random() < 0.5 ? 'white' : 'black';
    const player2Color = player1Color === 'white' ? 'black' : 'white';
    
    // Update game room with colors
    gameRoom.players.white = player1Color === 'white' ? fromUser : user;
    gameRoom.players.black = player1Color === 'black' ? fromUser : user;
    
    // Notify both players
    io.to(fromSocket).emit('match-found', {
      roomId: gameRoom.id,
      color: player1Color,
      opponent: user,
      gameState: {
        fen: gameRoom.chess.fen(),
        whiteTime: gameRoom.whiteTime,
        blackTime: gameRoom.blackTime,
        currentTurn: gameRoom.currentTurn
      }
    });
    
    socket.emit('match-found', {
      roomId: gameRoom.id,
      color: player2Color,
      opponent: fromUser,
      gameState: {
        fen: gameRoom.chess.fen(),
        whiteTime: gameRoom.whiteTime,
        blackTime: gameRoom.blackTime,
        currentTurn: gameRoom.currentTurn
      }
    });

    // Clean up invitation
    invitation.status = 'accepted';
    gameInvitations.delete(inviteId);
    
    // Start game timer
    startGameTimer(gameRoom.id);
    
    console.log(`🎮 Friend game started: ${fromUser.username} vs ${user.username}`);
  });

  // Decline game invitation
  socket.on('decline-game-invitation', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { inviteId } = data;
    const invitation = gameInvitations.get(inviteId);
    
    if (invitation && invitation.to === user.username) {
      const fromSocket = getUserSocket(invitation.from);
      if (fromSocket) {
        io.to(fromSocket).emit('game-invitation-declined', {
          by: user.username
        });
      }
      gameInvitations.delete(inviteId);
    }
  });

  // Random matchmaking (existing functionality)
  socket.on('join-matchmaking', (playerData) => {
    const user = getUserBySocket(socket.id);
    if (!user) {
      socket.emit('error', { message: 'Please register a username first' });
      return;
    }

    console.log(`🎯 ${user.username} joining random matchmaking`);
    
    // Remove from queue if already there
    const existingIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (existingIndex !== -1) {
      waitingPlayers.splice(existingIndex, 1);
    }
    
    // Add to waiting queue
    const player = {
      ...user,
      joinedAt: new Date(),
      ...playerData
    };
    
    waitingPlayers.push(player);
    
    socket.emit('matchmaking-joined', {
      position: waitingPlayers.length,
      message: 'Searching for random opponent...'
    });

    // Try to match players
    if (waitingPlayers.length >= 2) {
      const player1 = waitingPlayers.shift();
      const player2 = waitingPlayers.shift();
      
      // Create game room
      const gameRoom = createGameRoom(player1, player2);
      
      // Join socket rooms
      const socket1 = io.sockets.sockets.get(player1.socketId);
      const socket2 = io.sockets.sockets.get(player2.socketId);
      
      if (socket1 && socket2) {
        socket1.join(gameRoom.id);
        socket2.join(gameRoom.id);
        
        // Notify players
        socket1.emit('match-found', {
          roomId: gameRoom.id,
          color: 'white',
          opponent: player2,
          gameState: {
            fen: gameRoom.chess.fen(),
            whiteTime: gameRoom.whiteTime,
            blackTime: gameRoom.blackTime,
            currentTurn: gameRoom.currentTurn
          }
        });
        
        socket2.emit('match-found', {
          roomId: gameRoom.id,
          color: 'black',
          opponent: player1,
          gameState: {
            fen: gameRoom.chess.fen(),
            whiteTime: gameRoom.whiteTime,
            blackTime: gameRoom.blackTime,
            currentTurn: gameRoom.currentTurn
          }
        });
        
        console.log(`🎮 Random match: ${player1.username} vs ${player2.username}`);
        startGameTimer(gameRoom.id);
      }
    } else {
      socket.emit('waiting-for-opponent', {
        position: waitingPlayers.length,
        estimatedWait: waitingPlayers.length * 30
      });
    }
  });

  // Existing chess game handlers (move, resign, etc.)
  socket.on('make-move', (data) => {
    const { roomId, move, playerColor } = data;
    const gameRoom = gameRooms.get(roomId);
    
    if (!gameRoom) {
      socket.emit('error', { message: 'Game room not found' });
      return;
    }

    if (gameRoom.gameStatus !== 'playing') {
      socket.emit('error', { message: 'Game is not active' });
      return;
    }

    const expectedColor = gameRoom.chess.turn() === 'w' ? 'white' : 'black';
    if (playerColor !== expectedColor) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    try {
      const chess = gameRoom.chess;
      const result = chess.move(move);
      
      if (result) {
        gameRoom.currentTurn = chess.turn() === 'w' ? 'white' : 'black';
        gameRoom.lastMove = result;
        
        let gameEnded = false;
        let winner = null;
        let reason = null;
        
        if (chess.isGameOver()) {
          gameEnded = true;
          gameRoom.gameStatus = 'ended';
          
          if (chess.isCheckmate()) {
            winner = chess.turn() === 'w' ? 'black' : 'white';
            reason = 'checkmate';
          } else if (chess.isStalemate()) {
            reason = 'stalemate';
          } else if (chess.isDraw()) {
            reason = 'draw';
          }
        }
        
        const moveData = {
          move: result,
          fen: chess.fen(),
          currentTurn: gameRoom.currentTurn,
          whiteTime: gameRoom.whiteTime,
          blackTime: gameRoom.blackTime,
          gameEnded,
          winner,
          reason
        };
        
        io.to(roomId).emit('move-made', moveData);
        
        if (gameEnded) {
          console.log(`🏁 Game ${roomId} ended: ${reason} - Winner: ${winner || 'Draw'}`);
          stopGameTimer(roomId);
        }
        
      } else {
        socket.emit('invalid-move', { move, reason: 'Invalid move' });
      }
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('invalid-move', { move, reason: error.message });
    }
  });

  socket.on('resign', (data) => {
    const { roomId, playerColor } = data;
    const gameRoom = gameRooms.get(roomId);
    
    if (gameRoom && gameRoom.gameStatus === 'playing') {
      const winner = playerColor === 'white' ? 'black' : 'white';
      gameRoom.gameStatus = 'ended';
      
      io.to(roomId).emit('game-ended', {
        reason: 'resignation',
        winner: winner,
        resignedPlayer: playerColor
      });
      
      stopGameTimer(roomId);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`💔 User disconnected: ${socket.id}`);
    
    const user = getUserBySocket(socket.id);
    
    if (user) {
      // Remove from user mappings
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
      
      // Notify friends that user went offline
      const friends = userFriends.get(user.username) || new Set();
      friends.forEach(friendName => {
        const friendSocket = getUserSocket(friendName);
        if (friendSocket) {
          io.to(friendSocket).emit('friend-status-update', {
            username: user.username,
            status: 'offline'
          });
        }
      });
      
      console.log(`👋 User ${user.username} went offline`);
    }
    
    // Remove from waiting queue
    const waitingIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Handle game disconnections (existing logic)
    for (const [roomId, gameRoom] of gameRooms.entries()) {
      if (gameRoom.players.white.socketId === socket.id || 
          gameRoom.players.black.socketId === socket.id) {
        
        const disconnectedColor = gameRoom.players.white.socketId === socket.id ? 'white' : 'black';
        const winner = disconnectedColor === 'white' ? 'black' : 'white';
        
        io.to(roomId).emit('opponent-disconnected', {
          disconnectedPlayer: disconnectedColor,
          winner: winner
        });
        
        setTimeout(() => {
          if (gameRooms.has(roomId) && gameRoom.gameStatus === 'playing') {
            gameRoom.gameStatus = 'ended';
            io.to(roomId).emit('game-ended', {
              reason: 'disconnection',
              winner: winner,
              disconnectedPlayer: disconnectedColor
            });
            stopGameTimer(roomId);
          }
        }, 30000);
        
        break;
      }
    }
  });

  socket.on('get-stats', () => {
    socket.emit('stats', {
      activeGames: gameRooms.size,
      waitingPlayers: waitingPlayers.length,
      connectedUsers: connectedUsers.size,
      totalUsers: userFriends.size
    });
  });
});

// Game timer management (existing code)
const gameTimers = new Map();

function startGameTimer(roomId) {
  if (gameTimers.has(roomId)) {
    clearInterval(gameTimers.get(roomId));
  }
  
  const timer = setInterval(() => {
    const gameRoom = gameRooms.get(roomId);
    if (!gameRoom || gameRoom.gameStatus !== 'playing') {
      stopGameTimer(roomId);
      return;
    }
    
    if (gameRoom.currentTurn === 'white') {
      gameRoom.whiteTime--;
      if (gameRoom.whiteTime <= 0) {
        gameRoom.whiteTime = 0;
        gameRoom.gameStatus = 'ended';
        io.to(roomId).emit('game-ended', {
          reason: 'timeout',
          winner: 'black',
          timeoutPlayer: 'white'
        });
        stopGameTimer(roomId);
        return;
      }
    } else {
      gameRoom.blackTime--;
      if (gameRoom.blackTime <= 0) {
        gameRoom.blackTime = 0;
        gameRoom.gameStatus = 'ended';
        io.to(roomId).emit('game-ended', {
          reason: 'timeout',
          winner: 'white',
          timeoutPlayer: 'black'
        });
        stopGameTimer(roomId);
        return;
      }
    }
    
    if ((gameRoom.whiteTime % 5 === 0) || (gameRoom.blackTime % 5 === 0)) {
      io.to(roomId).emit('time-update', {
        whiteTime: gameRoom.whiteTime,
        blackTime: gameRoom.blackTime
      });
    }
  }, 1000);
  
  gameTimers.set(roomId, timer);
}

function stopGameTimer(roomId) {
  if (gameTimers.has(roomId)) {
    clearInterval(gameTimers.get(roomId));
    gameTimers.delete(roomId);
  }
}

// Cleanup old games and invitations
setInterval(() => {
  const now = new Date();
  
  // Clean up old games
  for (const [roomId, gameRoom] of gameRooms.entries()) {
    const gameAge = now - gameRoom.createdAt;
    if (gameAge > 2 * 60 * 60 * 1000) {
      gameRooms.delete(roomId);
      stopGameTimer(roomId);
    }
  }
  
  // Clean up old invitations
  for (const [inviteId, invitation] of gameInvitations.entries()) {
    const inviteAge = now - invitation.createdAt;
    if (inviteAge > 5 * 60 * 1000) { // 5 minutes
      gameInvitations.delete(inviteId);
    }
  }
}, 30 * 60 * 1000);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeGames: gameRooms.size,
    waitingPlayers: waitingPlayers.length,
    connectedUsers: connectedUsers.size,
    totalRegisteredUsers: userFriends.size,
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 ChessChat backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
