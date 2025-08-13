// background/services/CircuitBreaker.js
/**
 * Circuit Breaker pattern implementation for API failure handling
 */

const CircuitState = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Circuit is open, requests fail fast
  HALF_OPEN: 'HALF_OPEN'  // Testing if service is back
};

class CircuitBreaker {
  constructor(config = {}) {
    this.failureThreshold = config.failureThreshold || 5;
    this.resetTimeout = config.resetTimeout || 30000; // 30 seconds
    this.monitorTimeout = config.monitorTimeout || 2000; // 2 seconds
    this.successThreshold = config.successThreshold || 3; // For half-open state
    
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      stateChanges: 0,
      lastStateChange: null
    };
    
    this.listeners = new Set();
  }

  /**
   * Add a state change listener
   */
  addStateChangeListener(callback) {
    this.listeners.add(callback);
  }

  /**
   * Remove a state change listener
   */
  removeStateChangeListener(callback) {
    this.listeners.delete(callback);
  }

  /**
   * Notify listeners of state change
   */
  notifyStateChange(oldState, newState, reason) {
    this.stats.stateChanges++;
    this.stats.lastStateChange = Date.now();
    
    this.listeners.forEach(callback => {
      try {
        callback({ oldState, newState, reason, timestamp: Date.now() });
      } catch (error) {
        console.warn('[CircuitBreaker] Error in state change listener:', error);
      }
    });
  }

  /**
   * Change circuit state
   */
  changeState(newState, reason = '') {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.notifyStateChange(oldState, newState, reason);
      
      console.log(`[CircuitBreaker] State changed from ${oldState} to ${newState}: ${reason}`);
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn, context = null) {
    this.stats.totalRequests++;
    
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        this.stats.rejectedRequests++;
        const error = new Error('Circuit breaker is OPEN');
        error.circuitState = this.state;
        error.retryAfter = this.nextAttemptTime - Date.now();
        throw error;
      } else {
        // Time to try again - move to half-open
        this.changeState(CircuitState.HALF_OPEN, 'Attempting to recover');
        this.successCount = 0;
      }
    }

    try {
      const result = await fn.call(context);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.stats.successfulRequests++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.changeState(CircuitState.CLOSED, 'Service recovered');
        this.reset();
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.reset();
    }
  }

  /**
   * Handle failed execution
   */
  onFailure() {
    this.stats.failedRequests++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately go back to open state
      this.changeState(CircuitState.OPEN, 'Failure during recovery attempt');
      this.nextAttemptTime = Date.now() + this.resetTimeout;
    } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      this.changeState(CircuitState.OPEN, `Failure threshold reached (${this.failureCount})`);
      this.nextAttemptTime = Date.now() + this.resetTimeout;
    }
  }

  /**
   * Reset failure count
   */
  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Force circuit to open state
   */
  forceOpen(reason = 'Manually forced') {
    this.changeState(CircuitState.OPEN, reason);
    this.nextAttemptTime = Date.now() + this.resetTimeout;
  }

  /**
   * Force circuit to closed state
   */
  forceClosed(reason = 'Manually forced') {
    this.changeState(CircuitState.CLOSED, reason);
    this.reset();
  }

  /**
   * Get current circuit status
   */
  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      timeUntilRetry: this.nextAttemptTime ? Math.max(0, this.nextAttemptTime - Date.now()) : 0,
      stats: { ...this.stats }
    };
  }

  /**
   * Get health score (0-100)
   */
  getHealthScore() {
    const total = this.stats.successfulRequests + this.stats.failedRequests;
    if (total === 0) return 100;
    
    const successRate = (this.stats.successfulRequests / total) * 100;
    
    // Adjust for current state
    if (this.state === CircuitState.OPEN) return 0;
    if (this.state === CircuitState.HALF_OPEN) return Math.min(successRate, 50);
    
    return successRate;
  }
}

/**
 * Circuit Breaker Manager - Manages multiple circuit breakers
 */
class CircuitBreakerManager {
  constructor() {
    this.circuitBreakers = new Map();
    this.globalStats = {
      totalBreakers: 0,
      openBreakers: 0,
      halfOpenBreakers: 0,
      closedBreakers: 0
    };
  }

  /**
   * Create or get a circuit breaker for an API
   */
  getCircuitBreaker(apiName, config = {}) {
    if (!this.circuitBreakers.has(apiName)) {
      const breaker = new CircuitBreaker(config);
      
      // Add listener to update global stats
      breaker.addStateChangeListener((event) => {
        this.updateGlobalStats();
        console.log(`[CircuitBreakerManager] ${apiName} state changed: ${event.oldState} -> ${event.newState}`);
      });
      
      this.circuitBreakers.set(apiName, breaker);
      this.globalStats.totalBreakers++;
    }
    
    return this.circuitBreakers.get(apiName);
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(apiName, fn, config = {}, context = null) {
    const breaker = this.getCircuitBreaker(apiName, config);
    return breaker.execute(fn, context);
  }

  /**
   * Update global statistics
   */
  updateGlobalStats() {
    let open = 0, halfOpen = 0, closed = 0;
    
    for (const breaker of this.circuitBreakers.values()) {
      switch (breaker.state) {
        case CircuitState.OPEN:
          open++;
          break;
        case CircuitState.HALF_OPEN:
          halfOpen++;
          break;
        case CircuitState.CLOSED:
          closed++;
          break;
      }
    }
    
    this.globalStats = {
      totalBreakers: this.circuitBreakers.size,
      openBreakers: open,
      halfOpenBreakers: halfOpen,
      closedBreakers: closed
    };
  }

  /**
   * Get status of all circuit breakers
   */
  getAllStatus() {
    const status = {};
    
    for (const [apiName, breaker] of this.circuitBreakers) {
      status[apiName] = breaker.getStatus();
    }
    
    return {
      global: this.globalStats,
      breakers: status
    };
  }

  /**
   * Get health scores for all APIs
   */
  getHealthScores() {
    const scores = {};
    
    for (const [apiName, breaker] of this.circuitBreakers) {
      scores[apiName] = breaker.getHealthScore();
    }
    
    return scores;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.forceClosed('Global reset');
    }
  }

  /**
   * Reset a specific circuit breaker
   */
  reset(apiName) {
    const breaker = this.circuitBreakers.get(apiName);
    if (breaker) {
      breaker.forceClosed('Manual reset');
      return true;
    }
    return false;
  }

  /**
   * Remove a circuit breaker
   */
  remove(apiName) {
    const breaker = this.circuitBreakers.get(apiName);
    if (breaker) {
      this.circuitBreakers.delete(apiName);
      this.globalStats.totalBreakers--;
      this.updateGlobalStats();
      return true;
    }
    return false;
  }

  /**
   * Create a circuit-breaker-protected fetch function
   */
  createProtectedFetch(apiName, config = {}) {
    return async (url, options = {}) => {
      const breaker = this.getCircuitBreaker(apiName, config);
      
      return breaker.execute(async () => {
        const response = await fetch(url, options);
        
        // Consider HTTP errors as failures
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = response;
          error.status = response.status;
          throw error;
        }
        
        return response;
      });
    };
  }

  /**
   * Create a circuit-breaker-protected function wrapper
   */
  protect(apiName, fn, config = {}) {
    const breaker = this.getCircuitBreaker(apiName, config);
    
    return async (...args) => {
      return breaker.execute(() => fn(...args));
    };
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();
export { CircuitBreaker, CircuitState };