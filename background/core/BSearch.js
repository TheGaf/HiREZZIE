// background/core/BSearch.js
import { searchGoogleImages } from '../api/googleImages.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchBingImages } from '../api/bing.js';
import { searchBraveImages } from '../api/brave.js';
import { disambiguateCelebrityResults, shouldApplyDisambiguation } from '../utils/CelebrityDisambiguation.js';

let seenImages = new Set();

function resetCache() {
    seenImages.clear();
}

function isValidImage(result) {
    const imageUrl = result.imageUrl || result.url;
    if (!imageUrl) return false;
    if (!imageUrl.match(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i)) return false;
    
    // SMART HI-RES: Focus on actual photo quality
    const w = Number(result.width || 0);
    const h = Number(result.height || 0);
    const bytes = Number(result.byteSize || 0);
    
    // High-res means: decent resolution OR substantial file size OR unknown (let it through)
    const goodResolution = (w >= 1000) || (h >= 1000);
    const goodFileSize = bytes >= 500_000; // 500KB+ suggests quality
    const unknownSize = (w === 0 && h === 0) || (bytes === 0); // Don't filter unknowns
    
    // Block obvious thumbnails/icons
    const tooSmall = (w > 0 && w < 300) || (h > 0 && h < 300);
    const tinyFile = (bytes > 0 && bytes < 50_000); // Under 50KB is likely thumbnail
    
    if (tooSmall || tinyFile) return false;
    
    return goodResolution || goodFileSize || unknownSize;
}

async function searchImages(query, apiKeys, offset = 0) {
    console.log(`[BSearch] Searching images for: "${query}"`);
    
    const promises = [];
    
    // SerpApi Google Images
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
    
    // Bing Images
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
    
    const results = await Promise.allSettled(promises);
    const allImages = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);
    
    console.log(`[BSearch] Found ${allImages.length} raw images`);
    
    // Simple deduplication and validation
    const validImages = [];
    for (const image of allImages) {
        if (!image.imageUrl) image.imageUrl = image.url;
        if (!image.thumbnail) image.thumbnail = image.imageUrl;
        
        const imageUrl = image.imageUrl?.toLowerCase();
        if (!imageUrl || seenImages.has(imageUrl)) continue;
        
        if (isValidImage(image)) {
            seenImages.add(imageUrl);
            // Add query reference for disambiguation
            image._query = query;
            validImages.push(image);
        }
    }
    
    console.log(`[BSearch] ${validImages.length} valid images after filtering`);
    
    // Apply celebrity disambiguation if needed
    let processedImages = validImages;
    if (shouldApplyDisambiguation(query)) {
        console.log(`[BSearch] Applying celebrity disambiguation for query: "${query}"`);
        processedImages = disambiguateCelebrityResults(validImages, query);
    }
    
    // Sort by quality: prioritize known large images, then file size, then unknown sizes
    processedImages.sort((a, b) => {
        const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        const aBytes = Number(a.byteSize || 0);
        const bBytes = Number(b.byteSize || 0);
        
        // Factor in disambiguation score if available
        const aDisambiguation = a._disambiguationScore || 0;
        const bDisambiguation = b._disambiguationScore || 0;
        
        // If disambiguation scores differ significantly, prioritize that
        if (Math.abs(aDisambiguation - bDisambiguation) >= 5) {
            return bDisambiguation - aDisambiguation;
        }
        
        // Massive quality boost for 2MP+ images
        const aQuality = aPixels >= 2_000_000 ? aPixels + 10_000_000 : aPixels;
        const bQuality = bPixels >= 2_000_000 ? bPixels + 10_000_000 : bPixels;
        
        // If similar quality, prefer larger file size
        if (Math.abs(aQuality - bQuality) < 500_000) {
            return bBytes - aBytes;
        }
        
        return bQuality - aQuality;
    });
    
    return processedImages;
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
