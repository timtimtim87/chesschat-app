// src/services/dailyService.js - Complete frontend Daily.co integration
import DailyIframe from '@daily-co/daily-js';

class DailyService {
  constructor() {
    this.callFrame = null;
    this.participants = {};
    this.eventHandlers = {};
    this.isConnected = false;
    this.roomUrl = null;
    this.userName = null;
  }

  // Join a video room using URL provided by backend
  async joinRoom(roomUrl, userName = 'Anonymous') {
    if (!roomUrl) {
      console.warn('⚠️  No video room URL provided');
      return null;
    }

    try {
      console.log(`🎥 Joining Daily.co room: ${roomUrl}`);
      
      // Clean up existing call if any
      if (this.callFrame) {
        await this.leaveCall();
      }

      this.callFrame = DailyIframe.createCallObject({
        showLeaveButton: false,
        showFullscreenButton: false,
        showLocalVideo: false, // We'll handle video in our custom UI
        showParticipantsBar: false,
        iframeStyle: {
          display: 'none' // Hide the iframe since we're using custom UI
        }
      });

      // Set up event listeners
      this.setupEventListeners();

      // Join the room
      await this.callFrame.join({
        url: roomUrl,
        userName: userName
      });

      this.roomUrl = roomUrl;
      this.userName = userName;
      
      console.log(`✅ Successfully joined video room as ${userName}`);
      return this.callFrame;
      
    } catch (error) {
      console.error('❌ Error joining video room:', error);
      this.notifyHandlers('error', { type: 'join-failed', error });
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
      .on('error', this.handleError.bind(this))
      .on('left-meeting', this.handleLeftMeeting.bind(this))
      .on('camera-error', this.handleCameraError.bind(this))
      .on('network-quality-change', this.handleNetworkChange.bind(this));
  }

  handleJoinedMeeting(event) {
    console.log('✅ Joined video meeting successfully');
    this.isConnected = true;
    this.participants = event.participants;
    this.notifyHandlers('joined-meeting', event);
  }

  handleParticipantJoined(event) {
    console.log('👤 Participant joined video:', event.participant.user_name);
    this.participants[event.participant.session_id] = event.participant;
    this.notifyHandlers('participant-joined', event);
  }

  handleParticipantLeft(event) {
    console.log('👋 Participant left video:', event.participant.user_name);
    delete this.participants[event.participant.session_id];
    this.notifyHandlers('participant-left', event);
  }

  handleParticipantUpdated(event) {
    this.participants[event.participant.session_id] = event.participant;
    this.notifyHandlers('participant-updated', event);
  }

  handleLeftMeeting(event) {
    console.log('👋 Left video meeting');
    this.isConnected = false;
    this.participants = {};
    this.notifyHandlers('left-meeting', event);
  }

  handleError(event) {
    console.error('❌ Daily video error:', event);
    this.notifyHandlers('error', event);
  }

  handleCameraError(event) {
    console.error('📹 Camera error:', event);
    this.notifyHandlers('camera-error', event);
  }

  handleNetworkChange(event) {
    console.log('🌐 Network quality:', event.quality);
    this.notifyHandlers('network-quality-change', event);
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
      this.eventHandlers[eventName].forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in ${eventName} handler:`, error);
        }
      });
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

  getAllParticipants() {
    return this.callFrame?.participants() || {};
  }

  // Media controls
  async toggleCamera() {
    if (!this.callFrame) {
      console.warn('⚠️  No video call active');
      return false;
    }
    
    try {
      const localParticipant = this.getLocalParticipant();
      const currentState = localParticipant?.video;
      
      await this.callFrame.setLocalVideo(!currentState);
      console.log(`📹 Camera ${!currentState ? 'enabled' : 'disabled'}`);
      return !currentState;
    } catch (error) {
      console.error('❌ Error toggling camera:', error);
      this.notifyHandlers('error', { type: 'camera-toggle-failed', error });
      return false;
    }
  }

  async toggleMicrophone() {
    if (!this.callFrame) {
      console.warn('⚠️  No video call active');
      return false;
    }
    
    try {
      const localParticipant = this.getLocalParticipant();
      const currentState = localParticipant?.audio;
      
      await this.callFrame.setLocalAudio(!currentState);
      console.log(`🎤 Microphone ${!currentState ? 'enabled' : 'disabled'}`);
      return !currentState;
    } catch (error) {
      console.error('❌ Error toggling microphone:', error);
      this.notifyHandlers('error', { type: 'microphone-toggle-failed', error });
      return false;
    }
  }

  // Get current media states
  isCameraEnabled() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.video || false;
  }

  isMicrophoneEnabled() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.audio || false;
  }

  // Video stream helpers
  getLocalVideoTrack() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.videoTrack || null;
  }

  getRemoteVideoTrack() {
    const remoteParticipants = this.getRemoteParticipants();
    if (remoteParticipants.length > 0) {
      return remoteParticipants[0].videoTrack || null;
    }
    return null;
  }

  // Connection management
  async leaveCall() {
    if (this.callFrame) {
      try {
        console.log('👋 Leaving video call');
        await this.callFrame.leave();
        await this.callFrame.destroy();
      } catch (error) {
        console.error('❌ Error leaving video call:', error);
      }
      
      this.callFrame = null;
      this.participants = {};
      this.isConnected = false;
      this.roomUrl = null;
      this.userName = null;
    }
  }

  // Get call object for components that need direct access
  getCallObject() {
    return this.callFrame;
  }

  // Status checks
  isCallActive() {
    return this.callFrame && this.isConnected;
  }

  getRoomUrl() {
    return this.roomUrl;
  }

  getUserName() {
    return this.userName;
  }

  // Get participant count
  getParticipantCount() {
    return Object.keys(this.participants).length;
  }

  // Get connection quality
  getNetworkStats() {
    if (!this.callFrame) return null;
    
    try {
      return this.callFrame.getNetworkStats();
    } catch (error) {
      console.error('❌ Error getting network stats:', error);
      return null;
    }
  }

  // Handle permissions
  async requestMediaPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      // Stop the test stream immediately
      stream.getTracks().forEach(track => track.stop());
      
      console.log('✅ Media permissions granted');
      return true;
    } catch (error) {
      console.error('❌ Media permissions denied:', error);
      this.notifyHandlers('error', { type: 'permissions-denied', error });
      return false;
    }
  }

  // Cleanup on page unload
  cleanup() {
    if (this.callFrame) {
      this.leaveCall();
    }
    this.eventHandlers = {};
  }
}

// Create singleton instance
const dailyService = new DailyService();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  dailyService.cleanup();
});

export default dailyService;