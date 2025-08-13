// background/core/BSearch.js
import { searchGoogleImages } from '../api/googleImages.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchBingImages } from '../api/bing.js';
import { searchBraveImages } from '../api/brave.js';

let seenImages = new Set();

// Celebrity entity definitions for disambiguation
const CELEBRITY_ENTITIES = {
    'olivia rodrigo': {
        aliases: ['olivia rodrigo', 'rodrigo'],
        blockList: ['olivia wilde', 'wilde'],
        keywords: ['singer', 'songwriter', 'disney', 'sour', 'guts', 'driver license', 'deja vu', 'good 4 u', 'vampire', 'bad idea right', 'hsmtmts']
    },
    'olivia wilde': {
        aliases: ['olivia wilde', 'wilde'],
        blockList: ['olivia rodrigo', 'rodrigo'],
        keywords: ['actress', 'director', 'house', 'tron', 'rush', 'drinking buddies', 'booksmart', 'dont worry darling', 'jason sudeikis']
    },
    'taylor swift': {
        aliases: ['taylor swift', 'tswift'],
        blockList: ['taylor lautner', 'lautner'],
        keywords: ['singer', 'songwriter', 'pop', 'country', 'folklore', 'evermore', 'midnights', 'eras tour', 'swiftie', 'travis kelce']
    },
    'taylor lautner': {
        aliases: ['taylor lautner', 'lautner'],
        blockList: ['taylor swift', 'tswift'],
        keywords: ['actor', 'twilight', 'werewolf', 'jacob black', 'abduction', 'grown ups', 'kristen stewart']
    },
    'chris evans': {
        aliases: ['chris evans'],
        blockList: ['chris pine', 'chris pratt', 'chris hemsworth'],
        keywords: ['captain america', 'marvel', 'avengers', 'steve rogers', 'fantastic four', 'knives out']
    },
    'chris pine': {
        aliases: ['chris pine'],
        blockList: ['chris evans', 'chris pratt', 'chris hemsworth'],
        keywords: ['star trek', 'kirk', 'wonder woman', 'hell or high water', 'dungeons dragons']
    },
    'chris pratt': {
        aliases: ['chris pratt'],
        blockList: ['chris evans', 'chris pine', 'chris hemsworth'],
        keywords: ['guardians galaxy', 'star lord', 'parks recreation', 'jurassic world', 'mario movie']
    },
    'chris hemsworth': {
        aliases: ['chris hemsworth'],
        blockList: ['chris evans', 'chris pine', 'chris pratt'],
        keywords: ['thor', 'hammer', 'asgard', 'extraction', 'huntsman', 'rush']
    }
};

// Detect celebrity entities in query
function detectCelebrityEntities(query) {
    const lowerQuery = query.toLowerCase();
    const detected = [];
    
    for (const [entityName, entityData] of Object.entries(CELEBRITY_ENTITIES)) {
        // Check if any alias matches
        if (entityData.aliases.some(alias => lowerQuery.includes(alias))) {
            detected.push({ name: entityName, data: entityData });
        }
    }
    
    return detected;
}

// Filter results based on entity conflicts
function applyEntityDisambiguation(images, query) {
    // Skip disambiguation for exact quoted searches
    if (query.includes('"') && query.match(/"[^"]+"/)) {
        console.log(`[BSearch] Skipping entity disambiguation for quoted search: "${query}"`);
        return images;
    }
    
    const detectedEntities = detectCelebrityEntities(query);
    
    if (detectedEntities.length === 0) {
        // No celebrities detected, return all images
        return images;
    }
    
    console.log(`[BSearch] Detected celebrities: ${detectedEntities.map(e => e.name).join(', ')}`);
    
    return images.filter(image => {
        // Gather all text metadata for analysis
        const metadata = [
            image.title || '',
            image.sourceName || '',
            image.source || '',
            image.pageUrl || '',
            image.imageUrl || '',
            image.ogTitle || '',
            image.ogDescription || '',
            image.ogAlt || ''
        ].join(' ').toLowerCase();
        
        // Check for conflicts with any detected entity
        for (const entity of detectedEntities) {
            const { blockList, keywords } = entity.data;
            
            // Check if metadata contains blocked entities
            const hasBlockedEntity = blockList.some(blocked => metadata.includes(blocked));
            
            if (hasBlockedEntity) {
                // Check if it's actually about the correct entity
                const hasCorrectKeywords = keywords.some(keyword => metadata.includes(keyword));
                
                if (!hasCorrectKeywords) {
                    console.log(`[BSearch] Filtered out conflicting entity: "${image.title}" (contains: ${blockList.find(b => metadata.includes(b))})`);
                    return false;
                }
            }
        }
        
        return true;
    });
}

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
    
    // Apply entity disambiguation before validation
    const disambiguatedImages = applyEntityDisambiguation(allImages, query);
    console.log(`[BSearch] ${disambiguatedImages.length} images after entity disambiguation`);
    
    // Simple deduplication and validation
    const validImages = [];
    for (const image of disambiguatedImages) {
        if (!image.imageUrl) image.imageUrl = image.url;
        if (!image.thumbnail) image.thumbnail = image.imageUrl;
        
        const imageUrl = image.imageUrl?.toLowerCase();
        if (!imageUrl || seenImages.has(imageUrl)) continue;
        
        if (isValidImage(image)) {
            seenImages.add(imageUrl);
            validImages.push(image);
        }
    }
    
    console.log(`[BSearch] ${validImages.length} valid images after filtering`);
    
    // Sort by quality: prioritize known large images, then file size, then unknown sizes
    validImages.sort((a, b) => {
        const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        const aBytes = Number(a.byteSize || 0);
        const bBytes = Number(b.byteSize || 0);
        
        // Massive quality boost for 2MP+ images
        const aQuality = aPixels >= 2_000_000 ? aPixels + 10_000_000 : aPixels;
        const bQuality = bPixels >= 2_000_000 ? bPixels + 10_000_000 : bPixels;
        
        // If similar quality, prefer larger file size
        if (Math.abs(aQuality - bQuality) < 500_000) {
            return bBytes - aBytes;
        }
        
        return bQuality - aQuality;
    });
    
    return validImages;
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
