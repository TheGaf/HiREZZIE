// utils/PerformanceMonitor.js
/**
 * Performance monitoring utility for tracking and optimizing performance
 */

class PerformanceMonitor {
  constructor(options = {}) {
    this.options = {
      enabled: true,
      sampleRate: 1.0, // Sample 100% of operations by default
      maxMetrics: 1000,
      reportInterval: 30000, // 30 seconds
      ...options
    };

    this.metrics = new Map();
    this.timers = new Map();
    this.observers = new Map();
    this.reportTimer = null;
    this.listeners = new Set();

    if (this.options.enabled) {
      this.init();
    }
  }

  /**
   * Initialize performance monitoring
   */
  init() {
    this.setupPerformanceObserver();
    this.startReporting();
    this.monitorMemory();
  }

  /**
   * Setup Performance Observer for various metrics
   */
  setupPerformanceObserver() {
    if (!('PerformanceObserver' in window)) return;

    // Monitor navigation timing
    this.observeMetric('navigation', ['navigation']);
    
    // Monitor resource loading
    this.observeMetric('resource', ['resource']);
    
    // Monitor paint timing
    this.observeMetric('paint', ['paint']);
    
    // Monitor largest contentful paint
    this.observeMetric('largest-contentful-paint', ['largest-contentful-paint']);
    
    // Monitor first input delay
    this.observeMetric('first-input', ['first-input']);
    
    // Monitor layout shift
    this.observeMetric('layout-shift', ['layout-shift']);
  }

  /**
   * Observe specific performance metric
   */
  observeMetric(name, entryTypes) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordMetric(name, entry);
        }
      });

      observer.observe({ entryTypes });
      this.observers.set(name, observer);
    } catch (error) {
      console.warn(`[PerformanceMonitor] Failed to observe ${name}:`, error);
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(category, data) {
    if (!this.shouldSample()) return;

    if (!this.metrics.has(category)) {
      this.metrics.set(category, []);
    }

    const metrics = this.metrics.get(category);
    const timestamp = performance.now();

    // Process different types of metrics
    let metric;
    if (data instanceof PerformanceEntry) {
      metric = this.processPerformanceEntry(data);
    } else {
      metric = { ...data, timestamp };
    }

    metrics.push(metric);

    // Limit metrics size
    if (metrics.length > this.options.maxMetrics) {
      metrics.splice(0, metrics.length - this.options.maxMetrics);
    }

    this.notifyListeners(category, metric);
  }

  /**
   * Process PerformanceEntry into metric object
   */
  processPerformanceEntry(entry) {
    const base = {
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
      timestamp: Date.now()
    };

    // Add specific properties based on entry type
    switch (entry.entryType) {
      case 'navigation':
        return {
          ...base,
          domContentLoaded: entry.domContentLoadedEventEnd - entry.domContentLoadedEventStart,
          loadComplete: entry.loadEventEnd - entry.loadEventStart,
          domInteractive: entry.domInteractive - entry.navigationStart,
          firstPaint: entry.fetchStart - entry.navigationStart
        };

      case 'resource':
        return {
          ...base,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          initiatorType: entry.initiatorType,
          redirectTime: entry.redirectEnd - entry.redirectStart,
          dnsTime: entry.domainLookupEnd - entry.domainLookupStart,
          connectTime: entry.connectEnd - entry.connectStart,
          requestTime: entry.responseStart - entry.requestStart,
          responseTime: entry.responseEnd - entry.responseStart
        };

      case 'paint':
        return {
          ...base,
          paintType: entry.name
        };

      case 'largest-contentful-paint':
        return {
          ...base,
          renderTime: entry.renderTime,
          loadTime: entry.loadTime,
          size: entry.size,
          elementType: entry.element?.tagName
        };

      case 'first-input':
        return {
          ...base,
          processingStart: entry.processingStart,
          processingEnd: entry.processingEnd,
          inputDelay: entry.processingStart - entry.startTime
        };

      case 'layout-shift':
        return {
          ...base,
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          lastInputTime: entry.lastInputTime
        };

      default:
        return base;
    }
  }

  /**
   * Start a performance timer
   */
  startTimer(name, metadata = {}) {
    if (!this.shouldSample()) return null;

    const timer = {
      name,
      startTime: performance.now(),
      startTimestamp: Date.now(),
      metadata
    };

    this.timers.set(name, timer);
    return timer;
  }

  /**
   * End a performance timer
   */
  endTimer(name, additionalMetadata = {}) {
    const timer = this.timers.get(name);
    if (!timer) return null;

    const endTime = performance.now();
    const duration = endTime - timer.startTime;

    const metric = {
      name: timer.name,
      duration,
      startTime: timer.startTime,
      endTime,
      timestamp: timer.startTimestamp,
      ...timer.metadata,
      ...additionalMetadata
    };

    this.recordMetric('timer', metric);
    this.timers.delete(name);

    return metric;
  }

  /**
   * Create a timer wrapper function
   */
  timeFunction(name, fn, metadata = {}) {
    return async (...args) => {
      const timer = this.startTimer(name, metadata);
      try {
        const result = await fn(...args);
        this.endTimer(name, { success: true });
        return result;
      } catch (error) {
        this.endTimer(name, { success: false, error: error.message });
        throw error;
      }
    };
  }

  /**
   * Monitor memory usage
   */
  monitorMemory() {
    if (!performance.memory) return;

    const recordMemory = () => {
      const memory = {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        timestamp: Date.now()
      };

      this.recordMetric('memory', memory);
    };

    // Record initial memory
    recordMemory();

    // Record memory periodically
    setInterval(recordMemory, 10000); // Every 10 seconds
  }

  /**
   * Start periodic reporting
   */
  startReporting() {
    if (this.reportTimer) return;

    this.reportTimer = setInterval(() => {
      this.generateReport();
    }, this.options.reportInterval);
  }

  /**
   * Stop periodic reporting
   */
  stopReporting() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  /**
   * Generate performance report
   */
  generateReport() {
    const report = {
      timestamp: Date.now(),
      metrics: this.getMetricsSummary(),
      vitals: this.getCoreWebVitals(),
      resources: this.getResourceMetrics(),
      memory: this.getMemoryMetrics(),
      customTimers: this.getTimerMetrics()
    };

    this.notifyListeners('report', report);
    return report;
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary() {
    const summary = {};

    for (const [category, metrics] of this.metrics) {
      if (metrics.length === 0) continue;

      const durations = metrics
        .filter(m => typeof m.duration === 'number')
        .map(m => m.duration);

      if (durations.length > 0) {
        summary[category] = {
          count: metrics.length,
          avgDuration: this.average(durations),
          medianDuration: this.median(durations),
          p95Duration: this.percentile(durations, 95),
          minDuration: Math.min(...durations),
          maxDuration: Math.max(...durations)
        };
      } else {
        summary[category] = {
          count: metrics.length
        };
      }
    }

    return summary;
  }

  /**
   * Get Core Web Vitals
   */
  getCoreWebVitals() {
    const vitals = {};

    // Largest Contentful Paint (LCP)
    const lcpMetrics = this.metrics.get('largest-contentful-paint') || [];
    if (lcpMetrics.length > 0) {
      const latestLCP = lcpMetrics[lcpMetrics.length - 1];
      vitals.lcp = {
        value: latestLCP.startTime,
        rating: this.getLCPRating(latestLCP.startTime)
      };
    }

    // First Input Delay (FID)
    const fidMetrics = this.metrics.get('first-input') || [];
    if (fidMetrics.length > 0) {
      const avgInputDelay = this.average(fidMetrics.map(m => m.inputDelay));
      vitals.fid = {
        value: avgInputDelay,
        rating: this.getFIDRating(avgInputDelay)
      };
    }

    // Cumulative Layout Shift (CLS)
    const clsMetrics = this.metrics.get('layout-shift') || [];
    if (clsMetrics.length > 0) {
      const totalCLS = clsMetrics.reduce((sum, m) => sum + (m.value || 0), 0);
      vitals.cls = {
        value: totalCLS,
        rating: this.getCLSRating(totalCLS)
      };
    }

    return vitals;
  }

  /**
   * Get resource loading metrics
   */
  getResourceMetrics() {
    const resourceMetrics = this.metrics.get('resource') || [];
    
    const byType = {};
    let totalSize = 0;
    let totalDuration = 0;

    resourceMetrics.forEach(metric => {
      const type = metric.initiatorType || 'other';
      if (!byType[type]) {
        byType[type] = {
          count: 0,
          totalSize: 0,
          totalDuration: 0,
          avgDuration: 0
        };
      }

      byType[type].count++;
      byType[type].totalSize += metric.transferSize || 0;
      byType[type].totalDuration += metric.duration || 0;
      
      totalSize += metric.transferSize || 0;
      totalDuration += metric.duration || 0;
    });

    // Calculate averages
    Object.values(byType).forEach(type => {
      type.avgDuration = type.count > 0 ? type.totalDuration / type.count : 0;
    });

    return {
      totalResources: resourceMetrics.length,
      totalSize,
      avgDuration: resourceMetrics.length > 0 ? totalDuration / resourceMetrics.length : 0,
      byType
    };
  }

  /**
   * Get memory metrics
   */
  getMemoryMetrics() {
    const memoryMetrics = this.metrics.get('memory') || [];
    if (memoryMetrics.length === 0) return null;

    const latest = memoryMetrics[memoryMetrics.length - 1];
    const usedHeap = memoryMetrics.map(m => m.usedJSHeapSize);

    return {
      current: latest,
      peak: Math.max(...usedHeap),
      average: this.average(usedHeap),
      trend: this.calculateTrend(usedHeap)
    };
  }

  /**
   * Get custom timer metrics
   */
  getTimerMetrics() {
    const timerMetrics = this.metrics.get('timer') || [];
    const byName = {};

    timerMetrics.forEach(metric => {
      if (!byName[metric.name]) {
        byName[metric.name] = [];
      }
      byName[metric.name].push(metric.duration);
    });

    const summary = {};
    Object.entries(byName).forEach(([name, durations]) => {
      summary[name] = {
        count: durations.length,
        avgDuration: this.average(durations),
        medianDuration: this.median(durations),
        p95Duration: this.percentile(durations, 95)
      };
    });

    return summary;
  }

  /**
   * Get LCP rating
   */
  getLCPRating(value) {
    if (value <= 2500) return 'good';
    if (value <= 4000) return 'needs-improvement';
    return 'poor';
  }

  /**
   * Get FID rating
   */
  getFIDRating(value) {
    if (value <= 100) return 'good';
    if (value <= 300) return 'needs-improvement';
    return 'poor';
  }

  /**
   * Get CLS rating
   */
  getCLSRating(value) {
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs-improvement';
    return 'poor';
  }

  /**
   * Add performance listener
   */
  addListener(callback) {
    this.listeners.add(callback);
  }

  /**
   * Remove performance listener
   */
  removeListener(callback) {
    this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners(type, data) {
    this.listeners.forEach(callback => {
      try {
        callback(type, data);
      } catch (error) {
        console.warn('[PerformanceMonitor] Listener error:', error);
      }
    });
  }

  /**
   * Check if metric should be sampled
   */
  shouldSample() {
    return Math.random() < this.options.sampleRate;
  }

  /**
   * Calculate average
   */
  average(numbers) {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }

  /**
   * Calculate median
   */
  median(numbers) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * Calculate percentile
   */
  percentile(numbers, p) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Calculate trend
   */
  calculateTrend(values) {
    if (values.length < 2) return 'stable';
    
    const first = values.slice(0, Math.floor(values.length / 2));
    const second = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = this.average(first);
    const secondAvg = this.average(second);
    
    const change = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    if (Math.abs(change) < 5) return 'stable';
    return change > 0 ? 'increasing' : 'decreasing';
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
    this.timers.clear();
  }

  /**
   * Destroy the monitor
   */
  destroy() {
    this.stopReporting();
    
    // Disconnect observers
    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();
    
    this.clear();
    this.listeners.clear();
  }
}

export { PerformanceMonitor };