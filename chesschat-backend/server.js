// server.js - Simplified with direct username matching
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
  'https://chesschat-web-git-main-tims-projects-347b2ae0.vercel.app',
  'https://chesschat-web.vercel.app',
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

// In-memory storage for active gameplay
const gameRooms = new Map();
const connectedUsers = new Map(); // socketId -> user data
const userSockets = new Map(); // username -> socketId
const gameRequests = new Map(); // "user1:user2" -> request data

// Helper functions
function getUserBySocket(socketId) {
  return connectedUsers.get(socketId);
}

function getUserSocket(username) {
  return userSockets.get(username);
}

function isUserOnline(username) {
  return userSockets.has(username);
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

  // User registration
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

      socket.emit('registration-success', {
        username: user.username,
        displayName: user.displayName
      });

      console.log(`👤 User registered: ${username} (Total online: ${userSockets.size})`);
      console.log(`📊 Online users: [${Array.from(userSockets.keys()).join(', ')}]`);
    } catch (error) {
      console.error('Registration error:', error);
      socket.emit('registration-error', { 
        message: 'Failed to register user. Please try again.' 
      });
    }
  });

  // Direct game invitation (simplified)
  socket.on('invite-user-to-game', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { targetUsername } = data;
    
    // Validate target user
    if (targetUsername === user.username) {
      socket.emit('error', { message: "You can't play against yourself" });
      return;
    }

    if (!isUserOnline(targetUsername)) {
      socket.emit('error', { message: 'User is not online' });
      return;
    }

    const targetSocket = getUserSocket(targetUsername);
    const targetUser = getUserBySocket(targetSocket);
    
    if (!targetUser) {
      socket.emit('error', { message: 'Target user not found' });
      return;
    }

    // Send invitation to target user
    io.to(targetSocket).emit('game-invitation-received', {
      from: user.username,
      fromDisplayName: user.displayName,
      inviterSocket: socket.id
    });

    socket.emit('invitation-sent', { 
      to: targetUsername,
      message: `Invitation sent to ${targetUsername}`
    });

    console.log(`🎮 Direct invitation: ${user.username} -> ${targetUsername}`);
  });

  // Accept game invitation
  socket.on('accept-game-invitation', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { fromUsername, inviterSocket } = data;
    
    // Get inviter user
    const inviterUser = getUserBySocket(inviterSocket);
    if (!inviterUser) {
      socket.emit('error', { message: 'Inviting player is no longer online' });
      return;
    }

    console.log(`🎮 Starting game: ${inviterUser.username} vs ${user.username}`);
    startGameBetweenUsers(inviterUser, user);
  });

  // Decline game invitation
  socket.on('decline-game-invitation', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { fromUsername, inviterSocket } = data;
    
    // Notify inviter
    if (inviterSocket) {
      io.to(inviterSocket).emit('invitation-declined', {
        by: user.username,
        message: `${user.username} declined your invitation`
      });
    }

    console.log(`❌ Invitation declined: ${fromUsername} -> ${user.username}`);
  });

  // Helper function to start game between two users
  function startGameBetweenUsers(user1, user2) {
    // Create game room
    const gameRoom = createGameRoom(user1, user2);
    
    // Join socket rooms
    const socket1 = io.sockets.sockets.get(user1.socketId);
    const socket2 = io.sockets.sockets.get(user2.socketId);
    
    if (socket1 && socket2) {
      socket1.join(gameRoom.id);
      socket2.join(gameRoom.id);
      
      // Randomly assign colors
      const user1Color = Math.random() < 0.5 ? 'white' : 'black';
      const user2Color = user1Color === 'white' ? 'black' : 'white';
      
      // Update game room with colors
      gameRoom.players.white = user1Color === 'white' ? user1 : user2;
      gameRoom.players.black = user1Color === 'black' ? user1 : user2;
      
      // Notify both players
      socket1.emit('match-found', {
        roomId: gameRoom.id,
        color: user1Color,
        opponent: user2,
        gameState: {
          fen: gameRoom.chess.fen(),
          whiteTime: gameRoom.whiteTime,
          blackTime: gameRoom.blackTime,
          currentTurn: gameRoom.currentTurn
        }
      });
      
      socket2.emit('match-found', {
        roomId: gameRoom.id,
        color: user2Color,
        opponent: user1,
        gameState: {
          fen: gameRoom.chess.fen(),
          whiteTime: gameRoom.whiteTime,
          blackTime: gameRoom.blackTime,
          currentTurn: gameRoom.currentTurn
        }
      });
      
      console.log(`🎮 Game started: ${user1.username} (${user1Color}) vs ${user2.username} (${user2Color})`);
      startGameTimer(gameRoom.id);
    }
  }

  // Get online users
  socket.on('get-online-users', () => {
    const user = getUserBySocket(socket.id);
    if (!user) {
      socket.emit('online-users-list', { users: [] });
      return;
    }

    // Get all online users except the requesting user
    const onlineUsers = Array.from(userSockets.keys()).filter(username => username !== user.username);
    
    console.log(`📋 Sending online users to ${user.username}:`, onlineUsers);
    socket.emit('online-users-list', { users: onlineUsers });
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
        }
        
      } else {
        socket.emit('invalid-move', { move, reason: 'Invalid move' });
      }
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('invalid-move', { move, reason: error.message });
    }
  });

  // Resign game
  socket.on('resign', async (data) => {
    const { roomId, playerColor } = data;
    const gameRoom = gameRooms.get(roomId);
    
    if (!gameRoom) {
      socket.emit('error', { message: 'Game room not found' });
      return;
    }
    
    if (gameRoom.gameStatus !== 'playing') {
      socket.emit('error', { message: 'Game is not active' });
      return;
    }
    
    const winner = playerColor === 'white' ? 'black' : 'white';
    gameRoom.gameStatus = 'ended';
    
    io.to(roomId).emit('game-ended', {
      reason: 'resignation',
      winner: winner,
      resignedPlayer: playerColor
    });
    
    stopGameTimer(roomId);
    console.log(`🏳️ ${playerColor} resigned in game ${roomId}`);
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`💔 User disconnected: ${socket.id}`);
    
    const user = getUserBySocket(socket.id);
    
    if (user) {
      // Remove from user mappings
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
      
      // Clean up game requests
      for (const [key, request] of gameRequests.entries()) {
        if (request.requestedBy === user.username || request.targetUser === user.username) {
          gameRequests.delete(key);
        }
      }
      
      console.log(`👋 User ${user.username} went offline`);
    }
  });

  socket.on('get-stats', () => {
    socket.emit('stats', {
      activeGames: gameRooms.size,
      connectedUsers: connectedUsers.size,
      gameRequests: gameRequests.size
    });
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

  // Get current online users for debugging
  const onlineUsers = Array.from(userSockets.keys());

  res.json({
    status: 'healthy',
    database: dbStatus,
    activeGames: gameRooms.size,
    connectedUsers: connectedUsers.size,
    gameRequests: gameRequests.size,
    totalUsers: dbUsers,
    onlineUsers: onlineUsers, // Add this for debugging
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Debug endpoint to see online users
app.get('/online-users', (req, res) => {
  const onlineUsers = Array.from(userSockets.keys());
  res.json({
    count: onlineUsers.length,
    users: onlineUsers,
    socketMappings: Object.fromEntries(userSockets)
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
    console.log(`⚡ Game engine: Direct username matching`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
