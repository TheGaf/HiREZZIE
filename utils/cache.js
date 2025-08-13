// utils/cache.js - LRU cache with TTL implementation for hiREZZIE
export class LRUCache {
  constructor(maxSize = 100, defaultTTL = 300000) { // 5 minutes default TTL
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0
    };
  }

  _isExpired(item) {
    return Date.now() > item.expiry;
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }
  }

  _evictLRU() {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }
  }

  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (this._isExpired(item)) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    // Move to end (mark as recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    this.stats.hits++;
    return item.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    // Clean up expired items periodically
    if (Math.random() < 0.1) { // 10% chance to clean up
      this._evictExpired();
    }

    // Remove if already exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else {
      // Evict LRU if at capacity
      this._evictLRU();
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl,
      createdAt: Date.now()
    });

    this.stats.sets++;
    return true;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
  }

  size() {
    return this.cache.size;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  // Get cache key for search requests
  static getSearchKey(query, category, offset = 0, sortMode = 'recent') {
    return `search:${query.toLowerCase()}:${category}:${offset}:${sortMode}`;
  }

  // Get cache key for API responses
  static getApiKey(provider, query, params = {}) {
    const paramStr = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    return `api:${provider}:${query.toLowerCase()}:${paramStr}`;
  }

  // Get cache key for image validation
  static getImageKey(url) {
    return `img:${url}`;
  }
}

// Global cache instances
export const searchCache = new LRUCache(50, 600000); // 10 minutes for search results
export const apiCache = new LRUCache(200, 300000); // 5 minutes for API responses
export const imageCache = new LRUCache(500, 1800000); // 30 minutes for image validations

// Cache warming utilities
export function warmCache(keys, fetcher) {
  return Promise.allSettled(keys.map(async (key) => {
    if (!searchCache.get(key)) {
      try {
        const result = await fetcher(key);
        if (result) {
          searchCache.set(key, result);
        }
      } catch (error) {
        console.warn(`[Cache] Failed to warm cache for key: ${key}`, error);
      }
    }
  }));
}

// Cache management utilities
export function getCacheStatus() {
  return {
    search: searchCache.getStats(),
    api: apiCache.getStats(), 
    image: imageCache.getStats()
  };
}

export function clearAllCaches() {
  searchCache.clear();
  apiCache.clear();
  imageCache.clear();
}