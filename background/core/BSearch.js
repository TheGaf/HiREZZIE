// background/core/BSearch.js
import { resetDuplicateCache } from './BTrust.js';
import { fetchOpenGraphData } from '../utils/BUtils.js';
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

function simpleFilter(results, maxResults = 50) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BSearch] Processing ${results.length} raw results`);
    
    // Only filter out exact URL duplicates - ACCEPT EVERYTHING ELSE
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
    
    // Add advanced scoring for co-occurrence
    const scoredResults = uniqueResults.map(result => {
        let score = 0;
        
        // Boost high-res images
        if (result.category === 'images') {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            if (pixelCount >= 8_000_000) score += 3;
            else if (pixelCount >= 4_000_000) score += 2;
            else if (pixelCount >= 2_000_000) score += 1;
        }
        
        // ENHANCED co-occurrence scoring
        const query = (result._query || '').toLowerCase();
        const entities = query.split(/\s+(?:and|&|vs|x|with|,|\+)\s+/g).map(s => s.trim()).filter(Boolean);
        
        if (entities.length > 1) {
            // Check all available text fields for entity mentions
            const hay = `${result.title || ''} ${result.snippet || ''} ${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.pageUrl || result.url || ''}`.toLowerCase();
            
            const entityMatches = entities.filter(e => hay.includes(e)).length;
            
            // HUGE boost for images that mention ALL entities (true collaboration)
            if (entityMatches === entities.length) {
                score += 10; // Massive boost for true co-occurrence
                console.log(`[BSearch] TRUE CO-OCCURRENCE found: "${result.title}" mentions all entities: ${entities.join(', ')}`);
            }
            // Good boost for partial matches
            else if (entityMatches > 0) {
                score += entityMatches * 2;
            }
            
            // Extra boost for collaboration keywords
            const collabKeywords = ['together', 'collaboration', 'collab', 'with', 'featuring', 'feat', 'and', '&', 'vs', 'interview', 'podcast', 'hot ones'];
            const collabMatches = collabKeywords.filter(kw => hay.includes(kw)).length;
            if (collabMatches > 0) {
                score += collabMatches;
            }
        }
        
        return { ...result, _score: score };
    });
    
    // Sort by score (highest first) - true collaborations will be at top
    scoredResults.sort((a, b) => (b._score || 0) - (a._score || 0));
    
    const final = scoredResults.slice(0, maxResults);
    console.log(`[BSearch] Final results: ${final.length} (max: ${maxResults})`);
    
    // Log top scoring results for debugging
    final.slice(0, 5).forEach((result, i) => {
        console.log(`[BSearch] Top result #${i+1}: "${result.title}" (score: ${result._score}) from ${result.source}`);
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
            
            // Multiple Bing pages for volume
            const bingOffsets = [0, 50, 100, 150];
            for (const off of bingOffsets) {
                promises.push(searchBingImages(query, off, options));
            }
            
            // Google CSE if available
            if (apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
                promises.push(searchGoogleImages(query, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset, options));
            }
            
            // SerpApi if available (but don't fail if it errors)
            if (apiKeys?.serpApi) {
                promises.push(searchSerpApiImages(query, apiKeys.serpApi, offset, options).catch(e => {
                    console.warn('[BSearch] SerpApi failed:', e.message);
                    return []; // Return empty array instead of failing
                }));
            }
            
            // Get images from news articles too
            promises.push(searchGNews(query, apiKeys.gnews, offset, 30));
            promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 30));
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
            
            // For images, aggressively extract direct image URLs
            if (category === 'images') {
                console.log(`[BSearch] Extracting direct image URLs from ${resultsWithMeta.length} results...`);
                
                for (const result of resultsWithMeta) {
                    // If it's not already a direct image URL, extract from page
                    const isDirectImage = result.imageUrl && result.imageUrl.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i);
                    
                    if (!isDirectImage && result.url) {
                        try {
                            console.log(`[BSearch] Extracting OG data from: ${result.url}`);
                            const og = await fetchOpenGraphData(result.url);
                            if (og?.image) {
                                console.log(`[BSearch] Found OG image: ${og.image}`);
                                result.imageUrl = og.image;
                                result.thumbnail = og.image;
                                result.ogTitle = og.title;
                                result.ogDescription = og.description;
                                result.ogAlt = og.alt;
                            }
                        } catch (e) {
                            console.warn(`[BSearch] OG extraction failed for ${result.url}:`, e.message);
                            // If OG fails, try to use the original URL if it looks like an image
                            if (result.url && result.url.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) {
                                result.imageUrl = result.url;
                            }
                        }
                    }
                    
                    // Ensure all image results have imageUrl
                    if (!result.imageUrl) {
                        result.imageUrl = result.url;
                    }
                    if (!result.thumbnail) {
                        result.thumbnail = result.imageUrl || result.url;
                    }
                }
                
                console.log(`[BSearch] Completed OG extraction for images`);
            }
            
            // Simple filtering - accept almost everything but prioritize co-occurrence
            allResults[category] = simpleFilter(resultsWithMeta, 100);
            
            console.log(`[BSearch] ${category} completed: ${allResults[category].length} results`);
            
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
        
        // Extract image URLs for load more too
        if (category === 'images') {
            for (const result of resultsWithMeta) {
                const isDirectImage = result.imageUrl && result.imageUrl.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i);
                
                if (!isDirectImage && result.url) {
                    try {
                        const og = await fetchOpenGraphData(result.url);
                        if (og?.image) {
                            result.imageUrl = og.image;
                            result.thumbnail = og.image;
                            result.ogTitle = og.title;
                            result.ogDescription = og.description;
                            result.ogAlt = og.alt;
                        }
                    } catch (e) {
                        if (result.url && result.url.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) {
                            result.imageUrl = result.url;
                        }
                    }
                }
                
                if (!result.imageUrl) {
                    result.imageUrl = result.url;
                }
                if (!result.thumbnail) {
                    result.thumbnail = result.imageUrl || result.url;
                }
            }
        }
        
        const filtered = simpleFilter(resultsWithMeta, 30);
        console.log(`[BSearch] LoadMore completed: ${filtered.length} results`);
        
        return filtered;
    } catch (error) {
        console.error('[BSearch] LoadMore failed:', error);
        return [];
    }
}
