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

// ULTRA-RELAXED Image quality validation - Accept almost everything
async function validateImageQuality(result) {
    try {
        const imageUrl = result.imageUrl || result.url;
        if (!imageUrl) return false;
        
        // Quick format check - accept more formats
        if (!imageUrl.match(/\.(jpg|jpeg|png|webp|avif|gif|bmp)(\?|#|$)/i)) {
            return false;
        }
        
        // If we have ANY size metadata, trust it
        const w = Number(result.width || 0);
        const h = Number(result.height || 0);
        const bytes = Number(result.byteSize || 0);
        
        // EXTREMELY PERMISSIVE STANDARDS
        if (w && h) {
            // Accept anything 400px+ on ANY side
            if (w >= 400 || h >= 400) {
                console.log(`[BSearch] ACCEPTED via metadata: ${w}x${h}`);
                return true;
            }
        }
        
        // Accept tiny files even (10KB+)
        if (bytes >= 10_000) {
            console.log(`[BSearch] ACCEPTED via filesize: ${Math.round(bytes/1000)}KB`);
            return true;
        }
        
        // NO HEAD CHECKS - just accept everything that looks like an image
        console.log(`[BSearch] ACCEPTING image (no validation): ${imageUrl}`);
        return true;
        
    } catch (e) {
        // Always accept if validation fails
        return true;
    }
}

function relevanceFirstFilter(results, maxResults = 50) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BSearch] Processing ${results.length} raw results with SIMPLE OR LOGIC (like Google Images)`);
    
    // Only filter out exact URL duplicates
    const uniqueResults = results.filter(result => {
        if (!result.url && !result.imageUrl) return false;
        
        const key = (result.imageUrl || result.url).toLowerCase().trim();
        if (seenResults.has(key)) {
            return false;
        }
        seenResults.add(key);
        return true;
    });
    
    console.log(`[BSearch] After deduplication: ${uniqueResults.length} results`);
    
    // SIMPLE OR LOGIC - Just like Google Images!
    const scoredResults = uniqueResults.map(result => {
        let score = 0;
        
        const query = (result._query || '').toLowerCase();
        
        // Split query into individual search terms
        const searchTerms = query.split(/\s+/).filter(Boolean);
        
        console.log(`[BSearch] Search terms: [${searchTerms.join(', ')}]`);
        
        // Check all available text fields for ANY search term (OR logic)
        const haystack = `${result.title || ''} ${result.snippet || ''} ${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.pageUrl || result.url || ''}`.toLowerCase();
        
        // Count matches for each search term
        let termMatches = 0;
        let totalMatches = 0;
        
        for (const term of searchTerms) {
            const matches = (haystack.match(new RegExp(term, 'gi')) || []).length;
            if (matches > 0) {
                termMatches++;
                totalMatches += matches;
                console.log(`[BSearch] Found "${term}" ${matches} times in "${result.title}"`);
            }
        }
        
        // SIMPLE SCORING - Google Images style
        if (termMatches > 0) {
            // Base score for having ANY search term
            score += 50;
            
            // Bonus for multiple term matches
            score += (termMatches - 1) * 20;
            
            // Bonus for multiple occurrences
            score += Math.min(totalMatches * 5, 25);
            
            // Extra bonus for title matches
            const titleMatches = searchTerms.filter(term => 
                (result.title || '').toLowerCase().includes(term)
            ).length;
            
            if (titleMatches > 0) {
                score += titleMatches * 15;
            }
            
            console.log(`[BSearch] "${result.title}" RELEVANCE SCORE: ${score} (${termMatches}/${searchTerms.length} terms matched)`);
        } else {
            console.log(`[BSearch] "${result.title}" NO MATCHES - RELEVANCE SCORE: 0`);
        }
        
        // Small resolution boosts (much smaller than relevance)
        if (result.category === 'images') {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            const bytes = Number(result.byteSize || 0);
            
            // Tiny boosts for verified high-res (secondary to relevance)
            if (pixelCount >= 8_000_000) score += 3;      // 8MP+ 
            else if (pixelCount >= 4_000_000) score += 2; // 4MP+
            else if (pixelCount >= 2_000_000) score += 1; // 2MP+
            
            if (bytes >= 3_000_000) score += 2;           // 3MB+
            else if (bytes >= 1_000_000) score += 1;      // 1MB+
        }
        
        return { ...result, _score: score };
    });
    
    // Sort by relevance score (highest first)
    scoredResults.sort((a, b) => (b._score || 0) - (a._score || 0));
    
    const final = scoredResults.slice(0, maxResults);
    console.log(`[BSearch] Final results: ${final.length} (TOP ${maxResults})`);
    
    // Log top scoring results
    final.slice(0, 10).forEach((result, i) => {
        const w = result.width || 0;
        const h = result.height || 0;
        const mp = Math.round((w * h) / 1000000);
        console.log(`[BSearch] #${i+1}: "${result.title}" (SCORE: ${result._score}, ${w}x${h} ${mp}MP) from ${result.source}`);
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
            
            // Get images from news articles too
            promises.push(searchGNews(query, apiKeys.gnews, offset, 7));
            promises.push(searchGNews(query, apiKeys.gnews, offset, 30));
            promises.push(searchGNews(query, apiKeys.gnews, offset, 90));
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
    
    const results = await Promise.allSettled(promises);
    
    const validResults = results
        .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
        .flatMap(res => res.value);
    
    console.log(`[BSearch] Got ${validResults.length} raw results for ${category}`);
    return validResults;
}

export async function performSearch(query, categories, settings, offset = 0, options = {}) {
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
            
            const resultsWithMeta = rawResults.map(result => ({ 
                ...result, 
                category, 
                _query: query 
            }));
            
            if (category === 'images') {
                console.log(`[BSearch] Processing ${resultsWithMeta.length} image results with SIMPLE OR LOGIC (TOP 50)...`);
                
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
                
                // ULTRA-RELAXED QUALITY VALIDATION
                console.log(`[BSearch] Validating image quality with ULTRA-RELAXED standards for ${resultsWithMeta.length} results...`);
                const qualityPromises = resultsWithMeta.map(async (result) => {
                    const isAcceptable = await validateImageQuality(result);
                    return isAcceptable ? result : null;
                });
                
                const qualityResults = [];
                const batchSize = 20;
                for (let i = 0; i < qualityPromises.length; i += batchSize) {
                    const batch = qualityPromises.slice(i, i + batchSize);
                    const batchResults = await Promise.all(batch);
                    qualityResults.push(...batchResults.filter(Boolean));
                    
                    if (i + batchSize < qualityPromises.length) {
                        await new Promise(r => setTimeout(r, 50));
                    }
                }
                
                console.log(`[BSearch] Quality validation completed: ${qualityResults.length}/${resultsWithMeta.length} passed (ULTRA-RELAXED)`);
                
                // Use SIMPLE OR LOGIC filtering with TOP 50 limit
                allResults[category] = relevanceFirstFilter(qualityResults, 50);
            } else {
                allResults[category] = relevanceFirstFilter(resultsWithMeta, 50);
            }
            
            console.log(`[BSearch] ${category} completed: ${allResults[category].length} results (TOP 50 SIMPLE OR LOGIC)`);
            
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
        
        if (category === 'images') {
            const qualityPromises = resultsWithMeta.map(async (result) => {
                if (!result.imageUrl) result.imageUrl = result.url;
                if (!result.thumbnail) result.thumbnail = result.imageUrl || result.url;
                
                const isAcceptable = await validateImageQuality(result);
                return isAcceptable ? result : null;
            });
            
            const qualityResults = (await Promise.all(qualityPromises)).filter(Boolean);
            const filtered = relevanceFirstFilter(qualityResults, 50);
            console.log(`[BSearch] LoadMore completed: ${filtered.length} quality results (TOP 50 SIMPLE OR LOGIC)`);
            return filtered;
        } else {
            const filtered = relevanceFirstFilter(resultsWithMeta, 50);
            console.log(`[BSearch] LoadMore completed: ${filtered.length} results (TOP 50 SIMPLE OR LOGIC)`);
            return filtered;
        }
        
    } catch (error) {
        console.error('[BSearch] LoadMore failed:', error);
        return [];
    }
}
