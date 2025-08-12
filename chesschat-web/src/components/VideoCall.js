// src/components/VideoCall.js - Restored working version with mobile audio fix
import React, { useEffect, useState, useRef } from 'react';
import dailyService from '../services/dailyService';

export default function VideoCall({ isOpponent, timer, playerLabel, videoRoomUrl, userName }) {
  const [participants, setParticipants] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [hasPermissions, setHasPermissions] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  // Initialize video call when room URL is provided
  useEffect(() => {
    if (videoRoomUrl && userName && !isOpponent) {
      console.log('🎥 Initializing video call for:', userName);
      initializeVideoCall();
    } else if (!videoRoomUrl) {
      setConnectionStatus('no-room');
      setErrorMessage('Video room not available');
    }

    return () => {
      // Cleanup on unmount
      if (!isOpponent && connectionStatus === 'connected') {
        console.log('🧹 Cleaning up video call');
        dailyService.leaveCall().catch(err => 
          console.warn('Cleanup error:', err)
        );
      }
    };
  }, [videoRoomUrl, userName, isOpponent]);

  const initializeVideoCall = async () => {
    try {
      setConnectionStatus('requesting-permissions');
      setErrorMessage('');
      
      console.log('🔐 Requesting media permissions...');
      const permissionsGranted = await dailyService.requestMediaPermissions();
      setHasPermissions(permissionsGranted);
      
      if (!permissionsGranted) {
        console.warn('❌ Media permissions denied');
        setConnectionStatus('permissions-denied');
        setErrorMessage('Camera/microphone access denied');
        return;
      }

      console.log('✅ Media permissions granted');
      setConnectionStatus('connecting');
      
      // Join the Daily.co room
      await dailyService.joinRoom(videoRoomUrl, userName);
      
      console.log('✅ Video call joined successfully');
      setConnectionStatus('connected');
      
    } catch (error) {
      console.error('❌ Failed to initialize video call:', error);
      setConnectionStatus('error');
      setErrorMessage('Video call unavailable');
    }
  };

  // Set up Daily.co event listeners
  useEffect(() => {
    const handleJoinedMeeting = (event) => {
      console.log('✅ Video call joined');
      setParticipants(event.participants || {});
      setConnectionStatus('connected');
      setErrorMessage('');
      updateMediaElements(event.participants || {});
    };

    const handleParticipantJoined = (event) => {
      console.log('👤 Participant joined video call');
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        updateMediaElements(updatedParticipants);
      } catch (error) {
        console.error('Error handling participant joined:', error);
      }
    };

    const handleParticipantLeft = (event) => {
      console.log('👋 Participant left video call');
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        updateMediaElements(updatedParticipants);
      } catch (error) {
        console.error('Error handling participant left:', error);
      }
    };

    const handleParticipantUpdated = (event) => {
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        updateMediaElements(updatedParticipants);
      } catch (error) {
        console.error('Error handling participant updated:', error);
      }
    };

    const handleError = (event) => {
      console.error('❌ Daily.co error:', event);
      setConnectionStatus('error');
      setErrorMessage('Video connection error');
    };

    const handleLeftMeeting = () => {
      console.log('👋 Left video meeting');
      setConnectionStatus('disconnected');
      setParticipants({});
      setErrorMessage('');
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }
    };

    try {
      dailyService.on('joined-meeting', handleJoinedMeeting);
      dailyService.on('participant-joined', handleParticipantJoined);
      dailyService.on('participant-left', handleParticipantLeft);
      dailyService.on('participant-updated', handleParticipantUpdated);
      dailyService.on('error', handleError);
      dailyService.on('left-meeting', handleLeftMeeting);
    } catch (error) {
      console.error('Error setting up video event listeners:', error);
    }

    return () => {
      try {
        dailyService.off('joined-meeting', handleJoinedMeeting);
        dailyService.off('participant-joined', handleParticipantJoined);
        dailyService.off('participant-left', handleParticipantLeft);
        dailyService.off('participant-updated', handleParticipantUpdated);
        dailyService.off('error', handleError);
        dailyService.off('left-meeting', handleLeftMeeting);
      } catch (error) {
        console.warn('Error cleaning up video event listeners:', error);
      }
    };
  }, []);

  const updateMediaElements = (allParticipants) => {
    if (!videoRef.current) return;

    try {
      const targetParticipant = isOpponent 
        ? Object.values(allParticipants).find(p => !p.local)
        : allParticipants.local;

      if (targetParticipant) {
        console.log(`🎬 Updating media for ${targetParticipant.user_name || 'participant'}:`, {
          video: !!targetParticipant.video,
          audio: !!targetParticipant.audio,
          videoTrack: !!targetParticipant.videoTrack,
          audioTrack: !!targetParticipant.audioTrack
        });

        // Handle video track
        if (targetParticipant.videoTrack && targetParticipant.video) {
          const videoStream = new MediaStream([targetParticipant.videoTrack]);
          videoRef.current.srcObject = videoStream;
          
          const playVideo = async () => {
            try {
              videoRef.current.muted = isOpponent ? false : true;
              await videoRef.current.play();
              console.log('✅ Video playing');
            } catch (error) {
              console.warn('Video autoplay prevented:', error);
            }
          };
          playVideo();
        } else {
          videoRef.current.srcObject = null;
        }

        // Handle audio track for remote participants
        if (targetParticipant.audioTrack && targetParticipant.audio && isOpponent) {
          if (!audioRef.current) {
            const audioElement = document.createElement('audio');
            audioElement.autoplay = true;
            audioElement.playsInline = true;
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
            audioRef.current = audioElement;
          }
          
          const audioStream = new MediaStream([targetParticipant.audioTrack]);
          audioRef.current.srcObject = audioStream;
          
          const playAudio = async () => {
            try {
              audioRef.current.volume = 1.0;
              await audioRef.current.play();
              console.log('🔊 Audio playing');
            } catch (error) {
              console.warn('Audio autoplay prevented:', error);
            }
          };
          playAudio();
        }
      } else {
        videoRef.current.srcObject = null;
        if (audioRef.current) {
          audioRef.current.srcObject = null;
        }
      }
    } catch (error) {
      console.error('Error updating media elements:', error);
    }
  };

  // Get the participant to show
  const targetParticipant = isOpponent 
    ? Object.values(participants).find(p => !p.local)
    : participants.local;

  const hasVideo = targetParticipant?.video && targetParticipant?.videoTrack;

  // Media control handlers
  const toggleVideo = async () => {
    if (!isOpponent && dailyService.isCallActive()) {
      try {
        const newState = await dailyService.toggleCamera();
        setIsVideoEnabled(newState);
        console.log(`📹 Camera ${newState ? 'enabled' : 'disabled'}`);
      } catch (error) {
        console.error('Error toggling video:', error);
        setErrorMessage('Failed to toggle camera');
      }
    }
  };

  const toggleAudio = async () => {
    if (!isOpponent && dailyService.isCallActive()) {
      try {
        const newState = await dailyService.toggleMicrophone();
        setIsAudioEnabled(newState);
        console.log(`🎤 Microphone ${newState ? 'enabled' : 'disabled'}`);
      } catch (error) {
        console.error('Error toggling audio:', error);
        setErrorMessage('Failed to toggle microphone');
      }
    }
  };

  // Force audio play on user interaction for mobile
  const handleUserInteraction = () => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(console.error);
    }
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(console.error);
    }
  };

  // Update local media states when participant data changes
  useEffect(() => {
    if (!isOpponent && targetParticipant) {
      setIsVideoEnabled(targetParticipant.video || false);
      setIsAudioEnabled(targetParticipant.audio || false);
    }
  }, [targetParticipant, isOpponent]);

  // Get display content
  const getDisplayContent = () => {
    if (!videoRoomUrl) {
      return {
        emoji: '📱',
        text: 'Video chat coming soon!',
        subtext: 'Playing chess works perfectly'
      };
    }

    switch (connectionStatus) {
      case 'requesting-permissions':
        return {
          emoji: '🔐',
          text: isOpponent ? 'Waiting for opponent...' : 'Requesting camera access...',
          subtext: isOpponent ? '' : 'Allow camera & microphone'
        };
      case 'permissions-denied':
        return {
          emoji: '❌',
          text: isOpponent ? 'Waiting for opponent...' : 'Camera access denied',
          subtext: isOpponent ? '' : 'Enable in browser settings'
        };
      case 'connecting':
        return {
          emoji: '🔄',
          text: isOpponent ? 'Waiting for opponent...' : 'Connecting to video...',
          subtext: ''
        };
      case 'connected':
        if (hasVideo) {
          return null; // Show actual video
        } else {
          return {
            emoji: isOpponent ? '📹' : '📷',
            text: isOpponent 
              ? (targetParticipant ? 'Camera off' : 'Waiting for opponent...') 
              : 'Camera off',
            subtext: ''
          };
        }
      case 'error':
        return {
          emoji: '⚠️',
          text: isOpponent ? 'Waiting for opponent...' : 'Video unavailable',
          subtext: errorMessage || 'Chess works perfectly without video'
        };
      case 'no-room':
        return {
          emoji: '📱',
          text: 'Video not configured',
          subtext: 'Chess works perfectly without video'
        };
      default:
        return {
          emoji: isOpponent ? '📹' : '📷',
          text: isOpponent ? 'Waiting for opponent...' : 'Not connected',
          subtext: ''
        };
    }
  };

  const displayContent = getDisplayContent();

  return (
    <div className="video-area" onClick={handleUserInteraction}>
      {hasVideo && connectionStatus === 'connected' ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={!isOpponent}
          className="video-element"
          style={{ 
            transform: isOpponent ? 'none' : 'scaleX(-1)',
            objectFit: 'cover'
          }}
          onError={(e) => {
            console.error('Video element error:', e);
            setErrorMessage('Video playback error');
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
          {displayContent?.subtext && (
            <div style={{
              fontSize: '12px',
              color: '#6b7280',
              marginTop: '4px',
              textAlign: 'center'
            }}>
              {displayContent.subtext}
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
          
          {/* Connection status indicator */}
          <span style={{ marginLeft: '8px', fontSize: '12px' }}>
            {connectionStatus === 'connected' && (isOpponent 
              ? (targetParticipant ? '🟢' : '🟡') 
              : '🟢'
            )}
            {connectionStatus === 'connecting' && '🟡'}
            {connectionStatus === 'error' && '🔴'}
            {connectionStatus === 'no-room' && '📱'}
          </span>
          
          {/* Audio indicator */}
          {connectionStatus === 'connected' && targetParticipant && (
            <span style={{ marginLeft: '4px', fontSize: '12px' }}>
              {targetParticipant.audio ? '🔊' : '🔇'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}