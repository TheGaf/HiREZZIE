// background/services/CacheService.js
/**
 * LRU Cache implementation with TTL support for result caching
 */

class LRUNode {
  constructor(key, value, ttl = null) {
    this.key = key;
    this.value = value;
    this.expiry = ttl ? Date.now() + ttl : null;
    this.prev = null;
    this.next = null;
  }

  isExpired() {
    return this.expiry && Date.now() > this.expiry;
  }
}

class LRUCache {
  constructor(maxSize = 100, defaultTTL = null) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.cache = new Map();
    this.size = 0;
    
    // Create dummy head and tail nodes for efficient operations
    this.head = new LRUNode(null, null);
    this.tail = new LRUNode(null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
    
    // Track cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      totalRequests: 0
    };
  }

  /**
   * Add a node to the front of the doubly linked list
   */
  addToFront(node) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  /**
   * Remove a node from the doubly linked list
   */
  removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  /**
   * Move a node to the front (mark as recently used)
   */
  moveToFront(node) {
    this.removeNode(node);
    this.addToFront(node);
  }

  /**
   * Remove the least recently used node (from tail)
   */
  removeTail() {
    const lastNode = this.tail.prev;
    this.removeNode(lastNode);
    return lastNode;
  }

  /**
   * Set a key-value pair with optional TTL
   */
  set(key, value, ttl = null) {
    ttl = ttl || this.defaultTTL;
    
    if (this.cache.has(key)) {
      // Update existing key
      const node = this.cache.get(key);
      node.value = value;
      node.expiry = ttl ? Date.now() + ttl : null;
      this.moveToFront(node);
    } else {
      // Add new key
      const newNode = new LRUNode(key, value, ttl);
      
      if (this.size >= this.maxSize) {
        // Remove least recently used
        const removedNode = this.removeTail();
        this.cache.delete(removedNode.key);
        this.stats.evictions++;
        this.size--;
      }
      
      this.cache.set(key, newNode);
      this.addToFront(newNode);
      this.size++;
    }
  }

  /**
   * Get a value by key
   */
  get(key) {
    this.stats.totalRequests++;
    
    if (!this.cache.has(key)) {
      this.stats.misses++;
      return null;
    }
    
    const node = this.cache.get(key);
    
    // Check if expired
    if (node.isExpired()) {
      this.delete(key);
      this.stats.expirations++;
      this.stats.misses++;
      return null;
    }
    
    // Move to front (mark as recently used)
    this.moveToFront(node);
    this.stats.hits++;
    return node.value;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key) {
    if (!this.cache.has(key)) return false;
    
    const node = this.cache.get(key);
    if (node.isExpired()) {
      this.delete(key);
      this.stats.expirations++;
      return false;
    }
    
    return true;
  }

  /**
   * Delete a key
   */
  delete(key) {
    if (!this.cache.has(key)) return false;
    
    const node = this.cache.get(key);
    this.removeNode(node);
    this.cache.delete(key);
    this.size--;
    return true;
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
    this.size = 0;
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.resetStats();
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const keysToDelete = [];
    
    for (const [key, node] of this.cache) {
      if (node.isExpired()) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.delete(key);
      this.stats.expirations++;
    });
    
    return keysToDelete.length;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.totalRequests > 0 
      ? (this.stats.hits / this.stats.totalRequests * 100).toFixed(2)
      : 0;
      
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.size,
      maxSize: this.maxSize,
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      totalRequests: 0
    };
  }

  /**
   * Estimate memory usage
   */
  getMemoryUsage() {
    let totalSize = 0;
    
    for (const [key, node] of this.cache) {
      // Rough estimation: key + value size
      const keySize = new Blob([key]).size;
      const valueSize = new Blob([JSON.stringify(node.value)]).size;
      totalSize += keySize + valueSize;
    }
    
    return {
      bytes: totalSize,
      kb: (totalSize / 1024).toFixed(2),
      mb: (totalSize / (1024 * 1024)).toFixed(2)
    };
  }

  /**
   * Get all keys (for debugging)
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  getSize() {
    return this.size;
  }
}

/**
 * Cache Service - Manages multiple cache instances
 */
class CacheService {
  constructor() {
    this.caches = new Map();
    this.defaultConfig = {
      maxSize: 100,
      defaultTTL: 5 * 60 * 1000 // 5 minutes
    };
  }

  /**
   * Get or create a cache instance
   */
  getCache(name, config = {}) {
    if (!this.caches.has(name)) {
      const cacheConfig = { ...this.defaultConfig, ...config };
      this.caches.set(name, new LRUCache(cacheConfig.maxSize, cacheConfig.defaultTTL));
    }
    return this.caches.get(name);
  }

  /**
   * Create a specialized cache for search results
   */
  getResultsCache() {
    return this.getCache('results', {
      maxSize: 50,
      defaultTTL: 5 * 60 * 1000 // 5 minutes
    });
  }

  /**
   * Create a specialized cache for image metadata
   */
  getImageCache() {
    return this.getCache('images', {
      maxSize: 200,
      defaultTTL: 30 * 60 * 1000 // 30 minutes
    });
  }

  /**
   * Create a specialized cache for API responses
   */
  getApiCache() {
    return this.getCache('api', {
      maxSize: 100,
      defaultTTL: 10 * 60 * 1000 // 10 minutes
    });
  }

  /**
   * Create a specialized cache for user preferences
   */
  getPreferencesCache() {
    return this.getCache('preferences', {
      maxSize: 20,
      defaultTTL: 60 * 60 * 1000 // 1 hour
    });
  }

  /**
   * Cleanup all caches
   */
  cleanupAll() {
    let totalCleaned = 0;
    for (const cache of this.caches.values()) {
      totalCleaned += cache.cleanup();
    }
    return totalCleaned;
  }

  /**
   * Get statistics for all caches
   */
  getAllStats() {
    const stats = {};
    for (const [name, cache] of this.caches) {
      stats[name] = cache.getStats();
    }
    return stats;
  }

  /**
   * Clear all caches
   */
  clearAll() {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  /**
   * Remove a specific cache
   */
  removeCache(name) {
    return this.caches.delete(name);
  }
}

// Export singleton instance
export const cacheService = new CacheService();
export { LRUCache };