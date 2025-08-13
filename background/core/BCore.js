// background/core/BCore.js
import * as BSearch from './BSearch.js';
import { getSettings } from '../utils/BSettings.js';
import { fetchOpenGraphData } from '../utils/BUtils.js';
import { cacheService } from '../services/CacheService.js';
import { rateLimiter } from '../services/RateLimiter.js';
import { circuitBreakerManager } from '../services/CircuitBreaker.js';
import { telemetryService } from '../services/TelemetryService.js';
import { getApiConfig, getFeatureFlag, getEnvironmentConfig } from '../config/apiConfig.js';
import { errorBoundary } from '../../utils/ErrorBoundary.js';

let settings;
let settingsReadyPromise;
let isInitialized = false;
let activeCancellationTokens = new Map();

// Initialize settings and services when the extension starts
async function initialize() {
    try {
        console.log('[BCore] Initializing services...');
        
        // Load settings
        settings = await getSettings();
        
        // Initialize telemetry
        const envConfig = getEnvironmentConfig();
        telemetryService.setEnabled(getFeatureFlag('enableLocalTelemetry'));
        
        // Initialize rate limiters for each API
        const apis = Object.keys(settings.apiKeys || {});
        for (const apiName of apis) {
            const config = getApiConfig(apiName);
            if (config && getFeatureFlag('enableRateLimiting')) {
                rateLimiter.createLimiter(apiName, config.rateLimit);
            }
        }
        
        // Initialize result cache
        const resultsCache = cacheService.getResultsCache();
        
        // Setup cleanup intervals
        setupCleanupIntervals();
        
        // Setup lifecycle listeners
        setupLifecycleListeners();
        
        isInitialized = true;
        console.log('[BCore] Services initialized successfully.');
        
    } catch (error) {
        console.error('[BCore] Initialization failed:', error);
        throw error;
    }
}

// Kick off services initialization and store the promise so listeners can await readiness
settingsReadyPromise = initialize();

// Setup periodic cleanup and resource management
function setupCleanupIntervals() {
    // Clean up expired cache entries every 5 minutes
    setInterval(() => {
        if (getFeatureFlag('enableResultCaching')) {
            const cleaned = cacheService.cleanupAll();
            if (cleaned > 0) {
                console.log(`[BCore] Cleaned up ${cleaned} expired cache entries`);
            }
        }
    }, 5 * 60 * 1000);

    // Collect telemetry data every minute
    setInterval(() => {
        if (getFeatureFlag('enablePerformanceMonitoring')) {
            telemetryService.collectSystemMetrics();
        }
    }, 60 * 1000);
}

// Setup service worker lifecycle listeners
function setupLifecycleListeners() {
    // Handle service worker installation
    self.addEventListener('install', (event) => {
        console.log('[BCore] Service worker installing...');
        event.waitUntil(self.skipWaiting());
    });

    // Handle service worker activation
    self.addEventListener('activate', (event) => {
        console.log('[BCore] Service worker activating...');
        event.waitUntil(self.clients.claim());
    });

    // Handle service worker suspension (cleanup)
    self.addEventListener('beforeunload', () => {
        console.log('[BCore] Service worker suspending, cleaning up...');
        cleanup();
    });
}

// Cleanup function for resource management
function cleanup() {
    try {
        // Cancel any active operations
        for (const [id, token] of activeCancellationTokens) {
            if (token.abort) token.abort();
        }
        activeCancellationTokens.clear();

        // Clear caches if configured
        const envConfig = getEnvironmentConfig();
        if (envConfig.clearCacheOnSuspend) {
            cacheService.clearAll();
        }

        console.log('[BCore] Cleanup completed');
    } catch (error) {
        console.error('[BCore] Error during cleanup:', error);
    }
}

// Create cancellation token for operations
function createCancellationToken() {
    const controller = new AbortController();
    const tokenId = `token_${Date.now()}_${Math.random()}`;
    activeCancellationTokens.set(tokenId, controller);
    
    return {
        signal: controller.signal,
        abort: () => {
            controller.abort();
            activeCancellationTokens.delete(tokenId);
        }
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ensure services are initialized
    if (!isInitialized) {
        console.warn('[BCore] Services not initialized yet; awaiting readyPromise.');
        settingsReadyPromise.then(() => {
            // Re-dispatch internally after initialization
            handleMessage(message, sender, sendResponse);
        }).catch(error => {
            console.error('[BCore] Initialization failed:', error);
            sendResponse({ error: 'Service initialization failed' });
        });
        return true; // keep the sendResponse alive
    }
    
    return handleMessage(message, sender, sendResponse);
});

// Centralized message handling with error boundaries
function handleMessage(message, sender, sendResponse) {
    const wrappedHandler = errorBoundary.wrap(async () => {
        // Cancel any previous operations for the same tab if it's a new search
        if (message.action === 'search' && sender.tab?.id) {
            const tabId = sender.tab.id;
            for (const [id, token] of activeCancellationTokens) {
                if (id.includes(`tab_${tabId}`)) {
                    token.abort();
                }
            }
        }

        switch (message.action) {
            case 'search':
                return await handleSearch(message, sendResponse, sender);
            case 'search_stream':
                return await handleSearchStream(message, sendResponse, sender);
            case 'load_more':
                return await handleLoadMore(message, sendResponse, sender);
            case 'fetch_og_data':
                return await handleFetchOgData(message, sendResponse);
            case 'test_ai_connection':
                return await handleTestAIConnection(sendResponse);
            case 'get_performance_stats':
                return await handleGetPerformanceStats(sendResponse);
            case 'get_cache_stats':
                return await handleGetCacheStats(sendResponse);
            case 'clear_cache':
                return await handleClearCache(sendResponse);
            default:
                console.warn('[BCore] Unknown message action:', message.action);
                return { error: 'Unknown action' };
        }
    }, {
        id: `message_${message.action}_${Date.now()}`,
        returnType: 'object',
        fallback: () => ({ error: 'Operation failed' })
    });

    wrappedHandler().then(result => {
        sendResponse(result);
    }).catch(error => {
        console.error('[BCore] Message handler error:', error);
        sendResponse({ error: error.message || 'Unknown error' });
    });

    return true; // Indicates that the response is sent asynchronously
}

async function handleSearch(message, sendResponse, sender) {
    const timer = telemetryService.createTimer('search_operation');
    const cancellationToken = createCancellationToken();
    
    try {
        console.log('[BCore] Starting search for:', message.query, 'categories:', message.categories);
        
        // Check cache first if enabled
        const cacheKey = `search:${message.query}:${JSON.stringify(message.categories)}:${JSON.stringify(message.options || {})}`;
        const resultsCache = cacheService.getResultsCache();
        
        if (getFeatureFlag('enableResultCaching')) {
            const cachedResults = resultsCache.get(cacheKey);
            if (cachedResults) {
                console.log('[BCore] Returning cached results');
                telemetryService.recordCacheAccess(true);
                timer.end({ cached: true, resultCount: Object.keys(cachedResults.data || {}).length });
                telemetryService.recordSearch(message.query, timer.duration, Object.keys(cachedResults.data || {}).length, message.categories);
                return { data: cachedResults.data, cached: true };
            }
            telemetryService.recordCacheAccess(false);
        }

        // Perform search with new services integration
        const searchOptions = {
            ...message.options,
            cancellationSignal: cancellationToken.signal,
            enableCircuitBreaker: getFeatureFlag('enableCircuitBreaker'),
            enableRateLimiting: getFeatureFlag('enableRateLimiting')
        };

        const results = await BSearch.performSearch(
            message.query, 
            message.categories, 
            settings, 
            0, 
            searchOptions
        );
        
        console.log('[BCore] Search completed, results:', results);
        
        // Cache results if enabled
        if (getFeatureFlag('enableResultCaching')) {
            resultsCache.set(cacheKey, { data: results }, getFeatureFlag('cacheExpirationMinutes') * 60 * 1000);
        }
        
        const duration = timer.end({ 
            cached: false, 
            resultCount: Object.keys(results || {}).length,
            categories: message.categories 
        });
        
        // Record telemetry
        telemetryService.recordSearch(message.query, duration, Object.keys(results || {}).length, message.categories);
        
        return { data: results };
        
    } catch (error) {
        console.error('[BCore] Search failed:', error);
        timer.end({ success: false, error: error.message });
        
        // Try to get fallback results from cache
        if (getFeatureFlag('enableResultCaching')) {
            const fallbackKey = `search:${message.query}:${JSON.stringify(message.categories)}`;
            const fallbackResults = resultsCache.get(fallbackKey);
            if (fallbackResults) {
                console.log('[BCore] Returning fallback cached results');
                return { data: fallbackResults.data, fallback: true };
            }
        }
        
        throw error;
    } finally {
        activeCancellationTokens.delete(cancellationToken.id);
    }
}

async function handleLoadMore(message, sendResponse, sender) {
    const timer = telemetryService.createTimer('load_more_operation');
    
    try {
        console.log('[BCore] Loading more for category:', message.category, 'offset:', message.offset);
        
        const results = await BSearch.loadMoreResults(
            message.query, 
            message.category, 
            settings, 
            message.offset
        );
        
        console.log('[BCore] Load more completed, results:', results);
        
        timer.end({ 
            success: true, 
            category: message.category, 
            offset: message.offset,
            resultCount: results.length 
        });
        
        telemetryService.recordUserInteraction('load_more', {
            category: message.category,
            offset: message.offset,
            resultCount: results.length
        });
        
        return { data: results };
        
    } catch (error) {
        console.error('[BCore] Load more failed:', error);
        timer.end({ success: false, error: error.message });
        throw error;
    }
}

async function handleFetchOgData(message, sendResponse) {
    const timer = telemetryService.createTimer('og_data_fetch');
    
    try {
        // Check cache first
        const imageCache = cacheService.getImageCache();
        const cacheKey = `og:${message.url}`;
        
        if (getFeatureFlag('enableResultCaching')) {
            const cachedData = imageCache.get(cacheKey);
            if (cachedData) {
                telemetryService.recordCacheAccess(true);
                timer.end({ cached: true });
                return { success: true, data: cachedData, cached: true };
            }
            telemetryService.recordCacheAccess(false);
        }

        const ogData = await fetchOpenGraphData(message.url);
        
        // Cache the result
        if (getFeatureFlag('enableResultCaching')) {
            imageCache.set(cacheKey, ogData, 30 * 60 * 1000); // 30 minutes
        }
        
        timer.end({ success: true, cached: false, hasImage: !!ogData.image });
        
        return { success: true, data: ogData };
        
    } catch (error) {
        console.error(`[BCore] Failed to fetch OG data for ${message.url}:`, error);
        timer.end({ success: false, error: error.message });
        return { success: false, error: error.message };
    }
}

// Streaming variant: sends partial batches back to the caller incrementally
async function handleSearchStream(message, sendResponse, sender) {
    try {
        const { query, categories } = message;
        console.log('[BCore] Streaming search for:', query, 'categories:', categories);
        
        // Kick off the search but do not await; we will stream via chrome.runtime ports
        const port = chrome.tabs.connect(message.tabId || sender?.tab?.id, { name: 'searchStream' });
        
        (async () => {
            for (const category of categories) {
                try {
                    const batch = await BSearch.performSearch(query, [category], settings, 0);
                    port.postMessage({ category, data: batch[category] || [] });
                } catch (error) {
                    port.postMessage({ category, error: error.message });
                }
            }
            port.postMessage({ done: true });
            port.disconnect();
        })();
        
        return { ok: true };
    } catch (error) {
        console.error('[BCore] Streaming search failed:', error);
        return { error: error.message };
    }
}

async function handleTestAIConnection(sendResponse) {
    // For now, return that AI is not available
    return { connected: false, reason: 'AI not configured' };
}

// New handlers for service management
async function handleGetPerformanceStats(sendResponse) {
    try {
        const report = telemetryService.getReport();
        const circuitStats = circuitBreakerManager.getAllStatus();
        const rateStats = rateLimiter.getStats();
        
        return {
            success: true,
            data: {
                telemetry: report,
                circuits: circuitStats,
                rateLimits: rateStats,
                timestamp: Date.now()
            }
        };
    } catch (error) {
        console.error('[BCore] Failed to get performance stats:', error);
        return { success: false, error: error.message };
    }
}

async function handleGetCacheStats(sendResponse) {
    try {
        const stats = cacheService.getAllStats();
        return { success: true, data: stats };
    } catch (error) {
        console.error('[BCore] Failed to get cache stats:', error);
        return { success: false, error: error.message };
    }
}

async function handleClearCache(sendResponse) {
    try {
        cacheService.clearAll();
        telemetryService.clear();
        return { success: true, message: 'All caches cleared' };
    } catch (error) {
        console.error('[BCore] Failed to clear cache:', error);
        return { success: false, error: error.message };
    }
}
