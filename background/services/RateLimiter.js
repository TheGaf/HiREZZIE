// background/services/RateLimiter.js
/**
 * Rate limiting service with token bucket algorithm
 */

class TokenBucket {
  constructor(capacity, refillRate, refillInterval = 1000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.lastRefill = Date.now();
    
    // Start the refill process
    this.startRefill();
  }

  /**
   * Start the token refill process
   */
  startRefill() {
    this.refillTimer = setInterval(() => {
      this.refill();
    }, this.refillInterval);
  }

  /**
   * Stop the token refill process
   */
  stopRefill() {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }

  /**
   * Refill tokens based on time elapsed
   */
  refill() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor((timePassed / this.refillInterval) * this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Try to consume tokens
   */
  consume(tokens = 1) {
    this.refill(); // Update tokens before checking
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  /**
   * Check if tokens are available without consuming
   */
  canConsume(tokens = 1) {
    this.refill();
    return this.tokens >= tokens;
  }

  /**
   * Get current token count
   */
  getTokens() {
    this.refill();
    return this.tokens;
  }

  /**
   * Get time until next token is available
   */
  getTimeUntilNextToken() {
    if (this.tokens > 0) return 0;
    
    const timeForNextRefill = this.refillInterval - (Date.now() - this.lastRefill);
    return Math.max(0, timeForNextRefill);
  }
}

class RateLimiter {
  constructor() {
    this.limiters = new Map();
    this.requestHistory = new Map();
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      resetCount: 0
    };
  }

  /**
   * Create a rate limiter for an API
   */
  createLimiter(apiName, config) {
    const limiters = {
      perSecond: new TokenBucket(
        config.requestsPerSecond,
        config.requestsPerSecond,
        1000
      ),
      perMinute: new TokenBucket(
        config.requestsPerMinute,
        config.requestsPerMinute,
        60000
      ),
      perDay: new TokenBucket(
        config.requestsPerDay,
        Math.ceil(config.requestsPerDay / 24), // Hourly refill rate
        3600000 // 1 hour
      )
    };

    this.limiters.set(apiName, limiters);
    this.requestHistory.set(apiName, {
      requests: [],
      totalRequests: 0,
      blockedRequests: 0,
      lastRequest: null
    });

    return limiters;
  }

  /**
   * Check if a request is allowed
   */
  async isAllowed(apiName, tokens = 1) {
    this.stats.totalRequests++;
    
    if (!this.limiters.has(apiName)) {
      console.warn(`[RateLimiter] No limiter configured for API: ${apiName}`);
      this.stats.allowedRequests++;
      return { allowed: true, reason: 'no_limiter' };
    }

    const limiters = this.limiters.get(apiName);
    const history = this.requestHistory.get(apiName);

    // Check all rate limits
    const checks = [
      { name: 'perSecond', limiter: limiters.perSecond },
      { name: 'perMinute', limiter: limiters.perMinute },
      { name: 'perDay', limiter: limiters.perDay }
    ];

    for (const check of checks) {
      if (!check.limiter.canConsume(tokens)) {
        this.stats.blockedRequests++;
        history.blockedRequests++;
        
        const waitTime = check.limiter.getTimeUntilNextToken();
        return {
          allowed: false,
          reason: `rate_limit_${check.name}`,
          waitTime,
          retryAfter: new Date(Date.now() + waitTime)
        };
      }
    }

    // All checks passed, consume tokens
    checks.forEach(check => check.limiter.consume(tokens));
    
    // Update history
    history.totalRequests++;
    history.lastRequest = Date.now();
    history.requests.push({
      timestamp: Date.now(),
      tokens,
      allowed: true
    });

    // Keep only recent history (last hour)
    const oneHourAgo = Date.now() - 3600000;
    history.requests = history.requests.filter(req => req.timestamp > oneHourAgo);

    this.stats.allowedRequests++;
    return { allowed: true, reason: 'rate_limit_ok' };
  }

  /**
   * Wait until a request is allowed
   */
  async waitForSlot(apiName, tokens = 1, maxWait = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const result = await this.isAllowed(apiName, tokens);
      
      if (result.allowed) {
        return result;
      }
      
      // Wait before retrying
      const waitTime = Math.min(result.waitTime || 1000, maxWait - (Date.now() - startTime));
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    return {
      allowed: false,
      reason: 'max_wait_exceeded',
      waitTime: maxWait
    };
  }

  /**
   * Reset rate limiter for an API
   */
  reset(apiName) {
    if (this.limiters.has(apiName)) {
      const limiters = this.limiters.get(apiName);
      Object.values(limiters).forEach(limiter => {
        limiter.tokens = limiter.capacity;
        limiter.lastRefill = Date.now();
      });
      
      this.stats.resetCount++;
      return true;
    }
    return false;
  }

  /**
   * Get current status for an API
   */
  getStatus(apiName) {
    if (!this.limiters.has(apiName)) {
      return { error: 'API not configured' };
    }

    const limiters = this.limiters.get(apiName);
    const history = this.requestHistory.get(apiName);

    return {
      perSecond: {
        tokens: limiters.perSecond.getTokens(),
        capacity: limiters.perSecond.capacity,
        nextRefill: limiters.perSecond.getTimeUntilNextToken()
      },
      perMinute: {
        tokens: limiters.perMinute.getTokens(),
        capacity: limiters.perMinute.capacity,
        nextRefill: limiters.perMinute.getTimeUntilNextToken()
      },
      perDay: {
        tokens: limiters.perDay.getTokens(),
        capacity: limiters.perDay.capacity,
        nextRefill: limiters.perDay.getTimeUntilNextToken()
      },
      history: {
        totalRequests: history.totalRequests,
        blockedRequests: history.blockedRequests,
        lastRequest: history.lastRequest ? new Date(history.lastRequest) : null,
        recentRequests: history.requests.length
      }
    };
  }

  /**
   * Get overall statistics
   */
  getStats() {
    const apiStats = {};
    for (const [apiName] of this.limiters) {
      apiStats[apiName] = this.getStatus(apiName);
    }

    return {
      overall: this.stats,
      apis: apiStats
    };
  }

  /**
   * Clean up resources
   */
  cleanup() {
    for (const limiters of this.limiters.values()) {
      Object.values(limiters).forEach(limiter => {
        if (limiter.stopRefill) {
          limiter.stopRefill();
        }
      });
    }
    this.limiters.clear();
    this.requestHistory.clear();
  }

  /**
   * Create a rate-limited fetch function
   */
  createRateLimitedFetch(apiName) {
    return async (url, options = {}) => {
      const permission = await this.isAllowed(apiName);
      
      if (!permission.allowed) {
        const error = new Error(`Rate limit exceeded for ${apiName}: ${permission.reason}`);
        error.retryAfter = permission.retryAfter;
        error.waitTime = permission.waitTime;
        throw error;
      }

      return fetch(url, options);
    };
  }

  /**
   * Create a rate-limited function wrapper
   */
  withRateLimit(apiName, fn) {
    return async (...args) => {
      const permission = await this.isAllowed(apiName);
      
      if (!permission.allowed) {
        const error = new Error(`Rate limit exceeded for ${apiName}: ${permission.reason}`);
        error.retryAfter = permission.retryAfter;
        error.waitTime = permission.waitTime;
        throw error;
      }

      return fn(...args);
    };
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();
export { TokenBucket };