mkdir -p utils
touch utils/cache.js

// utils/cache.js - LRU Cache with TTL
export class LRUCache {
    constructor(maxSize = 1000, maxAge = 300000) { // 5 minutes default
        this.maxSize = maxSize;
        this.maxAge = maxAge;
        this.cache = new Map();
        this.accessOrder = new Map();
        this.timers = new Map();
    }
    
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        // Update access time
        this.accessOrder.delete(key);
        this.accessOrder.set(key, Date.now());
        
        return item.data;
    }
    
    set(key, data) {
        // Remove existing entry if it exists
        if (this.cache.has(key)) {
            this.cache.delete(key);
            this.accessOrder.delete(key);
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
                this.timers.delete(key);
            }
        }
        
        // If at capacity, remove least recently used
        if (this.cache.size >= this.maxSize) {
            const lruKey = this.accessOrder.keys().next().value;
            this.delete(lruKey);
        }
        
        // Add new entry
        const now = Date.now();
        this.cache.set(key, { data, timestamp: now });
        this.accessOrder.set(key, now);
        
        // Set expiration timer
        const timer = setTimeout(() => {
            this.delete(key);
        }, this.maxAge);
        this.timers.set(key, timer);
    }
    
    delete(key) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
    }
    
    clear() {
        this.cache.clear();
        this.accessOrder.clear();
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }
    
    size() {
        return this.cache.size;
    }
}

// Result-specific cache
export class ResultCache {
    constructor() {
        this.cache = new LRUCache(500, 300000); // 500 items, 5 min TTL
    }
    
    generateKey(query, category, options = {}) {
        const optionsStr = JSON.stringify(options);
        return `${query}:${category}:${optionsStr}`.toLowerCase();
    }
    
    get(query, category, options) {
        const key = this.generateKey(query, category, options);
        return this.cache.get(key);
    }
    
    set(query, category, options, results) {
        const key = this.generateKey(query, category, options);
        this.cache.set(key, results);
    }
    
    clear() {
        this.cache.clear();
    }
}
