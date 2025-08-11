// src/components/VideoCall.js - Real video implementation
import React, { useEffect, useState, useRef } from 'react';

export default function VideoCall({ isOpponent, timer, playerLabel, callObject }) {
  const [participants, setParticipants] = useState({});
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!callObject) return;

    const updateParticipants = () => {
      const allParticipants = callObject.participants();
      setParticipants(allParticipants);
      
      // Update video element
      updateVideoElement(allParticipants);
    };

    const updateVideoElement = (allParticipants) => {
      if (!videoRef.current) return;

      const targetParticipant = isOpponent 
        ? Object.values(allParticipants).find(p => !p.local)
        : allParticipants.local;

      if (targetParticipant?.videoTrack && targetParticipant.video) {
        const stream = new MediaStream([targetParticipant.videoTrack]);
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    };

    // Set up event listeners
    callObject
      .on('joined-meeting', updateParticipants)
      .on('participant-joined', updateParticipants)
      .on('participant-left', updateParticipants)
      .on('participant-updated', updateParticipants);

    // Initial update
    updateParticipants();

    return () => {
      callObject
        .off('joined-meeting', updateParticipants)
        .off('participant-joined', updateParticipants)
        .off('participant-left', updateParticipants)
        .off('participant-updated', updateParticipants);
    };
  }, [callObject, isOpponent]);

  // Get the participant to show
  const targetParticipant = isOpponent 
    ? Object.values(participants).find(p => !p.local)
    : participants.local;

  const hasVideo = targetParticipant?.video && targetParticipant?.videoTrack;

  // Media control handlers
  const toggleVideo = async () => {
    if (callObject && !isOpponent) {
      try {
        const newState = await callObject.setLocalVideo(!isVideoEnabled);
        setIsVideoEnabled(!isVideoEnabled);
      } catch (error) {
        console.error('Error toggling video:', error);
      }
    }
  };

  const toggleAudio = async () => {
    if (callObject && !isOpponent) {
      try {
        const newState = await callObject.setLocalAudio(!isAudioEnabled);
        setIsAudioEnabled(!isAudioEnabled);
      } catch (error) {
        console.error('Error toggling audio:', error);
      }
    }
  };

  return (
    <div className="video-area">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted={!isOpponent} // Mute local video to prevent feedback
          playsInline
          className="video-element"
          style={{ transform: isOpponent ? 'none' : 'scaleX(-1)' }} // Mirror local video
        />
      ) : (
        <div className="video-placeholder">
          <div className="video-placeholder-text">
            {isOpponent ? '📹' : '📷'}
          </div>
          <div className="video-placeholder-subtext">
            {isOpponent 
              ? (targetParticipant ? 'Camera off' : 'Waiting for opponent...') 
              : (targetParticipant ? 'Camera off' : 'Connecting...')
            }
          </div>
        </div>
      )}
      
      {/* Timer overlay */}
      {timer && (
        <div className="timer-overlay">
          {timer}
        </div>
      )}
      
      {/* Media controls for local video */}
      {!isOpponent && callObject && (
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
        </div>
      </div>
    </div>
  );
}
