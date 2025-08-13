// background/core/BSearch.js
import { resetDuplicateCache } from './BTrust.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchBingImages } from '../api/bing.js';

// Global cache to prevent exact duplicates
let seenResults = new Set();

function resetSeenResults() {
    seenResults.clear();
    console.log('[BSearch] Reset seen results cache');
}

// Simple image quality validation - basic size/filesize check
function validateImageQuality(result) {
    const imageUrl = result.imageUrl || result.url;
    if (!imageUrl) return false;
    
    // Accept images with basic file extensions
    if (!imageUrl.match(/\.(jpg|jpeg|png|webp|avif|gif|bmp)(\?|#|$)/i)) {
        return false;
    }
    
    // Basic size check: >= 400px on any side OR >= 50KB filesize
    const w = Number(result.width || 0);
    const h = Number(result.height || 0);
    const bytes = Number(result.byteSize || 0);
    
    if ((w >= 400 || h >= 400) || bytes >= 50_000) {
        return true;
    }
    
    // Accept if no size info available (trust the API)
    return true;
}

// Simple filtering - just remove exact URL duplicates and return in source order
function simpleFilter(results, maxResults = 50) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BSearch] Processing ${results.length} raw results with simple filtering`);
    
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
    
    // Return results in source order, no complex scoring
    const final = uniqueResults.slice(0, maxResults);
    console.log(`[BSearch] Simple filter results: ${final.length}`);
    return final;
}

async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    console.log(`[BSearch] Searching category: ${category} for query: "${query}" with offset: ${offset}`);
    let promises = [];
    
    if (category === 'images') {
        // Fast results pipeline - up to 100 results each
        
        // Primary: Google Custom Search Images API
        if (apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
            for (let i = 0; i < 10; i++) { // 10 pages of 10 = 100 results max
                promises.push(searchGoogleImages(query, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, i * 10, options).then(results => 
                    results.map(r => ({ ...r, _source: 'GoogleCSE' }))
                ));
            }
        }
        
        // Secondary: SerpApi Google Images
        if (apiKeys?.serpApi) {
            promises.push(searchSerpApiImages(query, apiKeys.serpApi, 0, options).then(results => 
                results.map(r => ({ ...r, _source: 'SerpApi' }))
            ));
        }
        
        // Fallback: Bing Images HTML scraping
        for (let i = 0; i < 2; i++) { // 2 pages = 100 results max
            promises.push(searchBingImages(query, i * 50, options).then(results => 
                results.map(r => ({ ...r, _source: 'Bing' }))
            ));
        }
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
                console.log(`[BSearch] Processing ${resultsWithMeta.length} image results with simple filtering...`);
                
                // Ensure all results have imageUrl
                for (const result of resultsWithMeta) {
                    if (!result.imageUrl) {
                        result.imageUrl = result.url;
                    }
                    if (!result.thumbnail) {
                        result.thumbnail = result.imageUrl || result.url;
                    }
                }
                
                // Basic size filter: Keep images ≥400px on any side OR ≥50KB filesize
                const qualityResults = resultsWithMeta.filter(result => validateImageQuality(result));
                
                console.log(`[BSearch] Quality validation completed: ${qualityResults.length}/${resultsWithMeta.length} passed`);
                
                // Simple filtering - return top 50 in source order
                allResults[category] = simpleFilter(qualityResults, 50);
            } else {
                allResults[category] = simpleFilter(resultsWithMeta, 50);
            }
            
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
        
        if (category === 'images') {
            // Ensure all results have imageUrl
            for (const result of resultsWithMeta) {
                if (!result.imageUrl) result.imageUrl = result.url;
                if (!result.thumbnail) result.thumbnail = result.imageUrl || result.url;
            }
            
            const qualityResults = resultsWithMeta.filter(result => validateImageQuality(result));
            const filtered = simpleFilter(qualityResults, 50);
            console.log(`[BSearch] LoadMore completed: ${filtered.length} quality results`);
            return filtered;
        } else {
            const filtered = simpleFilter(resultsWithMeta, 50);
            console.log(`[BSearch] LoadMore completed: ${filtered.length} results`);
            return filtered;
        }
        
    } catch (error) {
        console.error('[BSearch] LoadMore failed:', error);
        return [];
    }
}
