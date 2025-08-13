// background/utils/CelebrityDisambiguation.js

// Celebrity profession keywords for context analysis
const PROFESSION_KEYWORDS = {
    singer: ['singer', 'musician', 'artist', 'vocalist', 'performer', 'recording', 'album', 'song', 'music', 'concert', 'tour', 'Grammy', 'Billboard', 'chart', 'single', 'EP', 'band', 'melody', 'lyrics', 'acoustic', 'studio'],
    actress: ['actress', 'actor', 'film', 'movie', 'cinema', 'Hollywood', 'director', 'producer', 'starring', 'cast', 'role', 'character', 'scene', 'script', 'premiere', 'Oscar', 'Emmy', 'Golden Globe', 'box office', 'blockbuster'],
    athlete: ['athlete', 'player', 'sport', 'team', 'game', 'match', 'championship', 'league', 'Olympic', 'medal', 'compete', 'tournament', 'season', 'coach', 'training', 'fitness', 'performance', 'record', 'victory', 'defeat'],
    model: ['model', 'fashion', 'runway', 'photoshoot', 'campaign', 'brand', 'magazine', 'cover', 'designer', 'style', 'beauty', 'cosmetics', 'editorial', 'portrait', 'glamour'],
    influencer: ['influencer', 'social media', 'Instagram', 'TikTok', 'YouTube', 'content creator', 'follower', 'viral', 'brand ambassador', 'sponsored', 'collaboration', 'lifestyle'],
    politician: ['politician', 'president', 'senator', 'governor', 'mayor', 'congress', 'parliament', 'government', 'policy', 'election', 'campaign', 'vote', 'political'],
    chef: ['chef', 'restaurant', 'cooking', 'cuisine', 'recipe', 'kitchen', 'culinary', 'food', 'dish', 'menu', 'Michelin', 'cookbook'],
    author: ['author', 'writer', 'book', 'novel', 'bestseller', 'publishing', 'literature', 'poet', 'journalist', 'editor', 'column', 'article']
};

// Enhanced conjunctions for entity splitting 
const ENTITY_CONJUNCTIONS = /\s+(?:and|&|vs\.?|x|with|ft\.?|feat\.?|featuring|,)\s+/gi;

/**
 * Extract entities from query with better handling of multi-word celebrity names
 * @param {string} query - Search query
 * @returns {Array<string>} - Array of extracted entities
 */
export function extractEntities(query) {
    if (!query || typeof query !== 'string') return [];
    
    // First, try splitting on explicit conjunctions
    let entities = query.split(ENTITY_CONJUNCTIONS)
        .map(entity => entity.trim())
        .filter(entity => entity.length > 0);
    
    // If no explicit conjunctions found, try to detect multiple names
    if (entities.length === 1) {
        const originalEntity = entities[0];
        const words = originalEntity.split(/\s+/);
        
        // Handle common celebrity name patterns based on word count
        if (words.length === 3) {
            // Pattern: "olivia rodrigo laufey" -> ["olivia rodrigo", "laufey"]
            // Assume first two words are first name + last name, third is another person
            entities = [`${words[0]} ${words[1]}`, words[2]];
        } else if (words.length === 4) {
            // Pattern: "taylor swift travis kelce" -> ["taylor swift", "travis kelce"]
            // Assume pairs of first name + last name
            entities = [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`];
        } else if (words.length > 4) {
            // For longer queries, try to split at midpoint or keep as single entity
            // This is a fallback - in practice, queries like this are rare
            entities = [originalEntity];
        }
        // For 1-2 words, keep as single entity (single person)
    }
    
    // Clean up entities - remove common noise words but preserve celebrity names
    const cleanedEntities = entities.map(entity => {
        return entity
            .replace(/\b(the|a|an|in|at|on|for|with|by)\b/gi, '') // Remove articles/prepositions
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }).filter(entity => entity.length > 1); // Keep entities with meaningful length
    
    console.log(`[CelebrityDisambiguation] Extracted entities: ${cleanedEntities.join(', ')}`);
    return cleanedEntities;
}

/**
 * Analyze profession context from image metadata
 * @param {Object} imageResult - Image search result with metadata
 * @returns {Object} - Profession analysis with scores
 */
export function analyzeProfessionContext(imageResult) {
    const metadata = [
        imageResult.title || '',
        imageResult.ogTitle || '',
        imageResult.ogDescription || '',
        imageResult.ogAlt || '',
        imageResult.snippet || '',
        imageResult.pageUrl || ''
    ].join(' ').toLowerCase();
    
    const professionScores = {};
    let totalMatches = 0;
    
    // Score each profession based on keyword presence
    Object.entries(PROFESSION_KEYWORDS).forEach(([profession, keywords]) => {
        let score = 0;
        keywords.forEach(keyword => {
            const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
            const matches = (metadata.match(keywordRegex) || []).length;
            score += matches;
            totalMatches += matches;
        });
        professionScores[profession] = score;
    });
    
    // Find dominant profession(s)
    const maxScore = Math.max(...Object.values(professionScores));
    const dominantProfessions = Object.entries(professionScores)
        .filter(([, score]) => score > 0 && score >= maxScore * 0.7) // At least 70% of max score
        .map(([profession]) => profession);
    
    return {
        scores: professionScores,
        dominantProfessions,
        totalMatches,
        contextStrength: totalMatches > 0 ? maxScore / totalMatches : 0
    };
}

/**
 * Calculate celebrity disambiguation score for an image result
 * @param {Object} imageResult - Image search result
 * @param {Array<string>} entities - Extracted entities from query
 * @param {string} originalQuery - Original search query
 * @returns {number} - Disambiguation score (higher = more relevant)
 */
export function calculateDisambiguationScore(imageResult, entities, originalQuery) {
    let score = 0;
    
    // Base metadata for matching
    const metadata = [
        imageResult.title || '',
        imageResult.ogTitle || '',
        imageResult.ogDescription || '',
        imageResult.ogAlt || '',
        imageResult.snippet || '',
        imageResult.pageUrl || ''
    ].join(' ').toLowerCase();
    
    // 1. Co-occurrence bonus - all entities mentioned together
    if (entities.length > 1) {
        const allEntitiesPresent = entities.every(entity => 
            metadata.includes(entity.toLowerCase())
        );
        if (allEntitiesPresent) {
            score += 10; // Strong co-occurrence bonus
            console.log(`[CelebrityDisambiguation] Co-occurrence bonus for entities: ${entities.join(', ')}`);
        } else {
            // Partial entity matches
            const matchingEntities = entities.filter(entity => 
                metadata.includes(entity.toLowerCase())
            );
            score += matchingEntities.length * 2; // Partial bonus
        }
    }
    
    // 2. Profession context bonus
    const professionContext = analyzeProfessionContext(imageResult);
    if (professionContext.dominantProfessions.length > 0) {
        score += professionContext.contextStrength * 5; // Context strength bonus
        
        // Extra bonus if query suggests specific profession
        const queryLower = originalQuery.toLowerCase();
        professionContext.dominantProfessions.forEach(profession => {
            const professionKeywords = PROFESSION_KEYWORDS[profession];
            const queryHasProfessionContext = professionKeywords.some(keyword => 
                queryLower.includes(keyword)
            );
            if (queryHasProfessionContext) {
                score += 3; // Query-profession alignment bonus
            }
        });
    }
    
    // 3. Entity name prominence bonus
    entities.forEach(entity => {
        const entityLower = entity.toLowerCase();
        
        // Higher weight if entity appears in title vs description
        if ((imageResult.title || '').toLowerCase().includes(entityLower)) {
            score += 3;
        } else if ((imageResult.ogTitle || '').toLowerCase().includes(entityLower)) {
            score += 2;
        }
        
        // Bonus for alt text and description mentions
        if ((imageResult.ogAlt || '').toLowerCase().includes(entityLower)) {
            score += 2;
        }
        if ((imageResult.ogDescription || '').toLowerCase().includes(entityLower)) {
            score += 1;
        }
    });
    
    // 4. URL quality bonus (official sites, news sites, etc.)
    const url = (imageResult.pageUrl || '').toLowerCase();
    if (url.includes('instagram.com') || url.includes('twitter.com') || url.includes('facebook.com')) {
        score += 2; // Social media bonus
    }
    if (url.includes('wikipedia.org') || url.includes('imdb.com')) {
        score += 3; // Authoritative source bonus
    }
    if (url.includes('getty') || url.includes('shutterstock') || url.includes('reuters')) {
        score += 4; // Professional photo agency bonus
    }
    
    return score;
}

/**
 * Filter and rank images using celebrity disambiguation
 * @param {Array<Object>} images - Array of image search results
 * @param {string} query - Original search query
 * @returns {Array<Object>} - Filtered and ranked images with disambiguation scores
 */
export function disambiguateCelebrityResults(images, query) {
    if (!images || images.length === 0) return [];
    
    console.log(`[CelebrityDisambiguation] Processing ${images.length} images for query: "${query}"`);
    
    const entities = extractEntities(query);
    
    // Only apply disambiguation if we have multiple entities (potential celebrity confusion)
    if (entities.length < 2) {
        console.log(`[CelebrityDisambiguation] Single entity detected, skipping disambiguation`);
        return images;
    }
    
    // Calculate disambiguation scores for each image
    const scoredImages = images.map(image => {
        const disambiguationScore = calculateDisambiguationScore(image, entities, query);
        
        return {
            ...image,
            _disambiguationScore: disambiguationScore,
            _entities: entities,
            _professionContext: analyzeProfessionContext(image)
        };
    });
    
    // Filter out low-relevance images (score below threshold)
    const relevantImages = scoredImages.filter(image => 
        image._disambiguationScore >= 2 // Minimum relevance threshold
    );
    
    // Sort by disambiguation score (descending)
    relevantImages.sort((a, b) => b._disambiguationScore - a._disambiguationScore);
    
    console.log(`[CelebrityDisambiguation] Filtered from ${images.length} to ${relevantImages.length} relevant images`);
    
    return relevantImages;
}

/**
 * Check if a query likely contains celebrity names that could be confused
 * @param {string} query - Search query
 * @returns {boolean} - True if disambiguation might be needed
 */
export function shouldApplyDisambiguation(query) {
    if (!query || typeof query !== 'string') return false;
    
    const entities = extractEntities(query);
    
    // Apply disambiguation if:
    // 1. Multiple entities detected
    // 2. Query contains common celebrity naming patterns
    if (entities.length >= 2) return true;
    
    // Check for common celebrity name patterns (first + last name)
    const namePattern = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/;
    if (namePattern.test(query)) return true;
    
    return false;
}