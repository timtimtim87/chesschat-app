// server.js - Fixed for Railway deployment
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const Database = require('./database');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Get port from environment or default to 3001
const PORT = process.env.PORT || 3001;

// CORS configuration for Railway deployment
const corsOrigins = [
  'http://localhost:3000',
  'https://chesschat-web-timantibes-1614-tims-projects-347b2ae0.vercel.app',
  // Add your actual Vercel domain here
  'https://chesschat-web.vercel.app',
  // Add any other frontend domains you might use
];

const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? corsOrigins
      : ['http://localhost:3000'],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? corsOrigins
    : ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

// Root endpoint for health check
app.get('/', (req, res) => {
  res.json({
    message: 'ChessChat Backend Server',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Initialize database - make it optional for deployment
let db = null;
async function initializeDatabase() {
  try {
    // Only initialize database if DATABASE_URL is provided
    if (process.env.DATABASE_URL) {
      db = new Database();
      await db.connect();
      console.log('✅ Database initialized successfully');
    } else {
      console.log('⚠️  No DATABASE_URL provided, running without database persistence');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    console.log('⚠️  Continuing without database - features will be limited');
    db = null;
  }
}

// Fast in-memory storage for active gameplay
const gameRooms = new Map();
const waitingPlayers = [];
const connectedUsers = new Map();
const userSockets = new Map();
const gameInvitations = new Map();

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

async function getFriendsList(username) {
  if (!db) return [];
  
  try {
    const friends = await db.getFriends(username);
    return friends.map(friend => ({
      username: friend.friend_username,
      displayName: friend.display_name,
      online: isUserOnline(friend.friend_username),
      status: isUserOnline(friend.friend_username) ? 'online' : 'offline',
      lastSeen: friend.last_seen,
      friendshipCreated: friend.friendship_created
    }));
  } catch (error) {
    console.error('Error getting friends list:', error);
    return [];
  }
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
    lastMove: null,
    moveCount: 0
  };
  
  gameRooms.set(roomId, gameRoom);
  return gameRoom;
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // User registration with database persistence (if available)
  socket.on('register-user', async (userData) => {
    const { username, displayName } = userData;
    
    try {
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

      let dbUser = null;
      
      // Create/update user in database if available
      if (db) {
        try {
          dbUser = await db.createUser(username, displayName || username);
        } catch (error) {
          console.error('Database user creation failed:', error);
          // Continue without database
        }
      }

      // Create session user object
      const user = {
        socketId: socket.id,
        username: username,
        displayName: displayName || username,
        connectedAt: new Date(),
        status: 'online'
      };

      connectedUsers.set(socket.id, user);
      userSockets.set(username, socket.id);

      // Get user's friends and pending requests from database if available
      let friends = [];
      let pendingRequests = [];
      
      if (db) {
        try {
          [friends, pendingRequests] = await Promise.all([
            getFriendsList(username),
            db.getPendingFriendRequests(username)
          ]);
        } catch (error) {
          console.error('Failed to load user data:', error);
        }
      }

      socket.emit('registration-success', {
        username: user.username,
        displayName: user.displayName,
        friends: friends,
        pendingRequests: pendingRequests.map(req => ({
          from: req.from_user,
          displayName: req.display_name,
          createdAt: req.created_at
        }))
      });

      // Notify online friends that user is online
      const onlineFriends = friends.filter(friend => friend.online);
      onlineFriends.forEach(friend => {
        const friendSocket = getUserSocket(friend.username);
        if (friendSocket) {
          io.to(friendSocket).emit('friend-status-update', {
            username: username,
            status: 'online'
          });
        }
      });

      console.log(`👤 User registered: ${username} (DB: ${dbUser ? 'saved' : 'memory-only'})`);
    } catch (error) {
      console.error('Registration error:', error);
      socket.emit('registration-error', { 
        message: 'Failed to register user. Please try again.' 
      });
    }
  });

  // Send friend request with database persistence (if available)
  socket.on('send-friend-request', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { targetUsername } = data;
    
    if (!db) {
      socket.emit('error', { message: 'Friend system requires database connection' });
      return;
    }
    
    try {
      if (targetUsername === user.username) {
        socket.emit('error', { message: "You can't add yourself as a friend" });
        return;
      }

      // Check if target user exists
      const targetUser = await db.getUser(targetUsername);
      if (!targetUser) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Send friend request through database
      await db.sendFriendRequest(user.username, targetUsername);

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
    } catch (error) {
      console.error('Send friend request error:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Accept friend request (similar error handling)
  socket.on('accept-friend-request', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user || !db) return;

    const { fromUsername } = data;
    
    try {
      await db.acceptFriendRequest(fromUsername, user.username);

      const [fromUserData] = await Promise.all([
        db.getUser(fromUsername)
      ]);

      socket.emit('friend-added', { 
        username: fromUsername,
        displayName: fromUserData.display_name,
        online: isUserOnline(fromUsername)
      });

      const fromSocket = getUserSocket(fromUsername);
      if (fromSocket) {
        io.to(fromSocket).emit('friend-added', { 
          username: user.username,
          displayName: user.displayName,
          online: true
        });
      }

      console.log(`✅ Friend added: ${user.username} <-> ${fromUsername}`);
    } catch (error) {
      console.error('Accept friend request error:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Decline friend request
  socket.on('decline-friend-request', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user || !db) return;

    const { fromUsername } = data;
    
    try {
      await db.declineFriendRequest(fromUsername, user.username);
      socket.emit('friend-request-declined', { username: fromUsername });
    } catch (error) {
      console.error('Decline friend request error:', error);
      socket.emit('error', { message: 'Failed to decline friend request' });
    }
  });

  // Get friends list
  socket.on('get-friends', async () => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    if (!db) {
      socket.emit('friends-list', { friends: [], pendingRequests: [] });
      return;
    }

    try {
      const [friends, pendingRequests] = await Promise.all([
        getFriendsList(user.username),
        db.getPendingFriendRequests(user.username)
      ]);

      socket.emit('friends-list', {
        friends: friends,
        pendingRequests: pendingRequests.map(req => ({
          from: req.from_user,
          displayName: req.display_name,
          createdAt: req.created_at
        }))
      });
    } catch (error) {
      console.error('Get friends error:', error);
      socket.emit('error', { message: 'Failed to load friends list' });
    }
  });

  // Game invitation system (keeping in-memory for simplicity)
  socket.on('invite-friend', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { friendUsername, gameType = '10min' } = data;
    
    // Check if friend is online
    const friendSocket = getUserSocket(friendUsername);
    if (!friendSocket) {
      socket.emit('error', { message: 'Friend is not online' });
      return;
    }

    // Check if they're friends (if database available)
    if (db) {
      try {
        const areFriends = await db.areFriends(user.username, friendUsername);
        if (!areFriends) {
          socket.emit('error', { message: 'You can only invite friends to games' });
          return;
        }
      } catch (error) {
        console.error('Friend check error:', error);
      }
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

  // Rest of the socket handlers (accept invitation, matchmaking, game moves, etc.)
  // ... (keeping existing logic for game handling)

  // Random matchmaking
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
    }
  });

  // Game move handling
  socket.on('make-move', async (data) => {
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
        gameRoom.moveCount++;
        
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
            winner = 'draw';
          } else if (chess.isDraw()) {
            reason = 'draw';
            winner = 'draw';
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
          
          // Save game result to database if available
          if (db) {
            try {
              const gameData = {
                whitePlayer: gameRoom.players.white.username,
                blackPlayer: gameRoom.players.black.username,
                winner: winner,
                endReason: reason,
                duration: Math.floor((new Date() - gameRoom.createdAt) / 1000),
                movesCount: gameRoom.moveCount
              };
              await db.saveGameResult(gameData);
              console.log(`💾 Game result saved to database`);
            } catch (error) {
              console.error('Failed to save game result:', error);
            }
          }
        }
        
      } else {
        socket.emit('invalid-move', { move, reason: 'Invalid move' });
      }
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('invalid-move', { move, reason: error.message });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`💔 User disconnected: ${socket.id}`);
    
    const user = getUserBySocket(socket.id);
    
    if (user) {
      // Update last seen in database if available
      if (db) {
        try {
          await db.updateLastSeen(user.username);
        } catch (error) {
          console.error('Failed to update last seen:', error);
        }
      }

      // Remove from user mappings
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
      
      console.log(`👋 User ${user.username} went offline`);
    }
    
    // Remove from waiting queue
    const waitingIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
  });
});

// Game timer management
const gameTimers = new Map();

function startGameTimer(roomId) {
  if (gameTimers.has(roomId)) {
    clearInterval(gameTimers.get(roomId));
  }
  
  const timer = setInterval(async () => {
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
    
    // Send time updates
    if ((gameRoom.whiteTime % 5 === 0) || (gameRoom.blackTime % 5 === 0) || 
        gameRoom.whiteTime <= 10 || gameRoom.blackTime <= 10) {
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

// Health check endpoint
app.get('/health', async (req, res) => {
  let dbStatus = 'not configured';
  let dbUsers = 0;
  
  if (db) {
    try {
      const result = await db.pool.query('SELECT COUNT(*) as user_count FROM users');
      dbUsers = parseInt(result.rows[0].user_count);
      dbStatus = 'healthy';
    } catch (error) {
      console.error('Database health check failed:', error);
      dbStatus = 'unhealthy';
    }
  }

  res.json({
    status: 'healthy',
    database: dbStatus,
    activeGames: gameRooms.size,
    waitingPlayers: waitingPlayers.length,
    connectedUsers: connectedUsers.size,
    totalUsers: dbUsers,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Received SIGTERM, shutting down gracefully...');
  
  server.close(() => {
    console.log('🔌 HTTP server closed');
  });
  
  if (db) {
    try {
      await db.close();
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }
  
  process.exit(0);
});

// Initialize and start server
async function startServer() {
  await initializeDatabase();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ChessChat backend running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`💾 Database: ${db ? 'PostgreSQL connected' : 'Memory-only mode'}`);
    console.log(`⚡ Game engine: In-memory for speed`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
