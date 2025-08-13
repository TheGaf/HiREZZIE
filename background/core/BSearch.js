// background/core/BSearch.js - Enhanced with performance optimizations
import { filterAndScoreResults, resetDuplicateCache } from './BTrust.js';
import { fetchOpenGraphData, headCheck } from '../utils/BUtils.js';
import { searchGNews } from '../api/gnews.js';
import { searchNewsAPIOrg } from '../api/news.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchYouTube } from '../api/youtube.js';
import { searchVimeo } from '../api/vimeo.js';
import { searchDailymotion } from '../api/dailymotion.js';
import { searchBrave } from '../api/brave.js';
import { searchBraveImages } from '../api/brave.js';
import { searchBingImages } from '../api/bing.js';

// Performance optimization imports
import { apiCache, searchCache } from '../../utils/cache.js';
import { rateLimiters, waitForRateLimit, handleApiError } from '../../utils/rateLimiter.js';
import { withCircuitBreaker, createImageSearchFallback } from '../../utils/circuitBreaker.js';
import { telemetry } from '../../utils/telemetry.js';
import { apiConfig, getProvidersByMode } from '../../config/apiConfig.js';

// Provider function mapping for smart selection
const PROVIDER_FUNCTIONS = {
    gnews: searchGNews,
    newsapi: searchNewsAPIOrg,
    brave: searchBrave,
    brave_images: searchBraveImages,
    bing: searchBingImages,
    google_cse: searchGoogleImages,
    serpapi: searchSerpApiImages,
    youtube: searchYouTube,
    vimeo: searchVimeo,
    dailymotion: searchDailymotion
};

// Optimize provider selection based on mode and availability
function selectOptimalProviders(category, sortMode, apiKeys, searchConfig) {
    const providers = getProvidersByMode(sortMode, category === 'videos');
    const available = [];

    for (const provider of providers) {
        // Check if API key is available
        const hasKey = checkApiKeyAvailability(provider, apiKeys);
        if (!hasKey) continue;

        // Check rate limits
        if (!rateLimiters.canMakeRequest(provider)) continue;

        // Check circuit breaker
        const breakerState = withCircuitBreaker.circuitBreakers?.getState?.(provider);
        if (breakerState?.state === 'OPEN') continue;

        available.push(provider);
    }

    return available.slice(0, searchConfig?.maxConcurrentProviders || 3);
}

function checkApiKeyAvailability(provider, apiKeys) {
    switch (provider) {
        case 'gnews':
            return !!apiKeys?.gnews;
        case 'newsapi':
            return !!apiKeys?.newsapi_org;
        case 'brave':
        case 'brave_images':
            return !!apiKeys?.brave;
        case 'bing':
            return true; // No key required
        case 'google_cse':
            return !!(apiKeys?.googleImages?.apiKey && apiKeys?.googleImages?.cx);
        case 'serpapi':
            return !!apiKeys?.serpApi;
        case 'youtube':
            return !!apiKeys?.youtube;
        case 'vimeo':
            return !!apiKeys?.vimeo;
        case 'dailymotion':
            return true; // No key required
        default:
            return false;
    }
}

// Enhanced search category function with parallel processing and performance monitoring
async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    const searchStartTime = Date.now();
    telemetry.startTimer(`search_category_${category}`);
    
    console.log(`[BSearch] Searching category: ${category} for query: "${query}" with offset: ${offset}`);
    
    // Check cache first
    const cacheKey = apiCache.constructor.getApiKey(`category_${category}`, query, {
        offset,
        sortMode: options.sortMode || 'recent',
        pass: options.pass || 'strict'
    });
    
    const cachedResult = apiCache.get(cacheKey);
    if (cachedResult && !options.skipCache) {
        telemetry.trackCacheOperation('search_category', true, category);
        telemetry.endTimer(`search_category_${category}`);
        console.log(`[BSearch] Returning cached results for ${category}`);
        return cachedResult;
    }

    telemetry.trackCacheOperation('search_category', false, category);

    let promises = [];
    const sortMode = options.sortMode || 'recent';
    const maxConcurrent = searchConfig?.maxConcurrentRequests || 3;
    
    try {
        switch (category) {
            case 'articles':
                promises = await buildArticleSearchPromises(query, apiKeys, searchConfig, offset, sortMode);
                break;
            case 'images':
                promises = await buildImageSearchPromises(query, apiKeys, searchConfig, offset, sortMode, options);
                break;
            case 'videos':
                promises = await buildVideoSearchPromises(query, apiKeys, offset);
                break;
        }

        console.log(`[BSearch] Made ${promises.length} API calls for ${category}`);
        
        // Execute promises with concurrency control and timeout
        const results = await executeWithConcurrencyControl(promises, maxConcurrent, 20000);
        
        console.log(`[BSearch] API results for ${category}:`, results);
        
        const validResults = results
            .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
            .flatMap(res => res.value);
        
        console.log(`[BSearch] Valid results for ${category}: ${validResults.length} (offset: ${offset})`);
        
        // Prefer images with inherent large dimensions if provided
        if (category === 'images') {
            validResults.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
        }

        const result = { items: validResults, totalValid: validResults.length };
        
        // Cache successful results
        if (validResults.length > 0) {
            const ttl = category === 'images' ? 600000 : 300000; // 10min for images, 5min for others
            apiCache.set(cacheKey, result, ttl);
        }
        
        telemetry.endTimer(`search_category_${category}`);
        telemetry.trackEvent('search_category_complete', {
            category,
            resultCount: validResults.length,
            duration: Date.now() - searchStartTime,
            cached: false
        });
        
        return result;
        
    } catch (error) {
        telemetry.endTimer(`search_category_${category}`);
        telemetry.trackEvent('search_category_error', {
            category,
            error: error.message,
            duration: Date.now() - searchStartTime
        });
        
        console.error(`[BSearch] Search category ${category} failed:`, error);
        return { items: [], totalValid: 0 };
    }
}

// Build article search promises with smart provider selection
async function buildArticleSearchPromises(query, apiKeys, searchConfig, offset, sortMode) {
    const promises = [];
    const providers = selectOptimalProviders('articles', sortMode, apiKeys, searchConfig);
    
    for (const provider of providers) {
        try {
            await waitForRateLimit(provider, 5000); // 5 second max wait
            
            const promise = withCircuitBreaker(provider, async () => {
                telemetry.startTimer(`api_${provider}`);
                
                let result;
                switch (provider) {
                    case 'gnews':
                        const gnewsDays = sortMode === 'relevant' ? 30 : 1;
                        result = await searchGNews(query, apiKeys.gnews, offset, gnewsDays);
                        break;
                    case 'newsapi':
                        const newsapiDays = sortMode === 'relevant' ? 30 : 1;
                        result = await searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, newsapiDays);
                        break;
                    case 'brave':
                        result = await searchBrave(query, apiKeys.brave, offset);
                        break;
                }
                
                telemetry.endTimer(`api_${provider}`);
                telemetry.trackApiCall(provider, 'search', true, Date.now() - telemetry.timers.get(`api_${provider}`), 200);
                
                return result;
            }, createImageSearchFallback(query, [provider]));
            
            promises.push(promise);
            
        } catch (error) {
            console.warn(`[BSearch] Skipping provider ${provider}:`, error.message);
            if (error.status) {
                handleApiError(provider, error.status);
            }
        }
    }
    
    return promises;
}

// Build image search promises with enhanced optimization
async function buildImageSearchPromises(query, apiKeys, searchConfig, offset, sortMode, options) {
    const promises = [];
    
    // Build a refined query for image engines to improve co-occurrence
    let refinedQuery = query;
    try {
        const parts = String(query).split(/\s+(?:and|&|vs|x|with|,|\+)+\s+/i).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
            // Special-case common ambiguous names
            const a = parts[0].toLowerCase();
            const b = parts[1].toLowerCase();
            if ((a.includes('jordan') && b.includes('pippen')) || (a.includes('pippen') && b.includes('jordan'))) {
                refinedQuery = '"Michael Jordan" "Scottie Pippen"';
                if (/\bgame\b|\bbulls\b/i.test(query)) refinedQuery += ' (game OR Bulls)';
            } else {
                refinedQuery = parts.map(p => `"${p}"`).join(' ');
            }
        }
    } catch {}

    const providers = selectOptimalProviders('images', sortMode, apiKeys, searchConfig);
    
    // Free-only mode: build images from article sources
    if (searchConfig?.usePaidImageAPIs === false) {
        const dayWindows = (sortMode === 'relevant') ? [null, 30, 90] : [1, 3, 7];
        
        for (const d of dayWindows) {
            if (providers.includes('gnews')) {
                promises.push(createProviderPromise('gnews', () => 
                    searchGNews(query, apiKeys.gnews, offset, d)
                ));
            }
            if (providers.includes('newsapi')) {
                promises.push(createProviderPromise('newsapi', () => 
                    searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, d)
                ));
            }
        }
        
        // Free image sources
        if (providers.includes('brave_images')) {
            promises.push(createProviderPromise('brave_images', () => 
                searchBraveImages(refinedQuery, apiKeys.brave, offset)
            ));
        }
        
        if (providers.includes('bing')) {
            // Multiple Bing pages for volume but limit based on performance
            const bingOffsets = [0, 50, 100];
            for (const off of bingOffsets) {
                promises.push(createProviderPromise('bing', () => 
                    searchBingImages(refinedQuery, off, { sortMode })
                ));
            }
        }
        
        return promises;
    }

    // Full mode: combine all available sources
    for (const provider of providers) {
        try {
            const promise = createProviderPromise(provider, async () => {
                switch (provider) {
                    case 'google_cse':
                        const opt = await new Promise(resolve => 
                            chrome.storage.sync.get(['blacklist','imgSize','minWidth','minHeight','minBytes','exactDefault'], resolve)
                        );
                        const blacklist = opt.blacklist || [];
                        const mergedOptions = { 
                            ...options, 
                            exactPhrases: (options.exactPhrases ?? opt.exactDefault ?? true), 
                            blacklist, 
                            imgSize: opt.imgSize 
                        };
                        return await searchGoogleImages(refinedQuery, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset, mergedOptions);
                    
                    case 'brave_images':
                        return await searchBraveImages(refinedQuery, apiKeys.brave, offset);
                    
                    case 'bing':
                        return await searchBingImages(refinedQuery, offset, { sortMode });
                    
                    case 'serpapi':
                        if (searchConfig?.usePaidImageAPIs) {
                            return await searchSerpApiImages(refinedQuery, apiKeys.serpApi, offset, options);
                        }
                        return [];
                    
                    default:
                        return [];
                }
            });
            
            promises.push(promise);
            
        } catch (error) {
            console.warn(`[BSearch] Skipping image provider ${provider}:`, error.message);
        }
    }
    
    return promises;
}

// Build video search promises
async function buildVideoSearchPromises(query, apiKeys, offset) {
    const promises = [];
    const providers = selectOptimalProviders('videos', 'recent', apiKeys, {});
    
    for (const provider of providers) {
        try {
            const promise = createProviderPromise(provider, async () => {
                switch (provider) {
                    case 'youtube':
                        return await searchYouTube(query, apiKeys.youtube, offset);
                    case 'vimeo':
                        return await searchVimeo(query, apiKeys.vimeo, offset);
                    case 'dailymotion':
                        return await searchDailymotion(query, offset);
                    default:
                        return [];
                }
            });
            
            promises.push(promise);
            
        } catch (error) {
            console.warn(`[BSearch] Skipping video provider ${provider}:`, error.message);
        }
    }
    
    return promises;
}

// Create a provider promise with rate limiting and circuit breaker
async function createProviderPromise(provider, apiCall) {
    return withCircuitBreaker(provider, async () => {
        await waitForRateLimit(provider, 5000);
        
        telemetry.startTimer(`api_${provider}`);
        const startTime = Date.now();
        
        try {
            const result = await apiCall();
            const duration = Date.now() - startTime;
            
            telemetry.endTimer(`api_${provider}`);
            telemetry.trackApiCall(provider, 'search', true, duration, 200);
            
            return result;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            const statusCode = error.status || error.statusCode || 500;
            
            telemetry.endTimer(`api_${provider}`);
            telemetry.trackApiCall(provider, 'search', false, duration, statusCode);
            
            if (statusCode) {
                handleApiError(provider, statusCode);
            }
            
            throw error;
        }
    }, createImageSearchFallback(provider, [provider]));
}

// Execute promises with concurrency control and timeout
async function executeWithConcurrencyControl(promises, maxConcurrent, timeoutMs) {
    if (promises.length === 0) return [];
    
    const results = [];
    const executing = [];
    
    for (const promise of promises) {
        const wrappedPromise = Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('API timeout')), timeoutMs)
            )
        ]);
        
        const resultPromise = wrappedPromise.then(
            value => ({ status: 'fulfilled', value }),
            reason => ({ status: 'rejected', reason })
        );
        
        results.push(resultPromise);
        
        if (executing.length >= maxConcurrent) {
            await Promise.race(executing);
            executing.splice(executing.findIndex(p => p.status !== 'pending'), 1);
        }
        
        executing.push(resultPromise);
    }
    
    return Promise.all(results);
}

// Enhanced main search function with comprehensive performance optimizations
export async function performSearch(query, categories, settings, offset = 0, options = {}) {
    const searchStartTime = Date.now();
    telemetry.startTimer('search_total');
    
    try {
        // Reset duplicate cache for new searches
        if (offset === 0) {
            resetDuplicateCache();
        }
        
        console.log(`[BSearch] Starting performSearch for "${query}", categories: ${categories}, offset: ${offset}`);
        
        // Check cache first for complete search
        const cacheKey = searchCache.constructor.getSearchKey(
            query, 
            categories.join(','), 
            offset, 
            options.sortMode || 'recent'
        );
        
        const cachedResults = searchCache.get(cacheKey);
        if (cachedResults && !options.skipCache) {
            telemetry.trackCacheOperation('search_total', true);
            telemetry.endTimer('search_total');
            
            console.log('[BSearch] Returning complete cached search results');
            return cachedResults;
        }

        telemetry.trackCacheOperation('search_total', false);
        
        const { apiKeys, searchConfig } = settings;
        const allResults = {};
        const totalValidMeta = {};

        // Process categories with concurrency control
        const categoryPromises = categories.map(async (category) => {
            const categoryStartTime = Date.now();
            
            try {
                const categoryResultsObj = await searchCategory(category, query, apiKeys, searchConfig, offset, { 
                    ...options, 
                    pass: 'strict' 
                });
                
                const categoryResults = categoryResultsObj.items || categoryResultsObj;
                totalValidMeta[category] = categoryResultsObj.totalValid || (categoryResults?.length || 0);
                
                // Add category and original query to each result for downstream scoring
                const resultsWithCategory = categoryResults.map(result => ({ 
                    ...result, 
                    category, 
                    _query: query 
                }));

                // Enhanced processing for images
                if (category === 'images') {
                    return await processImageResults(resultsWithCategory, query, options, settings);
                }
                
                // Enhanced processing for articles
                if (category === 'articles') {
                    return await processArticleResults(resultsWithCategory);
                }
                
                return { category, results: resultsWithCategory };
                
            } catch (error) {
                console.error(`[BSearch] Error processing category ${category}:`, error);
                telemetry.trackEvent('category_processing_error', {
                    category,
                    error: error.message,
                    duration: Date.now() - categoryStartTime
                });
                return { category, results: [] };
            }
        });

        // Execute category searches in parallel with controlled concurrency
        const categoryResults = await Promise.all(categoryPromises);
        
        // Assemble results
        for (const { category, results } of categoryResults) {
            if (results && results.length > 0) {
                const maxItems = category === 'images' ? 100 : 50;
                allResults[category] = filterAndScoreResults(results, maxItems);
                console.log(`[BSearch] Top ${maxItems} results for ${category}:`, allResults[category].length);
            } else {
                allResults[category] = [];
            }
        }

        // Enhanced image expansion for low volume
        if (categories.length === 1 && categories[0] === 'images') {
            allResults.images = await expandImageResults(
                allResults.images || [], 
                query, 
                apiKeys, 
                searchConfig, 
                offset, 
                options
            );
        }

        // Final image validation with performance optimization
        if (allResults.images && allResults.images.length) {
            allResults.images = await performFinalImageValidation(allResults.images);
        }

        // Attach metadata
        allResults.__meta = { 
            totalValid: totalValidMeta,
            searchDuration: Date.now() - searchStartTime,
            cached: false,
            timestamp: Date.now()
        };

        // Cache successful results
        if (Object.keys(allResults).some(key => key !== '__meta' && allResults[key].length > 0)) {
            searchCache.set(cacheKey, allResults, 600000); // 10 minutes
        }

        const totalResults = Object.values(allResults)
            .filter(arr => Array.isArray(arr))
            .reduce((sum, arr) => sum + arr.length, 0);

        telemetry.endTimer('search_total');
        telemetry.trackSearchComplete(totalResults, categories, Date.now() - searchStartTime);
        
        console.log(`[BSearch] Search completed in ${Date.now() - searchStartTime}ms with ${totalResults} total results`);
        return allResults;
        
    } catch (error) {
        telemetry.endTimer('search_total');
        telemetry.trackEvent('search_error', {
            query: query.substring(0, 50),
            categories,
            error: error.message,
            duration: Date.now() - searchStartTime
        });
        
        console.error('[BSearch] performSearch failed:', error);
        throw error;
    }
}

// Process image results with enhanced optimizations
async function processImageResults(resultsWithCategory, query, options, settings) {
    telemetry.startTimer('process_images');
    
    try {
        // For images, compute phrase/term context but defer strict filtering until after OG/ALT enrichment
        const qNorm = query.toLowerCase();
        const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
        const knownPhrases = ['hot ones'];
        const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
        let residual = qNorm;
        phrases.forEach(p => { residual = residual.replace(p, ' '); });
        const terms = residual.split(/\s+/).filter(Boolean);
        options.__phrases = phrases;
        options.__terms = terms;

        // Extract from article pages with controlled concurrency
        const ogExtractionPromises = resultsWithCategory.slice(0, 50).map(async (result) => {
            try {
                const direct = result.imageUrl || result.url || '';
                if (/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(direct)) {
                    result.imageUrl = direct;
                    result.thumbnail = direct;
                    return result;
                }
                
                // Use cached OG data if available
                const ogCacheKey = apiCache.constructor.getApiKey('og_data', result.pageUrl || result.url);
                let og = apiCache.get(ogCacheKey);
                
                if (!og) {
                    og = await fetchOpenGraphData(result.pageUrl || result.url);
                    if (og) {
                        apiCache.set(ogCacheKey, og, 1800000); // 30 minutes
                    }
                }
                
                if (og && (og.image || (og.images && og.images.length))) {
                    const imgs = (og.images && og.images.length) ? og.images : [{ url: og.image, alt: og.title || '' }];
                    const entityParts = qNorm.split(/\s+(?:vs|x|and|&|with)\s+/g).map(s => s.trim()).filter(Boolean);
                    
                    function scoreCand(c) {
                        const alt = (c.alt || '').toLowerCase();
                        let s = 0;
                        if (alt.includes(qNorm)) s += 3;
                        let fileName = '';
                        try { 
                            const u = new URL(c.url); 
                            fileName = (u.pathname.split('/').pop() || '').toLowerCase(); 
                        } catch {}
                        const entityAllInAlt = entityParts.length > 1 && entityParts.every(e => alt.includes(e));
                        const entityAllInName = entityParts.length > 1 && entityParts.every(e => 
                            fileName.includes(e.replace(/\s+/g,'-')) || 
                            fileName.includes(e.replace(/\s+/g,'_')) || 
                            fileName.includes(e)
                        );
                        if (entityAllInAlt || entityAllInName) s += 4;
                        if (c.url) s += 1;
                        return s;
                    }
                    
                    let best = imgs.reduce((a, c) => (scoreCand(c) > scoreCand(a || {}) ? c : a), null);
                    result.imageUrl = (best && best.url) || og.image;
                    result.thumbnail = result.imageUrl;
                    result.ogTitle = og.title;
                    result.ogDescription = og.description;
                    result.ogAlt = (best && best.alt) || og.alt;
                }
                
                return result;
            } catch (e) {
                return result; // Return original on error
            }
        });

        // Execute OG extraction with concurrency control
        const ogResults = await executeWithConcurrencyControl(ogExtractionPromises, 5, 10000);
        const processedResults = ogResults
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        // Enhanced deduplication with performance optimization
        const deduplicatedResults = performOptimizedDeduplication(processedResults);
        
        // Content-first relevance filtering
        const filteredResults = performContentFiltering(deduplicatedResults, query, settings);
        
        telemetry.endTimer('process_images');
        return { category: 'images', results: filteredResults };
        
    } catch (error) {
        telemetry.endTimer('process_images');
        throw error;
    }
}

// Optimized deduplication algorithm
function performOptimizedDeduplication(results) {
    const normalizeKey = (u) => {
        try {
            const url = new URL(u);
            let name = (url.pathname.split('/').pop() || '').toLowerCase();
            name = name.replace(/\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$/, '');
            name = name.replace(/[-_]?\d{2,4}x\d{2,4}$/, '');
            return name;
        } catch { 
            return (u || '').toLowerCase(); 
        }
    };
    
    const bestByKey = new Map();
    for (const r of results) {
        if (!r.imageUrl && !r.url) continue;
        
        const key = normalizeKey(r.imageUrl || r.url || '');
        const current = bestByKey.get(key);
        const area = (Number(r.width || 0) * Number(r.height || 0)) || 0;
        const currentArea = current ? ((Number(current.width || 0) * Number(current.height || 0)) || 0) : 0;
        
        if (!current || area > currentArea) {
            bestByKey.set(key, r);
        }
    }
    
    return Array.from(bestByKey.values()).filter(r => r.imageUrl);
}

// Enhanced content filtering
function performContentFiltering(results, query, settings) {
    const qNorm = query.toLowerCase();
    const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
    const knownPhrases = ['hot ones'];
    const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
    const entityParts = qNorm.split(/\s+(?:vs|x|and|&|with)\s+/g).map(s => s.trim()).filter(Boolean);
    const entities = entityParts.length > 1 ? entityParts : [];
    
    let residual = qNorm;
    phrases.forEach(p => { residual = residual.replace(p, ' '); });
    residual = residual.replace(/\b(vs|x|and|&|with)\b/g, ' ');
    const terms = residual.split(/\s+/).filter(Boolean);
    
    const requireAll = settings?.searchConfig?.requireAllTerms === true;
    const minMP = settings?.searchConfig?.minImageMegaPixels || 0;

    const contentMatches = (r, relaxedMin = null) => {
        const hay = `${r.ogTitle || ''} ${r.ogDescription || ''} ${r.ogAlt || ''} ${r.title || ''} ${r.pageUrl || r.url || ''}`.toLowerCase();
        
        if (!phrases.every(p => hay.includes(p))) return false;
        
        if (entities.length > 1) {
            const entityMatches = entities.filter(e => hay.includes(e)).length;
            if (relaxedMin !== null) {
                if (entityMatches < 1) return false;
            } else if (entityMatches < 2) {
                return false;
            }
        }
        
        if (terms.length === 0) return true;
        if (requireAll && relaxedMin === null) return terms.every(t => hay.includes(t));
        
        const minMatches = relaxedMin ?? 1;
        const matched = terms.filter(t => hay.includes(t)).length;
        return matched >= minMatches;
    };

    // Two-stage filtering for better performance
    let softKept = [];
    for (const r of results) {
        if (contentMatches(r, entities.length > 1 ? 1 : 2)) {
            softKept.push(r);
        }
    }
    
    if (softKept.length === 0) softKept = results;
    
    const strictlyKept = [];
    for (const r of softKept) {
        if (!contentMatches(r)) continue;
        const hasDims = Number(r.width) > 0 && Number(r.height) > 0;
        const mp = hasDims ? ((Number(r.width) * Number(r.height)) / 1_000_000) : 0;
        if (!hasDims || mp >= minMP) {
            strictlyKept.push(r);
        }
    }
    
    return strictlyKept.length ? strictlyKept : softKept;
}

// Process article results
async function processArticleResults(resultsWithCategory) {
    telemetry.startTimer('process_articles');
    
    try {
        // For articles without thumbnails, try to fetch Open Graph data
        const ogPromises = resultsWithCategory
            .filter(result => !result.thumbnail)
            .slice(0, 20) // Limit to 20 for performance
            .map(async (result) => {
                try {
                    const ogCacheKey = apiCache.constructor.getApiKey('og_data', result.url);
                    let ogData = apiCache.get(ogCacheKey);
                    
                    if (!ogData) {
                        ogData = await fetchOpenGraphData(result.url);
                        if (ogData) {
                            apiCache.set(ogCacheKey, ogData, 1800000);
                        }
                    }
                    
                    if (ogData && ogData.image) {
                        result.thumbnail = ogData.image;
                        console.log(`[BSearch] Added OG image for: ${result.title}`);
                    }
                    
                    return result;
                } catch (error) {
                    console.warn(`[BSearch] Failed to fetch OG data for: ${result.url}`);
                    return result;
                }
            });

        // Execute with controlled concurrency
        await Promise.allSettled(ogPromises);
        
        telemetry.endTimer('process_articles');
        return { category: 'articles', results: resultsWithCategory };
        
    } catch (error) {
        telemetry.endTimer('process_articles');
        throw error;
    }
}

// Enhanced image expansion for low volume results
async function expandImageResults(currentImages, query, apiKeys, searchConfig, offset, options) {
    telemetry.startTimer('expand_images');
    
    try {
        const MIN_TARGET = 25;
        if (currentImages.length >= MIN_TARGET) {
            telemetry.endTimer('expand_images');
            return currentImages;
        }

        console.log('[BSearch] Images too few, running relaxed expansion pass');
        
        // Try relaxed search first
        const relaxedRaw = await searchCategory('images', query, apiKeys, searchConfig, offset, { 
            pass: 'relaxed', 
            minTermMatches: 2,
            skipCache: true // Force fresh search for expansion
        });
        
        const relaxedWithMeta = (relaxedRaw.items || relaxedRaw).map(r => ({ 
            ...r, 
            category: 'images', 
            _query: query 
        }));
        
        const merged = [...currentImages];
        const seen = new Set(currentImages.map(r => (r.imageUrl || r.url).toLowerCase()));
        
        for (const r of relaxedWithMeta) {
            const key = (r.imageUrl || r.url).toLowerCase();
            if (!seen.has(key)) { 
                merged.push(r); 
                seen.add(key); 
            }
        }
        
        let finalResults = filterAndScoreResults(merged, 60);

        // Final safety net: SerpApi supplement if still below target
        if (finalResults.length < MIN_TARGET && apiKeys?.serpApi && searchConfig?.usePaidImageAPIs !== false) {
            try {
                console.log('[BSearch] Still low volume; fetching supplemental images from SerpApi');
                
                const serpPromises = [
                    createProviderPromise('serpapi', () => 
                        searchSerpApiImages(query, apiKeys.serpApi, 0, { 
                            exactPhrases: options?.exactPhrases, 
                            autoRelax: true, 
                            sortMode: options?.sortMode 
                        })
                    )
                ];
                
                // Add more pages if needed
                if (finalResults.length < 15) {
                    serpPromises.push(
                        createProviderPromise('serpapi', () => 
                            searchSerpApiImages(query, apiKeys.serpApi, 100, { 
                                exactPhrases: options?.exactPhrases, 
                                autoRelax: true, 
                                sortMode: options?.sortMode 
                            })
                        )
                    );
                }
                
                const serpResults = await Promise.allSettled(serpPromises);
                const serpImages = serpResults
                    .filter(r => r.status === 'fulfilled')
                    .flatMap(r => r.value || [])
                    .map(r => ({ ...r, category: 'images', _query: query }));

                // Merge and deduplicate
                const seen2 = new Set(finalResults.map(r => (r.imageUrl || r.url).toLowerCase()));
                for (const r of serpImages) {
                    const key = (r.imageUrl || r.url).toLowerCase();
                    if (!seen2.has(key)) { 
                        finalResults.push(r); 
                        seen2.add(key); 
                    }
                }
                
                finalResults = filterAndScoreResults(finalResults, 60);
                
            } catch (e) {
                console.warn('[BSearch] SerpApi supplement failed:', e?.message);
            }
        }

        telemetry.endTimer('expand_images');
        return finalResults;
        
    } catch (error) {
        telemetry.endTimer('expand_images');
        console.error('[BSearch] Image expansion failed:', error);
        return currentImages;
    }
}

// Enhanced final image validation with performance optimization
async function performFinalImageValidation(images) {
    telemetry.startTimer('final_validation');
    
    try {
        const allowedExt = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i;
        const validated = [];
        const candidates = images.slice(0, 60); // Limit for performance
        
        // Use batched validation for better performance
        const batchSize = 10;
        const batches = [];
        
        for (let i = 0; i < candidates.length; i += batchSize) {
            batches.push(candidates.slice(i, i + batchSize));
        }
        
        for (const batch of batches) {
            const headResults = await Promise.allSettled(batch.map(async r => {
                const url = r.imageUrl || r.url || '';
                if (!/^https?:\/\//i.test(url)) return { ok: false };
                
                // Check cache first
                const cacheKey = apiCache.constructor.getImageKey(url);
                const cachedInfo = apiCache.get(cacheKey);
                
                if (cachedInfo) {
                    return { ok: cachedInfo.ok, r };
                }
                
                let info;
                if (!allowedExt.test(url)) {
                    info = await headCheck(url);
                    const ok = info.ok && (!info.contentLength || info.contentLength >= 200_000);
                    apiCache.set(cacheKey, { ok }, 1800000); // 30 minutes
                    return { ok, info, r };
                }
                
                info = await headCheck(url);
                const ok = info.ok && (!info.contentLength || info.contentLength >= 200_000);
                apiCache.set(cacheKey, { ok }, 1800000);
                return { ok, info, r };
            }));
            
            headResults.forEach(res => {
                if (res.status === 'fulfilled' && res.value.ok) {
                    validated.push(res.value.r);
                }
            });
            
            // Small delay between batches to avoid overwhelming
            if (batches.indexOf(batch) < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        telemetry.endTimer('final_validation');
        return validated.length ? validated : images.slice(0, 20); // Fallback to first 20
        
    } catch (error) {
        telemetry.endTimer('final_validation');
        console.error('[BSearch] Final validation failed:', error);
        return images.slice(0, 20);
    }
}
}

// Enhanced function for loading more results with caching and performance monitoring
export async function loadMoreResults(query, category, settings, offset, options = {}) {
    const startTime = Date.now();
    telemetry.startTimer(`load_more_${category}`);
    
    try {
        console.log(`[BSearch] LoadMore: query="${query}", category="${category}", offset=${offset}`);
        
        // Check cache first
        const cacheKey = apiCache.constructor.getApiKey(`load_more_${category}`, query, {
            offset,
            sortMode: options.sortMode || 'recent'
        });
        
        const cachedResult = apiCache.get(cacheKey);
        if (cachedResult && !options.skipCache) {
            telemetry.trackCacheOperation('load_more', true, category);
            telemetry.endTimer(`load_more_${category}`);
            
            console.log(`[BSearch] Returning cached load more results for ${category}`);
            return cachedResult;
        }

        telemetry.trackCacheOperation('load_more', false, category);
        
        const { apiKeys, searchConfig } = settings;
        const categoryResultsObj = await searchCategory(category, query, apiKeys, searchConfig, offset, options);
        const categoryResults = categoryResultsObj.items || categoryResultsObj;
        
        // Add category and original query to each result for downstream scoring
        const resultsWithCategory = categoryResults.map(result => ({ 
            ...result, 
            category, 
            _query: query 
        }));
        
        console.log(`[BSearch] LoadMore: got ${categoryResults.length} raw results for ${category}`);
        
        const filteredResults = filterAndScoreResults(resultsWithCategory, 30); // Load more: up to 30 results
        
        // Cache successful results
        if (filteredResults.length > 0) {
            apiCache.set(cacheKey, filteredResults, 300000); // 5 minutes
        }
        
        const duration = Date.now() - startTime;
        telemetry.endTimer(`load_more_${category}`);
        telemetry.trackEvent('load_more_complete', {
            category,
            resultCount: filteredResults.length,
            duration,
            offset
        });
        
        console.log(`[BSearch] LoadMore: filtered to ${filteredResults.length} results for ${category}`);
        return filteredResults;
        
    } catch (error) {
        telemetry.endTimer(`load_more_${category}`);
        telemetry.trackEvent('load_more_error', {
            category,
            error: error.message,
            duration: Date.now() - startTime,
            offset
        });
        
        console.error(`[BSearch] LoadMore failed for ${category}:`, error);
        return [];
    }
}

// Performance monitoring and debugging utilities
export function getSearchPerformanceStats() {
    return {
        cache: {
            search: searchCache.getStats(),
            api: apiCache.getStats()
        },
        rateLimiter: rateLimiters.getStats(),
        circuitBreaker: circuitBreakers.getHealth(),
        telemetry: {
            search: telemetry.getSearchAnalytics(),
            api: telemetry.getApiAnalytics(),
            performance: telemetry.getPerformanceStats()
        }
    };
}

// Clear performance caches
export function clearSearchCaches() {
    searchCache.clear();
    apiCache.clear();
    telemetry.trackEvent('search_caches_cleared');
    console.log('[BSearch] All search caches cleared');
}

// Reset rate limiters and circuit breakers for testing
export function resetSearchInfrastructure() {
    rateLimiters.resetAll();
    circuitBreakers.resetAll();
    clearSearchCaches();
    telemetry.trackEvent('search_infrastructure_reset');
    console.log('[BSearch] Search infrastructure reset');
}
