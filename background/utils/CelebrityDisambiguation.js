// background/utils/CelebrityDisambiguation.js

/**
 * Celebrity Disambiguation System
 * 
 * Analyzes search queries and image metadata to correctly identify celebrities
 * when there are name conflicts (e.g., Olivia Rodrigo vs Olivia Wilde).
 */

// Professional context keywords for different celebrity types
const PROFESSION_KEYWORDS = {
    music: [
        'singer', 'musician', 'artist', 'rapper', 'songwriter', 'composer', 'producer',
        'band', 'album', 'song', 'track', 'single', 'music', 'concert', 'tour', 
        'performance', 'studio', 'record', 'recording', 'vinyl', 'spotify', 'itunes',
        'grammy', 'billboard', 'chart', 'hit', 'debut', 'ep', 'collaboration',
        'acoustic', 'live', 'vocals', 'guitar', 'piano', 'drums', 'bass'
    ],
    film: [
        'actress', 'actor', 'director', 'producer', 'filmmaker', 'movie', 'film',
        'cinema', 'hollywood', 'premiere', 'screening', 'oscar', 'academy', 'award',
        'role', 'character', 'cast', 'casting', 'script', 'scene', 'trailer',
        'blockbuster', 'indie', 'drama', 'comedy', 'thriller', 'action', 'romance',
        'documentary', 'series', 'tv', 'television', 'show', 'episode', 'season'
    ],
    sports: [
        'athlete', 'player', 'team', 'sport', 'football', 'basketball', 'baseball',
        'soccer', 'tennis', 'golf', 'olympics', 'championship', 'league', 'game',
        'match', 'tournament', 'season', 'draft', 'contract', 'trade', 'coach',
        'stadium', 'field', 'court', 'score', 'win', 'loss', 'mvp', 'rookie'
    ],
    fashion: [
        'model', 'fashion', 'runway', 'designer', 'style', 'brand', 'collection',
        'magazine', 'photoshoot', 'campaign', 'editorial', 'vogue', 'elle', 'glamour',
        'supermodel', 'catwalk', 'haute', 'couture', 'trendsetter', 'influencer'
    ]
};

/**
 * Extract entities from a search query by splitting on conjunctions
 */
export function extractEntities(query) {
    if (!query || typeof query !== 'string') return [];
    
    // Split on various conjunctions and connecting words
    let entities = query
        .toLowerCase()
        .split(/\s+(?:and|&|vs|x|with|plus|\+|featuring|feat\.?|ft\.?)\s+/g)
        .map(entity => entity.trim())
        .filter(Boolean);
    
    // If no explicit conjunctions found, try to detect multiple celebrities
    // by looking for patterns like "firstname lastname firstname lastname"
    if (entities.length === 1) {
        const words = query.toLowerCase().trim().split(/\s+/);
        
        // If we have 3+ words, try to split into two entities
        // This handles cases like "olivia rodrigo laufey" → ["olivia rodrigo", "laufey"]
        if (words.length >= 3) {
            // Look for common celebrity name patterns
            const possibleSplit = findCelebrityNameSplit(words);
            if (possibleSplit) {
                entities = possibleSplit;
            }
        }
    }
    
    return entities.length > 1 ? entities : [query.toLowerCase().trim()];
}

/**
 * Attempt to split a word array into likely celebrity names
 */
function findCelebrityNameSplit(words) {
    // Common patterns for celebrity names:
    // - Two words + one word: "olivia rodrigo laufey" → ["olivia rodrigo", "laufey"]
    // - One word + two words: "adele taylor swift" → ["adele", "taylor swift"] 
    // - Two words + two words: "taylor swift travis kelce" → ["taylor swift", "travis kelce"]
    
    if (words.length === 3) {
        // Try "first last single" pattern
        return [`${words[0]} ${words[1]}`, words[2]];
    } else if (words.length === 4) {
        // Try "first last first last" pattern
        return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`];
    } else if (words.length === 5) {
        // Try various combinations, prefer balanced split
        return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]} ${words[4]}`];
    }
    
    return null;
}

/**
 * Analyze text content for professional context clues
 */
export function analyzeContext(text) {
    if (!text || typeof text !== 'string') return {};
    
    const lowerText = text.toLowerCase();
    const context = {
        music: 0,
        film: 0,
        sports: 0,
        fashion: 0
    };
    
    // Count keyword matches for each profession
    for (const [profession, keywords] of Object.entries(PROFESSION_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerText.includes(keyword)) {
                context[profession]++;
            }
        }
    }
    
    return context;
}

/**
 * Calculate relevance score for an image result based on entity co-occurrence
 * and professional context matching
 */
export function calculateRelevanceScore(result, query) {
    if (!result || !query) return 0;
    
    let score = 0;
    const entities = extractEntities(query);
    
    // If single entity, use simpler scoring
    if (entities.length <= 1) {
        return calculateSingleEntityScore(result, query);
    }
    
    // Multi-entity disambiguation
    const metadata = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || ''}`.toLowerCase();
    
    // Co-occurrence boost: prefer images mentioning all entities
    const entityMatches = entities.filter(entity => metadata.includes(entity));
    const allEntitiesPresent = entityMatches.length === entities.length;
    const someEntitiesPresent = entityMatches.length > 0;
    
    if (allEntitiesPresent) {
        score += 10; // Strong boost for all entities present
    } else if (someEntitiesPresent) {
        score += entityMatches.length * 2; // Partial boost based on matches
    }
    
    // Context analysis for profession matching
    const queryContext = analyzeContext(query);
    const metadataContext = analyzeContext(metadata);
    
    // Boost if contexts align (same professional domain)
    for (const profession of Object.keys(queryContext)) {
        if (queryContext[profession] > 0 && metadataContext[profession] > 0) {
            score += Math.min(queryContext[profession], metadataContext[profession]) * 3;
        }
    }
    
    // Additional boost for exact name matches in correct context
    score += calculateNameContextMatch(entities, metadata, metadataContext);
    
    return score;
}

/**
 * Calculate score for single entity queries
 */
function calculateSingleEntityScore(result, query) {
    const metadata = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || ''}`.toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0;
    
    // Basic relevance: how many query tokens appear in metadata
    const queryTokens = queryLower.split(/\s+/).filter(Boolean);
    const matchingTokens = queryTokens.filter(token => metadata.includes(token));
    score += matchingTokens.length * 2;
    
    // Exact phrase match gets higher score
    if (metadata.includes(queryLower)) {
        score += 5;
    }
    
    return score;
}

/**
 * Calculate specific name-context matching for celebrity disambiguation
 */
function calculateNameContextMatch(entities, metadata, context) {
    let score = 0;
    
    // Look for celebrity-specific patterns
    for (const entity of entities) {
        const words = entity.split(/\s+/);
        
        // If entity has multiple words (likely full name), check for context clues
        if (words.length >= 2) {
            const firstName = words[0];
            const lastName = words[words.length - 1];
            
            // Boost if full name appears with relevant context
            if (metadata.includes(entity)) {
                // Determine likely profession based on context
                const topProfession = Object.entries(context)
                    .sort(([,a], [,b]) => b - a)[0];
                
                if (topProfession && topProfession[1] > 0) {
                    score += 5; // Full name + context match
                }
            }
            // Partial boost if only first name but strong context
            else if (metadata.includes(firstName)) {
                const topProfession = Object.entries(context)
                    .sort(([,a], [,b]) => b - a)[0];
                
                if (topProfession && topProfession[1] >= 2) {
                    score += 2; // First name + strong context
                }
            }
        }
    }
    
    return score;
}

/**
 * Apply disambiguation scoring to search results
 */
export function disambiguateResults(results, query) {
    if (!results || results.length === 0) return results;
    
    console.log(`[CelebrityDisambiguation] Disambiguating ${results.length} results for query: "${query}"`);
    
    const entities = extractEntities(query);
    console.log(`[CelebrityDisambiguation] Extracted entities:`, entities);
    
    // Calculate relevance scores and add to results
    const scoredResults = results.map(result => {
        const relevanceScore = calculateRelevanceScore(result, query);
        return {
            ...result,
            _disambiguationScore: relevanceScore,
            _entities: entities
        };
    });
    
    // Sort by disambiguation score (descending), maintaining quality as secondary sort
    scoredResults.sort((a, b) => {
        const scoreA = a._disambiguationScore || 0;
        const scoreB = b._disambiguationScore || 0;
        
        // If scores are significantly different, prioritize disambiguation
        if (Math.abs(scoreA - scoreB) >= 3) {
            return scoreB - scoreA;
        }
        
        // If scores are similar, fall back to existing quality metrics
        const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        const aQuality = aPixels >= 2_000_000 ? aPixels + 10_000_000 : aPixels;
        const bQuality = bPixels >= 2_000_000 ? bPixels + 10_000_000 : bPixels;
        
        return bQuality - aQuality;
    });
    
    console.log(`[CelebrityDisambiguation] Top 5 results after disambiguation:`, 
        scoredResults.slice(0, 5).map(r => ({
            title: r.title,
            score: r._disambiguationScore,
            entities: r._entities
        }))
    );
    
    return scoredResults;
}