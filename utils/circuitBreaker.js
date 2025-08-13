// utils/circuitBreaker.js - Failure protection pattern for hiREZZIE APIs
export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 600000; // 10 minutes
    this.successThreshold = options.successThreshold || 3; // For half-open state
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = [];
    this.successes = [];
    this.lastFailureTime = null;
    this.nextAttempt = null;
    this.stats = this._initStats();
  }

  _initStats() {
    return {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      stateChanges: 0,
      lastStateChange: Date.now(),
      circuitOpened: 0,
      fastFails: 0
    };
  }

  _cleanupOldRecords() {
    const cutoff = Date.now() - this.monitoringPeriod;
    this.failures = this.failures.filter(time => time > cutoff);
    this.successes = this.successes.filter(time => time > cutoff);
  }

  _recordSuccess() {
    const now = Date.now();
    this.successes.push(now);
    this.stats.totalSuccesses++;
    this.stats.totalRequests++;
    this._cleanupOldRecords();
  }

  _recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    this.lastFailureTime = now;
    this.stats.totalFailures++;
    this.stats.totalRequests++;
    this._cleanupOldRecords();
  }

  _shouldTrip() {
    return this.failures.length >= this.failureThreshold;
  }

  _setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.stats.stateChanges++;
    this.stats.lastStateChange = Date.now();
    
    if (newState === 'OPEN') {
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.stats.circuitOpened++;
    }
    
    console.log(`[CircuitBreaker] ${this.name}: ${oldState} -> ${newState}`);
  }

  async execute(request, fallback = null) {
    this._cleanupOldRecords();
    
    if (this.state === 'OPEN') {
      // Check if we should attempt a reset
      if (Date.now() >= this.nextAttempt) {
        this._setState('HALF_OPEN');
      } else {
        this.stats.fastFails++;
        const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
        error.circuitBreakerOpen = true;
        error.nextAttempt = this.nextAttempt;
        
        if (fallback) {
          console.log(`[CircuitBreaker] ${this.name}: Using fallback due to open circuit`);
          return await fallback();
        }
        throw error;
      }
    }

    try {
      const result = await request();
      this._recordSuccess();
      
      // If we're in half-open state and have enough successes, close the circuit
      if (this.state === 'HALF_OPEN') {
        const recentSuccesses = this.successes.filter(
          time => time > Date.now() - (this.resetTimeout / 2)
        ).length;
        
        if (recentSuccesses >= this.successThreshold) {
          this._setState('CLOSED');
          console.log(`[CircuitBreaker] ${this.name}: Circuit closed after ${recentSuccesses} successes`);
        }
      }
      
      return result;
    } catch (error) {
      this._recordFailure();
      
      // Check if we should trip the circuit
      if (this.state === 'CLOSED' && this._shouldTrip()) {
        this._setState('OPEN');
        console.warn(`[CircuitBreaker] ${this.name}: Circuit tripped after ${this.failures.length} failures`);
      }
      
      // In half-open state, any failure immediately opens the circuit
      if (this.state === 'HALF_OPEN') {
        this._setState('OPEN');
        console.warn(`[CircuitBreaker] ${this.name}: Circuit re-opened from half-open state`);
      }
      
      // Try fallback if available
      if (fallback && this.state === 'OPEN') {
        console.log(`[CircuitBreaker] ${this.name}: Using fallback due to failure`);
        try {
          return await fallback();
        } catch (fallbackError) {
          console.warn(`[CircuitBreaker] ${this.name}: Fallback also failed`, fallbackError);
          throw error; // Throw original error
        }
      }
      
      throw error;
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures.length,
      successes: this.successes.length,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      timeUntilNextAttempt: this.nextAttempt ? Math.max(0, this.nextAttempt - Date.now()) : 0,
      ...this.stats
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = [];
    this.successes = [];
    this.lastFailureTime = null;
    this.nextAttempt = null;
    this.stats = this._initStats();
    console.log(`[CircuitBreaker] ${this.name}: Reset to CLOSED state`);
  }

  forceOpen() {
    this._setState('OPEN');
    console.log(`[CircuitBreaker] ${this.name}: Manually forced to OPEN state`);
  }

  forceClose() {
    this._setState('CLOSED');
    this.failures = [];
    this.nextAttempt = null;
    console.log(`[CircuitBreaker] ${this.name}: Manually forced to CLOSED state`);
  }
}

// Circuit breaker registry for managing multiple APIs
export class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
    this.defaultConfig = {
      failureThreshold: 5,
      resetTimeout: 60000,
      monitoringPeriod: 600000,
      successThreshold: 3
    };
  }

  getOrCreate(name, config = {}) {
    if (!this.breakers.has(name)) {
      const breakerConfig = { ...this.defaultConfig, ...config };
      this.breakers.set(name, new CircuitBreaker(name, breakerConfig));
    }
    return this.breakers.get(name);
  }

  execute(name, request, fallback = null, config = {}) {
    const breaker = this.getOrCreate(name, config);
    return breaker.execute(request, fallback);
  }

  getState(name) {
    const breaker = this.breakers.get(name);
    return breaker ? breaker.getState() : null;
  }

  getAllStates() {
    const states = {};
    for (const [name, breaker] of this.breakers.entries()) {
      states[name] = breaker.getState();
    }
    return states;
  }

  reset(name) {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  // Get health summary
  getHealth() {
    const states = this.getAllStates();
    const total = Object.keys(states).length;
    const open = Object.values(states).filter(s => s.state === 'OPEN').length;
    const halfOpen = Object.values(states).filter(s => s.state === 'HALF_OPEN').length;
    const closed = Object.values(states).filter(s => s.state === 'CLOSED').length;

    return {
      total,
      healthy: closed,
      degraded: halfOpen,
      unhealthy: open,
      healthPercentage: total > 0 ? Math.round((closed / total) * 100) : 100,
      states
    };
  }
}

// Global circuit breaker registry
export const circuitBreakers = new CircuitBreakerRegistry();

// Utility functions for specific API patterns
export function withCircuitBreaker(providerName, request, fallback = null) {
  const config = getProviderConfig(providerName);
  return circuitBreakers.execute(providerName, request, fallback, config);
}

function getProviderConfig(provider) {
  const configs = {
    gnews: { failureThreshold: 3, resetTimeout: 30000 },
    newsapi: { failureThreshold: 3, resetTimeout: 30000 },
    brave: { failureThreshold: 5, resetTimeout: 60000 },
    bing: { failureThreshold: 5, resetTimeout: 60000 },
    google_cse: { failureThreshold: 2, resetTimeout: 120000 },
    serpapi: { failureThreshold: 3, resetTimeout: 60000 },
    youtube: { failureThreshold: 5, resetTimeout: 120000 },
    vimeo: { failureThreshold: 5, resetTimeout: 120000 },
    dailymotion: { failureThreshold: 5, resetTimeout: 120000 }
  };
  
  return configs[provider] || {};
}

// Create fallback functions for common patterns
export function createImageSearchFallback(query, sources = []) {
  return async () => {
    console.log(`[CircuitBreaker] Using fallback image search for: ${query}`);
    // Return cached results or basic placeholder
    return {
      results: [],
      source: 'fallback',
      query,
      timestamp: Date.now(),
      fromFallback: true
    };
  };
}

export function createNewsSearchFallback(query) {
  return async () => {
    console.log(`[CircuitBreaker] Using fallback news search for: ${query}`);
    // Return empty results or cached articles
    return {
      results: [],
      source: 'fallback',
      query,
      timestamp: Date.now(),
      fromFallback: true
    };
  };
}