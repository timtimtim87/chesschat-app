// chesschat-backend/videoService.js - Daily.co room management
require('dotenv').config();

class VideoService {
  constructor() {
    this.apiKey = process.env.DAILY_API_KEY;
    this.dailyDomain = process.env.DAILY_DOMAIN;
    this.apiUrl = 'https://api.daily.co/v1';
    
    if (!this.apiKey) {
      console.warn('⚠️  DAILY_API_KEY not configured - video features will be disabled');
    }
  }

  // Create a Daily.co room for a chess game
  async createGameRoom(gameId, playerNames = []) {
    if (!this.apiKey) {
      console.log('⚠️  Daily.co not configured, skipping video room creation');
      return null;
    }

    const roomName = `chess-${gameId}-${Date.now()}`;
    
    const roomConfig = {
      name: roomName,
      properties: {
        max_participants: 2,
        enable_chat: false,
        enable_screenshare: false,
        enable_recording: false,
        enable_dialin: false,
        start_video_off: false,
        start_audio_off: false,
        owner_only_broadcast: false,
        enable_prejoin_ui: false,
        enable_network_ui: false,
        enable_people_ui: true,
        lang: 'en',
        exp: Math.round(Date.now() / 1000) + (60 * 60 * 3), // 3 hour expiry
        eject_at_room_exp: true
      }
    };

    try {
      const response = await fetch(`${this.apiUrl}/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(roomConfig)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Daily API error: ${response.status} - ${errorData.error || response.statusText}`);
      }

      const roomData = await response.json();
      
      console.log(`🎥 Created Daily.co room: ${roomData.name}`);
      console.log(`🔗 Room URL: ${roomData.url}`);
      
      return {
        id: roomData.id,
        name: roomData.name,
        url: roomData.url,
        domain_name: roomData.domain_name,
        expires: roomData.config?.exp,
        created_at: roomData.created_at
      };
      
    } catch (error) {
      console.error('❌ Failed to create Daily.co room:', error.message);
      // Don't throw error - game should continue without video
      return null;
    }
  }

  // Delete a Daily.co room when game ends
  async deleteGameRoom(roomName) {
    if (!this.apiKey || !roomName) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/rooms/${roomName}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.ok) {
        console.log(`🗑️  Deleted Daily.co room: ${roomName}`);
        return true;
      } else {
        console.warn(`⚠️  Failed to delete room ${roomName}: ${response.status}`);
        return false;
      }
      
    } catch (error) {
      console.error(`❌ Error deleting room ${roomName}:`, error.message);
      return false;
    }
  }

  // Get room info
  async getRoomInfo(roomName) {
    if (!this.apiKey || !roomName) {
      return null;
    }

    try {
      const response = await fetch(`${this.apiUrl}/rooms/${roomName}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.ok) {
        const roomData = await response.json();
        return roomData;
      } else {
        console.warn(`⚠️  Failed to get room info for ${roomName}: ${response.status}`);
        return null;
      }
      
    } catch (error) {
      console.error(`❌ Error getting room info for ${roomName}:`, error.message);
      return null;
    }
  }

  // Create meeting token for enhanced security (optional)
  async createMeetingToken(roomName, userName, isOwner = false) {
    if (!this.apiKey || !roomName) {
      return null;
    }

    const tokenConfig = {
      properties: {
        room_name: roomName,
        user_name: userName,
        is_owner: isOwner,
        exp: Math.round(Date.now() / 1000) + (60 * 60 * 3), // 3 hours
        enable_screenshare: false,
        enable_recording: false,
        start_video_off: false,
        start_audio_off: false
      }
    };

    try {
      const response = await fetch(`${this.apiUrl}/meeting-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(tokenConfig)
      });

      if (response.ok) {
        const tokenData = await response.json();
        console.log(`🎫 Created meeting token for ${userName} in room ${roomName}`);
        return tokenData.token;
      } else {
        console.warn(`⚠️  Failed to create meeting token: ${response.status}`);
        return null;
      }
      
    } catch (error) {
      console.error('❌ Error creating meeting token:', error.message);
      return null;
    }
  }

  // Cleanup expired rooms (utility function)
  async cleanupExpiredRooms() {
    if (!this.apiKey) {
      return;
    }

    try {
      const response = await fetch(`${this.apiUrl}/rooms`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const now = Math.round(Date.now() / 1000);
        let cleanedCount = 0;

        for (const room of data.data) {
          // Clean up chess rooms that are expired or old
          if (room.name.startsWith('chess-') && room.config?.exp && room.config.exp < now) {
            await this.deleteGameRoom(room.name);
            cleanedCount++;
          }
        }

        if (cleanedCount > 0) {
          console.log(`🧹 Cleaned up ${cleanedCount} expired video rooms`);
        }
      }
    } catch (error) {
      console.error('❌ Error during room cleanup:', error.message);
    }
  }

  // Check if Daily.co is properly configured
  isConfigured() {
    return !!(this.apiKey && this.dailyDomain);
  }

  // Get service status
  getStatus() {
    return {
      configured: this.isConfigured(),
      apiKey: this.apiKey ? '***configured***' : 'missing',
      domain: this.dailyDomain || 'not set'
    };
  }
}

module.exports = VideoService;