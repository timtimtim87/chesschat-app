// src/services/dailyService.js - Web version with Daily.co
import DailyIframe from '@daily-co/daily-js';

class DailyService {
  constructor() {
    this.callFrame = null;
    this.participants = {};
    this.eventHandlers = {};
  }

  // Create a room via Daily API
  async createRoom(roomName = null) {
    const API_KEY = process.env.REACT_APP_DAILY_API_KEY; // Add this to your .env file
    
    if (!API_KEY) {
      // For development, create a temporary room
      const tempRoomName = roomName || `chess-${Date.now()}`;
      return {
        name: tempRoomName,
        url: `https://your-daily-domain.daily.co/${tempRoomName}`,
        id: tempRoomName
      };
    }

    const roomConfig = {
      name: roomName || `chess-${Date.now()}`,
      properties: {
        max_participants: 2,
        enable_chat: false,
        enable_screenshare: false,
        start_video_off: false,
        start_audio_off: false,
        enable_recording: false,
        enable_dialin: false,
        exp: Math.round(Date.now() / 1000) + (60 * 60 * 2) // 2 hour expiry
      }
    };

    try {
      const response = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(roomConfig)
      });

      if (!response.ok) {
        throw new Error(`Failed to create room: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating Daily room:', error);
      throw error;
    }
  }

  // Join a room
  async joinRoom(roomUrl, userName = 'Anonymous') {
    try {
      this.callFrame = DailyIframe.createCallObject({
        showLeaveButton: false,
        showFullscreenButton: false,
        showLocalVideo: true,
        showParticipantsBar: false
      });

      // Set up event listeners
      this.setupEventListeners();

      // Join the room
      await this.callFrame.join({
        url: roomUrl,
        userName: userName
      });

      return this.callFrame;
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    }
  }

  setupEventListeners() {
    if (!this.callFrame) return;

    this.callFrame
      .on('joined-meeting', this.handleJoinedMeeting.bind(this))
      .on('participant-joined', this.handleParticipantJoined.bind(this))
      .on('participant-left', this.handleParticipantLeft.bind(this))
      .on('participant-updated', this.handleParticipantUpdated.bind(this))
      .on('error', this.handleError.bind(this));
  }

  handleJoinedMeeting(event) {
    console.log('✅ Joined meeting successfully');
    this.participants = event.participants;
    this.notifyHandlers('joined-meeting', event);
  }

  handleParticipantJoined(event) {
    console.log('👤 Participant joined:', event.participant.user_name);
    this.participants[event.participant.session_id] = event.participant;
    this.notifyHandlers('participant-joined', event);
  }

  handleParticipantLeft(event) {
    console.log('👋 Participant left:', event.participant.user_name);
    delete this.participants[event.participant.session_id];
    this.notifyHandlers('participant-left', event);
  }

  handleParticipantUpdated(event) {
    this.participants[event.participant.session_id] = event.participant;
    this.notifyHandlers('participant-updated', event);
  }

  handleError(event) {
    console.error('❌ Daily error:', event);
    this.notifyHandlers('error', event);
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

  notifyHandlers(eventName, event) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName].forEach(handler => handler(event));
    }
  }

  // Get participants
  getLocalParticipant() {
    return this.callFrame?.participants()?.local;
  }

  getRemoteParticipants() {
    const participants = this.callFrame?.participants();
    if (!participants) return [];
    
    return Object.values(participants).filter(p => !p.local);
  }

  // Media controls
  async toggleCamera() {
    if (!this.callFrame) return false;
    
    const localParticipant = this.getLocalParticipant();
    const currentState = localParticipant?.video;
    
    await this.callFrame.setLocalVideo(!currentState);
    return !currentState;
  }

  async toggleMicrophone() {
    if (!this.callFrame) return false;
    
    const localParticipant = this.getLocalParticipant();
    const currentState = localParticipant?.audio;
    
    await this.callFrame.setLocalAudio(!currentState);
    return !currentState;
  }

  // Leave and cleanup
  async leaveCall() {
    if (this.callFrame) {
      try {
        await this.callFrame.leave();
        await this.callFrame.destroy();
      } catch (error) {
        console.error('Error leaving call:', error);
      }
      
      this.callFrame = null;
      this.participants = {};
      this.eventHandlers = {};
    }
  }

  // Get call object for components
  getCallObject() {
    return this.callFrame;
  }

  // Check if connected
  isConnected() {
    return this.callFrame && this.callFrame.meetingState() === 'joined-meeting';
  }

  // Get participant count
  getParticipantCount() {
    return Object.keys(this.participants).length;
  }
}

export default new DailyService();
