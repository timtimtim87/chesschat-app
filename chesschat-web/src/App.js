// src/App.js - Enhanced with user system
import React, { useState, useEffect } from 'react';
import './App.css';
import GameScreen from './components/GameScreen';
import Login from './components/Login';
import socketService from './services/socketService';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [loginError, setLoginError] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    // Connect to server
    socketService.connect();

    // Set up connection event handlers
    socketService.on('connected', () => {
      setConnectionStatus('connected');
    });

    socketService.on('disconnected', () => {
      setConnectionStatus('disconnected');
      setIsLoggedIn(false);
      setCurrentUser(null);
    });

    socketService.on('connection_error', () => {
      setConnectionStatus('disconnected');
    });

    // Set up user registration handlers
    socketService.on('registration-success', (userData) => {
      setIsLoggedIn(true);
      setCurrentUser(userData);
      setLoginError('');
    });

    socketService.on('registration-error', (error) => {
      setLoginError(error.message);
      setIsLoggedIn(false);
      setCurrentUser(null);
    });

    return () => {
      socketService.disconnect();
    };
  }, []);

  const handleLogin = (username, displayName) => {
    setLoginError('');
    socketService.registerUser(username, displayName);
  };

  if (!isLoggedIn) {
    return (
      <Login 
        onLogin={handleLogin}
        connectionStatus={connectionStatus}
        error={loginError}
      />
    );
  }

  return (
    <div className="App">
      <GameScreen currentUser={currentUser} />
    </div>
  );
}

export default App;
