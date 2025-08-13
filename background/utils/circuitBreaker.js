// utils/circuitBreaker.js - API failure protection
export class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.timeout = options.timeout || 60000; // 1 minute
        this.monitoringPeriod = options.monitoringPeriod || 120000; // 2 minutes
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        this.requestHistory = [];
    }
    
    async execute(operation) {
        if (this.state === 'OPEN') {
            if (this.shouldAttemptReset()) {
                this.state = 'HALF_OPEN';
                console.log('[CircuitBreaker] Attempting reset to HALF_OPEN');
            } else {
                throw new Error(`Circuit breaker is OPEN. Last failure: ${this.lastFailureTime}`);
            }
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        this.lastFailureTime = null;
        
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = 'CLOSED';
                this.successCount = 0;
                console.log('[CircuitBreaker] Reset to CLOSED state');
            }
        }
        
        this.recordRequest(true);
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            console.warn(`[CircuitBreaker] OPENED after ${this.failureCount} failures`);
        }
        
        this.recordRequest(false);
    }
    
    shouldAttemptReset() {
        return Date.now() - this.lastFailureTime > this.timeout;
    }
    
    recordRequest(success) {
        const now = Date.now();
        this.requestHistory.push({ timestamp: now, success });
        
        // Keep only recent history
        this.requestHistory = this.requestHistory.filter(
            req => now - req.timestamp < this.monitoringPeriod
        );
    }
    
    getStats() {
        const total = this.requestHistory.length;
        const successful = this.requestHistory.filter(req => req.success).length;
        
        return {
            state: this.state,
            failureCount: this.failureCount,
            successRate: total > 0 ? (successful / total) * 100 : 0,
            totalRequests: total,
            lastFailureTime: this.lastFailureTime
        };
    }
}
