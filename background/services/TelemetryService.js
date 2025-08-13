// background/services/TelemetryService.js
/**
 * Local-only telemetry service for performance monitoring
 * Privacy-first: No external data collection
 */

class PerformanceMetrics {
  constructor() {
    this.metrics = {
      searchTimes: [],
      apiResponseTimes: new Map(),
      cachePerformance: {
        hits: 0,
        misses: 0,
        totalRequests: 0
      },
      memoryUsage: [],
      errorRates: new Map(),
      userInteractions: {
        searches: 0,
        loadMore: 0,
        imageClicks: 0
      },
      popularQueries: new Map(),
      apiSuccessRates: new Map(),
      performanceTimings: new Map()
    };
    
    this.sessionStart = Date.now();
    this.maxHistorySize = 1000; // Limit history to prevent memory bloat
  }

  /**
   * Record search performance
   */
  recordSearchTime(query, duration, resultCount, categories) {
    const record = {
      timestamp: Date.now(),
      query: this.anonymizeQuery(query),
      duration,
      resultCount,
      categories: categories.slice(), // copy array
      queryLength: query.length,
      wordCount: query.split(/\s+/).length
    };
    
    this.metrics.searchTimes.push(record);
    this.trimArray(this.metrics.searchTimes);
    
    // Track popular queries (anonymized)
    const anonymized = this.anonymizeQuery(query);
    this.metrics.popularQueries.set(
      anonymized,
      (this.metrics.popularQueries.get(anonymized) || 0) + 1
    );
    
    this.metrics.userInteractions.searches++;
  }

  /**
   * Record API response time
   */
  recordApiResponse(apiName, duration, success, errorType = null) {
    if (!this.metrics.apiResponseTimes.has(apiName)) {
      this.metrics.apiResponseTimes.set(apiName, []);
    }
    
    const record = {
      timestamp: Date.now(),
      duration,
      success,
      errorType
    };
    
    this.metrics.apiResponseTimes.get(apiName).push(record);
    this.trimArray(this.metrics.apiResponseTimes.get(apiName));
    
    // Track success rates
    if (!this.metrics.apiSuccessRates.has(apiName)) {
      this.metrics.apiSuccessRates.set(apiName, { successful: 0, failed: 0 });
    }
    
    const rates = this.metrics.apiSuccessRates.get(apiName);
    if (success) {
      rates.successful++;
    } else {
      rates.failed++;
      
      // Track error types
      if (errorType) {
        if (!this.metrics.errorRates.has(errorType)) {
          this.metrics.errorRates.set(errorType, 0);
        }
        this.metrics.errorRates.set(errorType, this.metrics.errorRates.get(errorType) + 1);
      }
    }
  }

  /**
   * Record cache performance
   */
  recordCacheAccess(hit) {
    this.metrics.cachePerformance.totalRequests++;
    if (hit) {
      this.metrics.cachePerformance.hits++;
    } else {
      this.metrics.cachePerformance.misses++;
    }
  }

  /**
   * Record memory usage
   */
  recordMemoryUsage(usage) {
    const record = {
      timestamp: Date.now(),
      ...usage
    };
    
    this.metrics.memoryUsage.push(record);
    this.trimArray(this.metrics.memoryUsage);
  }

  /**
   * Record user interaction
   */
  recordUserInteraction(type, data = {}) {
    switch (type) {
      case 'load_more':
        this.metrics.userInteractions.loadMore++;
        break;
      case 'image_click':
        this.metrics.userInteractions.imageClicks++;
        break;
    }
  }

  /**
   * Record performance timing
   */
  recordTiming(operation, duration, metadata = {}) {
    if (!this.metrics.performanceTimings.has(operation)) {
      this.metrics.performanceTimings.set(operation, []);
    }
    
    const record = {
      timestamp: Date.now(),
      duration,
      ...metadata
    };
    
    this.metrics.performanceTimings.get(operation).push(record);
    this.trimArray(this.metrics.performanceTimings.get(operation));
  }

  /**
   * Anonymize query for privacy
   */
  anonymizeQuery(query) {
    // Replace potential personal info with placeholders
    return query
      .toLowerCase()
      .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[EMAIL]')
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]')
      .trim()
      .substring(0, 50); // Limit length
  }

  /**
   * Trim array to max size
   */
  trimArray(array) {
    if (array.length > this.maxHistorySize) {
      array.splice(0, array.length - this.maxHistorySize);
    }
  }

  /**
   * Get search performance statistics
   */
  getSearchStats() {
    const searches = this.metrics.searchTimes;
    if (searches.length === 0) {
      return { count: 0 };
    }
    
    const durations = searches.map(s => s.duration);
    const resultCounts = searches.map(s => s.resultCount);
    
    return {
      count: searches.length,
      averageDuration: this.average(durations),
      medianDuration: this.median(durations),
      p95Duration: this.percentile(durations, 95),
      averageResults: this.average(resultCounts),
      slowestSearch: Math.max(...durations),
      fastestSearch: Math.min(...durations),
      last24Hours: searches.filter(s => Date.now() - s.timestamp < 24 * 60 * 60 * 1000).length
    };
  }

  /**
   * Get API performance statistics
   */
  getApiStats() {
    const stats = {};
    
    for (const [apiName, responses] of this.metrics.apiResponseTimes) {
      const successRates = this.metrics.apiSuccessRates.get(apiName) || { successful: 0, failed: 0 };
      const durations = responses.map(r => r.duration);
      const successfulDurations = responses.filter(r => r.success).map(r => r.duration);
      
      const total = successRates.successful + successRates.failed;
      const successRate = total > 0 ? (successRates.successful / total * 100) : 0;
      
      stats[apiName] = {
        totalRequests: responses.length,
        successRate: successRate.toFixed(2),
        averageResponseTime: this.average(durations),
        averageSuccessTime: this.average(successfulDurations),
        p95ResponseTime: this.percentile(durations, 95),
        fastestResponse: durations.length > 0 ? Math.min(...durations) : 0,
        slowestResponse: durations.length > 0 ? Math.max(...durations) : 0
      };
    }
    
    return stats;
  }

  /**
   * Get cache performance statistics
   */
  getCacheStats() {
    const cache = this.metrics.cachePerformance;
    const hitRate = cache.totalRequests > 0 ? (cache.hits / cache.totalRequests * 100) : 0;
    
    return {
      hitRate: hitRate.toFixed(2),
      totalRequests: cache.totalRequests,
      hits: cache.hits,
      misses: cache.misses
    };
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const errorTypes = {};
    let totalErrors = 0;
    
    for (const [errorType, count] of this.metrics.errorRates) {
      errorTypes[errorType] = count;
      totalErrors += count;
    }
    
    return {
      totalErrors,
      errorTypes,
      errorRate: this.calculateOverallErrorRate()
    };
  }

  /**
   * Get user interaction statistics
   */
  getUserStats() {
    return {
      ...this.metrics.userInteractions,
      sessionDuration: Date.now() - this.sessionStart,
      averageSearchesPerSession: this.metrics.userInteractions.searches / Math.max(1, (Date.now() - this.sessionStart) / (60 * 60 * 1000))
    };
  }

  /**
   * Get popular queries (anonymized)
   */
  getPopularQueries(limit = 10) {
    return Array.from(this.metrics.popularQueries.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  }

  /**
   * Get comprehensive analytics report
   */
  getAnalyticsReport() {
    return {
      timestamp: Date.now(),
      sessionDuration: Date.now() - this.sessionStart,
      search: this.getSearchStats(),
      apis: this.getApiStats(),
      cache: this.getCacheStats(),
      errors: this.getErrorStats(),
      user: this.getUserStats(),
      popularQueries: this.getPopularQueries(),
      memoryUsage: this.getMemoryStats(),
      performance: this.getPerformanceStats()
    };
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats() {
    const usage = this.metrics.memoryUsage;
    if (usage.length === 0) return { samples: 0 };
    
    const latest = usage[usage.length - 1];
    const trend = usage.length > 1 ? 
      (latest.heapUsed - usage[0].heapUsed) / usage.length : 0;
    
    return {
      samples: usage.length,
      current: latest,
      trend: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
      peakUsage: Math.max(...usage.map(u => u.heapUsed || 0))
    };
  }

  /**
   * Get performance timing statistics
   */
  getPerformanceStats() {
    const stats = {};
    
    for (const [operation, timings] of this.metrics.performanceTimings) {
      const durations = timings.map(t => t.duration);
      
      stats[operation] = {
        count: timings.length,
        average: this.average(durations),
        median: this.median(durations),
        p95: this.percentile(durations, 95),
        min: Math.min(...durations),
        max: Math.max(...durations)
      };
    }
    
    return stats;
  }

  /**
   * Calculate overall error rate
   */
  calculateOverallErrorRate() {
    let totalRequests = 0;
    let totalErrors = 0;
    
    for (const rates of this.metrics.apiSuccessRates.values()) {
      totalRequests += rates.successful + rates.failed;
      totalErrors += rates.failed;
    }
    
    return totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : 0;
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics = {
      searchTimes: [],
      apiResponseTimes: new Map(),
      cachePerformance: { hits: 0, misses: 0, totalRequests: 0 },
      memoryUsage: [],
      errorRates: new Map(),
      userInteractions: { searches: 0, loadMore: 0, imageClicks: 0 },
      popularQueries: new Map(),
      apiSuccessRates: new Map(),
      performanceTimings: new Map()
    };
    this.sessionStart = Date.now();
  }

  // Utility functions
  average(numbers) {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }

  median(numbers) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  percentile(numbers, p) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

/**
 * Telemetry Service - Privacy-first performance monitoring
 */
class TelemetryService {
  constructor() {
    this.metrics = new PerformanceMetrics();
    this.enabled = true;
    this.reportInterval = 60000; // 1 minute
    this.reportTimer = null;
    
    this.startPeriodicReporting();
  }

  /**
   * Start periodic memory and performance monitoring
   */
  startPeriodicReporting() {
    if (this.reportTimer) return;
    
    this.reportTimer = setInterval(() => {
      this.collectSystemMetrics();
    }, this.reportInterval);
  }

  /**
   * Stop periodic reporting
   */
  stopPeriodicReporting() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    if (!this.enabled) return;
    
    try {
      // Memory usage (if available)
      if (performance.memory) {
        this.metrics.recordMemoryUsage({
          heapUsed: performance.memory.usedJSHeapSize,
          heapTotal: performance.memory.totalJSHeapSize,
          heapLimit: performance.memory.jsHeapSizeLimit
        });
      }
    } catch (error) {
      console.warn('[TelemetryService] Error collecting system metrics:', error);
    }
  }

  /**
   * Create a performance timer
   */
  createTimer(operation) {
    const startTime = performance.now();
    
    return {
      end: (metadata = {}) => {
        const duration = performance.now() - startTime;
        this.metrics.recordTiming(operation, duration, metadata);
        return duration;
      }
    };
  }

  /**
   * Record search performance
   */
  recordSearch(query, duration, resultCount, categories) {
    if (!this.enabled) return;
    this.metrics.recordSearchTime(query, duration, resultCount, categories);
  }

  /**
   * Record API call performance
   */
  recordApiCall(apiName, duration, success, errorType = null) {
    if (!this.enabled) return;
    this.metrics.recordApiResponse(apiName, duration, success, errorType);
  }

  /**
   * Record cache access
   */
  recordCacheAccess(hit) {
    if (!this.enabled) return;
    this.metrics.recordCacheAccess(hit);
  }

  /**
   * Record user interaction
   */
  recordUserInteraction(type, data = {}) {
    if (!this.enabled) return;
    this.metrics.recordUserInteraction(type, data);
  }

  /**
   * Get analytics report
   */
  getReport() {
    return this.metrics.getAnalyticsReport();
  }

  /**
   * Enable/disable telemetry
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    if (enabled) {
      this.startPeriodicReporting();
    } else {
      this.stopPeriodicReporting();
    }
  }

  /**
   * Clear all collected data
   */
  clear() {
    this.metrics.clear();
  }

  /**
   * Export data for debugging (anonymized)
   */
  exportData() {
    return {
      report: this.getReport(),
      timestamp: Date.now(),
      version: chrome?.runtime?.getManifest?.()?.version || 'unknown'
    };
  }
}

// Export singleton instance
export const telemetryService = new TelemetryService();
export { PerformanceMetrics };