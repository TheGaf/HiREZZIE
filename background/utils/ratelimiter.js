touch utils/rateLimiter.js

// utils/rateLimiter.js - API rate limiting
export class RateLimiter {
    constructor(requestsPerMinute = 60) {
        this.limit = requestsPerMinute;
        this.requests = [];
        this.queue = [];
        this.processing = false;
    }
    
    async execute(operation) {
        return new Promise((resolve, reject) => {
            this.queue.push({ operation, resolve, reject });
            this.processQueue();
        });
    }
    
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            await this.waitIfNeeded();
            
            const { operation, resolve, reject } = this.queue.shift();
            
            try {
                const result = await operation();
                resolve(result);
            } catch (error) {
                reject(error);
            }
            
            this.recordRequest();
        }
        
        this.processing = false;
    }
    
    async waitIfNeeded() {
        const now = Date.now();
        
        // Remove requests older than 1 minute
        this.requests = this.requests.filter(time => now - time < 60000);
        
        if (this.requests.length >= this.limit) {
            const oldestRequest = this.requests[0];
            const waitTime = 60000 - (now - oldestRequest);
            
            if (waitTime > 0) {
                console.log(`[RateLimiter] Waiting ${waitTime}ms before next request`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    recordRequest() {
        this.requests.push(Date.now());
    }
    
    getStats() {
        const now = Date.now();
        const recentRequests = this.requests.filter(time => now - time < 60000);
        
        return {
            requestsInLastMinute: recentRequests.length,
            limit: this.limit,
            queueLength: this.queue.length,
            utilizationPercent: (recentRequests.length / this.limit) * 100
        };
    }
}
