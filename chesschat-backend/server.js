// server.js - Complete with video integration
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const Database = require('./database');
const VideoService = require('./videoService');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Get port from environment or default to 3001
const PORT = process.env.PORT || 3001;

// Initialize video service
const videoService = new VideoService();

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
    video: videoService.getStatus(),
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
const matchingCodes = new Map(); // code -> [user1, user2, ...]

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
    moveCount: 0,
    videoRoom: null // Will be populated with Daily.co room info
  };
  
  gameRooms.set(roomId, gameRoom);
  return gameRoom;
}

// Helper function to start game between two users
async function startGameBetweenUsers(user1, user2) {
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
    
    // Create video room
    try {
      const videoRoom = await videoService.createGameRoom(
        gameRoom.id, 
        [user1.username, user2.username]
      );
      
      if (videoRoom) {
        gameRoom.videoRoom = videoRoom;
        console.log(`🎥 Video room created for game ${gameRoom.id}: ${videoRoom.url}`);
      } else {
        console.log(`⚠️  Video room creation failed for game ${gameRoom.id}, continuing without video`);
      }
    } catch (error) {
      console.error(`❌ Video room creation error for game ${gameRoom.id}:`, error);
    }
    
    // Prepare game data for both players
    const gameStateData = {
      roomId: gameRoom.id,
      gameState: {
        fen: gameRoom.chess.fen(),
        whiteTime: gameRoom.whiteTime,
        blackTime: gameRoom.blackTime,
        currentTurn: gameRoom.currentTurn
      },
      videoRoom: gameRoom.videoRoom // Include video room info
    };
    
    // Notify both players
    socket1.emit('match-found', {
      ...gameStateData,
      color: user1Color,
      opponent: user2
    });
    
    socket2.emit('match-found', {
      ...gameStateData,
      color: user2Color,
      opponent: user1
    });
    
    console.log(`🎮 Game started: ${user1.username} (${user1Color}) vs ${user2.username} (${user2Color})`);
    console.log(`🎥 Video room: ${gameRoom.videoRoom ? gameRoom.videoRoom.url : 'disabled'}`);
    startGameTimer(gameRoom.id);
  }
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

  // Simplified matching system - enter a code to match
  socket.on('enter-match-code', (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) {
      socket.emit('error', { message: 'User not found' });
      return;
    }

    const { code } = data;
    
    console.log(`🔑 User ${user.username} entering code: ${code}`);
    
    // Validate code
    if (!code || code.length < 3 || code.length > 20) {
      socket.emit('error', { message: 'Code must be 3-20 characters long' });
      return;
    }

    // Get or create code entry
    if (!matchingCodes.has(code)) {
      matchingCodes.set(code, []);
    }
    
    const waitingUsers = matchingCodes.get(code);
    
    // Check if user already in this code
    if (waitingUsers.some(u => u.username === user.username)) {
      socket.emit('code-entered', { 
        code: code,
        message: `You're already waiting for someone to enter code "${code}"`,
        waiting: true
      });
      return;
    }
    
    // Add user to waiting list
    waitingUsers.push(user);
    
    if (waitingUsers.length === 1) {
      // First person - waiting for match
      socket.emit('code-entered', { 
        code: code,
        message: `Waiting for someone to enter code "${code}"`,
        waiting: true
      });
      console.log(`⏳ ${user.username} waiting for match with code: ${code}`);
      
    } else if (waitingUsers.length >= 2) {
      // Match found! Start game between first two users
      const player1 = waitingUsers[0];
      const player2 = waitingUsers[1];
      
      console.log(`🎮 MATCH FOUND! ${player1.username} vs ${player2.username} (code: ${code})`);
      
      // Start the game (now includes video room creation)
      startGameBetweenUsers(player1, player2);
      
      // Clean up - remove these two users from the code
      waitingUsers.splice(0, 2);
      
      // If no one else waiting, remove the code entirely
      if (waitingUsers.length === 0) {
        matchingCodes.delete(code);
      }
    }
  });

  // Get online users (keeping for debug)
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
          
          // Clean up video room
          if (gameRoom.videoRoom && gameRoom.videoRoom.name) {
            setTimeout(() => {
              videoService.deleteGameRoom(gameRoom.videoRoom.name);
            }, 30000); // 30 second delay to allow players to see final position
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
    
    // Clean up video room
    if (gameRoom.videoRoom && gameRoom.videoRoom.name) {
      setTimeout(() => {
        videoService.deleteGameRoom(gameRoom.videoRoom.name);
      }, 10000); // 10 second delay
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`💔 User disconnected: ${socket.id}`);
    
    const user = getUserBySocket(socket.id);
    
    if (user) {
      // Remove from user mappings
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
      
      // Clean up matching codes
      for (const [code, users] of matchingCodes.entries()) {
        const userIndex = users.findIndex(u => u.username === user.username);
        if (userIndex !== -1) {
          users.splice(userIndex, 1);
          console.log(`🧹 Removed ${user.username} from code: ${code}`);
          
          // If no users left, delete the code
          if (users.length === 0) {
            matchingCodes.delete(code);
          }
        }
      }
      
      console.log(`👋 User ${user.username} went offline`);
    }
  });

  socket.on('get-stats', () => {
    socket.emit('stats', {
      activeGames: gameRooms.size,
      connectedUsers: connectedUsers.size,
      matchingCodes: matchingCodes.size,
      videoService: videoService.getStatus()
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
    matchingCodes: matchingCodes.size,
    totalUsers: dbUsers,
    onlineUsers: onlineUsers,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    video: videoService.getStatus()
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

// Video service endpoints for debugging
app.get('/video/status', (req, res) => {
  res.json(videoService.getStatus());
});

// Cleanup expired video rooms every hour
setInterval(() => {
  videoService.cleanupExpiredRooms();
}, 60 * 60 * 1000);

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
    console.log(`🎥 Video service: ${videoService.isConfigured() ? 'Daily.co configured' : 'Video disabled'}`);
    console.log(`⚡ Game engine: Code matching system`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});