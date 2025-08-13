// utils/telemetry.js - Local-only performance tracking
export class LocalTelemetry {
    constructor() {
        this.metrics = {
            searchCount: 0,
            apiSuccessRates: {},
            averageResponseTimes: {},
            popularQueries: [],
            errorCounts: {},
            cacheHitRates: {},
            lastReset: Date.now()
        };
        
        this.loadMetrics();
        this.startPeriodicSave();
    }
    
    async loadMetrics() {
        try {
            const stored = await chrome.storage.local.get(['telemetry']);
            if (stored.telemetry) {
                this.metrics = { ...this.metrics, ...stored.telemetry };
            }
        } catch (error) {
            console.warn('[Telemetry] Failed to load metrics:', error);
        }
    }
    
    async saveMetrics() {
        try {
            await chrome.storage.local.set({ telemetry: this.metrics });
        } catch (error) {
            console.warn('[Telemetry] Failed to save metrics:', error);
        }
    }
    
    startPeriodicSave() {
        setInterval(() => {
            this.saveMetrics();
        }, 30000); // Save every 30 seconds
    }
    
    recordSearch(query, sources, responseTime, resultCount = 0) {
        this.metrics.searchCount++;
        
        // Track popular queries (anonymized)
        const queryHash = this.hashQuery(query);
        const existing = this.metrics.popularQueries.find(q => q.hash === queryHash);
        if (existing) {
            existing.count++;
            existing.lastUsed = Date.now();
        } else {
            this.metrics.popularQueries.push({
                hash: queryHash,
                length: query.length,
                count: 1,
                lastUsed: Date.now()
            });
        }
        
        // Keep only top 50 popular queries
        this.metrics.popularQueries.sort((a, b) => b.count - a.count);
        this.metrics.popularQueries = this.metrics.popularQueries.slice(0, 50);
        
        // Track response times per source
        sources.forEach(source => {
            if (!this.metrics.averageResponseTimes[source]) {
                this.metrics.averageResponseTimes[source] = [];
            }
            this.metrics.averageResponseTimes[source].push(responseTime);
            
            // Keep only last 100 measurements
            if (this.metrics.averageResponseTimes[source].length > 100) {
                this.metrics.averageResponseTimes[source].shift();
            }
        });
    }
    
    recordApiCall(source, success, responseTime) {
        if (!this.metrics.apiSuccessRates[source]) {
            this.metrics.apiSuccessRates[source] = { success: 0, total: 0 };
        }
        
        this.metrics.apiSuccessRates[source].total++;
        if (success) {
            this.metrics.apiSuccessRates[source].success++;
        }
        
        if (responseTime) {
            if (!this.metrics.averageResponseTimes[source]) {
                this.metrics.averageResponseTimes[source] = [];
            }
            this.metrics.averageResponseTimes[source].push(responseTime);
        }
    }
    
    recordError(source, errorType) {
        const key = `${source}:${errorType}`;
        this.metrics.errorCounts[key] = (this.metrics.errorCounts[key] || 0) + 1;
    }
    
    recordCacheHit(cacheType, hit) {
        if (!this.metrics.cacheHitRates[cacheType]) {
            this.metrics.cacheHitRates[cacheType] = { hits: 0, total: 0 };
        }
        
        this.metrics.cacheHitRates[cacheType].total++;
        if (hit) {
            this.metrics.cacheHitRates[cacheType].hits++;
        }
    }
    
    getOptimalSources(category) {
        const sources = Object.keys(this.metrics.apiSuccessRates);
        return sources
            .map(source => ({
                source,
                successRate: this.getSuccessRate(source),
                avgResponseTime: this.getAverageResponseTime(source)
            }))
            .filter(s => s.successRate > 0.5) // Only sources with >50% success rate
            .sort((a, b) => {
                // Sort by success rate first, then by response time
                if (Math.abs(a.successRate - b.successRate) > 0.1) {
                    return b.successRate - a.successRate;
                }
                return a.avgResponseTime - b.avgResponseTime;
            });
    }
    
    getSuccessRate(source) {
        const stats = this.metrics.apiSuccessRates[source];
        if (!stats || stats.total === 0) return 0;
        return stats.success / stats.total;
    }
    
    getAverageResponseTime(source) {
        const times = this.metrics.averageResponseTimes[source];
        if (!times || times.length === 0) return Infinity;
        return times.reduce((sum, time) => sum + time, 0) / times.length;
    }
    
    getCacheEfficiency(cacheType) {
        const stats = this.metrics.cacheHitRates[cacheType];
        if (!stats || stats.total === 0) return 0;
        return stats.hits / stats.total;
    }
    
    hashQuery(query) {
        // Simple hash for privacy (not cryptographically secure)
        let hash = 0;
        for (let i = 0; i < query.length; i++) {
            const char = query.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }
    
    getPerformanceReport() {
        return {
            totalSearches: this.metrics.searchCount,
            apiPerformance: Object.keys(this.metrics.apiSuccessRates).map(source => ({
                source,
                successRate: (this.getSuccessRate(source) * 100).toFixed(1) + '%',
                avgResponseTime: this.getAverageResponseTime(source).toFixed(0) + 'ms',
                totalCalls: this.metrics.apiSuccessRates[source].total
            })),
            cachePerformance: Object.keys(this.metrics.cacheHitRates).map(type => ({
                type,
                hitRate: (this.getCacheEfficiency(type) * 100).toFixed(1) + '%',
                totalRequests: this.metrics.cacheHitRates[type].total
            })),
            topErrors: Object.entries(this.metrics.errorCounts)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .map(([error, count]) => ({ error, count })),
            uptime: Math.floor((Date.now() - this.metrics.lastReset) / 1000 / 60) + ' minutes'
        };
    }
    
    reset() {
        this.metrics = {
            searchCount: 0,
            apiSuccessRates: {},
            averageResponseTimes: {},
            popularQueries: [],
            errorCounts: {},
            cacheHitRates: {},
            lastReset: Date.now()
        };
        this.saveMetrics();
    }
}

export const telemetry = new LocalTelemetry();
