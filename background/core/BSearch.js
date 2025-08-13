// background/core/BSearch.js
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
import { rateLimiter } from '../services/RateLimiter.js';
import { circuitBreakerManager } from '../services/CircuitBreaker.js';
import { telemetryService } from '../services/TelemetryService.js';
import { getApisForCategory, getFeatureFlag, shouldUseApi } from '../config/apiConfig.js';
import { errorBoundary } from '../../utils/ErrorBoundary.js';

// Intelligent API selection based on performance and circuit breaker status
function selectOptimalApis(category, options = {}) {
    const availableApis = getApisForCategory(category);
    const { preferFreeAPIs = false, queryType = 'all' } = options;
    
    if (!getFeatureFlag('useIntelligentSourceSelection')) {
        return availableApis; // Return all APIs if intelligence is disabled
    }
    
    // Get health scores from circuit breakers
    const healthScores = circuitBreakerManager.getHealthScores();
    
    // Filter and sort APIs by health and preference
    const optimizedApis = availableApis
        .filter(api => shouldUseApi(api.name, queryType, category, { preferFreeAPIs }))
        .map(api => ({
            ...api,
            healthScore: healthScores[api.name] || 100
        }))
        .filter(api => api.healthScore > 0) // Exclude completely broken APIs
        .sort((a, b) => {
            // First sort by health score
            if (b.healthScore !== a.healthScore) {
                return b.healthScore - a.healthScore;
            }
            // Then by priority
            return a.priority - b.priority;
        });

    console.log(`[BSearch] Selected ${optimizedApis.length} optimal APIs for ${category}:`, 
                optimizedApis.map(api => `${api.name}(${api.healthScore}%)`));
    
    return optimizedApis;
}

// Enhanced API call wrapper with rate limiting and circuit breaker
async function callApiWithProtection(apiName, apiFunction, ...args) {
    const useRateLimit = getFeatureFlag('enableRateLimiting');
    const useCircuitBreaker = getFeatureFlag('enableCircuitBreaker');
    
    try {
        // Apply rate limiting
        if (useRateLimit) {
            const permission = await rateLimiter.isAllowed(apiName);
            if (!permission.allowed) {
                const error = new Error(`Rate limit exceeded for ${apiName}: ${permission.reason}`);
                error.isRateLimited = true;
                error.retryAfter = permission.retryAfter;
                throw error;
            }
        }
        
        // Apply circuit breaker protection
        if (useCircuitBreaker) {
            return await circuitBreakerManager.execute(apiName, apiFunction, {}, null);
        } else {
            return await apiFunction(...args);
        }
        
    } catch (error) {
        // Record API call performance
        telemetryService.recordApiCall(apiName, 0, false, error.constructor.name);
        throw error;
    }
}
async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    console.log(`[BSearch] Searching category: ${category} for query: "${query}" with offset: ${offset}`);
    
    const timer = telemetryService.createTimer(`search_${category}`);
    let promises = [];
    const sortMode = options.sortMode || 'recent';
    
    // Get optimal APIs for this category
    const optimalApis = selectOptimalApis(category, options);
    
    try {
        switch (category) {
            case 'articles':
                // Use intelligent source selection
                for (const api of optimalApis) {
                    switch (api.name) {
                        case 'gnews':
                            if (apiKeys.gnews) {
                                const dayWindow = sortMode === 'relevant' ? 30 : 1;
                                promises.push(
                                    callApiWithProtection('gnews', 
                                        () => searchGNews(query, apiKeys.gnews, offset, dayWindow)
                                    ).catch(error => {
                                        console.warn(`[BSearch] GNews API failed:`, error.message);
                                        return [];
                                    })
                                );
                            }
                            break;
                        case 'newsapi':
                            if (apiKeys.newsapi_org) {
                                const dayWindow = sortMode === 'relevant' ? 30 : 1;
                                promises.push(
                                    callApiWithProtection('newsapi',
                                        () => searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, dayWindow)
                                    ).catch(error => {
                                        console.warn(`[BSearch] NewsAPI failed:`, error.message);
                                        return [];
                                    })
                                );
                            }
                            break;
                        case 'brave':
                            if (apiKeys.brave) {
                                promises.push(
                                    callApiWithProtection('brave',
                                        () => searchBrave(query, apiKeys.brave, offset)
                                    ).catch(error => {
                                        console.warn(`[BSearch] Brave API failed:`, error.message);
                                        return [];
                                    })
                                );
                            }
                            break;
                    }
                }
                break;

            case 'images':
                // Enhanced image search with intelligent API selection
                let refinedQuery = query;
                try {
                    const parts = String(query).split(/\s+(?:and|&|vs|x|with|,|\+)+\s+/i).map(s => s.trim()).filter(Boolean);
                    if (parts.length >= 2) {
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

                // Free-only mode or intelligent API selection
                if (searchConfig?.usePaidImageAPIs === false || options.preferFreeAPIs) {
                    const dayWindows = (sortMode === 'relevant') ? [null, 30, 90] : [1, 3, 7];
                    for (const d of dayWindows) {
                        if (apiKeys.gnews) {
                            promises.push(
                                callApiWithProtection('gnews',
                                    () => searchGNews(query, apiKeys.gnews, offset, d)
                                ).catch(() => [])
                            );
                        }
                        if (apiKeys.newsapi_org) {
                            promises.push(
                                callApiWithProtection('newsapi',
                                    () => searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, d)
                                ).catch(() => [])
                            );
                        }
                    }
                }

                // Use optimal APIs for images
                for (const api of optimalApis) {
                    switch (api.name) {
                        case 'googleImages':
                            if (searchConfig?.preferGoogleCSE && apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
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
                                promises.push(
                                    callApiWithProtection('googleImages',
                                        () => searchGoogleImages(refinedQuery, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset, mergedOptions)
                                    ).catch(() => [])
                                );
                            }
                            break;
                        case 'serpApi':
                            if (apiKeys?.serpApi && searchConfig?.usePaidImageAPIs) {
                                promises.push(
                                    callApiWithProtection('serpApi',
                                        () => searchSerpApiImages(refinedQuery, apiKeys.serpApi, offset, options)
                                    ).catch(() => [])
                                );
                            }
                            break;
                        case 'brave':
                            if (apiKeys.brave) {
                                promises.push(
                                    callApiWithProtection('brave',
                                        () => searchBraveImages(refinedQuery, apiKeys.brave, offset)
                                    ).catch(() => [])
                                );
                            }
                            break;
                        case 'bing':
                            const bingOffsets = [0, 50, 100, 150, 200];
                            for (const off of bingOffsets) {
                                promises.push(
                                    callApiWithProtection('bing',
                                        () => searchBingImages(refinedQuery, off, { sortMode })
                                    ).catch(() => [])
                                );
                            }
                            break;
                    }
                }
                break;

            case 'videos':
                // Use optimal APIs for videos
                for (const api of optimalApis) {
                    switch (api.name) {
                        case 'youtube':
                            if (apiKeys.youtube) {
                                promises.push(
                                    callApiWithProtection('youtube',
                                        () => searchYouTube(query, apiKeys.youtube, offset)
                                    ).catch(() => [])
                                );
                            }
                            break;
                        // Add other video APIs as they become available
                    }
                }
                break;
        }

        console.log(`[BSearch] Made ${promises.length} API calls for ${category} using intelligent selection`);
        
        // Execute all API calls with timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Search timeout')), 30000)
        );
        
        const results = await Promise.race([
            Promise.allSettled(promises),
            timeoutPromise
        ]);
        
        console.log(`[BSearch] API results for ${category}:`, results);
        
        const validResults = results
            .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
            .flatMap(res => res.value);
        
        console.log(`[BSearch] Valid results for ${category}: ${validResults.length} (offset: ${offset})`);
        
        // Prefer images with inherent large dimensions if provided
        if (category === 'images') {
            validResults.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
        }
        
        const duration = timer.end({ 
            category, 
            resultCount: validResults.length, 
            apiCount: promises.length 
        });
        
        return { items: validResults, totalValid: validResults.length };
        
    } catch (error) {
        timer.end({ success: false, error: error.message });
        console.error(`[BSearch] Search category ${category} failed:`, error);
        throw error;
    }
}

export async function performSearch(query, categories, settings, offset = 0, options = {}) {
    const searchTimer = telemetryService.createTimer('full_search_operation');
    const { cancellationSignal } = options;
    
    try {
        // Reset duplicate cache for new searches
        if (offset === 0) {
            resetDuplicateCache();
        }
        
        // Check if operation was cancelled
        if (cancellationSignal?.aborted) {
            throw new Error('Search operation was cancelled');
        }
        
        const { apiKeys, searchConfig } = settings;
        const allResults = {};
        const totalValidMeta = {};
        
        // Process categories with cancellation support
        for (const category of categories) {
            if (cancellationSignal?.aborted) {
                throw new Error('Search operation was cancelled');
            }
            
            const categoryTimer = telemetryService.createTimer(`category_${category}`);
            
            try {
                const categoryResultsObj = await searchCategory(
                    category, 
                    query, 
                    apiKeys, 
                    searchConfig, 
                    offset, 
                    { ...options, pass: 'strict', cancellationSignal }
                );
                
                const categoryResults = categoryResultsObj.items || categoryResultsObj;
                totalValidMeta[category] = categoryResultsObj.totalValid || (categoryResults?.length || 0);
                
                // Add category and original query to each result for downstream scoring
                const resultsWithCategory = categoryResults.map(result => ({ 
                    ...result, 
                    category, 
                    _query: query 
                }));
                
                // Enhanced image processing with cancellation checks
                if (category === 'images') {
                    await processImageResults(resultsWithCategory, query, options, cancellationSignal);
                }
                
                // Process articles with OG data
                if (category === 'articles') {
                    await processArticleResults(resultsWithCategory, cancellationSignal);
                }
                
                const maxItems = 100; // allow larger pool before curation
                allResults[category] = filterAndScoreResults(resultsWithCategory, maxItems);
                
                categoryTimer.end({ 
                    category, 
                    resultCount: allResults[category].length,
                    totalValid: totalValidMeta[category]
                });
                
                console.log(`[BSearch] Top ${maxItems} results for ${category}:`, allResults[category].length);
                
            } catch (error) {
                categoryTimer.end({ success: false, error: error.message });
                
                if (error.message.includes('cancelled')) {
                    throw error; // Re-throw cancellation errors
                }
                
                console.error(`[BSearch] Category ${category} search failed:`, error);
                allResults[category] = []; // Graceful degradation
                totalValidMeta[category] = 0;
            }
        }
        
        // Apply post-processing with cancellation support
        await applyPostProcessing(allResults, query, settings, options, cancellationSignal);
        
        // Attach metadata
        allResults.__meta = { totalValid: totalValidMeta };
        
        const duration = searchTimer.end({ 
            success: true, 
            query: query.substring(0, 50), // Truncate for privacy
            categories,
            totalResults: Object.values(allResults).flat().length
        });
        
        console.log(`[BSearch] Complete search finished in ${duration}ms`);
        return allResults;
        
    } catch (error) {
        searchTimer.end({ success: false, error: error.message });
        
        if (error.message.includes('cancelled')) {
            console.log('[BSearch] Search operation was cancelled');
        } else {
            console.error('[BSearch] Search operation failed:', error);
        }
        
        throw error;
    }
}
        }

        // For images, extract from article pages: get Open Graph/Twitter/candidate images
        if (category === 'images') {
            for (const result of resultsWithCategory) {
                try {
                    const direct = result.imageUrl || result.url || '';
                    if (/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(direct)) {
                        result.imageUrl = direct;
                        result.thumbnail = direct;
                        continue;
                    }
                    const og = await fetchOpenGraphData(result.pageUrl || result.url);
                    if (og && (og.image || (og.images && og.images.length))) {
                        const imgs = (og.images && og.images.length) ? og.images : [{ url: og.image, alt: og.title || '' }];
                        const q = (query || '').toLowerCase();
                        const entityParts = q.split(/\s+(?:vs|x|and|&|with)\s+/g).map(s => s.trim()).filter(Boolean);
                        function scoreCand(c) {
                            const alt = (c.alt || '').toLowerCase();
                            let s = 0;
                            if (alt.includes(q)) s += 3;
                            let fileName = '';
                            try { const u = new URL(c.url); fileName = (u.pathname.split('/').pop() || '').toLowerCase(); } catch {}
                            const entityAllInAlt = entityParts.length > 1 && entityParts.every(e => alt.includes(e));
                            const entityAllInName = entityParts.length > 1 && entityParts.every(e => fileName.includes(e.replace(/\s+/g,'-')) || fileName.includes(e.replace(/\s+/g,'_')) || fileName.includes(e));
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
                } catch (e) { /* ignore */ }
            }

            // Stronger de-duplication: collapse by normalized image filename key
            const normalizeKey = (u) => {
                try {
                    const url = new URL(u);
                    let name = (url.pathname.split('/').pop() || '').toLowerCase();
                    // strip params-like suffixes and common size suffixes
                    name = name.replace(/\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$/, '');
                    name = name.replace(/[-_]?\d{2,4}x\d{2,4}$/, '');
                    return name;
                } catch { return (u || '').toLowerCase(); }
            };
            const bestByKey = new Map();
            for (const r of resultsWithCategory) {
                const key = normalizeKey(r.imageUrl || r.url || '');
                const cur = bestByKey.get(key);
                const area = (Number(r.width || 0) * Number(r.height || 0)) || 0;
                const curArea = cur ? ((Number(cur.width || 0) * Number(cur.height || 0)) || 0) : 0;
                if (!cur || area > curArea) bestByKey.set(key, r);
            }
            // replace array with best unique items
            while (resultsWithCategory.length) resultsWithCategory.pop();
            resultsWithCategory.push(...bestByKey.values());

            // Drop any items without a direct image URL to avoid broken page links
            for (let i = resultsWithCategory.length - 1; i >= 0; i--) {
                if (!resultsWithCategory[i].imageUrl) resultsWithCategory.splice(i, 1);
            }

            // CONTENT-FIRST relevance filtering (phrases then terms) now that OG fields are available
            const qNorm = query.toLowerCase();
            const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
            const knownPhrases = ['hot ones'];
            const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
            // parse entities around connectors: vs, x, and, &
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
                // For multi-entity queries, require both entities or allow at least one strong match when relaxed
                if (!phrases.every(p => hay.includes(p))) return false; // always require phrases
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

            // Two-stage: soft filter first to avoid zeroes, then hard filter if still big pool
            let softKept = [];
            for (const r of resultsWithCategory) {
                if (contentMatches(r, entities.length > 1 ? 1 : 2)) softKept.push(r);
            }
            if (softKept.length === 0) softKept = resultsWithCategory; // fallback
            const strictlyKept = [];
            for (const r of softKept) {
                if (!contentMatches(r)) continue;
                const hasDims = Number(r.width) > 0 && Number(r.height) > 0;
                const mp = hasDims ? ((Number(r.width) * Number(r.height)) / 1_000_000) : 0;
                if (!hasDims || mp >= minMP) strictlyKept.push(r);
            }
            while (resultsWithCategory.length) resultsWithCategory.pop();
            resultsWithCategory.push(...(strictlyKept.length ? strictlyKept : softKept));

            // HEAD verification to enforce size/type and fix broken links (prefer direct images on same page)
            const checks = await Promise.allSettled(resultsWithCategory.slice(0, 160).map(async r => {
                const url = r.imageUrl || r.url;
                // Trust common direct file URLs without HEAD to keep volume high
                const isDirectFile = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(url);
                let info = { ok: isDirectFile, contentLength: null };
                if (!isDirectFile) {
                    info = await headCheck(url);
                }
                if (!info.ok || (info.contentLength && info.contentLength < 150_000)) {
                    // Try fallbacks from page candidates (og.images)
                    try {
                        const og = await fetchOpenGraphData(r.pageUrl || r.url);
                        const altImgs = (og && og.images) || [];
                        for (const cand of altImgs) {
                            const test = await headCheck(cand.url);
                            if (test.ok && (!test.contentLength || test.contentLength >= 150_000)) {
                                r.imageUrl = cand.url; r.thumbnail = cand.url; info = test; break;
                            }
                        }
                    } catch {}
                }
                return info;
            }));
            for (let i = checks.length - 1; i >= 0; i--) {
                const res = checks[i];
                if (res.status === 'fulfilled') {
                    const info = res.value;
                    if (!info.ok) { resultsWithCategory.splice(i, 1); continue; }
                    if (info.contentLength && info.contentLength < 150_000) { resultsWithCategory.splice(i, 1); }
                }
            }
        }
        
        // For articles without thumbnails, try to fetch Open Graph data
        if (category === 'articles') {
            for (const result of resultsWithCategory) {
                if (!result.thumbnail) {
                    try {
                        const ogData = await fetchOpenGraphData(result.url);
                        if (ogData && ogData.image) {
                            result.thumbnail = ogData.image;
                            console.log(`[BSearch] Added OG image for: ${result.title}`);
                        }
                    } catch (error) {
                        console.warn(`[BSearch] Failed to fetch OG data for: ${result.url}`);
                    }
                }
            }
        }
        
        const maxItems = 100; // allow larger pool before curation
        allResults[category] = filterAndScoreResults(resultsWithCategory, maxItems);
        console.log(`[BSearch] Top ${maxItems} results for ${category}:`, allResults[category].length);
    }

    // If images volume is low, do a relaxed expansion pass to find "similar" results
    if (categories.length === 1 && categories[0] === 'images') {
        const current = allResults.images || [];
        const MIN_TARGET = 25;
        if (current.length < MIN_TARGET) {
            console.log('[BSearch] Images too few, running relaxed expansion pass');
            const relaxedRaw = await searchCategory('images', query, apiKeys, searchConfig, offset, { pass: 'relaxed', minTermMatches: 2 });
            const relaxedWithMeta = (relaxedRaw.items || relaxedRaw).map(r => ({ ...r, category: 'images', _query: query }));
            const merged = [...current];
            const seen = new Set(current.map(r => (r.imageUrl || r.url).toLowerCase()));
            for (const r of relaxedWithMeta) {
                const key = (r.imageUrl || r.url).toLowerCase();
                if (!seen.has(key)) { merged.push(r); seen.add(key); }
            }
            allResults.images = filterAndScoreResults(merged, 60);
        }

        // Final safety net: if still below target, pull from SerpApi (Google Images engine)
        const afterRelax = allResults.images || [];
        if (afterRelax.length < MIN_TARGET && apiKeys?.serpApi && searchConfig?.usePaidImageAPIs !== false) {
            try {
                console.log('[BSearch] Still low volume; fetching supplemental images from SerpApi');
                const serp = await searchSerpApiImages(query, apiKeys.serpApi, 0, { exactPhrases: options?.exactPhrases, autoRelax: true, sortMode: options?.sortMode });
                // pull additional pages if needed
                let serpMore = [];
                if (serp.length < 80) {
                    const p2 = await searchSerpApiImages(query, apiKeys.serpApi, 100, { exactPhrases: options?.exactPhrases, autoRelax: true, sortMode: options?.sortMode });
                    serpMore.push(...p2);
                }
                if (serp.length + serpMore.length < 120) {
                    const p3 = await searchSerpApiImages(query, apiKeys.serpApi, 200, { exactPhrases: options?.exactPhrases, autoRelax: true, sortMode: options?.sortMode });
                    serpMore.push(...p3);
                }
                const serpWithMeta = serp.map(r => ({ ...r, category: 'images', _query: query }));
                const serpMoreWithMeta = serpMore.map(r => ({ ...r, category: 'images', _query: query }));
                // Merge with existing and dedupe via curation layer
                const merged2 = [...afterRelax];
                const seen2 = new Set(afterRelax.map(r => (r.imageUrl || r.url).toLowerCase()));
                for (const r of serpWithMeta) {
                    const key = (r.imageUrl || r.url).toLowerCase();
                    if (!seen2.has(key)) { merged2.push(r); seen2.add(key); }
                }
                for (const r of serpMoreWithMeta) {
                    const key = (r.imageUrl || r.url).toLowerCase();
                    if (!seen2.has(key)) { merged2.push(r); seen2.add(key); }
                }
                allResults.images = filterAndScoreResults(merged2, 60);
            } catch (e) {
                console.warn('[BSearch] SerpApi supplement failed:', e?.message);
            }
        }
    }

    // Attach meta so UI can display total-valid counts
    // Final HEAD validation across the curated image set to drop non-images/videos
    if (allResults.images && allResults.images.length) {
        const allowedExt = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i;
        const validated = [];
        const candidates = allResults.images.slice(0, 60);
        const headResults = await Promise.allSettled(candidates.map(async r => {
            const url = r.imageUrl || r.url || '';
            if (!/^https?:\/\//i.test(url)) return { ok: false };
            if (!allowedExt.test(url)) {
                // Still allow if HEAD says it's an image
                const info = await headCheck(url);
                return { ok: info.ok && (!info.contentLength || info.contentLength >= 200_000), info, r };
            }
            const info = await headCheck(url);
            return { ok: info.ok && (!info.contentLength || info.contentLength >= 200_000), info, r };
        }));
        headResults.forEach(res => {
            if (res.status === 'fulfilled' && res.value.ok) validated.push(res.value.r);
        });
        if (validated.length) allResults.images = validated;
    }

    allResults.__meta = { totalValid: totalValidMeta };
    return allResults;
}

// Enhanced image processing with cancellation support
async function processImageResults(resultsWithCategory, query, options, cancellationSignal) {
    const qNorm = query.toLowerCase();
    const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
    const knownPhrases = ['hot ones'];
    const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
    let residual = qNorm;
    phrases.forEach(p => { residual = residual.replace(p, ' '); });
    const terms = residual.split(/\s+/).filter(Boolean);
    options.__phrases = phrases;
    options.__terms = terms;

    // For images, extract from article pages: get Open Graph/Twitter/candidate images
    for (let i = 0; i < resultsWithCategory.length; i++) {
        if (cancellationSignal?.aborted) break;
        
        const result = resultsWithCategory[i];
        try {
            const direct = result.imageUrl || result.url || '';
            if (/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(direct)) {
                result.imageUrl = direct;
                result.thumbnail = direct;
                continue;
            }
            
            const og = await fetchOpenGraphData(result.pageUrl || result.url);
            if (og && (og.image || (og.images && og.images.length))) {
                const imgs = (og.images && og.images.length) ? og.images : [{ url: og.image, alt: og.title || '' }];
                const q = (query || '').toLowerCase();
                const entityParts = q.split(/\s+(?:vs|x|and|&|with)\s+/g).map(s => s.trim()).filter(Boolean);
                
                function scoreCand(c) {
                    const alt = (c.alt || '').toLowerCase();
                    let s = 0;
                    if (alt.includes(q)) s += 3;
                    let fileName = '';
                    try { const u = new URL(c.url); fileName = (u.pathname.split('/').pop() || '').toLowerCase(); } catch {}
                    const entityAllInAlt = entityParts.length > 1 && entityParts.every(e => alt.includes(e));
                    const entityAllInName = entityParts.length > 1 && entityParts.every(e => fileName.includes(e.replace(/\s+/g,'-')) || fileName.includes(e.replace(/\s+/g,'_')) || fileName.includes(e));
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
        } catch (e) { /* ignore */ }
    }

    // Apply deduplication and filtering
    applyImageDeduplication(resultsWithCategory);
    applyImageFiltering(resultsWithCategory, query, options);
}

// Process article results with OG data
async function processArticleResults(resultsWithCategory, cancellationSignal) {
    for (let i = 0; i < resultsWithCategory.length; i++) {
        if (cancellationSignal?.aborted) break;
        
        const result = resultsWithCategory[i];
        if (!result.thumbnail) {
            try {
                const ogData = await fetchOpenGraphData(result.url);
                if (ogData && ogData.image) {
                    result.thumbnail = ogData.image;
                    console.log(`[BSearch] Added OG image for: ${result.title}`);
                }
            } catch (error) {
                console.warn(`[BSearch] Failed to fetch OG data for: ${result.url}`);
            }
        }
    }
}

// Apply post-processing with cancellation support
async function applyPostProcessing(allResults, query, settings, options, cancellationSignal) {
    // Enhanced image volume expansion for single-category image searches
    if (Object.keys(allResults).length === 1 && allResults.images) {
        const current = allResults.images || [];
        const MIN_TARGET = 25;
        
        if (current.length < MIN_TARGET && !cancellationSignal?.aborted) {
            console.log('[BSearch] Images too few, running relaxed expansion pass');
            
            try {
                const { apiKeys, searchConfig } = settings;
                const relaxedRaw = await searchCategory(
                    'images', 
                    query, 
                    apiKeys, 
                    searchConfig, 
                    0, 
                    { ...options, pass: 'relaxed', minTermMatches: 2, cancellationSignal }
                );
                
                const relaxedWithMeta = (relaxedRaw.items || relaxedRaw).map(r => ({ 
                    ...r, 
                    category: 'images', 
                    _query: query 
                }));
                
                const merged = [...current];
                const seen = new Set(current.map(r => (r.imageUrl || r.url).toLowerCase()));
                
                for (const r of relaxedWithMeta) {
                    const key = (r.imageUrl || r.url).toLowerCase();
                    if (!seen.has(key)) { 
                        merged.push(r); 
                        seen.add(key); 
                    }
                }
                
                allResults.images = filterAndScoreResults(merged, 60);
            } catch (error) {
                console.warn('[BSearch] Relaxed expansion failed:', error);
            }
        }
    }

    // Final HEAD validation for images
    if (allResults.images && allResults.images.length && !cancellationSignal?.aborted) {
        await validateImageUrls(allResults.images, cancellationSignal);
    }
}

// Helper functions for image processing
function applyImageDeduplication(results) {
    // Stronger de-duplication: collapse by normalized image filename key
    const normalizeKey = (u) => {
        try {
            const url = new URL(u);
            let name = (url.pathname.split('/').pop() || '').toLowerCase();
            name = name.replace(/\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$/, '');
            name = name.replace(/[-_]?\d{2,4}x\d{2,4}$/, '');
            return name;
        } catch { return (u || '').toLowerCase(); }
    };
    
    const bestByKey = new Map();
    for (const r of results) {
        const key = normalizeKey(r.imageUrl || r.url || '');
        const cur = bestByKey.get(key);
        const area = (Number(r.width || 0) * Number(r.height || 0)) || 0;
        const curArea = cur ? ((Number(cur.width || 0) * Number(cur.height || 0)) || 0) : 0;
        if (!cur || area > curArea) bestByKey.set(key, r);
    }
    
    // Replace array with best unique items
    while (results.length) results.pop();
    results.push(...bestByKey.values());
    
    // Drop any items without a direct image URL to avoid broken page links
    for (let i = results.length - 1; i >= 0; i--) {
        if (!results[i].imageUrl) results.splice(i, 1);
    }
}

function applyImageFiltering(results, query, options) {
    // CONTENT-FIRST relevance filtering now that OG fields are available
    const settings = {}; // Get from context if needed
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

    // Two-stage filtering
    let softKept = [];
    for (const r of results) {
        if (contentMatches(r, entities.length > 1 ? 1 : 2)) softKept.push(r);
    }
    if (softKept.length === 0) softKept = results;
    
    const strictlyKept = [];
    for (const r of softKept) {
        if (!contentMatches(r)) continue;
        const hasDims = Number(r.width) > 0 && Number(r.height) > 0;
        const mp = hasDims ? ((Number(r.width) * Number(r.height)) / 1_000_000) : 0;
        if (!hasDims || mp >= minMP) strictlyKept.push(r);
    }
    
    while (results.length) results.pop();
    results.push(...(strictlyKept.length ? strictlyKept : softKept));
}

async function validateImageUrls(images, cancellationSignal) {
    const allowedExt = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i;
    const validated = [];
    const candidates = images.slice(0, 60);
    
    const headResults = await Promise.allSettled(
        candidates.map(async r => {
            if (cancellationSignal?.aborted) return { ok: false };
            
            const url = r.imageUrl || r.url || '';
            if (!/^https?:\/\//i.test(url)) return { ok: false };
            
            if (!allowedExt.test(url)) {
                const info = await headCheck(url);
                return { ok: info.ok && (!info.contentLength || info.contentLength >= 200_000), info, r };
            }
            
            const info = await headCheck(url);
            return { ok: info.ok && (!info.contentLength || info.contentLength >= 200_000), info, r };
        })
    );
    
    headResults.forEach(res => {
        if (res.status === 'fulfilled' && res.value.ok) {
            validated.push(res.value.r);
        }
    });
    
    if (validated.length) {
        while (images.length) images.pop();
        images.push(...validated);
    }
}

// Enhanced function for loading more results with telemetry
export async function loadMoreResults(query, category, settings, offset, options = {}) {
    const timer = telemetryService.createTimer('load_more_results');
    
    try {
        console.log(`[BSearch] LoadMore: query="${query}", category="${category}", offset=${offset}`);
        
        const { apiKeys, searchConfig } = settings;
        const categoryResultsObj = await searchCategory(
            category, 
            query, 
            apiKeys, 
            searchConfig, 
            offset, 
            { ...options, enableRateLimiting: getFeatureFlag('enableRateLimiting') }
        );
        
        const categoryResults = categoryResultsObj.items || categoryResultsObj;
        
        // Add category and original query to each result for downstream scoring
        const resultsWithCategory = categoryResults.map(result => ({ 
            ...result, 
            category, 
            _query: query 
        }));
        
        console.log(`[BSearch] LoadMore: got ${categoryResults.length} raw results for ${category}`);
        
        const filteredResults = filterAndScoreResults(resultsWithCategory, 30); // Load more: up to 30 results
        
        console.log(`[BSearch] LoadMore: filtered to ${filteredResults.length} results for ${category}`);
        
        timer.end({ 
            success: true, 
            category, 
            offset, 
            resultCount: filteredResults.length 
        });
        
        return filteredResults;
        
    } catch (error) {
        timer.end({ success: false, error: error.message });
        console.error(`[BSearch] LoadMore failed for ${category}:`, error);
        throw error;
    }
}
