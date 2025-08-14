// src/components/VideoCall.js - Fixed with automatic opponent video detection
import React, { useEffect, useState, useRef, useCallback } from 'react';
import dailyService from '../services/dailyService';

export default function VideoCall({ isOpponent, timer, playerLabel, videoRoomUrl, userName }) {
  const [participants, setParticipants] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [hasPermissions, setHasPermissions] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const initializationRef = useRef(false);
  const connectionTimeoutRef = useRef(null);
  const mediaUpdateTimeoutRef = useRef(null);

  // FIXED: Only ONE component should initialize the video call (not both)
  useEffect(() => {
    if (videoRoomUrl && userName && !isOpponent && !initializationRef.current) {
      console.log(`🎥 Initializing video call for: ${userName} (main instance)`);
      initializationRef.current = true;
      initializeVideoCall();
    } else if (isOpponent) {
      console.log(`🎥 Opponent video component initialized - will show remote participant`);
      setConnectionStatus('waiting-for-connection');
    } else if (!videoRoomUrl) {
      setConnectionStatus('no-room');
      setErrorMessage('Video room not available');
    }

    return () => {
      // Cleanup timeouts
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      if (mediaUpdateTimeoutRef.current) {
        clearTimeout(mediaUpdateTimeoutRef.current);
      }
    };
  }, [videoRoomUrl, userName, isOpponent]);

  const initializeVideoCall = useCallback(async () => {
    try {
      setConnectionStatus('requesting-permissions');
      setErrorMessage('');
      
      // Clear any existing timeout
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }

      // Set connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        console.warn('⏰ Video connection timeout');
        setConnectionStatus('error');
        setErrorMessage('Connection timeout');
      }, 30000);

      console.log('🔐 Requesting media permissions...');
      const permissionsGranted = await dailyService.requestMediaPermissions();
      setHasPermissions(permissionsGranted);
      
      if (!permissionsGranted) {
        console.warn('❌ Media permissions denied - continuing anyway');
      }

      console.log('✅ Media permissions handled, connecting...');
      setConnectionStatus('connecting');
      
      // Join the Daily.co room
      await dailyService.joinRoom(videoRoomUrl, userName);
      
      // Clear timeout on successful connection
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      
      console.log('✅ Video call joined successfully');
      setConnectionStatus('connected');
      setRetryCount(0);
      
    } catch (error) {
      console.error('❌ Failed to initialize video call:', error);
      
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      
      if (retryCount < 2) {
        console.log(`🔄 Retrying video connection (${retryCount + 1}/3) in 3 seconds...`);
        setRetryCount(prev => prev + 1);
        setTimeout(() => {
          initializeVideoCall();
        }, 3000);
      } else {
        console.error('❌ Max retries reached for video connection');
        setConnectionStatus('error');
        setErrorMessage('Video connection failed');
      }
    }
  }, [videoRoomUrl, userName, retryCount]);

  // ENHANCED: Force media update with delayed retry
  const forceMediaUpdate = useCallback((allParticipants) => {
    updateMediaElements(allParticipants);
    
    // FIXED: Add delayed retry to catch late-arriving video tracks
    if (mediaUpdateTimeoutRef.current) {
      clearTimeout(mediaUpdateTimeoutRef.current);
    }
    
    mediaUpdateTimeoutRef.current = setTimeout(() => {
      console.log('🔄 Delayed media update check...');
      const currentParticipants = dailyService.getAllParticipants();
      updateMediaElements(currentParticipants);
    }, 1000); // 1 second delay to catch late tracks
  }, []);

  // Enhanced Daily.co event listeners with better media updates
  useEffect(() => {
    const handleJoinedMeeting = (event) => {
      console.log('✅ Video call joined successfully');
      const allParticipants = event.participants || {};
      setParticipants(allParticipants);
      setConnectionStatus('connected');
      setErrorMessage('');
      forceMediaUpdate(allParticipants);
    };

    const handleParticipantJoined = (event) => {
      console.log('👤 Participant joined video call:', event.participant.user_name);
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        forceMediaUpdate(updatedParticipants);
      } catch (error) {
        console.error('Error handling participant joined:', error);
      }
    };

    const handleParticipantLeft = (event) => {
      console.log('👋 Participant left video call:', event.participant.user_name);
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        forceMediaUpdate(updatedParticipants);
      } catch (error) {
        console.error('Error handling participant left:', error);
      }
    };

    const handleParticipantUpdated = (event) => {
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        forceMediaUpdate(updatedParticipants);
      } catch (error) {
        console.error('Error handling participant updated:', error);
      }
    };

    const handleTrackStarted = (event) => {
      console.log('🎬 Track started:', event.track?.kind, 'for', event.participant?.user_name);
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        
        // FIXED: Immediate update for new tracks
        forceMediaUpdate(updatedParticipants);
        
        // ADDITIONAL: Extra delayed update for video tracks
        if (event.track?.kind === 'video') {
          setTimeout(() => {
            console.log('🎬 Extra video track update for', event.participant?.user_name);
            const latestParticipants = dailyService.getAllParticipants();
            forceMediaUpdate(latestParticipants);
          }, 500);
        }
      } catch (error) {
        console.error('Error handling track started:', error);
      }
    };

    const handleTrackStopped = (event) => {
      console.log('🛑 Track stopped:', event.track?.kind, 'for', event.participant?.user_name);
      try {
        const updatedParticipants = dailyService.getAllParticipants();
        setParticipants(updatedParticipants);
        forceMediaUpdate(updatedParticipants);
      } catch (error) {
        console.error('Error handling track stopped:', error);
      }
    };

    const handleError = (event) => {
      console.error('❌ Daily.co error:', event);
      setConnectionStatus('error');
      setErrorMessage(`Video error: ${event.errorMsg || event.error?.message || 'Unknown error'}`);
    };

    const handleLeftMeeting = () => {
      console.log('👋 Left video meeting');
      setConnectionStatus('disconnected');
      setParticipants({});
      setErrorMessage('');
      
      // Clean up media elements
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
      dailyService.on('track-started', handleTrackStarted);
      dailyService.on('track-stopped', handleTrackStopped);
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
        dailyService.off('track-started', handleTrackStarted);
        dailyService.off('track-stopped', handleTrackStopped);
        dailyService.off('error', handleError);
        dailyService.off('left-meeting', handleLeftMeeting);
      } catch (error) {
        console.warn('Error cleaning up video event listeners:', error);
      }
    };
  }, [forceMediaUpdate]);

  // ENHANCED: Periodic media update check to catch missed events
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const interval = setInterval(() => {
        try {
          const currentParticipants = dailyService.getAllParticipants();
          const targetParticipant = isOpponent 
            ? Object.values(currentParticipants).find(p => !p.local)
            : Object.values(currentParticipants).find(p => p.local);
          
          // Check if we should have video but don't
          if (targetParticipant?.videoTrack && targetParticipant?.video && !videoRef.current?.srcObject) {
            console.log('🔄 Periodic check: Missing video stream, forcing update');
            updateMediaElements(currentParticipants);
          }
        } catch (error) {
          console.warn('Error in periodic media check:', error);
        }
      }, 2000); // Check every 2 seconds
      
      return () => clearInterval(interval);
    }
  }, [connectionStatus, isOpponent]);

  // Enhanced media element updates with better error handling
  const updateMediaElements = useCallback((allParticipants) => {
    if (!videoRef.current) return;

    try {
      // Determine which participant to show
      const targetParticipant = isOpponent 
        ? Object.values(allParticipants).find(p => !p.local)  // Show remote participant
        : Object.values(allParticipants).find(p => p.local);   // Show local participant

      console.log(`🎬 Updating media for ${isOpponent ? 'opponent' : 'local'} (${targetParticipant?.user_name || 'none'}):`, {
        hasParticipant: !!targetParticipant,
        video: !!targetParticipant?.video,
        audio: !!targetParticipant?.audio,
        videoTrack: !!targetParticipant?.videoTrack,
        audioTrack: !!targetParticipant?.audioTrack,
        local: !!targetParticipant?.local,
        currentVideoSrc: !!videoRef.current?.srcObject
      });

      if (targetParticipant) {
        // Handle video track
        if (targetParticipant.videoTrack && targetParticipant.video) {
          const videoStream = new MediaStream([targetParticipant.videoTrack]);
          
          // FIXED: Always update if tracks are different
          const currentStream = videoRef.current.srcObject;
          const tracksMatch = currentStream && 
            currentStream.getVideoTracks().length > 0 && 
            currentStream.getVideoTracks()[0].id === targetParticipant.videoTrack.id;
          
          if (!tracksMatch) {
            console.log(`🎬 Setting new video stream for ${targetParticipant.user_name}`);
            videoRef.current.srcObject = videoStream;
            
            const playVideo = async () => {
              try {
                // Mute local video to prevent echo, unmute remote video
                videoRef.current.muted = targetParticipant.local;
                videoRef.current.playsInline = true;
                await videoRef.current.play();
                console.log(`✅ Video playing for ${targetParticipant.user_name} (${isOpponent ? 'remote' : 'local'})`);
              } catch (error) {
                console.warn('Video autoplay prevented:', error);
                // Try to play again after a short delay
                setTimeout(async () => {
                  try {
                    await videoRef.current.play();
                    console.log(`✅ Video playing (retry) for ${targetParticipant.user_name}`);
                  } catch (retryError) {
                    console.warn('Video retry failed:', retryError);
                  }
                }, 100);
              }
            };
            playVideo();
          }
        } else {
          // No video track or video disabled
          if (videoRef.current.srcObject) {
            console.log(`📺 Clearing video for ${targetParticipant.user_name} (no video track or disabled)`);
            videoRef.current.srcObject = null;
          }
        }

        // Handle audio track - only for remote participants to avoid echo
        if (targetParticipant.audioTrack && targetParticipant.audio && !targetParticipant.local) {
          // Create or get existing audio element for this participant
          const audioId = `video-audio-${targetParticipant.session_id}`;
          let audioElement = document.getElementById(audioId);
          
          if (!audioElement) {
            audioElement = document.createElement('audio');
            audioElement.id = audioId;
            audioElement.autoplay = true;
            audioElement.playsInline = true;
            audioElement.style.display = 'none';
            audioElement.volume = 1.0;
            document.body.appendChild(audioElement);
            console.log(`🔊 Created audio element for ${targetParticipant.user_name}`);
          }
          
          const audioStream = new MediaStream([targetParticipant.audioTrack]);
          const currentAudioStream = audioElement.srcObject;
          const audioTracksMatch = currentAudioStream && 
            currentAudioStream.getAudioTracks().length > 0 && 
            currentAudioStream.getAudioTracks()[0].id === targetParticipant.audioTrack.id;
          
          if (!audioTracksMatch) {
            audioElement.srcObject = audioStream;
            
            const playAudio = async () => {
              try {
                await audioElement.play();
                console.log(`🔊 Audio playing for ${targetParticipant.user_name}`);
              } catch (error) {
                console.warn(`⚠️  Audio autoplay prevented for ${targetParticipant.user_name}:`, error);
              }
            };
            playAudio();
          }
        }
      } else {
        // No participant - clear video
        if (videoRef.current.srcObject) {
          console.log(`📺 No ${isOpponent ? 'remote' : 'local'} participant to show - clearing video`);
          videoRef.current.srcObject = null;
        }
      }
    } catch (error) {
      console.error('Error updating media elements:', error);
    }
  }, [isOpponent]);

  // Get the participant to show
  const targetParticipant = isOpponent 
    ? Object.values(participants).find(p => !p.local)
    : Object.values(participants).find(p => p.local);

  const hasVideo = targetParticipant?.video && targetParticipant?.videoTrack;

  // Media control handlers (only for local player)
  const toggleVideo = async () => {
    if (!isOpponent && dailyService.isCallActive()) {
      try {
        const newState = await dailyService.toggleCamera();
        setIsVideoEnabled(newState);
        console.log(`📹 Camera ${newState ? 'enabled' : 'disabled'}`);
        
        // FIXED: Force immediate media update after toggle
        setTimeout(() => {
          const currentParticipants = dailyService.getAllParticipants();
          forceMediaUpdate(currentParticipants);
        }, 100);
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
        
        // FIXED: Force immediate media update after toggle
        setTimeout(() => {
          const currentParticipants = dailyService.getAllParticipants();
          forceMediaUpdate(currentParticipants);
        }, 100);
      } catch (error) {
        console.error('Error toggling audio:', error);
        setErrorMessage('Failed to toggle microphone');
      }
    }
  };

  // Force media play on user interaction (for mobile Safari)
  const handleUserInteraction = useCallback(async () => {
    try {
      // Force audio play
      await dailyService.forceAudioPlay();
      
      // Resume video if paused
      if (videoRef.current && videoRef.current.paused) {
        await videoRef.current.play();
      }
      
      // Resume any audio elements
      const audioElements = document.querySelectorAll('[id^="video-audio-"]');
      for (const audioEl of audioElements) {
        if (audioEl.paused) {
          try {
            await audioEl.play();
            console.log('▶️ Resumed audio element');
          } catch (error) {
            console.warn('Could not resume audio:', error);
          }
        }
      }
      
      // FIXED: Also trigger media update on user interaction
      const currentParticipants = dailyService.getAllParticipants();
      if (Object.keys(currentParticipants).length > 0) {
        forceMediaUpdate(currentParticipants);
      }
    } catch (error) {
      console.warn('Error in user interaction handler:', error);
    }
  }, [forceMediaUpdate]);

  // Update local media states when participant data changes
  useEffect(() => {
    if (!isOpponent && targetParticipant) {
      setIsVideoEnabled(targetParticipant.video || false);
      setIsAudioEnabled(targetParticipant.audio || false);
    }
  }, [targetParticipant, isOpponent]);

  // Enhanced status display logic
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
          text: isOpponent ? 'Waiting for connection...' : 'Requesting camera access...',
          subtext: isOpponent ? 'Main player connecting' : 'Allow camera & microphone'
        };
      case 'permissions-denied':
        return {
          emoji: '❌',
          text: isOpponent ? 'Waiting for connection...' : 'Camera access denied',
          subtext: isOpponent ? 'May have denied permissions' : 'Enable in browser settings'
        };
      case 'connecting':
        return {
          emoji: '🔄',
          text: isOpponent ? 'Waiting for connection...' : 'Connecting to video...',
          subtext: retryCount > 0 ? `Retry ${retryCount}/3` : 'Joining video room...'
        };
      case 'waiting-for-connection':
        return {
          emoji: '⏳',
          text: 'Waiting for video connection...',
          subtext: 'Other player is connecting'
        };
      case 'connected':
        if (hasVideo) {
          return null; // Show actual video
        } else {
          const waitingForOpponent = isOpponent && !targetParticipant;
          return {
            emoji: isOpponent ? '📹' : '📷',
            text: waitingForOpponent 
              ? 'Waiting for opponent...' 
              : (isOpponent ? 'Opponent camera off' : 'Camera off'),
            subtext: waitingForOpponent ? 'They haven\'t joined video yet' : ''
          };
        }
      case 'error':
        return {
          emoji: '⚠️',
          text: isOpponent ? 'Opponent video unavailable' : 'Video unavailable',
          subtext: errorMessage || 'Chess works perfectly without video'
        };
      case 'disconnected':
        return {
          emoji: '🔌',
          text: isOpponent ? 'Opponent disconnected' : 'Disconnected',
          subtext: 'Trying to reconnect...'
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

  // Retry connection handler
  const handleRetryConnection = () => {
    if (connectionStatus === 'error' || connectionStatus === 'disconnected') {
      console.log('🔄 Manually retrying video connection...');
      setRetryCount(0);
      initializeVideoCall();
    }
  };

  return (
    <div className="video-area" onClick={handleUserInteraction}>
      {hasVideo && connectionStatus === 'connected' ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={targetParticipant?.local || false}
          className="video-element"
          style={{ 
            transform: (targetParticipant?.local && !isOpponent) ? 'scaleX(-1)' : 'none',
            objectFit: 'cover'
          }}
          onError={(e) => {
            console.error('Video element error:', e);
            setErrorMessage('Video playback error');
          }}
          onLoadedData={() => {
            console.log(`📹 Video loaded for ${targetParticipant?.user_name}`);
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
          
          {/* Retry button for errors */}
          {(connectionStatus === 'error' || connectionStatus === 'disconnected') && !isOpponent && (
            <button
              onClick={handleRetryConnection}
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              🔄 Retry Connection
            </button>
          )}
        </div>
      )}
      
      {/* Timer overlay */}
      {timer && (
        <div className="timer-overlay">
          {timer}
        </div>
      )}
      
      {/* Media controls for local video only */}
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
      
      {/* Enhanced player label with connection status */}
      <div className="label-bottom">
        <div className="label-text">
          {playerLabel || (isOpponent ? 'Opponent' : 'You')}
          {targetParticipant?.user_name && ` (${targetParticipant.user_name})`}
          
          {/* Connection status indicator */}
          <span style={{ marginLeft: '8px', fontSize: '12px' }}>
            {connectionStatus === 'connected' && (
              isOpponent 
                ? (targetParticipant ? '🟢' : '🟡') 
                : '🟢'
            )}
            {connectionStatus === 'connecting' && '🟡'}
            {connectionStatus === 'waiting-for-connection' && '⏳'}
            {connectionStatus === 'error' && '🔴'}
            {connectionStatus === 'no-room' && '📱'}
            {connectionStatus === 'disconnected' && '🔌'}
          </span>
          
          {/* Media status indicators */}
          {connectionStatus === 'connected' && targetParticipant && (
            <>
              <span style={{ marginLeft: '4px', fontSize: '12px' }}>
                {targetParticipant.audio ? '🔊' : '🔇'}
              </span>
              <span style={{ marginLeft: '2px', fontSize: '12px' }}>
                {targetParticipant.video ? '📹' : '📷❌'}
              </span>
            </>
          )}
          
          {/* Error message */}
          {errorMessage && connectionStatus === 'error' && (
            <div style={{ 
              fontSize: '10px', 
              color: '#ef4444', 
              marginTop: '2px',
              textAlign: 'center'
            }}>
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}