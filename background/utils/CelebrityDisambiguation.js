// background/utils/CelebrityDisambiguation.js

/**
 * Celebrity Disambiguation System
 * Analyzes search queries and image metadata to prevent celebrity mix-ups
 */

// Profession keywords that help identify celebrity types
const PROFESSION_KEYWORDS = {
    music: ['singer', 'musician', 'artist', 'rapper', 'songwriter', 'producer', 'band', 'album', 'song', 'tour', 'concert', 'music', 'grammy', 'billboard'],
    acting: ['actor', 'actress', 'movie', 'film', 'cinema', 'hollywood', 'oscar', 'Emmy', 'series', 'show', 'drama', 'comedy', 'theatre', 'theater'],
    sports: ['athlete', 'player', 'sport', 'team', 'game', 'championship', 'olympic', 'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf'],
    modeling: ['model', 'fashion', 'runway', 'magazine', 'photoshoot', 'campaign', 'brand', 'style'],
    social: ['influencer', 'youtuber', 'tiktok', 'instagram', 'social', 'content', 'creator', 'viral']
};

// Common conjunctions used to split entities
const ENTITY_SEPARATORS = /\s+(?:and|&|vs|x|with|ft|feat|featuring)\s+/gi;

// Common name patterns that might indicate a celebrity name
const COMMON_NAME_INDICATORS = ['swift', 'kelce', 'rodrigo', 'eilish', 'grande', 'styles', 'watson', 'stone', 'lawrence'];
const PROFESSION_WORDS = ['singer', 'actor', 'actress', 'player', 'artist', 'musician', 'rapper', 'songwriter', 'producer', 'concert', 'tour', 'movie', 'film', 'show', 'album', 'song'];

/**
 * Extract entities from a search query
 * @param {string} query - The search query
 * @returns {string[]} Array of entity names
 */
export function extractEntities(query) {
    if (!query || typeof query !== 'string') return [];
    
    const cleanQuery = query.toLowerCase().trim();
    
    // Split on common conjunctions, handling spaces around them
    const entities = cleanQuery
        .split(ENTITY_SEPARATORS)
        .map(entity => entity.trim())
        .filter(entity => entity.length > 0);
    
    // If no conjunctions found, try to split intelligently
    if (entities.length === 1) {
        const words = cleanQuery.split(/\s+/);
        
        // For 3+ words, try to identify celebrity names vs other words
        if (words.length >= 3) {
            const extractedEntities = [];
            let currentEntity = [];
            
            for (let i = 0; i < words.length; i++) {
                const word = words[i];
                
                // If this is a profession word and we have a current entity, finish it
                if (PROFESSION_WORDS.includes(word) && currentEntity.length > 0) {
                    extractedEntities.push(currentEntity.join(' '));
                    currentEntity = [];
                    continue;
                }
                
                // Add to current entity
                currentEntity.push(word);
                
                // If we have 2 words and this might be a complete name, consider finishing
                if (currentEntity.length === 2) {
                    // Check if the next word might start a new name
                    if (i + 1 < words.length) {
                        const nextWord = words[i + 1];
                        // If next word is capitalized or common name, finish current entity
                        if (!PROFESSION_WORDS.includes(nextWord)) {
                            extractedEntities.push(currentEntity.join(' '));
                            currentEntity = [];
                        }
                    } else {
                        // Last words, finish entity
                        extractedEntities.push(currentEntity.join(' '));
                        currentEntity = [];
                    }
                }
            }
            
            // Add any remaining entity
            if (currentEntity.length > 0) {
                extractedEntities.push(currentEntity.join(' '));
            }
            
            if (extractedEntities.length > 1) {
                return extractedEntities;
            }
            
            // Fallback to simple splitting for 3-4 words
            if (words.length === 3) {
                return [words[0] + ' ' + words[1], words[2]];
            } else if (words.length === 4) {
                return [words[0] + ' ' + words[1], words[2] + ' ' + words[3]];
            }
        }
    }
    
    return entities;
}

/**
 * Detect profession keywords in text
 * @param {string} text - Text to analyze
 * @returns {Object} Object with profession categories and their matching keywords
 */
export function detectProfessions(text) {
    if (!text || typeof text !== 'string') return {};
    
    const lowerText = text.toLowerCase();
    const detected = {};
    
    for (const [profession, keywords] of Object.entries(PROFESSION_KEYWORDS)) {
        const matches = keywords.filter(keyword => lowerText.includes(keyword));
        if (matches.length > 0) {
            detected[profession] = matches;
        }
    }
    
    return detected;
}

/**
 * Analyze context from image metadata to determine relevance
 * @param {Object} imageResult - Image result object
 * @param {string[]} queryEntities - Entities from the search query
 * @returns {Object} Context analysis with relevance score
 */
export function analyzeContext(imageResult, queryEntities) {
    if (!imageResult || !queryEntities || queryEntities.length === 0) {
        return { score: 0, reasons: [] };
    }
    
    // Combine all available text metadata
    const metadata = [
        imageResult.title || '',
        imageResult.ogTitle || '',
        imageResult.ogDescription || '',
        imageResult.ogAlt || '',
        imageResult.snippet || '',
        imageResult.pageUrl || ''
    ].join(' ').toLowerCase();
    
    let score = 0;
    const reasons = [];
    
    // Check entity co-occurrence
    const entityMatches = queryEntities.filter(entity => metadata.includes(entity));
    const entityCoverage = entityMatches.length / queryEntities.length;
    
    if (entityCoverage === 1.0) {
        score += 10; // All entities present - strong match
        reasons.push(`All entities found: ${entityMatches.join(', ')}`);
    } else if (entityCoverage >= 0.5) {
        score += 5; // Partial entity match
        reasons.push(`Partial entity match: ${entityMatches.join(', ')}`);
    }
    
    // Check for profession context
    const professions = detectProfessions(metadata);
    if (Object.keys(professions).length > 0) {
        score += 3;
        reasons.push(`Profession context: ${Object.keys(professions).join(', ')}`);
    }
    
    // Boost for image-specific indicators
    if (metadata.includes('photo') || metadata.includes('image') || metadata.includes('picture')) {
        score += 1;
        reasons.push('Image-specific content');
    }
    
    // Penalty for generic/unrelated content
    if (metadata.includes('wiki') && !metadata.includes('photo')) {
        score -= 2; // Wikipedia pages often have wrong celebrity images
        reasons.push('Generic wiki content');
    }
    
    return { score, reasons, entityMatches, professions };
}

/**
 * Calculate relevance score for celebrity disambiguation
 * @param {Object} imageResult - Image result object
 * @param {string} originalQuery - Original search query
 * @returns {Object} Relevance analysis with score and details
 */
export function calculateRelevanceScore(imageResult, originalQuery) {
    const entities = extractEntities(originalQuery);
    
    if (entities.length <= 1) {
        // Single entity query - no disambiguation needed
        return { score: 5, disambiguated: false, entities, analysis: null };
    }
    
    const analysis = analyzeContext(imageResult, entities);
    const relevanceScore = Math.max(0, analysis.score);
    
    return {
        score: relevanceScore,
        disambiguated: true,
        entities,
        analysis,
        isRelevant: relevanceScore >= 5 // Threshold for relevant results
    };
}

/**
 * Filter and score results for celebrity disambiguation
 * @param {Array} results - Array of search results
 * @param {string} query - Original search query
 * @returns {Array} Filtered and scored results
 */
export function disambiguateResults(results, query) {
    if (!results || results.length === 0) return [];
    
    const entities = extractEntities(query);
    
    // If only one entity, no disambiguation needed
    if (entities.length <= 1) {
        return results.map(result => ({
            ...result,
            _celebrityRelevance: { score: 5, disambiguated: false }
        }));
    }
    
    console.log(`[CelebrityDisambiguation] Disambiguating query "${query}" with entities: ${entities.join(', ')}`);
    
    // Score each result
    const scoredResults = results.map(result => {
        const relevance = calculateRelevanceScore(result, query);
        return {
            ...result,
            _celebrityRelevance: relevance
        };
    });
    
    // Filter out low-relevance results for multi-entity queries
    const threshold = 5;
    const filteredResults = scoredResults.filter(result => 
        result._celebrityRelevance.score >= threshold
    );
    
    console.log(`[CelebrityDisambiguation] Filtered ${scoredResults.length} to ${filteredResults.length} relevant results`);
    
    // Sort by relevance score (descending)
    filteredResults.sort((a, b) => 
        b._celebrityRelevance.score - a._celebrityRelevance.score
    );
    
    return filteredResults;
}