// background/core/BSearch.js
import { fetchOpenGraphData, headCheck } from '../utils/BUtils.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchBingImages } from '../api/bing.js';
import { searchBraveImages } from '../api/brave.js';

// Simple deduplication cache
let seenImages = new Set();

function resetCache() {
    seenImages.clear();
}

// Simple image validation - focus on high-res images
async function isValidImage(result) {
    const imageUrl = result.imageUrl || result.url;
    if (!imageUrl) return false;
    
    // Accept common image formats
    if (!imageUrl.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) {
        return false;
    }
    
    // Filter for high-res images: ≥1000px or ≥500KB
    const w = Number(result.width || 0);
    const h = Number(result.height || 0);
    const bytes = Number(result.byteSize || 0);
    
    if (w >= 1000 || h >= 1000 || bytes >= 500_000) {
        return true;
    }
    
    // If no size info available, accept it (will be filtered later if needed)
    if (!w && !h && !bytes) {
        return true;
    }
    
    return false;
}

// Simple size-based sorting - largest images first
function scoreResults(results, query) {
    return results.map(result => {
        // Sort by pixel count, largest first
        const w = Number(result.width || 0);
        const h = Number(result.height || 0);
        const pixels = w * h;
        
        return { ...result, _score: pixels };
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
    
    // Brave Images
    if (apiKeys.brave) {
        promises.push(
            searchBraveImages(query, apiKeys.brave, offset)
                .then(results => results.map(r => ({ ...r, _source: 'Brave' })))
                .catch(() => [])
        );
    }
    
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
