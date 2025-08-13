// background/core/BSearch.js
import { fetchOpenGraphData, headCheck } from '../utils/BUtils.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchBingImages } from '../api/bing.js';

// Simple deduplication cache
let seenImages = new Set();

function resetCache() {
    seenImages.clear();
}

// Simple image validation - just check if it's a real image
async function isValidImage(result) {
    const imageUrl = result.imageUrl || result.url;
    if (!imageUrl) return false;
    
    // Accept common image formats
    if (!imageUrl.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) {
        return false;
    }
    
    // If we have size info, prefer larger images
    const w = Number(result.width || 0);
    const h = Number(result.height || 0);
    if (w && h && (w >= 400 || h >= 400)) {
        return true;
    }
    
    // Otherwise accept everything that looks like an image
    return true;
}

// Simple relevance scoring - prefer exact matches
function scoreResults(results, query) {
    const queryLower = query.toLowerCase();
    const searchTerms = queryLower.split(/\s+/).filter(Boolean);
    
    return results.map(result => {
        let score = 0;
        const text = `${result.title || ''} ${result.snippet || ''} ${result.pageUrl || ''}`.toLowerCase();
        
        // Score based on term matches
        searchTerms.forEach(term => {
            if (text.includes(term)) {
                score += 10;
                if ((result.title || '').toLowerCase().includes(term)) {
                    score += 5; // Bonus for title matches
                }
            }
        });
        
        // Size bonus for large images
        const w = Number(result.width || 0);
        const h = Number(result.height || 0);
        const pixels = w * h;
        if (pixels >= 4_000_000) score += 3; // 4MP+
        else if (pixels >= 2_000_000) score += 2; // 2MP+
        else if (w >= 1000 || h >= 1000) score += 1;
        
        return { ...result, _score: score };
    });
}

async function searchImages(query, apiKeys, offset = 0) {
    console.log(`[BSearch] Searching images for: "${query}"`);
    
    const promises = [];
    
    // Google Images via SerpApi (best quality)
    if (apiKeys.serpApi) {
        promises.push(
            searchSerpApiImages(query, apiKeys.serpApi, offset)
                .then(results => results.map(r => ({ ...r, _source: 'SerpApi' })))
                .catch(() => [])
        );
    }
    
    // Google Custom Search
    if (apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
        promises.push(
            searchGoogleImages(query, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset)
                .then(results => results.map(r => ({ ...r, _source: 'GoogleCSE' })))
                .catch(() => [])
        );
    }
    
    // Bing Images (free backup)
    promises.push(
        searchBingImages(query, offset)
            .then(results => results.map(r => ({ ...r, _source: 'Bing' })))
            .catch(() => [])
    );
    
    // Get all results
    const results = await Promise.allSettled(promises);
    const allImages = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);
    
    console.log(`[BSearch] Found ${allImages.length} raw images`);
    
    // Quick validation and deduplication
    const validImages = [];
    for (const image of allImages) {
        if (!image.imageUrl) image.imageUrl = image.url;
        if (!image.thumbnail) image.thumbnail = image.imageUrl;
        
        const imageUrl = image.imageUrl?.toLowerCase();
        if (!imageUrl || seenImages.has(imageUrl)) continue;
        
        if (await isValidImage(image)) {
            seenImages.add(imageUrl);
            validImages.push(image);
        }
    }
    
    console.log(`[BSearch] ${validImages.length} valid images after filtering`);
    
    // Score and sort
    const scored = scoreResults(validImages, query);
    scored.sort((a, b) => (b._score || 0) - (a._score || 0));
    
    return scored.slice(0, 50);
}

export async function performSearch(query, categories, settings, offset = 0) {
    if (offset === 0) {
        resetCache();
    }
    
    const results = {};
    
    if (categories.includes('images')) {
        try {
            const images = await searchImages(query, settings.apiKeys, offset);
            results.images = images;
            console.log(`[BSearch] Returning ${images.length} images`);
        } catch (error) {
            console.error('[BSearch] Image search failed:', error);
            results.images = [];
        }
    }
    
    return results;
}

export async function loadMoreResults(query, category, settings, offset) {
    if (category === 'images') {
        return await searchImages(query, settings.apiKeys, offset);
    }
    return [];
}
