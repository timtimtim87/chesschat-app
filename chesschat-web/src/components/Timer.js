// src/components/Timer.js - Web version
import React from 'react';

export default function Timer({ time, isActive }) {
  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`timer ${isActive ? 'active' : 'inactive'}`}>
      {formatTime(time)}
    </div>
  );
}
