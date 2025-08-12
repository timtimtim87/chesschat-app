// src/components/VideoCall.js - Complete Daily.co integration
import React, { useEffect, useState, useRef } from 'react';
import dailyService from '../services/dailyService';

export default function VideoCall({ isOpponent, timer, playerLabel, videoRoomUrl, userName }) {
  const [participants, setParticipants] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [hasPermissions, setHasPermissions] = useState(false);
  const videoRef = useRef(null);

  // Initialize video call when room URL is provided
  useEffect(() => {
    if (videoRoomUrl && userName && !isOpponent) {
      // Only the local user initiates the connection
      initializeVideoCall();
    }

    return () => {
      // Cleanup on unmount
      if (!isOpponent) {
        dailyService.leaveCall();
      }
    };
  }, [videoRoomUrl, userName, isOpponent]);

  const initializeVideoCall = async () => {
    try {
      setConnectionStatus('requesting-permissions');
      
      // Request media permissions first
      const permissionsGranted = await dailyService.requestMediaPermissions();
      setHasPermissions(permissionsGranted);
      
      if (!permissionsGranted) {
        setConnectionStatus('permissions-denied');
        return;
      }

      setConnectionStatus('connecting');
      
      // Join the Daily.co room
      await dailyService.joinRoom(videoRoomUrl, userName);
      
      setConnectionStatus('connected');
      
    } catch (error) {
      console.error('❌ Failed to initialize video call:', error);
      setConnectionStatus('error');
    }
  };

  // Set up Daily.co event listeners
  useEffect(() => {
    const handleJoinedMeeting = (event) => {
      console.log('✅ Video call joined');
      setParticipants(event.participants);
      setConnectionStatus('connected');
      updateVideoElement(event.participants);
    };

    const handleParticipantJoined = (event) => {
      console.log('👤 Participant joined video call');
      const updatedParticipants = dailyService.getAllParticipants();
      setParticipants(updatedParticipants);
      updateVideoElement(updatedParticipants);
    };

    const handleParticipantLeft = (event) => {
      console.log('👋 Participant left video call');
      const updatedParticipants = dailyService.getAllParticipants();
      setParticipants(updatedParticipants);
      updateVideoElement(updatedParticipants);
    };

    const handleParticipantUpdated = (event) => {
      const updatedParticipants = dailyService.getAllParticipants();
      setParticipants(updatedParticipants);
      updateVideoElement(updatedParticipants);
    };

    const handleError = (event) => {
      console.error('❌ Daily.co error:', event);
      setConnectionStatus('error');
    };

    const handleLeftMeeting = () => {
      console.log('👋 Left video meeting');
      setConnectionStatus('disconnected');
      setParticipants({});
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    // Add event listeners
    dailyService.on('joined-meeting', handleJoinedMeeting);
    dailyService.on('participant-joined', handleParticipantJoined);
    dailyService.on('participant-left', handleParticipantLeft);
    dailyService.on('participant-updated', handleParticipantUpdated);
    dailyService.on('error', handleError);
    dailyService.on('left-meeting', handleLeftMeeting);

    return () => {
      // Cleanup event listeners
      dailyService.off('joined-meeting', handleJoinedMeeting);
      dailyService.off('participant-joined', handleParticipantJoined);
      dailyService.off('participant-left', handleParticipantLeft);
      dailyService.off('participant-updated', handleParticipantUpdated);
      dailyService.off('error', handleError);
      dailyService.off('left-meeting', handleLeftMeeting);
    };
  }, []);

  const updateVideoElement = (allParticipants) => {
    if (!videoRef.current) return;

    try {
      const targetParticipant = isOpponent 
        ? Object.values(allParticipants).find(p => !p.local)
        : allParticipants.local;

      if (targetParticipant?.videoTrack && targetParticipant.video) {
        const stream = new MediaStream([targetParticipant.videoTrack]);
        videoRef.current.srcObject = stream;
        
        // Ensure video plays
        videoRef.current.play().catch(error => {
          console.warn('Video autoplay prevented:', error);
        });
      } else {
        videoRef.current.srcObject = null;
      }
    } catch (error) {
      console.error('Error updating video element:', error);
    }
  };

  // Get the participant to show
  const targetParticipant = isOpponent 
    ? Object.values(participants).find(p => !p.local)
    : participants.local;

  const hasVideo = targetParticipant?.video && targetParticipant?.videoTrack;

  // Media control handlers (only for local user)
  const toggleVideo = async () => {
    if (!isOpponent && dailyService.isCallActive()) {
      try {
        const newState = await dailyService.toggleCamera();
        setIsVideoEnabled(newState);
      } catch (error) {
        console.error('Error toggling video:', error);
      }
    }
  };

  const toggleAudio = async () => {
    if (!isOpponent && dailyService.isCallActive()) {
      try {
        const newState = await dailyService.toggleMicrophone();
        setIsAudioEnabled(newState);
      } catch (error) {
        console.error('Error toggling audio:', error);
      }
    }
  };

  // Update local media states when participant data changes
  useEffect(() => {
    if (!isOpponent && targetParticipant) {
      setIsVideoEnabled(targetParticipant.video || false);
      setIsAudioEnabled(targetParticipant.audio || false);
    }
  }, [targetParticipant, isOpponent]);

  // Get display content based on connection status
  const getDisplayContent = () => {
    if (!videoRoomUrl) {
      return {
        emoji: isOpponent ? '📹' : '📷',
        text: 'Video not available'
      };
    }

    switch (connectionStatus) {
      case 'requesting-permissions':
        return {
          emoji: '🔐',
          text: isOpponent ? 'Waiting for opponent...' : 'Requesting camera access...'
        };
      case 'permissions-denied':
        return {
          emoji: '❌',
          text: isOpponent ? 'Waiting for opponent...' : 'Camera access denied'
        };
      case 'connecting':
        return {
          emoji: '🔄',
          text: isOpponent ? 'Waiting for opponent...' : 'Connecting to video...'
        };
      case 'connected':
        if (hasVideo) {
          return null; // Show actual video
        } else {
          return {
            emoji: isOpponent ? '📹' : '📷',
            text: isOpponent 
              ? (targetParticipant ? 'Camera off' : 'Waiting for opponent...') 
              : 'Camera off'
          };
        }
      case 'error':
        return {
          emoji: '⚠️',
          text: isOpponent ? 'Waiting for opponent...' : 'Video connection failed'
        };
      default:
        return {
          emoji: isOpponent ? '📹' : '📷',
          text: isOpponent ? 'Waiting for opponent...' : 'Not connected'
        };
    }
  };

  const displayContent = getDisplayContent();

  return (
    <div className="video-area">
      {hasVideo && connectionStatus === 'connected' ? (
        <video
          ref={videoRef}
          autoPlay
          muted={!isOpponent} // Mute local video to prevent feedback
          playsInline
          className="video-element"
          style={{ 
            transform: isOpponent ? 'none' : 'scaleX(-1)', // Mirror local video
            objectFit: 'cover'
          }}
        />
      ) : (
        <div className="video-placeholder">
          <div className="video-placeholder-text">
            {displayContent?.emoji}
          </div>
          <div className="video-placeholder-subtext">
            {displayContent?.text}
          </div>
          
          {/* Connection status indicator */}
          {connectionStatus !== 'disconnected' && connectionStatus !== 'connected' && !isOpponent && (
            <div style={{
              position: 'absolute',
              bottom: '60px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 8px',
              background: 'rgba(0, 0, 0, 0.7)',
              borderRadius: '4px',
              fontSize: '12px',
              color: 'white'
            }}>
              {connectionStatus.replace('-', ' ')}
            </div>
          )}
        </div>
      )}
      
      {/* Timer overlay */}
      {timer && (
        <div className="timer-overlay">
          {timer}
        </div>
      )}
      
      {/* Media controls for local video */}
      {!isOpponent && videoRoomUrl && connectionStatus === 'connected' && (
        <div className="media-controls">
          <button 
            className={`media-control-btn ${isVideoEnabled ? 'active' : 'inactive'}`}
            onClick={toggleVideo}
            title="Toggle Camera"
          >
            {isVideoEnabled ? '📹' : '📹❌'}
          </button>
          <button 
            className={`media-control-btn ${isAudioEnabled ? 'active' : 'inactive'}`}
            onClick={toggleAudio}
            title="Toggle Microphone"
          >
            {isAudioEnabled ? '🎤' : '🎤❌'}
          </button>
        </div>
      )}
      
      {/* Player label */}
      <div className="label-bottom">
        <div className="label-text">
          {playerLabel || (isOpponent ? 'Opponent' : 'You')}
          {targetParticipant?.user_name && ` (${targetParticipant.user_name})`}
          
          {/* Video status indicator */}
          {connectionStatus === 'connected' && (
            <span style={{ marginLeft: '8px', fontSize: '12px' }}>
              {isOpponent 
                ? (targetParticipant ? '🟢' : '🟡') 
                : '🟢'
              }
            </span>
          )}
        </div>
      </div>
    </div>
  );
}