// src/services/socketService.js - Simplified direct room joining
import io from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.eventHandlers = {};
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

    // Room joining events
    this.socket.on('code-entered', (data) => {
      console.log('🔑 Code entered response:', data);
      this.notifyHandlers('code-entered', data);
    });

    // Game events
    this.socket.on('match-found', (data) => {
      console.log('🎮 Match found:', data);
      this.notifyHandlers('match-found', data);
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

    // NEW: Exit game event - when either player exits, both are removed
    this.socket.on('exit-game', (data) => {
      console.log('🚪 Exit game event received:', data);
      this.notifyHandlers('exit-game', data);
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

  // Simplified room joining - combines user creation and room joining
  enterMatchCode(code, displayName = null) {
    if (this.socket && this.isConnected) {
      console.log('🔑 Entering match code:', code, 'with name:', displayName);
      this.socket.emit('enter-match-code', { 
        code,
        displayName: displayName || `Player_${Math.random().toString(36).substr(2, 4)}`
      });
    } else {
      console.error('❌ Socket not connected - cannot enter match code');
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

  // NEW: Exit game method - removes both players from game and video
  exitGame(roomId) {
    if (this.socket && this.isConnected) {
      console.log('🚪 Sending exit game request for room:', roomId);
      this.socket.emit('exit-game', {
        roomId
      });
    } else {
      console.error('❌ Socket not connected - cannot exit game');
    }
  }

  // Utility methods
  getStats() {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-stats');
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.eventHandlers = {};
    }
  }

  isSocketConnected() {
    return this.socket && this.isConnected;
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