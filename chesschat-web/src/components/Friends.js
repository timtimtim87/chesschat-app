// src/components/Friends.js - Friends management component
import React, { useState } from 'react';

export default function Friends({ 
  friends = [], 
  pendingRequests = [], 
  onAddFriend, 
  onAcceptFriend, 
  onDeclineFriend,
  onInviteFriend,
  currentUser,
  isVisible,
  onClose 
}) {
  const [newFriendUsername, setNewFriendUsername] = useState('');
  const [isAddingFriend, setIsAddingFriend] = useState(false);

  const handleAddFriend = (e) => {
    e.preventDefault();
    
    if (newFriendUsername.trim().length < 3) {
      alert('Username must be at least 3 characters long');
      return;
    }

    if (newFriendUsername.trim() === currentUser?.username) {
      alert("You can't add yourself as a friend");
      return;
    }

    setIsAddingFriend(true);
    onAddFriend(newFriendUsername.trim());
    setNewFriendUsername('');
    setTimeout(() => setIsAddingFriend(false), 1000);
  };

  const handleInviteFriend = (friendUsername) => {
    onInviteFriend(friendUsername);
  };

  if (!isVisible) return null;

  return (
    <div className="friends-overlay">
      <div className="friends-panel">
        <div className="friends-header">
          <h2 className="friends-title">Friends</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="friends-content">
          {/* Add Friend Section */}
          <div className="add-friend-section">
            <h3 className="section-title">Add Friend</h3>
            <form onSubmit={handleAddFriend} className="add-friend-form">
              <input
                type="text"
                value={newFriendUsername}
                onChange={(e) => setNewFriendUsername(e.target.value)}
                placeholder="Enter username"
                className="friend-input"
                minLength={3}
                maxLength={20}
                disabled={isAddingFriend}
              />
              <button
                type="submit"
                className="add-friend-button"
                disabled={isAddingFriend || newFriendUsername.trim().length < 3}
              >
                {isAddingFriend ? 'Sending...' : 'Add'}
              </button>
            </form>
          </div>

          {/* Pending Friend Requests */}
          {pendingRequests.length > 0 && (
            <div className="pending-requests-section">
              <h3 className="section-title">Friend Requests</h3>
              <div className="requests-list">
                {pendingRequests.map((request) => (
                  <div key={request.from} className="request-item">
                    <div className="request-info">
                      <span className="request-username">{request.displayName || request.from}</span>
                      <span className="request-label">wants to be friends</span>
                    </div>
                    <div className="request-actions">
                      <button
                        onClick={() => onAcceptFriend(request.from)}
                        className="accept-button"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => onDeclineFriend(request.from)}
                        className="decline-button"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends List */}
          <div className="friends-list-section">
            <h3 className="section-title">
              Your Friends ({friends.length})
            </h3>
            
            {friends.length === 0 ? (
              <div className="empty-friends">
                <p className="empty-text">No friends yet</p>
                <p className="empty-subtext">Add friends by their username to play together!</p>
              </div>
            ) : (
              <div className="friends-list">
                {friends.map((friend) => (
                  <div key={friend.username} className="friend-item">
                    <div className="friend-info">
                      <div className="friend-name">
                        <span className="friend-username">{friend.displayName || friend.username}</span>
                        <span className={`friend-status ${friend.online ? 'online' : 'offline'}`}>
                          {friend.online ? '🟢 Online' : '⚫ Offline'}
                        </span>
                      </div>
                    </div>
                    
                    {friend.online && (
                      <button
                        onClick={() => handleInviteFriend(friend.username)}
                        className="invite-button"
                      >
                        Invite to Game
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
