// src/services/dailyService.js - Fixed singleton pattern with comprehensive cleanup
import DailyIframe from '@daily-co/daily-js';

class DailyService {
  constructor() {
    this.callFrame = null;
    this.participants = {};
    this.eventHandlers = {};
    this.isConnected = false;
    this.roomUrl = null;
    this.userName = null;
    this.joinAttempts = 0;
    this.maxJoinAttempts = 3;
    this.isJoining = false; // Prevent duplicate joins
  }

  // Enhanced room joining with singleton pattern
  async joinRoom(roomUrl, userName = 'Anonymous') {
    if (!roomUrl) {
      console.warn('⚠️  No video room URL provided');
      return null;
    }

    // Prevent duplicate joins
    if (this.isJoining) {
      console.warn('⚠️  Already joining a room, skipping duplicate request');
      return this.callFrame;
    }

    // If already connected to the same room, return existing instance
    if (this.callFrame && this.roomUrl === roomUrl && this.isConnected) {
      console.log('✅ Already connected to this room');
      return this.callFrame;
    }

    this.isJoining = true;
    this.joinAttempts++;
    
    try {
      console.log(`🎥 Joining Daily.co room (attempt ${this.joinAttempts}): ${roomUrl}`);
      
      // Clean up existing call if any
      if (this.callFrame) {
        await this.leaveCall();
      }

      // Create call object with FIXED settings for call object mode
      this.callFrame = DailyIframe.createCallObject({
        // Valid options for call object mode
        receiveSettings: {
          video: 'optimal',
          audio: 'optimal'
        }
      });

      // Set up event listeners before joining
      this.setupEventListeners();

      // Request permissions first
      const hasPermissions = await this.requestMediaPermissions();
      if (!hasPermissions) {
        console.warn('⚠️  Continuing without media permissions');
      }

      // Join the room with simplified settings
      const joinResult = await this.callFrame.join({
        url: roomUrl,
        userName: userName,
        startVideoOff: false,
        startAudioOff: false
      });

      this.roomUrl = roomUrl;
      this.userName = userName;
      this.joinAttempts = 0; // Reset on success
      this.isJoining = false;
      
      console.log(`✅ Successfully joined video room as ${userName}`, joinResult);
      
      return this.callFrame;
      
    } catch (error) {
      console.error(`❌ Error joining video room (attempt ${this.joinAttempts}):`, error);
      this.isJoining = false;
      
      // Retry logic
      if (this.joinAttempts < this.maxJoinAttempts) {
        console.log(`🔄 Retrying join in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.joinRoom(roomUrl, userName);
      }
      
      this.notifyHandlers('error', { type: 'join-failed', error, attempts: this.joinAttempts });
      throw error;
    }
  }

  // Enhanced event listener setup
  setupEventListeners() {
    if (!this.callFrame) return;

    this.callFrame
      .on('joined-meeting', this.handleJoinedMeeting.bind(this))
      .on('participant-joined', this.handleParticipantJoined.bind(this))
      .on('participant-left', this.handleParticipantLeft.bind(this))
      .on('participant-updated', this.handleParticipantUpdated.bind(this))
      .on('track-started', this.handleTrackStarted.bind(this))
      .on('track-stopped', this.handleTrackStopped.bind(this))
      .on('error', this.handleError.bind(this))
      .on('left-meeting', this.handleLeftMeeting.bind(this))
      .on('camera-error', this.handleCameraError.bind(this))
      .on('network-quality-change', this.handleNetworkChange.bind(this))
      .on('network-connection', this.handleNetworkConnection.bind(this));
  }

  handleJoinedMeeting(event) {
    console.log('✅ Joined video meeting successfully', {
      participants: Object.keys(event.participants || {}).length,
      local: event.participants?.local?.user_name
    });
    
    this.isConnected = true;
    this.participants = event.participants || {};
    
    this.notifyHandlers('joined-meeting', event);
  }

  handleParticipantJoined(event) {
    const participant = event.participant;
    console.log('👤 Participant joined video:', {
      name: participant.user_name,
      hasVideo: !!participant.videoTrack,
      hasAudio: !!participant.audioTrack,
      sessionId: participant.session_id
    });
    
    this.participants[participant.session_id] = participant;
    this.notifyHandlers('participant-joined', event);
  }

  handleParticipantLeft(event) {
    const participant = event.participant;
    console.log('👋 Participant left video:', participant.user_name);
    delete this.participants[participant.session_id];
    this.notifyHandlers('participant-left', event);
  }

  handleParticipantUpdated(event) {
    const participant = event.participant;
    console.log('🔄 Participant updated:', {
      name: participant.user_name,
      video: participant.video,
      audio: participant.audio,
      hasVideoTrack: !!participant.videoTrack,
      hasAudioTrack: !!participant.audioTrack
    });
    
    this.participants[participant.session_id] = participant;
    this.notifyHandlers('participant-updated', event);
  }

  handleTrackStarted(event) {
    console.log('🎬 Track started:', {
      participant: event.participant?.user_name,
      trackKind: event.track?.kind,
      trackId: event.track?.id
    });
    
    this.notifyHandlers('track-started', event);
  }

  handleTrackStopped(event) {
    console.log('🛑 Track stopped:', {
      participant: event.participant?.user_name,
      trackKind: event.track?.kind
    });
    
    this.notifyHandlers('track-stopped', event);
  }

  handleLeftMeeting(event) {
    console.log('👋 Left video meeting');
    this.isConnected = false;
    this.participants = {};
    this.isJoining = false;
    this.notifyHandlers('left-meeting', event);
  }

  handleError(event) {
    console.error('❌ Daily video error:', event);
    this.isJoining = false;
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

  handleNetworkConnection(event) {
    console.log('🔗 Network connection:', event.event);
    this.notifyHandlers('network-connection', event);
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

  // Enhanced participant getters
  getLocalParticipant() {
    return this.participants?.local || Object.values(this.participants).find(p => p.local);
  }

  getRemoteParticipants() {
    return Object.values(this.participants).filter(p => !p.local);
  }

  getAllParticipants() {
    return this.participants || {};
  }

  // Enhanced media controls with better error handling
  async toggleCamera() {
    if (!this.callFrame || !this.isConnected) {
      console.warn('⚠️  No active video call');
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
    if (!this.callFrame || !this.isConnected) {
      console.warn('⚠️  No active video call');
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

  // Enhanced media state getters
  isCameraEnabled() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.video || false;
  }

  isMicrophoneEnabled() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.audio || false;
  }

  // Enhanced track getters
  getLocalVideoTrack() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.videoTrack || null;
  }

  getLocalAudioTrack() {
    const localParticipant = this.getLocalParticipant();
    return localParticipant?.audioTrack || null;
  }

  getRemoteVideoTrack() {
    const remoteParticipants = this.getRemoteParticipants();
    if (remoteParticipants.length > 0) {
      return remoteParticipants[0].videoTrack;
    }
    return null;
  }

  getRemoteAudioTrack() {
    const remoteParticipants = this.getRemoteParticipants();
    if (remoteParticipants.length > 0) {
      return remoteParticipants[0].audioTrack;
    }
    return null;
  }

  // Enhanced permission handling
  async requestMediaPermissions() {
    try {
      console.log('🔐 Requesting media permissions...');
      
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('✅ Media permissions granted', {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      });
      
      // Stop the test stream immediately
      stream.getTracks().forEach(track => {
        track.stop();
        console.log(`🛑 Stopped test ${track.kind} track`);
      });
      
      return true;
    } catch (error) {
      console.error('❌ Media permissions denied:', error);
      this.notifyHandlers('error', { type: 'permissions-denied', error });
      return false;
    }
  }

  // CRITICAL: Comprehensive video cleanup - this is the main fix
  async leaveCall() {
    if (this.callFrame) {
      try {
        console.log('👋 Leaving video call - comprehensive cleanup starting...');
        
        // STEP 1: Stop all local tracks immediately to turn off camera/mic
        try {
          console.log('🛑 Stopping all local media tracks...');
          const localParticipant = this.getLocalParticipant();
          if (localParticipant) {
            if (localParticipant.videoTrack) {
              console.log('🛑 Stopping local video track');
              localParticipant.videoTrack.stop();
            }
            if (localParticipant.audioTrack) {
              console.log('🛑 Stopping local audio track');
              localParticipant.audioTrack.stop();
            }
          }
        } catch (trackError) {
          console.warn('⚠️  Error stopping local tracks:', trackError);
        }
        
        // STEP 2: Clean up all DOM media elements immediately
        try {
          console.log('🧹 Cleaning up all DOM media elements...');
          
          // Clean up all audio elements created by our video system
          const audioElements = document.querySelectorAll('[id^="video-audio-"], [id^="daily-audio-"], audio[src*="blob:"]');
          audioElements.forEach((el, index) => {
            console.log(`🧹 Cleaning up audio element ${index + 1}:`, el.id || 'unnamed');
            if (el.srcObject) {
              const tracks = el.srcObject.getTracks();
              tracks.forEach(track => {
                track.stop();
                console.log('🛑 Stopped track from audio element:', track.kind, track.id);
              });
              el.srcObject = null;
            }
            el.pause();
            el.remove();
          });
          
          // Clean up all video elements
          const videoElements = document.querySelectorAll('video');
          videoElements.forEach((el, index) => {
            console.log(`🧹 Cleaning up video element ${index + 1}`);
            if (el.srcObject) {
              const tracks = el.srcObject.getTracks();
              tracks.forEach(track => {
                track.stop();
                console.log('🛑 Stopped track from video element:', track.kind, track.id);
              });
              el.srcObject = null;
            }
            el.pause();
          });
          
          console.log('✅ All DOM media elements cleaned up');
        } catch (mediaError) {
          console.warn('⚠️  Error cleaning up media elements:', mediaError);
        }
        
        // STEP 3: Leave the Daily.co meeting
        try {
          console.log('📞 Leaving Daily.co meeting...');
          await this.callFrame.leave();
          console.log('✅ Left Daily.co meeting successfully');
        } catch (leaveError) {
          console.warn('⚠️  Error leaving meeting:', leaveError);
        }
        
        // STEP 4: Destroy the call frame
        try {
          console.log('💥 Destroying Daily.co call frame...');
          await this.callFrame.destroy();
          console.log('✅ Call frame destroyed successfully');
        } catch (destroyError) {
          console.warn('⚠️  Error destroying call frame:', destroyError);
        }
        
      } catch (error) {
        console.error('❌ Error during comprehensive video cleanup:', error);
        
        // EMERGENCY: Force destroy if anything fails
        try {
          if (this.callFrame) {
            console.log('🚨 Emergency: Force destroying call frame');
            await this.callFrame.destroy();
          }
        } catch (emergencyError) {
          console.error('❌ Emergency destroy also failed:', emergencyError);
        }
      }
      
      // STEP 5: Reset all service state (always do this, even if cleanup failed)
      console.log('🔄 Resetting all video service state...');
      this.callFrame = null;
      this.participants = {};
      this.isConnected = false;
      this.roomUrl = null;
      this.userName = null;
      this.joinAttempts = 0;
      this.isJoining = false;
      
      console.log('✅ Video call cleanup completed - all resources freed');
    } else {
      console.log('ℹ️ No active call frame to clean up');
    }
  }

  // ENHANCED: Emergency cleanup method for critical failures
  cleanup() {
    console.log('🚨 EMERGENCY VIDEO CLEANUP - forcing all operations...');
    
    try {
      // Force stop ALL media tracks in the system
      console.log('🛑 Emergency: Stopping all media tracks...');
      if (this.callFrame) {
        const participants = this.getAllParticipants();
        Object.values(participants).forEach(participant => {
          if (participant.videoTrack) {
            try {
              participant.videoTrack.stop();
              console.log('🛑 Emergency stopped video track for:', participant.user_name);
            } catch (e) {
              console.warn('Could not stop video track:', e);
            }
          }
          if (participant.audioTrack) {
            try {
              participant.audioTrack.stop();
              console.log('🛑 Emergency stopped audio track for:', participant.user_name);
            } catch (e) {
              console.warn('Could not stop audio track:', e);
            }
          }
        });
      }
    } catch (error) {
      console.warn('⚠️  Error during emergency track cleanup:', error);
    }
    
    // Force cleanup ALL media elements in the entire document
    try {
      console.log('🧹 Emergency: Cleaning up all media elements in document...');
      const allMediaElements = document.querySelectorAll('audio, video, [id*="audio"], [id*="video"]');
      console.log(`🧹 Found ${allMediaElements.length} media elements to clean up`);
      
      allMediaElements.forEach((el, index) => {
        try {
          if (el.srcObject) {
            const tracks = el.srcObject.getTracks();
            tracks.forEach(track => {
              track.stop();
            });
            el.srcObject = null;
          }
          el.pause();
          
          // Remove elements that look like our video/audio elements
          if (el.id && (el.id.includes('audio') || el.id.includes('video') || el.id.includes('daily'))) {
            el.remove();
            console.log(`🗑️  Removed element: ${el.id}`);
          }
        } catch (elementError) {
          console.warn(`Could not clean up element ${index}:`, elementError);
        }
      });
    } catch (error) {
      console.warn('⚠️  Error during emergency media element cleanup:', error);
    }
    
    // Force destroy call frame
    if (this.callFrame) {
      try {
        console.log('💥 Emergency: Force destroying call frame...');
        this.callFrame.destroy();
      } catch (error) {
        console.warn('⚠️  Emergency destroy failed:', error);
      }
    }
    
    // Reset ALL state
    console.log('🔄 Emergency: Resetting all service state...');
    this.callFrame = null;
    this.participants = {};
    this.isConnected = false;
    this.roomUrl = null;
    this.userName = null;
    this.joinAttempts = 0;
    this.isJoining = false;
    this.eventHandlers = {};
    
    console.log('✅ Emergency cleanup completed - system reset');
  }

  // Utility methods
  getCallObject() {
    return this.callFrame;
  }

  isCallActive() {
    return this.callFrame && this.isConnected;
  }

  getRoomUrl() {
    return this.roomUrl;
  }

  getUserName() {
    return this.userName;
  }

  getParticipantCount() {
    return Object.keys(this.participants).length;
  }

  // Enhanced network stats
  async getNetworkStats() {
    if (!this.callFrame) return null;
    
    try {
      const stats = await this.callFrame.getNetworkStats();
      return stats;
    } catch (error) {
      console.error('❌ Error getting network stats:', error);
      return null;
    }
  }

  // Force audio play (for user interaction requirement)
  async forceAudioPlay() {
    console.log('🔊 Forcing audio playback...');
    
    // Ensure audio context is active
    if (typeof window !== 'undefined' && window.AudioContext) {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
          console.log('🔊 Resuming audio context for mobile Safari');
          await audioContext.resume();
        }
      } catch (error) {
        console.warn('⚠️  Audio context not available:', error);
      }
    }
    
    // Try to resume any paused audio elements
    const audioElements = document.querySelectorAll('audio, video');
    for (const element of audioElements) {
      if (element.paused) {
        try {
          await element.play();
          console.log('▶️ Resumed paused media element');
        } catch (error) {
          console.warn('⚠️  Could not resume media element:', error);
        }
      }
    }
  }
}

// Create singleton instance
const dailyService = new DailyService();

// Enhanced cleanup on page unload
const cleanup = () => {
  console.log('🧹 Page unload - emergency cleaning up video service');
  dailyService.cleanup();
};

window.addEventListener('beforeunload', cleanup);
window.addEventListener('unload', cleanup);

// Force audio resume on user interaction (for mobile Safari)
const forceAudioOnInteraction = () => {
  dailyService.forceAudioPlay();
  // Remove listeners after first interaction
  document.removeEventListener('click', forceAudioOnInteraction);
  document.removeEventListener('touchstart', forceAudioOnInteraction);
  document.removeEventListener('keydown', forceAudioOnInteraction);
};

document.addEventListener('click', forceAudioOnInteraction);
document.addEventListener('touchstart', forceAudioOnInteraction);
document.addEventListener('keydown', forceAudioOnInteraction);

export default dailyService;