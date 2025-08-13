// utils/telemetry.js - Local analytics and monitoring for hiREZZIE
export class Telemetry {
  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
    this.events = [];
    this.metrics = new Map();
    this.timers = new Map();
    this.startTime = Date.now();
    this.sessionId = this._generateSessionId();
  }

  _generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _cleanup() {
    // Keep only recent events to prevent memory bloat
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  // Hash sensitive data (queries) for privacy
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Record an event
  trackEvent(eventType, data = {}) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      data: this._sanitizeData(data)
    };

    this.events.push(event);
    this._cleanup();
    
    // Update metrics
    this._updateMetrics(eventType, data);
    
    console.log(`[Telemetry] ${eventType}:`, data);
  }

  _sanitizeData(data) {
    const sanitized = { ...data };
    
    // Hash sensitive fields
    if (sanitized.query) {
      sanitized.queryHash = this._hashString(sanitized.query);
      delete sanitized.query;
    }
    
    if (sanitized.url && sanitized.url.includes('key=')) {
      sanitized.url = '[URL_WITH_API_KEY]';
    }
    
    return sanitized;
  }

  _updateMetrics(eventType, data) {
    const key = `event.${eventType}`;
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + 1);
    
    // Track specific metrics based on event type
    switch (eventType) {
      case 'search_started':
        this.metrics.set('search.total_searches', (this.metrics.get('search.total_searches') || 0) + 1);
        break;
      case 'search_completed':
        if (data.resultCount) {
          const totalResults = (this.metrics.get('search.total_results') || 0) + data.resultCount;
          this.metrics.set('search.total_results', totalResults);
        }
        break;
      case 'api_error':
        const errorKey = `api.errors.${data.provider || 'unknown'}`;
        this.metrics.set(errorKey, (this.metrics.get(errorKey) || 0) + 1);
        break;
      case 'cache_hit':
      case 'cache_miss':
        const cacheKey = `cache.${eventType.split('_')[1]}s`;
        this.metrics.set(cacheKey, (this.metrics.get(cacheKey) || 0) + 1);
        break;
    }
  }

  // Performance timing methods
  startTimer(label) {
    this.timers.set(label, Date.now());
  }

  endTimer(label) {
    const startTime = this.timers.get(label);
    if (!startTime) {
      console.warn(`[Telemetry] Timer '${label}' was not started`);
      return null;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);
    
    this.trackEvent('performance_timing', {
      label,
      duration,
      category: this._getTimingCategory(label)
    });

    // Update performance metrics
    const perfKey = `perf.${label}`;
    const durations = this.metrics.get(perfKey) || [];
    durations.push(duration);
    
    // Keep only recent measurements
    if (durations.length > 100) {
      durations.splice(0, durations.length - 100);
    }
    
    this.metrics.set(perfKey, durations);
    
    return duration;
  }

  _getTimingCategory(label) {
    if (label.includes('search')) return 'search';
    if (label.includes('api')) return 'api';
    if (label.includes('image')) return 'image';
    if (label.includes('cache')) return 'cache';
    return 'other';
  }

  // Get performance statistics
  getPerformanceStats(category = null) {
    const stats = {};
    
    for (const [key, durations] of this.metrics.entries()) {
      if (!key.startsWith('perf.') || !Array.isArray(durations)) continue;
      
      const label = key.replace('perf.', '');
      const labelCategory = this._getTimingCategory(label);
      
      if (category && labelCategory !== category) continue;
      
      if (durations.length > 0) {
        const sorted = [...durations].sort((a, b) => a - b);
        stats[label] = {
          count: durations.length,
          avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
          min: sorted[0],
          max: sorted[sorted.length - 1],
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)]
        };
      }
    }
    
    return stats;
  }

  // Memory usage tracking
  trackMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
      const memory = {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024), // MB
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024), // MB
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024) // MB
      };
      
      this.trackEvent('memory_usage', memory);
      return memory;
    }
    return null;
  }

  // Search-specific tracking
  trackSearch(query, mode, sources = []) {
    this.startTimer('search_total');
    this.trackEvent('search_started', {
      queryLength: query.length,
      mode,
      sourceCount: sources.length,
      sources
    });
  }

  trackSearchComplete(resultCount, sources, duration) {
    this.endTimer('search_total');
    this.trackEvent('search_completed', {
      resultCount,
      sourceCount: sources.length,
      sources,
      duration
    });
  }

  trackApiCall(provider, endpoint, success, duration, statusCode) {
    this.trackEvent(success ? 'api_success' : 'api_error', {
      provider,
      endpoint,
      duration,
      statusCode
    });
  }

  trackCacheOperation(operation, hit, provider = null) {
    this.trackEvent(hit ? 'cache_hit' : 'cache_miss', {
      operation,
      provider
    });
  }

  trackImageLoad(url, success, loadTime, fileSize = null) {
    this.trackEvent('image_load', {
      urlHash: this._hashString(url),
      success,
      loadTime,
      fileSize
    });
  }

  // Get analytics summary
  getAnalytics() {
    const now = Date.now();
    const sessionDuration = now - this.startTime;
    
    return {
      session: {
        id: this.sessionId,
        startTime: this.startTime,
        duration: sessionDuration,
        eventCount: this.events.length
      },
      metrics: Object.fromEntries(this.metrics.entries()),
      performance: this.getPerformanceStats(),
      recentEvents: this.events.slice(-50) // Last 50 events
    };
  }

  // Get specific search analytics
  getSearchAnalytics() {
    const searchEvents = this.events.filter(e => e.type.includes('search'));
    const totalSearches = this.metrics.get('search.total_searches') || 0;
    const totalResults = this.metrics.get('search.total_results') || 0;
    
    const perfStats = this.getPerformanceStats('search');
    
    return {
      totalSearches,
      totalResults,
      avgResultsPerSearch: totalSearches > 0 ? Math.round(totalResults / totalSearches) : 0,
      recentSearches: searchEvents.slice(-20),
      performance: perfStats
    };
  }

  // Get API health analytics
  getApiAnalytics() {
    const apiEvents = this.events.filter(e => e.type.includes('api'));
    const apiMetrics = {};
    
    for (const [key, value] of this.metrics.entries()) {
      if (key.startsWith('api.') || key.startsWith('event.api_')) {
        apiMetrics[key] = value;
      }
    }
    
    const perfStats = this.getPerformanceStats('api');
    
    return {
      metrics: apiMetrics,
      performance: perfStats,
      recentApiCalls: apiEvents.slice(-50)
    };
  }

  // Clear old data
  clearData(keepRecentHours = 24) {
    const cutoff = Date.now() - (keepRecentHours * 60 * 60 * 1000);
    this.events = this.events.filter(e => e.timestamp > cutoff);
    
    // Reset metrics
    this.metrics.clear();
    
    console.log(`[Telemetry] Cleared data older than ${keepRecentHours} hours`);
  }

  // Export anonymized data for debugging
  exportData() {
    return {
      version: '1.0',
      sessionId: this.sessionId,
      exportTime: Date.now(),
      analytics: this.getAnalytics()
    };
  }
}

// Global telemetry instance
export const telemetry = new Telemetry();

// Convenience functions
export function trackSearch(query, mode, sources) {
  telemetry.trackSearch(query, mode, sources);
}

export function trackSearchComplete(resultCount, sources, duration) {
  telemetry.trackSearchComplete(resultCount, sources, duration);
}

export function trackApiCall(provider, endpoint, success, duration, statusCode) {
  telemetry.trackApiCall(provider, endpoint, success, duration, statusCode);
}

export function trackPerformance(label, fn) {
  return async (...args) => {
    telemetry.startTimer(label);
    try {
      const result = await fn(...args);
      telemetry.endTimer(label);
      return result;
    } catch (error) {
      telemetry.endTimer(label);
      throw error;
    }
  };
}

// Performance monitoring decorator
export function monitored(provider, endpoint) {
  return function(target, propertyName, descriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function(...args) {
      const startTime = Date.now();
      telemetry.startTimer(`api_${provider}_${endpoint}`);
      
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - startTime;
        telemetry.trackApiCall(provider, endpoint, true, duration, 200);
        telemetry.endTimer(`api_${provider}_${endpoint}`);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const statusCode = error.status || error.statusCode || 500;
        telemetry.trackApiCall(provider, endpoint, false, duration, statusCode);
        telemetry.endTimer(`api_${provider}_${endpoint}`);
        throw error;
      }
    };
    
    return descriptor;
  };
}