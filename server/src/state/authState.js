import { timingSafeEqual } from 'crypto';

//authentication state management service
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; //1 minute

class AuthService {
  constructor() {
    this.attempts = new Map(); //ip -> { attempts: [timestamps], expiry: timestamp }
    
    //cleanup old attempts every 5 minutes
    setInterval(() => {
      this.cleanupExpiredAttempts();
    }, 5 * 60 * 1000);
  }

  //record any password attempt (both successful and failed) for rate limiting
  recordAttempt(ip) {
    const now = Date.now();
    const existingAttempt = this.attempts.get(ip) || { attempts: [], expiry: 0 };
    
    //remove old attempts outside the rate limit window
    const recentAttempts = existingAttempt.attempts.filter(
      time => now - time < RATE_LIMIT_WINDOW_MS
    );
    
    //add new attempt
    recentAttempts.push(now);
    
    //update with new expiry time
    this.attempts.set(ip, {
      attempts: recentAttempts,
      expiry: now + RATE_LIMIT_WINDOW_MS
    });
    
    console.log(`[Auth] Attempt recorded for ${ip}. Total attempts: ${recentAttempts.length}/${MAX_ATTEMPTS}`);
  }

  //record a failed password attempt for an IP (legacy method name)
  recordFailedAttempt(ip) {
    this.recordAttempt(ip);
  }

  //check if an IP is currently rate limited
  isRateLimited(ip) {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    
    if (!attempt) {
      return false;
    }

    //cleanup expired attempts first
    if (now > attempt.expiry) {
      this.attempts.delete(ip);
      return false;
    }

    //filter out old attempts
    const recentAttempts = attempt.attempts.filter(
      time => now - time < RATE_LIMIT_WINDOW_MS
    );

    //update the record with cleaned attempts
    if (recentAttempts.length === 0) {
      this.attempts.delete(ip);
      return false;
    } else {
      this.attempts.set(ip, {
        attempts: recentAttempts,
        expiry: attempt.expiry
      });
    }

    const isLimited = recentAttempts.length >= MAX_ATTEMPTS;
    
    if (isLimited) {
      console.log(`[Auth] IP ${ip} is rate limited. ${recentAttempts.length}/${MAX_ATTEMPTS} attempts`);
    }
    
    return isLimited;
  }

  //clear all attempts for an IP (call on successful login)
  clearAttempts(ip) {
    const wasLimited = this.isRateLimited(ip);
    this.attempts.delete(ip);
    
    if (wasLimited) {
      console.log(`[Auth] Rate limit cleared for ${ip} after successful authentication`);
    }
  }

  //get current attempt count for an IP
  getAttemptCount(ip) {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    
    if (!attempt || now > attempt.expiry) {
      return 0;
    }
    
    const recentAttempts = attempt.attempts.filter(
      time => now - time < RATE_LIMIT_WINDOW_MS
    );
    
    return recentAttempts.length;
  }

  //timing-safe password comparison
  verifyPassword(inputPassword, correctPassword) {
    if (!inputPassword || !correctPassword) {
      return false;
    }
    
    try {
      const inputBuffer = Buffer.from(inputPassword, 'utf8');
      const correctBuffer = Buffer.from(correctPassword, 'utf8');
      
      //pad buffers to same length to prevent timing attacks
      const maxLength = Math.max(inputBuffer.length, correctBuffer.length);
      const paddedInput = Buffer.alloc(maxLength);
      const paddedCorrect = Buffer.alloc(maxLength);
      
      inputBuffer.copy(paddedInput);
      correctBuffer.copy(paddedCorrect);
      
      return timingSafeEqual(paddedInput, paddedCorrect);
    } catch (error) {
      console.error('[Auth] Password verification error:', error);
      return false;
    }
  }

  //cleanup expired attempts to prevent memory leaks
  cleanupExpiredAttempts() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [ip, attempt] of this.attempts.entries()) {
      if (now > attempt.expiry) {
        this.attempts.delete(ip);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Auth] Cleaned up ${cleaned} expired rate limit entries`);
    }
  }

  //get rate limiting statistics
  getStats() {
    const now = Date.now();
    const stats = {
      totalIPs: this.attempts.size,
      rateLimitedIPs: 0,
      activeAttempts: 0
    };
    
    for (const [ip, attempt] of this.attempts.entries()) {
      if (now <= attempt.expiry) {
        const recentAttempts = attempt.attempts.filter(
          time => now - time < RATE_LIMIT_WINDOW_MS
        );
        
        stats.activeAttempts += recentAttempts.length;
        
        if (recentAttempts.length >= MAX_ATTEMPTS) {
          stats.rateLimitedIPs++;
        }
      }
    }
    
    return stats;
  }

  //cleanup method for shutdown
  cleanup() {
    this.attempts.clear();
    console.log('[Auth] Service cleanup completed');
  }

  //test isolation method
  _resetForTests() {
    this.attempts.clear();
  }
}

//create and export singleton instance
const authService = new AuthService();
export default authService;