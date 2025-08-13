// utils/rateLimiter.js - Per-API rate limiting for hiREZZIE
export class RateLimiter {
  constructor(maxRequests = 10, windowMs = 60000) { // 10 requests per minute default
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map(); // provider -> array of timestamps
    this.stats = new Map(); // provider -> stats
  }

  _cleanupOldRequests(provider) {
    const now = Date.now();
    const requests = this.requests.get(provider) || [];
    const cutoff = now - this.windowMs;
    
    const validRequests = requests.filter(timestamp => timestamp > cutoff);
    this.requests.set(provider, validRequests);
    
    return validRequests;
  }

  canMakeRequest(provider) {
    const validRequests = this._cleanupOldRequests(provider);
    return validRequests.length < this.maxRequests;
  }

  makeRequest(provider) {
    if (!this.canMakeRequest(provider)) {
      const stats = this.stats.get(provider) || { allowed: 0, blocked: 0 };
      stats.blocked++;
      this.stats.set(provider, stats);
      
      const oldestRequest = this.requests.get(provider)[0];
      const waitTime = this.windowMs - (Date.now() - oldestRequest);
      
      return {
        allowed: false,
        waitTime: Math.max(0, waitTime),
        remaining: 0
      };
    }

    const now = Date.now();
    const requests = this.requests.get(provider) || [];
    requests.push(now);
    this.requests.set(provider, requests);

    const stats = this.stats.get(provider) || { allowed: 0, blocked: 0 };
    stats.allowed++;
    this.stats.set(provider, stats);

    return {
      allowed: true,
      waitTime: 0,
      remaining: this.maxRequests - requests.length
    };
  }

  getStats(provider) {
    if (provider) {
      return this.stats.get(provider) || { allowed: 0, blocked: 0 };
    }
    
    const allStats = {};
    for (const [prov, stats] of this.stats.entries()) {
      allStats[prov] = { ...stats };
    }
    return allStats;
  }

  getRemainingRequests(provider) {
    const validRequests = this._cleanupOldRequests(provider);
    return Math.max(0, this.maxRequests - validRequests.length);
  }

  getResetTime(provider) {
    const requests = this.requests.get(provider) || [];
    if (requests.length === 0) return 0;
    
    const oldestRequest = requests[0];
    return oldestRequest + this.windowMs;
  }

  reset(provider) {
    if (provider) {
      this.requests.delete(provider);
      this.stats.delete(provider);
    } else {
      this.requests.clear();
      this.stats.clear();
    }
  }
}

// Provider-specific rate limiters with different limits
export class ProviderRateLimiters {
  constructor() {
    this.limiters = new Map();
    this.cooldowns = new Map(); // provider -> cooldown end time
    
    // Configure rate limits per provider
    this.configure('gnews', 100, 60000); // 100 req/min
    this.configure('newsapi', 100, 60000); // 100 req/min  
    this.configure('brave', 50, 60000); // 50 req/min
    this.configure('bing', 30, 60000); // 30 req/min
    this.configure('google_cse', 100, 86400000); // 100 req/day
    this.configure('serpapi', 100, 3600000); // 100 req/hour
    this.configure('youtube', 10000, 86400000); // 10k req/day
    this.configure('vimeo', 1000, 3600000); // 1k req/hour
    this.configure('dailymotion', 300, 3600000); // 300 req/hour
  }

  configure(provider, maxRequests, windowMs) {
    this.limiters.set(provider, new RateLimiter(maxRequests, windowMs));
  }

  canMakeRequest(provider) {
    // Check if provider is in cooldown
    const cooldownEnd = this.cooldowns.get(provider);
    if (cooldownEnd && Date.now() < cooldownEnd) {
      return false;
    }

    const limiter = this.limiters.get(provider);
    if (!limiter) {
      console.warn(`[RateLimiter] No limiter configured for provider: ${provider}`);
      return true; // Allow if no limiter configured
    }

    return limiter.canMakeRequest(provider);
  }

  makeRequest(provider) {
    // Check cooldown first
    const cooldownEnd = this.cooldowns.get(provider);
    if (cooldownEnd && Date.now() < cooldownEnd) {
      return {
        allowed: false,
        reason: 'cooldown',
        waitTime: cooldownEnd - Date.now(),
        remaining: 0
      };
    }

    const limiter = this.limiters.get(provider);
    if (!limiter) {
      console.warn(`[RateLimiter] No limiter configured for provider: ${provider}`);
      return { allowed: true, waitTime: 0, remaining: 999 };
    }

    const result = limiter.makeRequest(provider);
    if (!result.allowed) {
      result.reason = 'rate_limit';
    }
    return result;
  }

  setCooldown(provider, durationMs = 3600000) { // 1 hour default
    const endTime = Date.now() + durationMs;
    this.cooldowns.set(provider, endTime);
    console.log(`[RateLimiter] Provider ${provider} in cooldown until ${new Date(endTime).toISOString()}`);
  }

  clearCooldown(provider) {
    this.cooldowns.delete(provider);
    console.log(`[RateLimiter] Cooldown cleared for provider: ${provider}`);
  }

  getCooldownStatus(provider) {
    const cooldownEnd = this.cooldowns.get(provider);
    if (!cooldownEnd || Date.now() >= cooldownEnd) {
      return null;
    }
    return {
      active: true,
      remaining: cooldownEnd - Date.now(),
      endTime: cooldownEnd
    };
  }

  getStats(provider) {
    if (provider) {
      const limiter = this.limiters.get(provider);
      const cooldown = this.getCooldownStatus(provider);
      return {
        rateLimit: limiter ? limiter.getStats(provider) : null,
        cooldown,
        remaining: limiter ? limiter.getRemainingRequests(provider) : 0
      };
    }

    const allStats = {};
    for (const [prov, limiter] of this.limiters.entries()) {
      allStats[prov] = {
        rateLimit: limiter.getStats(prov),
        cooldown: this.getCooldownStatus(prov),
        remaining: limiter.getRemainingRequests(prov)
      };
    }
    return allStats;
  }

  reset(provider) {
    if (provider) {
      const limiter = this.limiters.get(provider);
      if (limiter) limiter.reset(provider);
      this.clearCooldown(provider);
    } else {
      for (const limiter of this.limiters.values()) {
        limiter.reset();
      }
      this.cooldowns.clear();
    }
  }
}

// Global rate limiter instance
export const rateLimiters = new ProviderRateLimiters();

// Utility functions
export function waitForRateLimit(provider, maxWaitTime = 30000) {
  return new Promise((resolve, reject) => {
    const result = rateLimiters.makeRequest(provider);
    
    if (result.allowed) {
      resolve(result);
      return;
    }

    if (result.waitTime > maxWaitTime) {
      reject(new Error(`Rate limit wait time (${result.waitTime}ms) exceeds maximum (${maxWaitTime}ms)`));
      return;
    }

    console.log(`[RateLimiter] Waiting ${result.waitTime}ms for ${provider} rate limit`);
    setTimeout(() => {
      resolve(rateLimiters.makeRequest(provider));
    }, result.waitTime);
  });
}

export function handleApiError(provider, statusCode) {
  if (statusCode === 429) {
    rateLimiters.setCooldown(provider, 3600000); // 1 hour
  } else if (statusCode === 403) {
    rateLimiters.setCooldown(provider, 1800000); // 30 minutes
  } else if (statusCode >= 500) {
    rateLimiters.setCooldown(provider, 900000); // 15 minutes
  }
}