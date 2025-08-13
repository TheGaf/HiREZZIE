// background/core/BTrust.js - Enhanced with performance optimizations
import { telemetry } from '../../utils/telemetry.js';

// Sources to completely filter out (optimized as a Set for O(1) lookups)
const BLOCKED_SOURCES_SET = new Set([
    'facebook.com',
    'pinterest.com',
    'tiktok.com',
    'twitter.com',
    'x.com',
    'snapchat.com',
    'linkedin.com',
    'tumblr.com',
    'reddit.com', 'redd.it',
    'flickr.com',
    'deviantart.com',
    'behance.net',
    '500px.com',
    // Social/CDN platforms (hard blocked)
    'youtube.com', 'youtu.be', 'ytimg.com',
    'fbcdn.net', 'fbsbx.com',
    'threads.net',
    'tiktokcdn.com', 'ttwcdn.com',
    'twimg.com', 't.co',
    'imgur.com', 'giphy.com',
    'vk.com', 'weibo.com', 'bilibili.com',
    'unsplash.com',
    'pexels.com',
    'shutterstock.com',
    'gettyimages.com',
    'istockphoto.com',
    'adobe.com',
    'canva.com',
    'medium.com',
    'substack.com',
    'quora.com',
    'buzzfeed.com',
    'vice.com',
    'vox.com',
    'huffpost.com',
    'huffingtonpost.com',
    'boredpanda.com',
    'distractify.com',
    'viralnova.com',
    'upworthy.com',
    'littlethings.com',
    'wikimedia.org',
    // Commerce/merch listing domains
    'lazada.vn', 'lazada.com', 'shopee', 'mercari', 'poshmark.com', 'ebay.com', 'amazon.com', 'shopify.com', 'merchbar.com', 'weverse.io', 'kpopmart', 'kpopstore',
    'walmart.com', 'target.com', 'bestbuy.com', 'aliexpress.com', 'alibaba.com', 'etsy.com', 'redbubble.com', 'teepublic.com', 'zazzle.com', 'cafepress.com',
    'stockx.com', 'goat.com', 'flightclub.com', 'stadiumgoods.com', 'sneakersnstuff.com', 'footlocker.com', 'finishline.com', 'eastbay.com', 'champssports.com', 'hibbett.com', 'jdsports.com',
    'nike.com', 'adidas.com', 'newbalance.com', 'reebok.com', 'puma.com',
    'sneakernews.com', 'solecollector.com', 'nicekicks.com'
]);

// Optimized blocked source checking with caching
const hostnameCache = new Map();
const blockedSubdomainPrefixes = ['store.', 'shop.', 'merch.'];

function isBlockedSource(sourceName, url) {
    if (!sourceName && !url) return false;
    
    const sourceLower = sourceName ? sourceName.toLowerCase() : '';
    const urlLower = url ? url.toLowerCase() : '';
    
    // Parse hostname with caching
    let host = '';
    if (url) {
        host = hostnameCache.get(url);
        if (!host) {
            try { 
                host = new URL(url).hostname.toLowerCase();
                hostnameCache.set(url, host);
                
                // Limit cache size to prevent memory bloat
                if (hostnameCache.size > 1000) {
                    const firstKey = hostnameCache.keys().next().value;
                    hostnameCache.delete(firstKey);
                }
            } catch {
                host = '';
            }
        }
    }
    
    // Check subdomain blocks (optimized)
    const subdomainBlocked = blockedSubdomainPrefixes.some(prefix => host.startsWith(prefix));
    if (subdomainBlocked) return true;
    
    // Direct set lookups (O(1) complexity)
    if (BLOCKED_SOURCES_SET.has(host)) return true;
    
    // Fallback string includes checks (for partial matches)
    return BLOCKED_SOURCES_SET.has(sourceLower) || 
           Array.from(BLOCKED_SOURCES_SET).some(blocked => 
               sourceLower.includes(blocked) || urlLower.includes(blocked)
           );
}

// Optimized English content detection with caching
const languageDetectionCache = new Map();

function isEnglishContent(title, snippet) {
    const text = `${title} ${snippet || ''}`;
    
    // Check cache first
    const cached = languageDetectionCache.get(text);
    if (cached !== undefined) return cached;
    
    // Check if content contains non-English characters
    const nonEnglishRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/;
    const isEnglish = !nonEnglishRegex.test(text);
    
    // Cache result
    languageDetectionCache.set(text, isEnglish);
    
    // Limit cache size
    if (languageDetectionCache.size > 500) {
        const firstKey = languageDetectionCache.keys().next().value;
        languageDetectionCache.delete(firstKey);
    }
    
    return isEnglish;
}

// Enhanced global cache to prevent duplicates across searches
class DuplicateCache {
    constructor() {
        this.seenUrls = new Set();
        this.seenSignatures = new Map();
        this.stats = {
            duplicatesBlocked: 0,
            uniqueItemsProcessed: 0
        };
    }

    has(url) {
        return this.seenUrls.has(url.toLowerCase().trim());
    }

    add(url) {
        this.seenUrls.add(url.toLowerCase().trim());
        this.stats.uniqueItemsProcessed++;
    }

    hasSignature(signature) {
        return this.seenSignatures.has(signature);
    }

    addSignature(signature, result) {
        this.seenSignatures.set(signature, result);
    }

    getBySignature(signature) {
        return this.seenSignatures.get(signature);
    }

    clear() {
        this.seenUrls.clear();
        this.seenSignatures.clear();
        this.stats = {
            duplicatesBlocked: 0,
            uniqueItemsProcessed: 0
        };
        console.log('[BTrust] Duplicate cache cleared');
    }

    getStats() {
        return {
            ...this.stats,
            urlCacheSize: this.seenUrls.size,
            signatureCacheSize: this.seenSignatures.size
        };
    }
}

const duplicateCache = new DuplicateCache();

// Optimized image signature normalization with caching
const signatureCache = new Map();

function normalizeImageSignature(imageUrl, width, height) {
    const cacheKey = `${imageUrl}|${width}|${height}`;
    const cached = signatureCache.get(cacheKey);
    if (cached) return cached;

    let signature;
    try {
        const url = new URL(imageUrl);
        let name = url.pathname.split('/').pop() || '';
        let base = name.toLowerCase();
        
        // Strip extension
        base = base.replace(/\.(jpg|jpeg|png|webp|gif|bmp|tiff|svg)(\?.*)?$/, '');
        
        // Remove common size/dimension and variant suffixes (optimized regex)
        base = base
            .replace(/[-_]?\d{2,4}x\d{2,4}$/, '')
            .replace(/@\d+x$/, '')
            .replace(/[-_](scaled|large|medium|small|thumbnail|thumb|cropped|edited|retina|hd|uhd|4k|8k)$/, '')
            .replace(/[-_]{2,}/g, '-');
            
        const w = Number(width || 0);
        const h = Number(height || 0);
        const wb = Math.round(w / 64);
        const hb = Math.round(h / 64);
        signature = `${base}|${wb}x${hb}`;
    } catch {
        signature = imageUrl;
    }

    // Cache the result
    signatureCache.set(cacheKey, signature);
    
    // Limit cache size
    if (signatureCache.size > 1000) {
        const firstKey = signatureCache.keys().next().value;
        signatureCache.delete(firstKey);
    }

    return signature;
}

// Enhanced deduplication with performance optimization
function dedupeImagesBySignature(results) {
    const startTime = Date.now();
    telemetry.startTimer('dedupe_images');
    
    const signatureToBest = new Map();
    const processed = [];
    
    for (const r of results) {
        const imgUrl = r.imageUrl || r.url || '';
        if (!imgUrl) continue;
        
        const sig = normalizeImageSignature(imgUrl, r.width, r.height);
        const existing = signatureToBest.get(sig);
        
        if (!existing) {
            signatureToBest.set(sig, r);
            processed.push(r);
            continue;
        }
        
        // Prefer higher pixel count with optimized calculation
        const existingArea = (Number(existing.width || 0) * Number(existing.height || 0)) || 0;
        const currentArea = (Number(r.width || 0) * Number(r.height || 0)) || 0;
        
        if (currentArea > existingArea) {
            // Replace in both map and array
            signatureToBest.set(sig, r);
            const index = processed.indexOf(existing);
            if (index !== -1) {
                processed[index] = r;
            }
        }
    }
    
    telemetry.endTimer('dedupe_images');
    telemetry.trackEvent('dedupe_complete', {
        inputCount: results.length,
        outputCount: processed.length,
        duplicatesRemoved: results.length - processed.length,
        duration: Date.now() - startTime
    });
    
    return processed;
}

// Enhanced main filtering and scoring function with comprehensive performance optimizations
export function filterAndScoreResults(results, maxResults = 20) {
    const startTime = Date.now();
    telemetry.startTimer('filter_and_score');
    
    if (!results || results.length === 0) {
        telemetry.endTimer('filter_and_score');
        return [];
    }

    console.log(`[BTrust] Processing ${results.length} results for curation`);
    telemetry.trackEvent('curation_start', {
        inputCount: results.length,
        maxResults
    });
    
    // Phase 1: Filter out blocked sources and non-English content with optimized processing
    const filteredResults = results.filter(result => {
        if (!result) return false;
        
        const blocked = isBlockedSource(result.source, result.url);
        const english = isEnglishContent(result.title, result.snippet);
        const hasImageUrl = result.imageUrl || /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '');

        if (blocked) {
            telemetry.trackEvent('result_filtered', { reason: 'blocked_source', source: result.source });
        }
        if (!english) {
            telemetry.trackEvent('result_filtered', { reason: 'non_english', title: result.title?.substring(0, 50) });
        }
        if (!hasImageUrl) {
            telemetry.trackEvent('result_filtered', { reason: 'no_image_url' });
        }
        
        return !blocked && english && hasImageUrl;
    });
    
    console.log(`[BTrust] After filtering blocked sources: ${filteredResults.length} results`);
    
    // Phase 2: Enhanced deduplication based on content type
    let uniqueResults;
    if (filteredResults.length > 0 && filteredResults[0].category === 'images') {
        // Special image de-duplication with performance optimization
        const deduped = dedupeImagesBySignature(filteredResults);
        
        // Guard against exact URL dupes with optimized checking
        uniqueResults = deduped.filter(result => {
            const key = (result.imageUrl || result.url).toLowerCase().trim();
            if (duplicateCache.has(key)) {
                duplicateCache.stats.duplicatesBlocked++;
                return false;
            }
            duplicateCache.add(key);
            return true;
        });
    } else {
        // Only filter out exact URL duplicates (very lenient)
        uniqueResults = filteredResults.filter(result => {
            const key = result.url.toLowerCase().trim();
            if (duplicateCache.has(key)) {
                console.log(`[BTrust] Exact duplicate URL detected: "${result.url}" - skipping`);
                duplicateCache.stats.duplicatesBlocked++;
                return false;
            }
            duplicateCache.add(key);
            return true;
        });
    }
    
    // Phase 3: Enhanced diversity and volume management
    uniqueResults = ensureMinimumResults(uniqueResults, filteredResults, 25);
    
    console.log(`[BTrust] After removing duplicates: ${uniqueResults.length} results`);
    
    // Phase 4: Final volume boost if needed
    uniqueResults = ensureMinimumResults(uniqueResults, filteredResults, 50, true);

    // Phase 5: Enhanced scoring with performance optimization
    const scoredResults = performEnhancedScoring(uniqueResults);

    // Phase 6: Final sorting and limiting
    scoredResults.sort((a, b) => {
        const boostDiff = (b._hiresBoost || 0) - (a._hiresBoost || 0);
        if (boostDiff !== 0) return boostDiff;
        const pa = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const pb = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        return pb - pa;
    });

    const finalResults = scoredResults.slice(0, maxResults);
    
    const duration = Date.now() - startTime;
    telemetry.endTimer('filter_and_score');
    telemetry.trackEvent('curation_complete', {
        inputCount: results.length,
        filteredCount: filteredResults.length,
        uniqueCount: uniqueResults.length,
        finalCount: finalResults.length,
        duration,
        duplicatesBlocked: duplicateCache.stats.duplicatesBlocked
    });
    
    console.log(`[BTrust] Curation completed in ${duration}ms: ${results.length} -> ${finalResults.length} results`);
    return finalResults;
}

// Ensure minimum results with intelligent diversity management
function ensureMinimumResults(uniqueResults, filteredResults, targetCount, isFinalBoost = false) {
    if (uniqueResults.length >= targetCount) return uniqueResults;
    
    console.log(`[BTrust] Only ${uniqueResults.length} unique results, adding more from filtered results (target: ${targetCount})`);
    
    const additionalResults = [];
    const byHost = new Map();
    const usedUrls = new Set(uniqueResults.map(r => (r.imageUrl || r.url).toLowerCase().trim()));
    
    // Group remaining results by host for diversity
    for (const r of filteredResults) {
        const key = (r.imageUrl || r.url).toLowerCase().trim();
        if (usedUrls.has(key)) continue;
        
        const host = getHostname(r.pageUrl || r.url || '');
        if (!byHost.has(host)) byHost.set(host, []);
        byHost.get(host).push(r);
    }
    
    // Interleave by host for diversity (optimized)
    const hostKeys = Array.from(byHost.keys());
    let pointer = 0;
    const maxAdditional = targetCount - uniqueResults.length;
    
    while (additionalResults.length < maxAdditional && hostKeys.length > 0) {
        const host = hostKeys[pointer % hostKeys.length];
        const bucket = byHost.get(host);
        const candidate = bucket && bucket.shift();
        
        if (candidate) {
            additionalResults.push(candidate);
            usedUrls.add((candidate.imageUrl || candidate.url).toLowerCase().trim());
        } else {
            hostKeys.splice(pointer % hostKeys.length, 1);
            continue;
        }
        pointer++;
    }
    
    // Handle relaxed deduplication for final boost
    if (isFinalBoost && additionalResults.length < maxAdditional) {
        additionalResults.push(...handleRelaxedDeduplication(
            uniqueResults, 
            filteredResults, 
            usedUrls, 
            maxAdditional - additionalResults.length
        ));
    }
    
    return [...uniqueResults, ...additionalResults];
}

// Handle relaxed deduplication for better volume
function handleRelaxedDeduplication(uniqueResults, filteredResults, usedUrls, remainingSlots) {
    console.log('[BTrust] Applying relaxed duplicate policy to include variants');
    
    const signatureCounts = new Map();
    const additionalResults = [];
    
    // Count existing signatures
    for (const r of uniqueResults) {
        const sig = normalizeImageSignature(r.imageUrl || r.url || '', r.width, r.height);
        signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1);
    }
    
    for (const r of filteredResults) {
        if (additionalResults.length >= remainingSlots) break;
        
        const key = (r.imageUrl || r.url).toLowerCase().trim();
        if (usedUrls.has(key)) continue;
        
        const sig = normalizeImageSignature(r.imageUrl || r.url || '', r.width, r.height);
        const host = getHostname(r.pageUrl || r.url || '');
        
        // Check for exact same signature + host combination
        const existingIdx = uniqueResults.findIndex(x => {
            const xSig = normalizeImageSignature(x.imageUrl || x.url || '', x.width, x.height);
            const xHost = getHostname(x.pageUrl || x.url || '');
            return xSig === sig && xHost === host;
        });
        
        if (existingIdx !== -1) continue;
        
        // Allow up to 2 variants per signature across different hosts
        if ((signatureCounts.get(sig) || 0) >= 2) continue;
        
        additionalResults.push(r);
        usedUrls.add(key);
        signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1);
    }
    
    return additionalResults;
}

// Enhanced scoring with performance optimization
function performEnhancedScoring(results) {
    telemetry.startTimer('enhanced_scoring');
    
    const scoredResults = results.map(result => {
        let scoreBoost = 0;
        
        if (result.category === 'images') {
            // Pixel count boost (optimized calculation)
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            
            if (pixelCount >= 8_000_000) scoreBoost += 2;      // 8MP+
            else if (pixelCount >= 4_000_000) scoreBoost += 1; // 4MP+

            // Co-occurrence boost with optimized text processing
            scoreBoost += calculateCooccurrenceBoost(result);
        }
        
        const curatedResult = { 
            ...result, 
            curated: true,
            curationMessage: "I personally curated this from the best sources available",
            _hiresBoost: scoreBoost
        };
        
        return curatedResult;
    });
    
    telemetry.endTimer('enhanced_scoring');
    return scoredResults;
}

// Optimized co-occurrence boost calculation
function calculateCooccurrenceBoost(result) {
    const query = (result._query || '').toLowerCase();
    if (!query) return 0;
    
    // Optimized entity extraction
    const entities = query.split(/\s+(?:and|&|vs|x|with)\s+/g)
        .map(s => s.trim())
        .filter(Boolean);
    
    const haystack = [
        result.ogTitle || '',
        result.ogDescription || '',
        result.ogAlt || '',
        result.title || '',
        result.pageUrl || ''
    ].join(' ').toLowerCase();
    
    if (entities.length > 1) {
        const allMatch = entities.every(e => haystack.includes(e));
        const anyMatch = entities.some(e => haystack.includes(e));
        
        if (allMatch) return 4; // Strong co-occurrence
        if (anyMatch) return 1;  // Partial match
        return 0;
    } else {
        // Fallback: token coverage
        const tokens = query.split(/\s+/).filter(Boolean);
        const matches = tokens.filter(t => haystack.includes(t)).length;
        
        if (matches >= Math.min(3, tokens.length)) return 2;
        if (matches >= 2) return 1;
        return 0;
    }
}

// Optimized hostname extraction with caching
function getHostname(url) {
    if (!url) return 'unknown';
    
    const cached = hostnameCache.get(url);
    if (cached) return cached;
    
    let hostname = 'unknown';
    try {
        hostname = new URL(url).hostname;
        hostnameCache.set(url, hostname);
    } catch {}
    
    return hostname;
}

// Enhanced function to reset the duplicate cache for new searches
export function resetDuplicateCache() {
    duplicateCache.clear();
    
    // Also clear other caches periodically to prevent memory bloat
    if (Math.random() < 0.1) { // 10% chance
        if (hostnameCache.size > 500) {
            const keysToDelete = Array.from(hostnameCache.keys()).slice(0, 100);
            keysToDelete.forEach(key => hostnameCache.delete(key));
        }
        
        if (languageDetectionCache.size > 250) {
            const keysToDelete = Array.from(languageDetectionCache.keys()).slice(0, 50);
            keysToDelete.forEach(key => languageDetectionCache.delete(key));
        }
        
        if (signatureCache.size > 500) {
            const keysToDelete = Array.from(signatureCache.keys()).slice(0, 100);
            keysToDelete.forEach(key => signatureCache.delete(key));
        }
    }
    
    telemetry.trackEvent('duplicate_cache_reset', duplicateCache.getStats());
    console.log('[BTrust] Duplicate cache reset for new search');
}

// Performance monitoring and statistics
export function getTrustPerformanceStats() {
    return {
        duplicateCache: duplicateCache.getStats(),
        cacheStats: {
            hostname: hostnameCache.size,
            languageDetection: languageDetectionCache.size,
            signature: signatureCache.size
        },
        telemetry: telemetry.getPerformanceStats('trust')
    };
}

// Clear all internal caches for testing/debugging
export function clearTrustCaches() {
    duplicateCache.clear();
    hostnameCache.clear();
    languageDetectionCache.clear();
    signatureCache.clear();
    
    telemetry.trackEvent('trust_caches_cleared');
    console.log('[BTrust] All trust caches cleared');
}

// Optimized bulk operations for better performance
export function filterAndScoreResultsBulk(resultBatches, maxResults = 20) {
    const startTime = Date.now();
    telemetry.startTimer('bulk_filter_score');
    
    try {
        const allResults = [];
        
        for (const batch of resultBatches) {
            const batchResults = filterAndScoreResults(batch, Math.ceil(maxResults / resultBatches.length));
            allResults.push(...batchResults);
        }
        
        // Final deduplication and scoring across all batches
        const finalResults = performEnhancedScoring(allResults);
        finalResults.sort((a, b) => {
            const boostDiff = (b._hiresBoost || 0) - (a._hiresBoost || 0);
            if (boostDiff !== 0) return boostDiff;
            const pa = (Number(a.width || 0) * Number(a.height || 0)) || 0;
            const pb = (Number(b.width || 0) * Number(b.height || 0)) || 0;
            return pb - pa;
        });
        
        const result = finalResults.slice(0, maxResults);
        
        telemetry.endTimer('bulk_filter_score');
        telemetry.trackEvent('bulk_curation_complete', {
            batchCount: resultBatches.length,
            totalInput: resultBatches.reduce((sum, batch) => sum + batch.length, 0),
            finalOutput: result.length,
            duration: Date.now() - startTime
        });
        
        return result;
        
    } catch (error) {
        telemetry.endTimer('bulk_filter_score');
        telemetry.trackEvent('bulk_curation_error', {
            error: error.message,
            duration: Date.now() - startTime
        });
        throw error;
    }
}

// Smart scoring for specific content types
export function scoreImageQuality(result) {
    let qualityScore = 0;
    
    // Resolution scoring
    const w = Number(result.width || 0);
    const h = Number(result.height || 0);
    const pixelCount = w * h;
    
    if (pixelCount >= 16_000_000) qualityScore += 10; // 16MP+
    else if (pixelCount >= 8_000_000) qualityScore += 8;  // 8MP+
    else if (pixelCount >= 4_000_000) qualityScore += 6;  // 4MP+
    else if (pixelCount >= 2_000_000) qualityScore += 4;  // 2MP+
    else if (pixelCount >= 1_000_000) qualityScore += 2;  // 1MP+
    
    // Aspect ratio scoring (prefer reasonable ratios)
    if (w > 0 && h > 0) {
        const aspectRatio = Math.max(w, h) / Math.min(w, h);
        if (aspectRatio <= 2) qualityScore += 2; // Good aspect ratio
        else if (aspectRatio <= 3) qualityScore += 1; // Acceptable
        // Extreme ratios get no bonus
    }
    
    // Source quality indicators
    if (result.source) {
        const source = result.source.toLowerCase();
        if (source.includes('getty') || source.includes('shutterstock')) {
            qualityScore -= 5; // Watermarked/commercial
        } else if (source.includes('wikipedia') || source.includes('gov')) {
            qualityScore += 3; // High quality sources
        }
    }
    
    return qualityScore;
}

// Memory-efficient batch processing for large result sets
export function processResultsInBatches(results, batchSize = 50, processor = filterAndScoreResults) {
    const batches = [];
    for (let i = 0; i < results.length; i += batchSize) {
        batches.push(results.slice(i, i + batchSize));
    }
    
    return batches.map(batch => processor(batch));
}
