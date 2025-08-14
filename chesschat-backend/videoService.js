// chesschat-backend/videoService.js - Complete fixed version
require('dotenv').config();

class VideoService {
  constructor() {
    this.apiKey = process.env.DAILY_API_KEY;
    this.dailyDomain = process.env.DAILY_DOMAIN;
    this.apiUrl = 'https://api.daily.co/v1';
    
    if (!this.apiKey) {
      console.warn('⚠️  DAILY_API_KEY not configured - video features will be disabled');
    } else {
      console.log('✅ Daily.co API key configured');
      console.log('🔑 API Key length:', this.apiKey.length);
      console.log('🏠 Domain:', this.dailyDomain || 'not set');
    }
  }

  // Create a Daily.co room for a chess game - FIXED VERSION
  async createGameRoom(gameId, playerNames = []) {
    if (!this.apiKey) {
      console.log('⚠️  Daily.co not configured, skipping video room creation');
      return null;
    }

    const roomName = `chess-${gameId}-${Date.now()}`;
    
    // Simplified room config that should work
    const roomConfig = {
      name: roomName,
      properties: {
        max_participants: 2,
        enable_chat: false,
        enable_screenshare: false,
        enable_recording: false,
        start_video_off: false,
        start_audio_off: false,
        exp: Math.round(Date.now() / 1000) + (60 * 60 * 3) // 3 hour expiry
      }
    };

    try {
      console.log('🎥 Creating Daily.co room:', roomName);
      console.log('🔧 Room config:', JSON.stringify(roomConfig, null, 2));
      
      const response = await fetch(`${this.apiUrl}/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(roomConfig)
      });

      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Daily API error response:', errorText);
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }
        
        throw new Error(`Daily API error: ${response.status} - ${errorData.error || response.statusText}`);
      }

      const roomData = await response.json();
      
      console.log(`✅ Created Daily.co room: ${roomData.name}`);
      console.log(`🔗 Room URL: ${roomData.url}`);
      console.log(`📊 Full room data:`, JSON.stringify(roomData, null, 2));
      
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
      console.error('❌ Full error:', error);
      
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
      console.log(`🗑️  Deleting Daily.co room: ${roomName}`);
      
      const response = await fetch(`${this.apiUrl}/rooms/${roomName}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.ok) {
        console.log(`✅ Deleted Daily.co room: ${roomName}`);
        return true;
      } else if (response.status === 404) {
        console.log(`ℹ️  Room ${roomName} not found (already deleted)`);
        return true;
      } else {
        const errorText = await response.text();
        console.warn(`⚠️  Failed to delete room ${roomName}: ${response.status} - ${errorText}`);
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

  // Test the API connection and permissions
  async testApiConnection() {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'No API key configured'
      };
    }

    try {
      console.log('🧪 Testing Daily.co API connection...');
      
      // First, try to list existing rooms to test the API key
      const response = await fetch(`${this.apiUrl}/rooms`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      console.log('📡 Test response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ API connection successful');
        console.log('📊 Existing rooms:', data.total_count || 0);
        
        return {
          success: true,
          message: 'API connection successful',
          existingRooms: data.total_count || 0
        };
      } else {
        const errorText = await response.text();
        console.error('❌ API test failed:', response.status, errorText);
        
        return {
          success: false,
          error: `API test failed: ${response.status} - ${errorText}`
        };
      }
      
    } catch (error) {
      console.error('❌ API test error:', error.message);
      return {
        success: false,
        error: `Connection error: ${error.message}`
      };
    }
  }

  // Cleanup expired rooms
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
    return !!(this.apiKey);
  }

  // Get service status
  getStatus() {
    return {
      configured: this.isConfigured(),
      apiKey: this.apiKey ? 'configured' : 'missing',
      domain: this.dailyDomain || 'not set'
    };
  }
}

module.exports = VideoService;