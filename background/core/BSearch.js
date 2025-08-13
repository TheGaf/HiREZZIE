// background/core/BSearch.js
import { searchGoogleImages } from '../api/googleImages.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchBingImages } from '../api/bing.js';
import { searchBraveImages } from '../api/brave.js';

let seenImages = new Set();

function resetCache() {
    seenImages.clear();
}

// Celebrity/Entity Disambiguation
function analyzeCelebrityQuery(query) {
    const cleanQuery = query.toLowerCase().trim();
    
    // Split query into potential entities - handle common separators
    const entities = cleanQuery.split(/\s+(?:and|&|vs|x|with|\+)\s+/g)
        .map(s => s.trim())
        .filter(Boolean);
    
    // If only one entity or no clear separators, try to detect multiple names
    if (entities.length === 1) {
        // Look for multiple name patterns (first last first last)
        const words = cleanQuery.split(/\s+/);
        const nameEntities = [];
        
        // Simple heuristic: if we have 3+ words, try to split into name pairs
        if (words.length >= 3) {
            // Common patterns: "olivia rodrigo laufey", "taylor swift travis kelce"
            for (let i = 0; i < words.length - 1; i += 2) {
                if (i + 1 < words.length) {
                    nameEntities.push(`${words[i]} ${words[i + 1]}`);
                }
            }
            // If we have an odd number, the last word might be a single name
            if (words.length % 2 === 1) {
                nameEntities.push(words[words.length - 1]);
            }
            
            if (nameEntities.length > 1) {
                return nameEntities;
            }
        }
        
        return [cleanQuery];
    }
    
    return entities;
}

function getDisambiguationContext(result, entities) {
    const metadata = [
        result.title || '',
        result.ogTitle || '',
        result.ogDescription || '',
        result.ogAlt || '',
        result.snippet || '',
        result.pageUrl || '',
        result.source || ''
    ].join(' ').toLowerCase();
    
    // Professional context keywords for common celebrity types
    const contextKeywords = {
        musician: ['singer', 'song', 'album', 'music', 'concert', 'tour', 'band', 'artist', 'musician', 'record', 'spotify', 'itunes', 'grammy', 'hit', 'single', 'ep', 'track'],
        actor: ['actor', 'actress', 'movie', 'film', 'tv', 'show', 'series', 'drama', 'comedy', 'netflix', 'hollywood', 'cinema', 'oscar', 'emmy', 'imdb'],
        athlete: ['athlete', 'sports', 'football', 'basketball', 'soccer', 'tennis', 'olympics', 'nfl', 'nba', 'fifa', 'team', 'player', 'game', 'match', 'championship'],
        model: ['model', 'fashion', 'runway', 'vogue', 'photoshoot', 'modeling', 'supermodel', 'catwalk'],
        youtuber: ['youtube', 'youtuber', 'channel', 'subscriber', 'creator', 'influencer', 'content', 'vlog', 'streaming']
    };
    
    // Find context matches
    const contexts = [];
    for (const [profession, keywords] of Object.entries(contextKeywords)) {
        const matches = keywords.filter(keyword => metadata.includes(keyword));
        if (matches.length > 0) {
            contexts.push({ profession, matches: matches.length, keywords: matches });
        }
    }
    
    return {
        metadata,
        contexts,
        hasMultipleEntities: entities.length > 1,
        entityMentions: entities.map(entity => ({
            entity,
            mentioned: metadata.includes(entity),
            frequency: (metadata.match(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
        }))
    };
}

function calculateDisambiguationScore(result, entities, query) {
    const context = getDisambiguationContext(result, entities);
    let score = 0;
    
    // Base score for entity mentions
    const mentionedEntities = context.entityMentions.filter(em => em.mentioned);
    
    if (entities.length > 1) {
        // Multi-entity queries: strongly prefer results mentioning all entities
        if (mentionedEntities.length === entities.length) {
            score += 10; // Strong boost for mentioning all entities
        } else if (mentionedEntities.length > 0) {
            score += 2; // Small boost for mentioning some entities
        } else {
            score -= 5; // Penalize results that don't mention any entities
        }
        
        // Boost for context consistency
        if (context.contexts.length > 0 && mentionedEntities.length > 0) {
            score += context.contexts.length * 2;
        }
    } else {
        // Single entity: ensure we have the right person
        if (mentionedEntities.length > 0) {
            score += mentionedEntities[0].frequency * 2;
            
            // Context validation for single entities
            if (context.contexts.length > 0) {
                score += context.contexts.length;
            }
        }
    }
    
    // Penalty for likely wrong matches
    const wrongPersonIndicators = [
        'actress', 'actor', 'wilde', 'hathaway', 'stone'  // Common name conflicts
    ];
    
    if (entities.some(entity => entity.includes('olivia rodrigo'))) {
        // Specific case: if searching for Olivia Rodrigo but finding Olivia Wilde
        if (wrongPersonIndicators.some(indicator => context.metadata.includes(indicator))) {
            score -= 15; // Heavy penalty for wrong Olivia
        }
        // Boost for music context when searching for Olivia Rodrigo
        const musicContext = context.contexts.find(c => c.profession === 'musician');
        if (musicContext) {
            score += musicContext.matches * 3;
        }
    }
    
    return { score, context };
}

function isValidImage(result, query = '', entities = []) {
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
    
    // Celebrity disambiguation check
    if (query && entities.length > 0) {
        const disambiguationResult = calculateDisambiguationScore(result, entities, query);
        // Filter out results with very negative disambiguation scores
        if (disambiguationResult.score < -10) {
            console.log(`[BSearch] Filtered out mismatched celebrity: "${result.title}" (score: ${disambiguationResult.score})`);
            return false;
        }
        // Store disambiguation score for later sorting
        result._disambiguationScore = disambiguationResult.score;
        result._disambiguationContext = disambiguationResult.context;
        
        if (disambiguationResult.score !== 0) {
            console.log(`[BSearch] Disambiguation: "${result.title}" scored ${disambiguationResult.score}`);
        }
    }
    
    return goodResolution || goodFileSize || unknownSize;
}

async function searchImages(query, apiKeys, offset = 0) {
    console.log(`[BSearch] Searching images for: "${query}"`);
    
    // Analyze query for celebrity entities
    const entities = analyzeCelebrityQuery(query);
    console.log(`[BSearch] Detected entities:`, entities);
    
    const promises = [];
    
    // SerpApi Google Images
    if (apiKeys.serpApi) {
        promises.push(
            searchSerpApiImages(query, apiKeys.serpApi, offset)
                .then(results => results.map(r => ({ ...r, _source: 'SerpApi', _query: query })))
                .catch(() => [])
        );
    }
    
    // Google Custom Search
    if (apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
        promises.push(
            searchGoogleImages(query, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset)
                .then(results => results.map(r => ({ ...r, _source: 'GoogleCSE', _query: query })))
                .catch(() => [])
        );
    }
    
    // Bing Images
    promises.push(
        searchBingImages(query, offset)
            .then(results => results.map(r => ({ ...r, _source: 'Bing', _query: query })))
            .catch(() => [])
    );

    // Brave Images
    if (apiKeys.brave) {
        promises.push(
            searchBraveImages(query, apiKeys.brave, offset)
                .then(results => results.map(r => ({ ...r, _source: 'Brave', _query: query })))
                .catch(() => [])
        );
    }
    
    const results = await Promise.allSettled(promises);
    const allImages = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);
    
    console.log(`[BSearch] Found ${allImages.length} raw images`);
    
    // Enhanced deduplication and validation with disambiguation
    const validImages = [];
    for (const image of allImages) {
        if (!image.imageUrl) image.imageUrl = image.url;
        if (!image.thumbnail) image.thumbnail = image.imageUrl;
        
        const imageUrl = image.imageUrl?.toLowerCase();
        if (!imageUrl || seenImages.has(imageUrl)) continue;
        
        if (isValidImage(image, query, entities)) {
            seenImages.add(imageUrl);
            validImages.push(image);
        }
    }
    
    console.log(`[BSearch] ${validImages.length} valid images after filtering`);
    
    // Enhanced sorting: prioritize disambiguation score, then quality
    validImages.sort((a, b) => {
        // Primary sort: disambiguation score (higher is better)
        const aDisambig = Number(a._disambiguationScore || 0);
        const bDisambig = Number(b._disambiguationScore || 0);
        if (Math.abs(aDisambig - bDisambig) >= 2) {
            return bDisambig - aDisambig;
        }
        
        // Secondary sort: image quality
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
