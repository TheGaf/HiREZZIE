// background/core/BSearch.js
import { resetDuplicateCache } from './BTrust.js';
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

// Global cache to prevent exact duplicates
let seenResults = new Set();

function resetSeenResults() {
    seenResults.clear();
    console.log('[BSearch] Reset seen results cache');
}

// Rate limiting for OG requests
const ogRequestQueue = [];
let ogProcessing = false;

async function processOGQueue() {
    if (ogProcessing || ogRequestQueue.length === 0) return;
    ogProcessing = true;
    
    while (ogRequestQueue.length > 0) {
        const { result, resolve, reject } = ogRequestQueue.shift();
        try {
            const og = await fetchOpenGraphData(result.url);
            resolve(og);
        } catch (e) {
            reject(e);
        }
        // Reduced wait time for faster processing
        await new Promise(r => setTimeout(r, 50));
    }
    ogProcessing = false;
}

function queueOGRequest(result) {
    return new Promise((resolve, reject) => {
        ogRequestQueue.push({ result, resolve, reject });
        processOGQueue();
    });
}

// RELAXED Image quality validation - Accept most images
async function validateImageQuality(result) {
    try {
        const imageUrl = result.imageUrl || result.url;
        if (!imageUrl) return false;
        
        // Quick format check first
        if (!imageUrl.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) {
            return false;
        }
        
        // If we have ANY metadata suggesting decent size, accept it
        const w = Number(result.width || 0);
        const h = Number(result.height || 0);
        const bytes = Number(result.byteSize || 0);
        
        // VERY RELAXED STANDARDS - prioritize getting results
        if (w && h) {
            const pixels = w * h;
            const is600px = w >= 600 || h >= 600;   // Very low threshold
            const is300k = pixels >= 300_000;       // 0.3MP minimum
            
            if (is300k || is600px) {
                console.log(`[BSearch] HIRES via metadata: ${w}x${h} (${Math.round(pixels/1000000)}MP)`);
                return true;
            }
        }
        
        // Accept even 30KB+ files
        if (bytes >= 30_000) {
            console.log(`[BSearch] HIRES via filesize: ${Math.round(bytes/1000)}KB`);
            return true;
        }
        
        // SKIP HEAD CHECKS - they're causing too many failures
        // Just trust that if it made it this far, it's probably good
        console.log(`[BSearch] Accepting image without HEAD check: ${imageUrl}`);
        return true;
        
    } catch (e) {
        console.warn(`[BSearch] Quality check failed for ${result.imageUrl || result.url}:`, e.message);
        // Always assume good if validation fails
        return true;
    }
}

function relevanceFirstFilter(results, maxResults = 200) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BSearch] Processing ${results.length} raw results with RELEVANCE PRIORITY`);
    
    // Only filter out exact URL duplicates
    const uniqueResults = results.filter(result => {
        // Must have a URL
        if (!result.url && !result.imageUrl) return false;
        
        const key = (result.imageUrl || result.url).toLowerCase().trim();
        if (seenResults.has(key)) {
            return false;
        }
        seenResults.add(key);
        return true;
    });
    
    console.log(`[BSearch] After deduplication: ${uniqueResults.length} results`);
    
    // RELEVANCE-FIRST SCORING - Resolution is secondary
    const scoredResults = uniqueResults.map(result => {
        let score = 0;
        
        // MASSIVE RELEVANCE BOOSTS (10x more important than resolution)
        const query = (result._query || '').toLowerCase();
        const entities = query.split(/\s+(?:and|&|vs|x|with|,|\+)\s+/g).map(s => s.trim()).filter(Boolean);
        
        if (entities.length > 1) {
            // Check all available text fields for entity mentions
            const hay = `${result.title || ''} ${result.snippet || ''} ${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.pageUrl || result.url || ''}`.toLowerCase();
            
            const entityMatches = entities.filter(e => hay.includes(e)).length;
            
            // HUGE boost for images that mention ALL entities (true collaboration)
            if (entityMatches === entities.length) {
                score += 100; // MASSIVE boost for true co-occurrence
                console.log(`[BSearch] PERFECT RELEVANCE: "${result.title}" mentions all entities: ${entities.join(', ')}`);
            }
            // Good boost for partial matches
            else if (entityMatches >= 2) {
                score += 50; // Strong boost for 2+ entities
            }
            else if (entityMatches === 1) {
                score += 20; // Moderate boost for 1 entity
            }
            
            // Extra boost for collaboration keywords
            const collabKeywords = ['together', 'collaboration', 'collab', 'with', 'featuring', 'feat', 'and', '&', 'vs', 'interview', 'podcast', 'hot ones'];
            const collabMatches = collabKeywords.filter(kw => hay.includes(kw)).length;
            if (collabMatches > 0) {
                score += collabMatches * 10;
            }
        } else {
            // Single entity queries - check for strong matches
            const hay = `${result.title || ''} ${result.snippet || ''} ${result.ogTitle || ''} ${result.ogDescription || ''} ${result.pageUrl || result.url || ''}`.toLowerCase();
            
            // Count how many times the query appears
            const queryMatches = (hay.match(new RegExp(query, 'gi')) || []).length;
            if (queryMatches >= 2) {
                score += 30; // Multiple mentions
            } else if (queryMatches === 1) {
                score += 15; // Single mention
            }
            
            // Title matches are extra important
            if ((result.title || '').toLowerCase().includes(query)) {
                score += 25;
            }
        }
        
        // MINOR resolution boosts (much smaller than relevance)
        if (result.category === 'images') {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            const bytes = Number(result.byteSize || 0);
            
            // Small boosts for verified high-res (secondary to relevance)
            if (pixelCount >= 8_000_000) score += 5;      // 8MP+ 
            else if (pixelCount >= 4_000_000) score += 4; // 4MP+
            else if (pixelCount >= 2_000_000) score += 3; // 2MP+
            else if (w >= 1000 || h >= 1000) score += 2;  // 1000px+
            else if (w >= 600 || h >= 600) score += 1;    // 600px+
            
            if (bytes >= 3_000_000) score += 3;           // 3MB+
            else if (bytes >= 1_000_000) score += 2;      // 1MB+
            else if (bytes >= 500_000) score += 1;        // 500KB+
        }
        
        return { ...result, _score: score };
    });
    
    // Sort by score (highest first) - relevance wins over resolution
    scoredResults.sort((a, b) => (b._score || 0) - (a._score || 0));
    
    const final = scoredResults.slice(0, maxResults);
    console.log(`[BSearch] Final results: ${final.length} (max: ${maxResults})`);
    
    // Log top scoring results for debugging
    final.slice(0, 5).forEach((result, i) => {
        const w = result.width || 0;
        const h = result.height || 0;
        const mp = Math.round((w * h) / 1000000);
        console.log(`[BSearch] Top result #${i+1}: "${result.title}" (RELEVANCE SCORE: ${result._score}, ${w}x${h} ${mp}MP) from ${result.source}`);
    });
    
    return final;
}

async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    console.log(`[BSearch] Searching category: ${category} for query: "${query}" with offset: ${offset}`);
    let promises = [];
    
    switch (category) {
        case 'articles':
            promises.push(searchGNews(query, apiKeys.gnews, offset, 7));
            promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 7));
            promises.push(searchBrave(query, apiKeys.brave, offset));
            break;
            
        case 'images':
            // Free sources first
            promises.push(searchBraveImages(query, apiKeys.brave, offset));
            
            // MASSIVE Bing coverage - up to 800 results
            const bingOffsets = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750];
            for (const off of bingOffsets) {
                promises.push(searchBingImages(query, off, options));
            }
            
            // Google CSE if available - multiple pages
            if (apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
                const googleOffsets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
                for (const off of googleOffsets) {
                    promises.push(searchGoogleImages(query, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, off, options));
                }
            }
            
            // SerpApi if available - multiple offsets
            if (apiKeys?.serpApi) {
                const serpOffsets = [0, 100, 200, 300, 400];
                for (const off of serpOffsets) {
                    promises.push(searchSerpApiImages(query, apiKeys.serpApi, off, options).catch(e => {
                        console.warn(`[BSearch] SerpApi failed at offset ${off}:`, e.message);
                        return [];
                    }));
                }
            }
            
            // Get images from news articles too - multiple time ranges
            promises.push(searchGNews(query, apiKeys.gnews, offset, 7));   // Last week
            promises.push(searchGNews(query, apiKeys.gnews, offset, 30));  // Last month
            promises.push(searchGNews(query, apiKeys.gnews, offset, 90));  // Last 3 months
            promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 7));
            promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 30));
            promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 90));
            
            // Multiple Brave offsets
            const braveOffsets = [0, 10, 20, 30, 40];
            for (const off of braveOffsets) {
                promises.push(searchBraveImages(query, apiKeys.brave, off));
            }
            break;
            
        case 'videos':
            promises.push(searchYouTube(query, apiKeys.youtube, offset));
            break;
    }

    console.log(`[BSearch] Making ${promises.length} API calls for ${category}`);
    
    // Wait for all promises but don't fail on individual errors
    const results = await Promise.allSettled(promises);
    
    const validResults = results
        .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
        .flatMap(res => res.value);
    
    console.log(`[BSearch] Got ${validResults.length} raw results for ${category}`);
    return validResults;
}

export async function performSearch(query, categories, settings, offset = 0, options = {}) {
    // Reset caches for new searches
    if (offset === 0) {
        resetDuplicateCache();
        resetSeenResults();
    }
    
    const { apiKeys, searchConfig } = settings;
    const allResults = {};

    for (const category of categories) {
        try {
            console.log(`[BSearch] Starting ${category} search...`);
            
            const rawResults = await searchCategory(category, query, apiKeys, searchConfig, offset, options);
            
            // Add metadata to each result
            const resultsWithMeta = rawResults.map(result => ({ 
                ...result, 
                category, 
                _query: query 
            }));
            
            // For images, extract URLs and do RELAXED quality validation
            if (category === 'images') {
                console.log(`[BSearch] Processing ${resultsWithMeta.length} image results with RELEVANCE PRIORITY...`);
                
                // Extract direct image URLs (rate limited)
                const needsOG = resultsWithMeta
                    .filter(result => !result.imageUrl?.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i))
                    .slice(0, 20);
                
                for (const result of needsOG) {
                    try {
                        const og = await queueOGRequest(result);
                        if (og?.image) {
                            result.imageUrl = og.image;
                            result.thumbnail = og.image;
                            result.ogTitle = og.title;
                            result.ogDescription = og.description;
                            result.ogAlt = og.alt;
                        }
                    } catch (e) {
                        if (result.url?.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) {
                            result.imageUrl = result.url;
                        }
                    }
                }
                
                // Ensure all results have imageUrl
                for (const result of resultsWithMeta) {
                    if (!result.imageUrl) {
                        result.imageUrl = result.url;
                    }
                    if (!result.thumbnail) {
                        result.thumbnail = result.imageUrl || result.url;
                    }
                }
                
                // RELAXED QUALITY VALIDATION - Much more permissive
                console.log(`[BSearch] Validating image quality with RELAXED standards for ${resultsWithMeta.length} results...`);
                const qualityPromises = resultsWithMeta.map(async (result) => {
                    const isAcceptable = await validateImageQuality(result);
                    return isAcceptable ? result : null;
                });
                
                // Process in smaller batches for speed
                const qualityResults = [];
                const batchSize = 20;
                for (let i = 0; i < qualityPromises.length; i += batchSize) {
                    const batch = qualityPromises.slice(i, i + batchSize);
                    const batchResults = await Promise.all(batch);
                    qualityResults.push(...batchResults.filter(Boolean));
                    
                    // Very small delay between batches
                    if (i + batchSize < qualityPromises.length) {
                        await new Promise(r => setTimeout(r, 50));
                    }
                }
                
                console.log(`[BSearch] Quality validation completed: ${qualityResults.length}/${resultsWithMeta.length} passed (RELAXED STANDARDS)`);
                
                // Use RELEVANCE-FIRST filtering
                allResults[category] = relevanceFirstFilter(qualityResults, 200);
            } else {
                // Non-images don't need quality validation
                allResults[category] = relevanceFirstFilter(resultsWithMeta, 200);
            }
            
            console.log(`[BSearch] ${category} completed: ${allResults[category].length} results (RELEVANCE PRIORITIZED)`);
            
        } catch (error) {
            console.error(`[BSearch] ${category} search failed:`, error);
            allResults[category] = [];
        }
    }

    console.log('[BSearch] Search completed:', Object.keys(allResults).map(k => `${k}: ${allResults[k].length}`));
    return allResults;
}

export async function loadMoreResults(query, category, settings, offset, options = {}) {
    console.log(`[BSearch] LoadMore: query="${query}", category="${category}", offset=${offset}`);
    
    try {
        const { apiKeys, searchConfig } = settings;
        const rawResults = await searchCategory(category, query, apiKeys, searchConfig, offset, options);
        
        const resultsWithMeta = rawResults.map(result => ({ 
            ...result, 
            category, 
            _query: query 
        }));
        
        // Quality validation for load more too
        if (category === 'images') {
            const qualityPromises = resultsWithMeta.map(async (result) => {
                if (!result.imageUrl) result.imageUrl = result.url;
                if (!result.thumbnail) result.thumbnail = result.imageUrl || result.url;
                
                const isAcceptable = await validateImageQuality(result);
                return isAcceptable ? result : null;
            });
            
            const qualityResults = (await Promise.all(qualityPromises)).filter(Boolean);
            const filtered = relevanceFirstFilter(qualityResults, 50);
            console.log(`[BSearch] LoadMore completed: ${filtered.length} quality results (RELEVANCE PRIORITIZED)`);
            return filtered;
        } else {
            const filtered = relevanceFirstFilter(resultsWithMeta, 50);
            console.log(`[BSearch] LoadMore completed: ${filtered.length} results (RELEVANCE PRIORITIZED)`);
            return filtered;
        }
        
    } catch (error) {
        console.error('[BSearch] LoadMore failed:', error);
        return [];
    }
}
