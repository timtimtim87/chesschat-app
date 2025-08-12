// server.js - Enhanced with PostgreSQL persistence for users, fast in-memory for games
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const Database = require('./database');
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

// Initialize database
const db = new Database();

// Fast in-memory storage for active gameplay (keeping these for speed!)
const gameRooms = new Map();
const waitingPlayers = []; // For random matchmaking
const connectedUsers = new Map(); // socketId -> user data (session only)
const userSockets = new Map(); // username -> socketId (session only)
const gameInvitations = new Map(); // inviteId -> invitation data (session only)

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

// Initialize database connection
async function initializeDatabase() {
  try {
    await db.connect();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  }
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // User registration/login with database persistence
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

      // Create/update user in database
      const dbUser = await db.createUser(username, displayName || username);

      // Create session user object
      const user = {
        socketId: socket.id,
        username: dbUser.username,
        displayName: dbUser.display_name,
        connectedAt: new Date(),
        status: 'online'
      };

      connectedUsers.set(socket.id, user);
      userSockets.set(username, socket.id);

      // Get user's friends and pending requests from database
      const [friends, pendingRequests] = await Promise.all([
        getFriendsList(username),
        db.getPendingFriendRequests(username)
      ]);

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

      console.log(`👤 User registered: ${username} (${dbUser.games_played} games played)`);
    } catch (error) {
      console.error('Registration error:', error);
      socket.emit('registration-error', { 
        message: 'Failed to register user. Please try again.' 
      });
    }
  });

  // Send friend request with database persistence
  socket.on('send-friend-request', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { targetUsername } = data;
    
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

  // Accept friend request with database persistence
  socket.on('accept-friend-request', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { fromUsername } = data;
    
    try {
      // Accept friend request in database
      await db.acceptFriendRequest(fromUsername, user.username);

      // Get updated friend info
      const [fromUserData] = await Promise.all([
        db.getUser(fromUsername)
      ]);

      // Notify both users
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

  // Decline friend request with database persistence
  socket.on('decline-friend-request', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { fromUsername } = data;
    
    try {
      await db.declineFriendRequest(fromUsername, user.username);
      socket.emit('friend-request-declined', { username: fromUsername });
    } catch (error) {
      console.error('Decline friend request error:', error);
      socket.emit('error', { message: 'Failed to decline friend request' });
    }
  });

  // Get friends list from database
  socket.on('get-friends', async () => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

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

  // Send game invitation to friend (with database verification)
  socket.on('invite-friend', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { friendUsername, gameType = '10min' } = data;
    
    try {
      // Check if they're friends in database
      const areFriends = await db.areFriends(user.username, friendUsername);
      if (!areFriends) {
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
    } catch (error) {
      console.error('Invite friend error:', error);
      socket.emit('error', { message: 'Failed to send game invitation' });
    }
  });

  // Accept game invitation (keeping in-memory for speed)
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

  // Random matchmaking (existing functionality with database user verification)
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

  // Chess game handlers (keeping in-memory for speed, with database logging)
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
          
          // Save game result to database
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
        
      } else {
        socket.emit('invalid-move', { move, reason: 'Invalid move' });
      }
    } catch (error) {
      console.error('Move error:', error);
      socket.emit('invalid-move', { move, reason: error.message });
    }
  });

  socket.on('resign', async (data) => {
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
      
      // Save resignation to database
      try {
        const gameData = {
          whitePlayer: gameRoom.players.white.username,
          blackPlayer: gameRoom.players.black.username,
          winner: winner,
          endReason: 'resignation',
          duration: Math.floor((new Date() - gameRoom.createdAt) / 1000),
          movesCount: gameRoom.moveCount
        };
        await db.saveGameResult(gameData);
        console.log(`💾 Resignation saved to database`);
      } catch (error) {
        console.error('Failed to save resignation:', error);
      }
    }
  });

  // Get user stats from database
  socket.on('get-user-stats', async (data) => {
    const user = getUserBySocket(socket.id);
    if (!user) return;

    const { username } = data || {};
    const targetUsername = username || user.username;

    try {
      const userStats = await db.getUserStats(targetUsername);
      if (userStats) {
        socket.emit('user-stats', {
          username: userStats.username,
          displayName: userStats.display_name,
          gamesPlayed: userStats.games_played,
          gamesWon: userStats.games_won,
          gamesLost: userStats.games_lost,
          gamesDrawn: userStats.games_drawn,
          winRate: userStats.games_played > 0 ? 
            ((userStats.games_won / userStats.games_played) * 100).toFixed(1) : 0,
          memberSince: userStats.created_at,
          lastSeen: userStats.last_seen
        });
      } else {
        socket.emit('error', { message: 'User not found' });
      }
    } catch (error) {
      console.error('Get user stats error:', error);
      socket.emit('error', { message: 'Failed to load user stats' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`💔 User disconnected: ${socket.id}`);
    
    const user = getUserBySocket(socket.id);
    
    if (user) {
      // Update last seen in database
      try {
        await db.updateLastSeen(user.username);
      } catch (error) {
        console.error('Failed to update last seen:', error);
      }

      // Remove from user mappings
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
      
      // Get friends from database and notify online friends
      try {
        const friends = await getFriendsList(user.username);
        const onlineFriends = friends.filter(friend => friend.online);
        onlineFriends.forEach(friend => {
          const friendSocket = getUserSocket(friend.username);
          if (friendSocket) {
            io.to(friendSocket).emit('friend-status-update', {
              username: user.username,
              status: 'offline'
            });
          }
        });
      } catch (error) {
        console.error('Failed to notify friends of disconnect:', error);
      }
      
      console.log(`👋 User ${user.username} went offline`);
    }
    
    // Remove from waiting queue
    const waitingIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Handle game disconnections
    for (const [roomId, gameRoom] of gameRooms.entries()) {
      if (gameRoom.players.white.socketId === socket.id || 
          gameRoom.players.black.socketId === socket.id) {
        
        const disconnectedColor = gameRoom.players.white.socketId === socket.id ? 'white' : 'black';
        const winner = disconnectedColor === 'white' ? 'black' : 'white';
        
        io.to(roomId).emit('opponent-disconnected', {
          disconnectedPlayer: disconnectedColor,
          winner: winner
        });
        
        setTimeout(async () => {
          if (gameRooms.has(roomId) && gameRoom.gameStatus === 'playing') {
            gameRoom.gameStatus = 'ended';
            io.to(roomId).emit('game-ended', {
              reason: 'disconnection',
              winner: winner,
              disconnectedPlayer: disconnectedColor
            });
            stopGameTimer(roomId);
            
            // Save disconnection to database
            try {
              const gameData = {
                whitePlayer: gameRoom.players.white.username,
                blackPlayer: gameRoom.players.black.username,
                winner: winner,
                endReason: 'disconnection',
                duration: Math.floor((new Date() - gameRoom.createdAt) / 1000),
                movesCount: gameRoom.moveCount
              };
              await db.saveGameResult(gameData);
            } catch (error) {
              console.error('Failed to save disconnection result:', error);
            }
          }
        }, 30000); // 30 second grace period
        
        break;
      }
    }
  });

  socket.on('get-stats', () => {
    socket.emit('stats', {
      activeGames: gameRooms.size,
      waitingPlayers: waitingPlayers.length,
      connectedUsers: connectedUsers.size
    });
  });
});

// Game timer management (keeping in-memory for performance)
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
        
        // Save timeout to database
        try {
          const gameData = {
            whitePlayer: gameRoom.players.white.username,
            blackPlayer: gameRoom.players.black.username,
            winner: 'black',
            endReason: 'timeout',
            duration: Math.floor((new Date() - gameRoom.createdAt) / 1000),
            movesCount: gameRoom.moveCount
          };
          await db.saveGameResult(gameData);
        } catch (error) {
          console.error('Failed to save timeout result:', error);
        }
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
        
        // Save timeout to database
        try {
          const gameData = {
            whitePlayer: gameRoom.players.white.username,
            blackPlayer: gameRoom.players.black.username,
            winner: 'white',
            endReason: 'timeout',
            duration: Math.floor((new Date() - gameRoom.createdAt) / 1000),
            movesCount: gameRoom.moveCount
          };
          await db.saveGameResult(gameData);
        } catch (error) {
          console.error('Failed to save timeout result:', error);
        }
        return;
      }
    }
    
    // Send time updates every 5 seconds or when time is low
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

// Cleanup old games and invitations
setInterval(() => {
  const now = new Date();
  
  // Clean up old games (keep in memory for 2 hours after completion)
  for (const [roomId, gameRoom] of gameRooms.entries()) {
    const gameAge = now - gameRoom.createdAt;
    if (gameAge > 2 * 60 * 60 * 1000) { // 2 hours
      gameRooms.delete(roomId);
      stopGameTimer(roomId);
    }
  }
  
  // Clean up old invitations (5 minutes)
  for (const [inviteId, invitation] of gameInvitations.entries()) {
    const inviteAge = now - invitation.createdAt;
    if (inviteAge > 5 * 60 * 1000) { // 5 minutes
      gameInvitations.delete(inviteId);
    }
  }
}, 30 * 60 * 1000); // Run every 30 minutes

// Cleanup old friend requests in database (daily)
setInterval(async () => {
  try {
    await db.cleanupOldFriendRequests(30); // Remove requests older than 30 days
  } catch (error) {
    console.error('Failed to cleanup old friend requests:', error);
  }
}, 24 * 60 * 60 * 1000); // Run once per day

// Health check endpoint with database status
app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  let dbUsers = 0;
  
  try {
    // Simple database health check
    const result = await db.pool.query('SELECT COUNT(*) as user_count FROM users');
    dbUsers = parseInt(result.rows[0].user_count);
    dbStatus = 'healthy';
  } catch (error) {
    console.error('Database health check failed:', error);
    dbStatus = 'unhealthy';
  }

  res.json({
    status: 'healthy',
    database: dbStatus,
    activeGames: gameRooms.size,
    waitingPlayers: waitingPlayers.length,
    connectedUsers: connectedUsers.size,
    totalUsers: dbUsers,
    uptime: process.uptime()
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Received SIGTERM, shutting down gracefully...');
  
  // Stop accepting new connections
  server.close(() => {
    console.log('🔌 HTTP server closed');
  });
  
  // Close database connection
  try {
    await db.close();
  } catch (error) {
    console.error('Error closing database:', error);
  }
  
  process.exit(0);
});

// Initialize and start server
async function startServer() {
  await initializeDatabase();
  
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`🚀 ChessChat backend running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`💾 Database: PostgreSQL connected`);
    console.log(`⚡ Game engine: In-memory for speed`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
