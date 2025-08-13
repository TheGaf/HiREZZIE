// background/core/BCore.js - Enhanced with performance optimizations
import * as BSearch from './BSearch.js';
import { getSettings } from '../utils/BSettings.js';
import { fetchOpenGraphData } from '../utils/BUtils.js';
import { telemetry } from '../../utils/telemetry.js';
import { searchCache, clearAllCaches } from '../../utils/cache.js';
import { rateLimiters } from '../../utils/rateLimiter.js';
import { circuitBreakers } from '../../utils/circuitBreaker.js';

let settings;
let settingsReadyPromise;
let activeRequests = new Map(); // Track active requests for cancellation
let serviceWorkerState = 'starting';
let lastActivity = Date.now();

// Initialize settings and performance monitoring when the extension starts
async function initialize() {
    try {
        serviceWorkerState = 'initializing';
        telemetry.trackEvent('service_worker_start', { 
            version: chrome.runtime.getManifest().version,
            timestamp: Date.now()
        });

        settings = await getSettings();
        
        // Initialize performance monitoring
        await initializePerformanceMonitoring();
        
        serviceWorkerState = 'ready';
        telemetry.trackEvent('service_worker_ready', { 
            initializationTime: Date.now() - telemetry.startTime
        });
        
        console.log('[BCore] Settings and performance monitoring initialized.');
    } catch (error) {
        serviceWorkerState = 'error';
        telemetry.trackEvent('service_worker_error', { 
            error: error.message,
            stage: 'initialization'
        });
        console.error('[BCore] Initialization failed:', error);
        throw error;
    }
}

// Performance monitoring setup
async function initializePerformanceMonitoring() {
    // Set up periodic memory monitoring
    setInterval(() => {
        telemetry.trackMemoryUsage();
        updateLastActivity();
    }, 30000); // Every 30 seconds

    // Set up cache cleanup
    setInterval(() => {
        if (Date.now() - lastActivity > 300000) { // 5 minutes idle
            performMaintenanceTasks();
        }
    }, 60000); // Check every minute

    // Log initial performance state
    telemetry.trackEvent('performance_monitoring_started', {
        cacheStatus: searchCache.getStats(),
        rateLimiterStatus: rateLimiters.getStats(),
        circuitBreakerHealth: circuitBreakers.getHealth()
    });
}

// Maintenance tasks for idle periods
function performMaintenanceTasks() {
    try {
        // Clear expired cache entries
        const initialCacheSize = searchCache.size();
        
        // Rate limiter and circuit breaker reset if needed
        const rateLimiterStats = rateLimiters.getStats();
        const circuitBreakerHealth = circuitBreakers.getHealth();
        
        telemetry.trackEvent('maintenance_cycle', {
            cacheSize: initialCacheSize,
            rateLimiterStats,
            circuitBreakerHealth: circuitBreakerHealth.healthPercentage
        });
        
        console.log('[BCore] Maintenance cycle completed');
    } catch (error) {
        console.error('[BCore] Maintenance cycle failed:', error);
    }
}

function updateLastActivity() {
    lastActivity = Date.now();
}

// Kick off settings load and store the promise so listeners can await readiness
settingsReadyPromise = initialize();

// Enhanced message listener with performance tracking and request management
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    updateLastActivity();
    const requestId = generateRequestId();
    telemetry.trackEvent('message_received', { 
        action: message.action,
        requestId,
        tabId: sender?.tab?.id
    });

    if (!settings) {
        console.warn('[BCore] Settings not initialized yet; awaiting readyPromise.');
        settingsReadyPromise.then(() => {
            // Re-dispatch internally after settings load
            handleMessageAction(message, sendResponse, requestId);
        }).catch(error => {
            telemetry.trackEvent('message_error', { 
                action: message.action,
                requestId,
                error: error.message,
                stage: 'settings_wait'
            });
            sendResponse({ error: 'Settings initialization failed' });
        });
        return true; // keep the sendResponse alive
    }
    
    handleMessageAction(message, sendResponse, requestId);
    return true; // Indicates that the response is sent asynchronously
});

function handleMessageAction(message, sendResponse, requestId) {
    // Track active request
    activeRequests.set(requestId, {
        action: message.action,
        startTime: Date.now(),
        sendResponse
    });

    switch (message.action) {
        case 'search':
            handleSearch(message, sendResponse, requestId);
            break;
        case 'search_stream':
            handleSearchStream(message, sendResponse, requestId);
            break;
        case 'load_more':
            handleLoadMore(message, sendResponse, requestId);
            break;
        case 'fetch_og_data':
            handleFetchOgData(message, sendResponse, requestId);
            break;
        case 'test_ai_connection':
            handleTestAIConnection(sendResponse, requestId);
            break;
        case 'get_performance_stats':
            handleGetPerformanceStats(sendResponse, requestId);
            break;
        case 'clear_cache':
            handleClearCache(sendResponse, requestId);
            break;
        case 'cancel_request':
            handleCancelRequest(message, sendResponse, requestId);
            break;
        default:
            console.warn('[BCore] Unknown message action:', message.action);
            telemetry.trackEvent('message_unknown_action', { 
                action: message.action,
                requestId
            });
            sendResponse({ error: 'Unknown action' });
            activeRequests.delete(requestId);
    }
}

function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function completeRequest(requestId, success = true, error = null) {
    const request = activeRequests.get(requestId);
    if (request) {
        const duration = Date.now() - request.startTime;
        telemetry.trackEvent('request_completed', {
            action: request.action,
            requestId,
            duration,
            success,
            error: error?.message
        });
        activeRequests.delete(requestId);
    }
}

// Enhanced search handler with caching and performance monitoring
async function handleSearch(message, sendResponse, requestId) {
    const startTime = Date.now();
    telemetry.startTimer(`search_${requestId}`);
    
    try {
        const { query, categories, options = {} } = message;
        console.log('[BCore] Starting search for:', query, 'categories:', categories);
        
        telemetry.trackSearch(query, options.sortMode || 'recent', categories);

        // Check cache first
        const cacheKey = searchCache.constructor.getSearchKey(
            query, 
            categories.join(','), 
            0, 
            options.sortMode || 'recent'
        );
        
        const cachedResult = searchCache.get(cacheKey);
        if (cachedResult && !options.skipCache) {
            telemetry.trackCacheOperation('search', true);
            telemetry.endTimer(`search_${requestId}`);
            
            console.log('[BCore] Returning cached search results');
            sendResponse({ data: cachedResult, fromCache: true });
            completeRequest(requestId, true);
            return;
        }

        telemetry.trackCacheOperation('search', false);

        // Perform search with timeout
        const searchPromise = BSearch.performSearch(query, categories, settings, 0, options);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Search timeout')), 30000)
        );

        const results = await Promise.race([searchPromise, timeoutPromise]);
        
        // Cache successful results
        if (results && Object.keys(results).length > 0) {
            searchCache.set(cacheKey, results, 600000); // 10 minutes
        }

        const duration = Date.now() - startTime;
        const totalResults = Object.values(results).reduce((sum, arr) => sum + (arr?.length || 0), 0);
        
        telemetry.trackSearchComplete(totalResults, categories, duration);
        telemetry.endTimer(`search_${requestId}`);
        
        console.log('[BCore] Search completed, results:', results);
        sendResponse({ data: results });
        completeRequest(requestId, true);
        
    } catch (error) {
        telemetry.endTimer(`search_${requestId}`);
        console.error('[BCore] Search failed:', error);
        
        telemetry.trackEvent('search_error', {
            query: message.query,
            categories: message.categories,
            error: error.message,
            duration: Date.now() - startTime
        });
        
        sendResponse({ error: error.message, data: {} });
        completeRequest(requestId, false, error);
    }
}

// Enhanced load more handler with caching
async function handleLoadMore(message, sendResponse, requestId) {
    telemetry.startTimer(`load_more_${requestId}`);
    
    try {
        const { query, category, offset, options = {} } = message;
        console.log('[BCore] Loading more for category:', category, 'offset:', offset);
        
        // Check cache for this specific offset
        const cacheKey = searchCache.constructor.getSearchKey(query, category, offset, options.sortMode || 'recent');
        const cachedResult = searchCache.get(cacheKey);
        
        if (cachedResult) {
            telemetry.trackCacheOperation('load_more', true);
            telemetry.endTimer(`load_more_${requestId}`);
            
            sendResponse({ data: cachedResult });
            completeRequest(requestId, true);
            return;
        }

        telemetry.trackCacheOperation('load_more', false);
        
        const results = await BSearch.loadMoreResults(query, category, settings, offset, options);
        
        // Cache the results
        if (results && results.length > 0) {
            searchCache.set(cacheKey, results, 600000);
        }
        
        telemetry.endTimer(`load_more_${requestId}`);
        console.log('[BCore] Load more completed, results:', results);
        
        sendResponse({ data: results });
        completeRequest(requestId, true);
        
    } catch (error) {
        telemetry.endTimer(`load_more_${requestId}`);
        console.error('[BCore] Load more failed:', error);
        
        sendResponse({ error: error.message, data: [] });
        completeRequest(requestId, false, error);
    }
}

// Enhanced OG data fetching with caching
async function handleFetchOgData(message, sendResponse, requestId) {
    telemetry.startTimer(`og_fetch_${requestId}`);
    
    try {
        const ogData = await fetchOpenGraphData(message.url);
        
        telemetry.endTimer(`og_fetch_${requestId}`);
        sendResponse({ success: true, data: ogData });
        completeRequest(requestId, true);
        
    } catch (error) {
        telemetry.endTimer(`og_fetch_${requestId}`);
        console.error(`[BCore] Failed to fetch OG data for ${message.url}:`, error);
        
        sendResponse({ success: false, error: error.message });
        completeRequest(requestId, false, error);
    }
}

// Enhanced streaming search with performance monitoring
async function handleSearchStream(message, sendResponse, requestId) {
    try {
        const { query, categories, tabId } = message;
        console.log('[BCore] Streaming search for:', query, 'categories:', categories);
        
        telemetry.trackEvent('search_stream_start', {
            query: query.substring(0, 50), // First 50 chars for privacy
            categories: categories.length,
            requestId
        });
        
        // Create port for streaming
        const port = chrome.tabs.connect(tabId || message.tabId, { name: 'searchStream' });
        
        // Track the streaming operation
        let streamedResults = 0;
        const streamStartTime = Date.now();
        
        (async () => {
            try {
                for (const category of categories) {
                    const batchStartTime = Date.now();
                    const batch = await BSearch.performSearch(query, [category], settings, 0, message.options);
                    const batchResults = batch[category] || [];
                    
                    streamedResults += batchResults.length;
                    
                    port.postMessage({ 
                        category, 
                        data: batchResults,
                        batchDuration: Date.now() - batchStartTime,
                        totalStreamed: streamedResults
                    });
                    
                    telemetry.trackEvent('search_stream_batch', {
                        category,
                        resultCount: batchResults.length,
                        duration: Date.now() - batchStartTime
                    });
                }
                
                const totalDuration = Date.now() - streamStartTime;
                port.postMessage({ 
                    done: true, 
                    totalResults: streamedResults,
                    totalDuration 
                });
                
                telemetry.trackEvent('search_stream_complete', {
                    totalResults: streamedResults,
                    totalDuration,
                    requestId
                });
                
                port.disconnect();
                completeRequest(requestId, true);
                
            } catch (streamError) {
                console.error('[BCore] Streaming error:', streamError);
                port.postMessage({ error: streamError.message });
                port.disconnect();
                completeRequest(requestId, false, streamError);
            }
        })();
        
        sendResponse({ ok: true, requestId });
        
    } catch (error) {
        console.error('[BCore] Streaming search failed:', error);
        sendResponse({ error: error.message });
        completeRequest(requestId, false, error);
    }
}

// New performance stats handler
function handleGetPerformanceStats(sendResponse, requestId) {
    try {
        const stats = {
            serviceWorker: {
                state: serviceWorkerState,
                uptime: Date.now() - telemetry.startTime,
                lastActivity: lastActivity,
                activeRequests: activeRequests.size
            },
            cache: {
                search: searchCache.getStats(),
                // Add other cache stats when available
            },
            rateLimiter: rateLimiters.getStats(),
            circuitBreaker: circuitBreakers.getHealth(),
            telemetry: {
                search: telemetry.getSearchAnalytics(),
                api: telemetry.getApiAnalytics(),
                performance: telemetry.getPerformanceStats()
            },
            memory: telemetry.trackMemoryUsage()
        };
        
        sendResponse({ success: true, data: stats });
        completeRequest(requestId, true);
        
    } catch (error) {
        console.error('[BCore] Failed to get performance stats:', error);
        sendResponse({ success: false, error: error.message });
        completeRequest(requestId, false, error);
    }
}

// Cache clearing handler
function handleClearCache(sendResponse, requestId) {
    try {
        const beforeStats = {
            search: searchCache.getStats()
        };
        
        clearAllCaches();
        
        const afterStats = {
            search: searchCache.getStats()
        };
        
        telemetry.trackEvent('cache_cleared', {
            before: beforeStats,
            after: afterStats
        });
        
        sendResponse({ 
            success: true, 
            message: 'All caches cleared',
            before: beforeStats,
            after: afterStats 
        });
        completeRequest(requestId, true);
        
    } catch (error) {
        console.error('[BCore] Failed to clear cache:', error);
        sendResponse({ success: false, error: error.message });
        completeRequest(requestId, false, error);
    }
}

// Request cancellation handler
function handleCancelRequest(message, sendResponse, requestId) {
    const { targetRequestId } = message;
    
    if (activeRequests.has(targetRequestId)) {
        activeRequests.delete(targetRequestId);
        telemetry.trackEvent('request_cancelled', { 
            targetRequestId,
            cancelledBy: requestId
        });
        
        sendResponse({ success: true, message: 'Request cancelled' });
    } else {
        sendResponse({ success: false, message: 'Request not found or already completed' });
    }
    
    completeRequest(requestId, true);
}

function handleTestAIConnection(sendResponse, requestId) {
    // For now, return that AI is not available
    sendResponse({ connected: false, reason: 'AI not configured' });
    completeRequest(requestId, true);
}

// Service worker lifecycle management
chrome.runtime.onStartup.addListener(() => {
    telemetry.trackEvent('extension_startup');
    console.log('[BCore] Extension startup detected');
});

chrome.runtime.onInstalled.addListener((details) => {
    telemetry.trackEvent('extension_installed', {
        reason: details.reason,
        previousVersion: details.previousVersion
    });
    console.log('[BCore] Extension installed/updated:', details);
});

// Cleanup on service worker termination
self.addEventListener('beforeunload', () => {
    telemetry.trackEvent('service_worker_terminating', {
        uptime: Date.now() - telemetry.startTime,
        activeRequests: activeRequests.size
    });
    
    // Cancel any active requests
    for (const [requestId, request] of activeRequests.entries()) {
        request.sendResponse({ error: 'Service worker terminating' });
    }
    activeRequests.clear();
});
