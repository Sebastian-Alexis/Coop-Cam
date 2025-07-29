//share service - manages shared recording links with expiration and security
//handles creation, validation, and access tracking for shared recordings

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

//initialize database for shares (simple JSON file for now, can be upgraded to SQLite)
const SHARES_DB_PATH = path.join(process.cwd(), 'shares.json');

//helper to load shares database
const loadSharesDB = () => {
  try {
    if (fs.existsSync(SHARES_DB_PATH)) {
      const data = fs.readFileSync(SHARES_DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[ShareService] Error loading shares database:', error);
  }
  return {};
};

//helper to save shares database
const saveSharesDB = (shares) => {
  try {
    fs.writeFileSync(SHARES_DB_PATH, JSON.stringify(shares, null, 2));
  } catch (error) {
    console.error('[ShareService] Error saving shares database:', error);
    throw error;
  }
};

export const createShareService = ({ config }) => {
  if (!config) {
    throw new Error('ShareService: config dependency is required.');
  }

  //generate cryptographically secure random token
  const generateToken = () => {
    return crypto.randomBytes(32).toString('hex');
  };

  //hash password using bcrypt
  const hashPassword = async (password) => {
    if (!password) return null;
    return await bcrypt.hash(password, 10);
  };

  //verify password against hash
  const verifyPassword = async (password, hash) => {
    if (!password || !hash) return false;
    return await bcrypt.compare(password, hash);
  };

  //parse expiration string to date
  const parseExpiration = (expiresIn) => {
    if (!expiresIn) return null;
    
    const now = new Date();
    const multipliers = {
      h: 60 * 60 * 1000,    //hours
      d: 24 * 60 * 60 * 1000 //days
    };
    
    const match = expiresIn.match(/^(\d+)([hd])$/);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    return new Date(now.getTime() + value * multipliers[unit]);
  };

  //create new share link
  const createShare = async (filename, options = {}) => {
    try {
      const shares = loadSharesDB();
      const token = generateToken();
      
      //prepare share data
      const shareData = {
        token,
        filename,
        createdAt: new Date().toISOString(),
        expiresAt: options.expiresIn ? parseExpiration(options.expiresIn)?.toISOString() : null,
        passwordHash: await hashPassword(options.password),
        customMessage: options.customMessage || null,
        viewCount: 0,
        lastViewed: null,
        isActive: true
      };
      
      shares[token] = shareData;
      saveSharesDB(shares);
      
      console.log(`[ShareService] Created share link for ${filename}, token: ${token.substring(0, 8)}...`);
      
      return {
        success: true,
        token,
        shareUrl: `${config.server.baseUrl || 'http://localhost:3004'}/share/${token}`,
        expiresAt: shareData.expiresAt
      };
    } catch (error) {
      console.error('[ShareService] Error creating share:', error);
      throw error;
    }
  };

  //validate share token and check if accessible
  const validateShare = async (token, password = null) => {
    try {
      const shares = loadSharesDB();
      const share = shares[token];
      
      if (!share || !share.isActive) {
        return { valid: false, error: 'Share not found or has been disabled' };
      }
      
      //check expiration
      if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
        return { valid: false, error: 'Share has expired' };
      }
      
      //check password if required
      if (share.passwordHash && !await verifyPassword(password, share.passwordHash)) {
        return { valid: false, error: 'Password required', requiresPassword: true };
      }
      
      //increment view count and update last viewed
      share.viewCount++;
      share.lastViewed = new Date().toISOString();
      shares[token] = share;
      saveSharesDB(shares);
      
      console.log(`[ShareService] Share accessed: ${token.substring(0, 8)}..., views: ${share.viewCount}`);
      
      return {
        valid: true,
        share: {
          filename: share.filename,
          customMessage: share.customMessage,
          viewCount: share.viewCount,
          createdAt: share.createdAt
        }
      };
    } catch (error) {
      console.error('[ShareService] Error validating share:', error);
      return { valid: false, error: 'Internal server error' };
    }
  };

  //get share statistics
  const getShareStats = async (token) => {
    try {
      const shares = loadSharesDB();
      const share = shares[token];
      
      if (!share) {
        return { error: 'Share not found' };
      }
      
      return {
        success: true,
        stats: {
          viewCount: share.viewCount,
          createdAt: share.createdAt,
          lastViewed: share.lastViewed,
          expiresAt: share.expiresAt,
          isActive: share.isActive
        }
      };
    } catch (error) {
      console.error('[ShareService] Error getting share stats:', error);
      throw error;
    }
  };

  //revoke/disable share
  const revokeShare = async (token) => {
    try {
      const shares = loadSharesDB();
      const share = shares[token];
      
      if (!share) {
        return { success: false, error: 'Share not found' };
      }
      
      share.isActive = false;
      shares[token] = share;
      saveSharesDB(shares);
      
      console.log(`[ShareService] Share revoked: ${token.substring(0, 8)}...`);
      
      return { success: true };
    } catch (error) {
      console.error('[ShareService] Error revoking share:', error);
      throw error;
    }
  };

  //cleanup expired shares (maintenance function)
  const cleanupExpiredShares = () => {
    try {
      const shares = loadSharesDB();
      const now = new Date();
      let cleaned = 0;
      
      for (const [token, share] of Object.entries(shares)) {
        if (share.expiresAt && now > new Date(share.expiresAt)) {
          delete shares[token];
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        saveSharesDB(shares);
        console.log(`[ShareService] Cleaned up ${cleaned} expired shares`);
      }
      
      return { cleaned };
    } catch (error) {
      console.error('[ShareService] Error cleaning up expired shares:', error);
      throw error;
    }
  };

  return {
    createShare,
    validateShare,
    getShareStats,
    revokeShare,
    cleanupExpiredShares
  };
};