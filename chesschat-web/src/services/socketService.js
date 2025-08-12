// src/services/socketService.js - Updated for Railway backend
import io from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.eventHandlers = {};
    this.currentUser = null;
  }

  connect(serverUrl = null) {
    try {
      // Auto-detect server URL based on environment
      const defaultServerUrl = process.env.NODE_ENV === 'production' 
        ? 'https://chesschat-backend-production.up.railway.app'
        : 'http://localhost:3001';
      
      const finalServerUrl = serverUrl || defaultServerUrl;
      
      console.log('🔌 Connecting to:', finalServerUrl);
      
      this.socket = io(finalServerUrl, {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        forceNew: false,
        withCredentials: true,
        autoConnect: true
      });

      this.setupEventListeners();
      return this.socket;
    } catch (error) {
      console.error('❌ Failed to connect to server:', error);
      throw error;
    }
  }

  setupEventListeners() {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ Connected to ChessChat server');
      this.isConnected = true;
      this.notifyHandlers('connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('💔 Disconnected from server:', reason);
      this.isConnected = false;
      this.notifyHandlers('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error);
      this.notifyHandlers('connection_error', error);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Reconnected after', attemptNumber, 'attempts');
      this.notifyHandlers('reconnected');
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('❌ Reconnection error:', error);
    });

    // User system events
    this.socket.on('registration-success', (data) => {
      console.log('✅ User registered:', data);
      this.currentUser = data;
      this.notifyHandlers('registration-success', data);
    });

    this.socket.on('registration-error', (data) => {
      console.log('❌ Registration error:', data);
      this.notifyHandlers('registration-error', data);
    });

    // Friend system events
    this.socket.on('friend-request-received', (data) => {
      console.log('👥 Friend request received:', data);
      this.notifyHandlers('friend-request-received', data);
    });

    this.socket.on('friend-request-sent', (data) => {
      console.log('📤 Friend request sent:', data);
      this.notifyHandlers('friend-request-sent', data);
    });

    this.socket.on('friend-added', (data) => {
      console.log('✅ Friend added:', data);
      this.notifyHandlers('friend-added', data);
    });

    this.socket.on('friend-status-update', (data) => {
      console.log('🔄 Friend status update:', data);
      this.notifyHandlers('friend-status-update', data);
    });

    this.socket.on('friends-list', (data) => {
      console.log('📋 Friends list:', data);
      this.notifyHandlers('friends-list', data);
    });

    // Game invitation events
    this.socket.on('game-invitation-received', (data) => {
      console.log('🎮 Game invitation received:', data);
      this.notifyHandlers('game-invitation-received', data);
    });

    this.socket.on('game-invitation-sent', (data) => {
      console.log('📤 Game invitation sent:', data);
      this.notifyHandlers('game-invitation-sent', data);
    });

    this.socket.on('game-invitation-declined', (data) => {
      console.log('❌ Game invitation declined:', data);
      this.notifyHandlers('game-invitation-declined', data);
    });

    // Game events
    this.socket.on('matchmaking-joined', (data) => {
      console.log('🎯 Joined matchmaking:', data);
      this.notifyHandlers('matchmaking-joined', data);
    });

    this.socket.on('match-found', (data) => {
      console.log('🎮 Match found:', data);
      this.notifyHandlers('match-found', data);
    });

    this.socket.on('waiting-for-opponent', (data) => {
      console.log('⏳ Waiting for opponent:', data);
      this.notifyHandlers('waiting-for-opponent', data);
    });

    this.socket.on('move-made', (data) => {
      console.log('♟️ Move made:', data);
      this.notifyHandlers('move-made', data);
    });

    this.socket.on('invalid-move', (data) => {
      console.log('❌ Invalid move:', data);
      this.notifyHandlers('invalid-move', data);
    });

    this.socket.on('game-ended', (data) => {
      console.log('🏁 Game ended:', data);
      this.notifyHandlers('game-ended', data);
    });

    this.socket.on('opponent-disconnected', (data) => {
      console.log('👋 Opponent disconnected:', data);
      this.notifyHandlers('opponent-disconnected', data);
    });

    this.socket.on('time-update', (data) => {
      this.notifyHandlers('time-update', data);
    });

    this.socket.on('error', (data) => {
      console.error('🚨 Server error:', data);
      this.notifyHandlers('error', data);
    });
  }

  // Event handler management
  on(eventName, handler) {
    if (!this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = [];
    }
    this.eventHandlers[eventName].push(handler);
  }

  off(eventName, handler) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(h => h !== handler);
    }
  }

  notifyHandlers(eventName, data) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${eventName} handler:`, error);
        }
      });
    }
  }

  // User system methods
  registerUser(username, displayName) {
    if (this.socket && this.isConnected) {
      this.socket.emit('register-user', { username, displayName });
    } else {
      console.error('❌ Socket not connected');
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  // Friend system methods
  sendFriendRequest(targetUsername) {
    if (this.socket && this.isConnected) {
      this.socket.emit('send-friend-request', { targetUsername });
    }
  }

  acceptFriendRequest(fromUsername) {
    if (this.socket && this.isConnected) {
      this.socket.emit('accept-friend-request', { fromUsername });
    }
  }

  declineFriendRequest(fromUsername) {
    if (this.socket && this.isConnected) {
      this.socket.emit('decline-friend-request', { fromUsername });
    }
  }

  getFriends() {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-friends');
    }
  }

  // Game invitation methods
  inviteFriend(friendUsername, gameType = '10min') {
    if (this.socket && this.isConnected) {
      this.socket.emit('invite-friend', { friendUsername, gameType });
    }
  }

  acceptGameInvitation(inviteId) {
    if (this.socket && this.isConnected) {
      this.socket.emit('accept-game-invitation', { inviteId });
    }
  }

  declineGameInvitation(inviteId) {
    if (this.socket && this.isConnected) {
      this.socket.emit('decline-game-invitation', { inviteId });
    }
  }

  // Simple game invitation methods
  inviteUserToGame(targetUsername) {
    if (this.socket && this.isConnected) {
      this.socket.emit('invite-user-to-game', { targetUsername });
    }
  }

  acceptGameInvitation(data) {
    if (this.socket && this.isConnected) {
      this.socket.emit('accept-game-invitation', data);
    }
  }

  declineGameInvitation(data) {
    if (this.socket && this.isConnected) {
      this.socket.emit('decline-game-invitation', data);
    }
  }

  getOnlineUsers() {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-online-users');
    }
  }

  // Matchmaking methods (keeping for practice mode)
  joinMatchmaking(playerData = {}) {
    if (this.socket && this.isConnected) {
      this.socket.emit('join-matchmaking', playerData);
    } else {
      console.error('❌ Socket not connected');
    }
  }

  // Chess game methods
  makeMove(roomId, move, playerColor) {
    if (this.socket && this.isConnected) {
      this.socket.emit('make-move', {
        roomId,
        move,
        playerColor
      });
    }
  }

  resign(roomId, playerColor) {
    if (this.socket && this.isConnected) {
      this.socket.emit('resign', {
        roomId,
        playerColor
      });
    }
  }

  // Utility methods
  getStats() {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-stats');
    }
  }

  getUserStats(username = null) {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-user-stats', { username });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.currentUser = null;
      this.eventHandlers = {};
    }
  }

  isSocketConnected() {
    return this.socket && this.isConnected;
  }

  isUserRegistered() {
    return this.currentUser !== null;
  }

  // Connection status
  getConnectionStatus() {
    if (!this.socket) return 'disconnected';
    if (this.socket.connected) return 'connected';
    if (this.socket.connecting) return 'connecting';
    return 'disconnected';
  }
}

const socketService = new SocketService();
export default socketService;