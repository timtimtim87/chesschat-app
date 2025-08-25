// server.js - Simplified for direct room joining without user registration
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

// Debug video service status on startup
console.log('🎥 Video Service Debug:', {
  hasApiKey: !!process.env.DAILY_API_KEY,
  apiKeyLength: process.env.DAILY_API_KEY ? process.env.DAILY_API_KEY.length : 0,
  isConfigured: videoService.isConfigured(),
  status: videoService.getStatus()
});

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

// Simplified in-memory storage for active gameplay
const gameRooms = new Map();
const matchingCodes = new Map(); // code -> [user1, user2, ...]
const activeConnections = new Map(); // socketId -> user data

// Helper functions
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
    videoRoom: null
  };
  
  gameRooms.set(roomId, gameRoom);
  return gameRoom;
}

// Enhanced function to start game between two users with video
async function startGameBetweenUsers(user1, user2) {
  console.log(`🎮 Starting game between ${user1.displayName} and ${user2.displayName}`);
  
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
    console.log('🎥 Attempting to create video room...');
    
    let videoRoom = null;
    if (videoService.isConfigured()) {
      try {
        videoRoom = await videoService.createGameRoom(
          gameRoom.id, 
          [user1.displayName, user2.displayName]
        );
        
        if (videoRoom) {
          console.log(`✅ Video room created: ${videoRoom.url}`);
          gameRoom.videoRoom = videoRoom;
        } else {
          console.warn('⚠️  Video room creation returned null');
          gameRoom.videoRoom = null;
        }
      } catch (error) {
        console.error('❌ Error creating video room:', error);
        gameRoom.videoRoom = null;
      }
    } else {
      console.log('⚠️  Video service not configured');
      gameRoom.videoRoom = null;
    }
    
    // Prepare game data
    const gameStateData = {
      roomId: gameRoom.id,
      gameState: {
        fen: gameRoom.chess.fen(),
        whiteTime: gameRoom.whiteTime,
        blackTime: gameRoom.blackTime,
        currentTurn: gameRoom.currentTurn
      },
      videoRoom: gameRoom.videoRoom
    };
    
    console.log('📤 Sending match-found event');
    
    // Notify both players
    socket1.emit('match-found', {
      ...gameStateData,
      color: user1Color,
      opponent: { 
        username: user2.displayName, 
        displayName: user2.displayName 
      }
    });
    
    socket2.emit('match-found', {
      ...gameStateData,
      color: user2Color,
      opponent: { 
        username: user1.displayName, 
        displayName: user1.displayName 
      }
    });
    
    console.log(`🎮 Game started: ${user1.displayName} (${user1Color}) vs ${user2.displayName} (${user2Color})`);
    startGameTimer(gameRoom.id);
  }
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Simplified room joining - combines user creation and matching
  socket.on('enter-match-code', async (data) => {
    const { code, displayName = `Player_${Math.random().toString(36).substr(2, 4)}` } = data;
    
    console.log(`🔑 User ${displayName} entering code: ${code}`);
    
    // Validate inputs
    if (!code || code.length < 3 || code.length > 20) {
      socket.emit('error', { message: 'Code must be 3-20 characters long' });
      return;
    }

    if (!displayName || displayName.length < 2 || displayName.length > 30) {
      socket.emit('error', { message: 'Display name must be 2-30 characters long' });
      return;
    }

    // Create user object
    const user = {
      socketId: socket.id,
      displayName: displayName.trim(),
      username: displayName.trim(), // Use display name as username for simplicity
      connectedAt: new Date(),
      status: 'waiting'
    };

    // Store active connection
    activeConnections.set(socket.id, user);

    // Get or create code entry
    if (!matchingCodes.has(code)) {
      matchingCodes.set(code, []);
    }
    
    const waitingUsers = matchingCodes.get(code);
    
    // Check if user already in this code (shouldn't happen with new flow, but safety check)
    const existingUserIndex = waitingUsers.findIndex(u => u.displayName === user.displayName);
    if (existingUserIndex !== -1) {
      waitingUsers[existingUserIndex] = user; // Update with new socket
      socket.emit('code-entered', { 
        code: code,
        message: `You're back in the queue for "${code}"`,
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
      console.log(`⏳ ${user.displayName} waiting for match with code: ${code}`);
      
    } else if (waitingUsers.length >= 2) {
      // Match found! Start game between first two users
      const player1 = waitingUsers[0];
      const player2 = waitingUsers[1];
      
      console.log(`🎮 MATCH FOUND! ${player1.displayName} vs ${player2.displayName} (code: ${code})`);
      
      // Start the game
      await startGameBetweenUsers(player1, player2);
      
      // Clean up - remove these two users from the code
      waitingUsers.splice(0, 2);
      
      // If no one else waiting, remove the code entirely
      if (waitingUsers.length === 0) {
        matchingCodes.delete(code);
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
          
          // UPDATED: Don't clean up video room immediately - let players chat
          console.log('🎥 Game ended naturally - keeping video room for post-game chat');
        }
        
      } else {
        socket.emit('invalid-move', { move, reason: 'Invalid move' });
      }
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('invalid-move', { move, reason: error.message });
    }
  });

  // UPDATED: Resign game - ends game but keeps video
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
    console.log(`🏳️ ${playerColor} resigned in game ${roomId} - keeping video for post-game chat`);
    
    // UPDATED: Don't clean up video room - let players continue chatting
    console.log('🎥 Resignation occurred - keeping video room for post-game discussion');
  });

  // NEW: Exit game handler - removes both players from game and video
  socket.on('exit-game', async (data) => {
    const { roomId } = data;
    const gameRoom = gameRooms.get(roomId);
    
    if (!gameRoom) {
      console.log(`⚠️  Exit game request for non-existent room: ${roomId}`);
      return;
    }
    
    console.log(`🚪 Exit game request for room ${roomId} - removing both players`);
    
    // Notify both players to exit
    io.to(roomId).emit('exit-game', {
      reason: 'player-exit',
      message: 'A player has left the game'
    });
    
    // Clean up video room now
    if (gameRoom.videoRoom && gameRoom.videoRoom.name) {
      console.log(`🎥 Cleaning up video room: ${gameRoom.videoRoom.name}`);
      try {
        await videoService.deleteGameRoom(gameRoom.videoRoom.name);
        console.log('✅ Video room cleaned up after exit game');
      } catch (error) {
        console.error('❌ Error cleaning up video room:', error);
      }
    }
    
    // Stop game timer
    stopGameTimer(roomId);
    
    // Remove game room
    gameRooms.delete(roomId);
    
    console.log(`✅ Game room ${roomId} fully cleaned up after exit`);
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`💔 User disconnected: ${socket.id}`);
    
    const user = activeConnections.get(socket.id);
    
    if (user) {
      // Remove from active connections
      activeConnections.delete(socket.id);
      
      // Clean up matching codes
      for (const [code, users] of matchingCodes.entries()) {
        const userIndex = users.findIndex(u => u.socketId === socket.id);
        if (userIndex !== -1) {
          users.splice(userIndex, 1);
          console.log(`🧹 Removed ${user.displayName} from code: ${code}`);
          
          if (users.length === 0) {
            matchingCodes.delete(code);
          }
        }
      }
      
      // Check if user was in an active game and handle appropriately
      for (const [roomId, gameRoom] of gameRooms.entries()) {
        const wasInGame = (gameRoom.players.white && gameRoom.players.white.socketId === socket.id) ||
                         (gameRoom.players.black && gameRoom.players.black.socketId === socket.id);
        
        if (wasInGame) {
          console.log(`👋 Player ${user.displayName} disconnected from active game ${roomId}`);
          
          // If game was still playing, end it due to disconnection
          if (gameRoom.gameStatus === 'playing') {
            gameRoom.gameStatus = 'ended';
            io.to(roomId).emit('game-ended', {
              reason: 'disconnection',
              winner: gameRoom.players.white.socketId === socket.id ? 'black' : 'white',
              disconnectedPlayer: user.displayName
            });
            stopGameTimer(roomId);
            console.log(`🏁 Game ${roomId} ended due to disconnection`);
          }
          
          // Clean up video room after short delay (in case they reconnect quickly)
          if (gameRoom.videoRoom && gameRoom.videoRoom.name) {
            setTimeout(async () => {
              try {
                await videoService.deleteGameRoom(gameRoom.videoRoom.name);
                console.log(`🎥 Cleaned up video room after disconnection: ${gameRoom.videoRoom.name}`);
              } catch (error) {
                console.error('❌ Error cleaning up video after disconnection:', error);
              }
            }, 10000); // 10 second delay
          }
          break;
        }
      }
      
      console.log(`👋 User ${user.displayName} disconnected`);
    }
  });

  socket.on('get-stats', () => {
    socket.emit('stats', {
      activeGames: gameRooms.size,
      activeConnections: activeConnections.size,
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
        
        // UPDATED: Don't clean up video room on timeout - let players chat
        console.log('🎥 Game ended by timeout - keeping video room for post-game chat');
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
        
        // UPDATED: Don't clean up video room on timeout - let players chat
        console.log('🎥 Game ended by timeout - keeping video room for post-game chat');
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

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  let dbStatus = 'not configured';
  
  if (db) {
    try {
      const result = await db.pool.query('SELECT 1');
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
    activeConnections: activeConnections.size,
    matchingCodes: matchingCodes.size,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    video: {
      ...videoService.getStatus(),
      hasApiKey: !!process.env.DAILY_API_KEY,
      apiKeyLength: process.env.DAILY_API_KEY ? process.env.DAILY_API_KEY.length : 0
    }
  });
});

// Video service endpoints
app.get('/video/status', (req, res) => {
  res.json({
    ...videoService.getStatus(),
    hasApiKey: !!process.env.DAILY_API_KEY,
    apiKeyLength: process.env.DAILY_API_KEY ? process.env.DAILY_API_KEY.length : 0
  });
});

app.get('/video/test', async (req, res) => {
  if (!videoService.isConfigured()) {
    return res.json({
      success: false,
      error: 'Video service not configured',
      hasApiKey: !!process.env.DAILY_API_KEY,
      status: videoService.getStatus()
    });
  }

  try {
    const connectionTest = await videoService.testApiConnection();
    if (!connectionTest.success) {
      return res.json({
        success: false,
        error: 'API connection failed',
        details: connectionTest
      });
    }

    const testRoom = await videoService.createGameRoom('test-' + Date.now(), ['TestUser1', 'TestUser2']);
    
    if (testRoom) {
      setTimeout(() => {
        videoService.deleteGameRoom(testRoom.name);
      }, 30000);
      
      res.json({
        success: true,
        message: 'Video room created successfully',
        room: testRoom,
        connectionTest: connectionTest
      });
    } else {
      res.json({
        success: false,
        error: 'Failed to create test room',
        connectionTest: connectionTest
      });
    }
  } catch (error) {
    console.error('❌ Test room creation error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Cleanup expired video rooms every hour
setInterval(() => {
  try {
    videoService.cleanupExpiredRooms();
  } catch (error) {
    console.error('Error during scheduled cleanup:', error);
  }
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
    console.log(`⚡ Game engine: Simplified room matching`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});