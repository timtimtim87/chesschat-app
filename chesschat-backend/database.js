// database.js - PostgreSQL persistence layer
const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }

  async connect() {
    try {
      const client = await this.pool.connect();
      console.log('📊 Connected to PostgreSQL database');
      client.release();
      await this.initTables();
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async initTables() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
          username VARCHAR(50) PRIMARY KEY,
          display_name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          games_played INTEGER DEFAULT 0,
          games_won INTEGER DEFAULT 0,
          games_lost INTEGER DEFAULT 0,
          games_drawn INTEGER DEFAULT 0
        );

        -- Friendships table (bidirectional relationships)
        CREATE TABLE IF NOT EXISTS friendships (
          id SERIAL PRIMARY KEY,
          user1 VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
          user2 VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user1, user2),
          CHECK (user1 < user2) -- Ensures consistent ordering
        );

        -- Friend requests table
        CREATE TABLE IF NOT EXISTS friend_requests (
          id SERIAL PRIMARY KEY,
          from_user VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
          to_user VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(from_user, to_user),
          CHECK (from_user != to_user)
        );

        -- Game history table (for future use)
        CREATE TABLE IF NOT EXISTS game_history (
          id SERIAL PRIMARY KEY,
          white_player VARCHAR(50) REFERENCES users(username),
          black_player VARCHAR(50) REFERENCES users(username),
          winner VARCHAR(10), -- 'white', 'black', or 'draw'
          end_reason VARCHAR(20), -- 'checkmate', 'timeout', 'resignation', etc.
          game_duration INTEGER, -- seconds
          moves_count INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Create indexes for better performance
        CREATE INDEX IF NOT EXISTS idx_friendships_user1 ON friendships(user1);
        CREATE INDEX IF NOT EXISTS idx_friendships_user2 ON friendships(user2);
        CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user);
        CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON friend_requests(from_user);
        CREATE INDEX IF NOT EXISTS idx_game_history_players ON game_history(white_player, black_player);
      `);
      console.log('✅ Database tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // User management
  async createUser(username, displayName) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO users (username, display_name) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET last_seen = CURRENT_TIMESTAMP RETURNING *',
        [username, displayName]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUser(username) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLastSeen(username) {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = $1',
        [username]
      );
    } catch (error) {
      console.error('Error updating last seen:', error);
    } finally {
      client.release();
    }
  }

  // Friend management
  async sendFriendRequest(fromUser, toUser) {
    const client = await this.pool.connect();
    try {
      // Check if users exist
      const [fromExists, toExists] = await Promise.all([
        client.query('SELECT 1 FROM users WHERE username = $1', [fromUser]),
        client.query('SELECT 1 FROM users WHERE username = $1', [toUser])
      ]);

      if (!fromExists.rows.length) {
        throw new Error('Sender user not found');
      }
      if (!toExists.rows.length) {
        throw new Error('Target user not found');
      }

      // Check if already friends
      const friendship = await this.areFriends(fromUser, toUser);
      if (friendship) {
        throw new Error('Users are already friends');
      }

      // Insert friend request (will throw error if duplicate due to UNIQUE constraint)
      const result = await client.query(
        'INSERT INTO friend_requests (from_user, to_user) VALUES ($1, $2) RETURNING *',
        [fromUser, toUser]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error('Friend request already sent');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptFriendRequest(fromUser, toUser) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if friend request exists
      const requestResult = await client.query(
        'SELECT * FROM friend_requests WHERE from_user = $1 AND to_user = $2',
        [fromUser, toUser]
      );

      if (!requestResult.rows.length) {
        throw new Error('Friend request not found');
      }

      // Delete the friend request
      await client.query(
        'DELETE FROM friend_requests WHERE from_user = $1 AND to_user = $2',
        [fromUser, toUser]
      );

      // Add friendship (ensure consistent ordering)
      const [user1, user2] = [fromUser, toUser].sort();
      await client.query(
        'INSERT INTO friendships (user1, user2) VALUES ($1, $2)',
        [user1, user2]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async declineFriendRequest(fromUser, toUser) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM friend_requests WHERE from_user = $1 AND to_user = $2 RETURNING *',
        [fromUser, toUser]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('Error declining friend request:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getFriends(username) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          CASE 
            WHEN f.user1 = $1 THEN f.user2 
            ELSE f.user1 
          END as friend_username,
          u.display_name,
          u.last_seen,
          f.created_at as friendship_created
        FROM friendships f
        JOIN users u ON (
          CASE 
            WHEN f.user1 = $1 THEN f.user2 
            ELSE f.user1 
          END = u.username
        )
        WHERE f.user1 = $1 OR f.user2 = $1
        ORDER BY f.created_at DESC
      `, [username]);
      
      return result.rows;
    } catch (error) {
      console.error('Error getting friends:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getPendingFriendRequests(username) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          fr.from_user,
          u.display_name,
          fr.created_at
        FROM friend_requests fr
        JOIN users u ON fr.from_user = u.username
        WHERE fr.to_user = $1
        ORDER BY fr.created_at DESC
      `, [username]);
      
      return result.rows;
    } catch (error) {
      console.error('Error getting pending requests:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async areFriends(user1, user2) {
    const client = await this.pool.connect();
    try {
      const [sortedUser1, sortedUser2] = [user1, user2].sort();
      const result = await client.query(
        'SELECT 1 FROM friendships WHERE user1 = $1 AND user2 = $2',
        [sortedUser1, sortedUser2]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('Error checking friendship:', error);
      return false;
    } finally {
      client.release();
    }
  }

  // Game history (for future use)
  async saveGameResult(gameData) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO game_history 
        (white_player, black_player, winner, end_reason, game_duration, moves_count)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        gameData.whitePlayer,
        gameData.blackPlayer,
        gameData.winner,
        gameData.endReason,
        gameData.duration,
        gameData.movesCount
      ]);

      // Update user stats
      await this.updateUserStats(gameData);
      
      return result.rows[0];
    } catch (error) {
      console.error('Error saving game result:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateUserStats(gameData) {
    const client = await this.pool.connect();
    try {
      // Update both players' stats
      await client.query(`
        UPDATE users 
        SET games_played = games_played + 1,
            games_won = games_won + CASE WHEN $2 = 'white' THEN 1 ELSE 0 END,
            games_lost = games_lost + CASE WHEN $2 = 'black' THEN 1 ELSE 0 END,
            games_drawn = games_drawn + CASE WHEN $2 = 'draw' THEN 1 ELSE 0 END
        WHERE username = $1
      `, [gameData.whitePlayer, gameData.winner]);

      await client.query(`
        UPDATE users 
        SET games_played = games_played + 1,
            games_won = games_won + CASE WHEN $2 = 'black' THEN 1 ELSE 0 END,
            games_lost = games_lost + CASE WHEN $2 = 'white' THEN 1 ELSE 0 END,
            games_drawn = games_drawn + CASE WHEN $2 = 'draw' THEN 1 ELSE 0 END
        WHERE username = $1
      `, [gameData.blackPlayer, gameData.winner]);
    } catch (error) {
      console.error('Error updating user stats:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserStats(username) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          username,
          display_name,
          games_played,
          games_won,
          games_lost,
          games_drawn,
          created_at,
          last_seen
        FROM users 
        WHERE username = $1
      `, [username]);
      
      return result.rows[0];
    } catch (error) {
      console.error('Error getting user stats:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Cleanup methods
  async cleanupOldFriendRequests(daysOld = 30) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM friend_requests 
        WHERE created_at < NOW() - INTERVAL '${daysOld} days'
      `);
      console.log(`🧹 Cleaned up ${result.rowCount} old friend requests`);
    } catch (error) {
      console.error('Error cleaning up friend requests:', error);
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
    console.log('📊 Database connection closed');
  }
}

module.exports = Database;
