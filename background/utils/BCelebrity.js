// background/utils/BCelebrity.js
// Celebrity disambiguation system to prevent mixing up celebrities with similar names

// Celebrity database with context keywords and exclusion terms
const CELEBRITY_DATABASE = {
    'olivia rodrigo': {
        aliases: ['olivia rodrigo', 'olivia isabel rodrigo'],
        contextKeywords: [
            // Music career
            'singer', 'musician', 'artist', 'songwriter', 'pop star', 'music',
            // Disney connection
            'disney', 'high school musical', 'hsmtmts', 'bizaardvark',
            // Hit songs
            'drivers license', 'good 4 u', 'deja vu', 'vampire', 'brutal', 'traitor',
            // Albums
            'sour', 'guts',
            // Awards and achievements
            'grammy', 'billboard', 'chart', 'teen choice', 'mtv',
            // Physical characteristics for disambiguation
            'brunette', 'young', 'teen', 'generation z', 'gen z'
        ],
        exclusionTerms: [
            // Olivia Wilde specific terms
            'actress', 'director', 'house md', 'tron', 'wilde', 'don\'t worry darling',
            'booksmart', 'jason sudeikis', 'harry styles', 'blonde', 'film', 'movie',
            'hollywood', 'marvel', 'thor'
        ],
        type: 'musician'
    },
    'olivia wilde': {
        aliases: ['olivia wilde', 'olivia jane cockburn'],
        contextKeywords: [
            // Acting career
            'actress', 'actor', 'film', 'movie', 'cinema', 'hollywood',
            // TV shows
            'house', 'house md', 'thirteen', 'dr remy hadley',
            // Movies
            'tron', 'tron legacy', 'cowboys aliens', 'her', 'drinking buddies',
            'booksmart', 'don\'t worry darling', 'richard jewell',
            // Directing
            'director', 'filmmaker', 'directing',
            // Personal life (for disambiguation)
            'jason sudeikis', 'harry styles', 'blonde', 'otis', 'daisy'
        ],
        exclusionTerms: [
            // Olivia Rodrigo specific terms
            'singer', 'musician', 'disney', 'drivers license', 'good 4 u',
            'sour', 'guts', 'grammy', 'pop star', 'brunette', 'teen', 'gen z'
        ],
        type: 'actress'
    },
    'laufey': {
        aliases: ['laufey', 'laufey lin'],
        contextKeywords: [
            // Music style
            'jazz', 'singer', 'musician', 'artist', 'songwriter', 'vocalist',
            // Songs and albums
            'like the movies', 'valentine', 'everything i know about love',
            'typical of me', 'street by street', 'promise',
            // Style descriptors
            'icelandic', 'jazz pop', 'bedroom pop', 'indie', 'vintage'
        ],
        exclusionTerms: [],
        type: 'musician'
    },
    'taylor swift': {
        aliases: ['taylor swift', 'taylor alison swift'],
        contextKeywords: [
            'singer', 'songwriter', 'musician', 'pop star', 'country',
            'fearless', 'speak now', 'red', '1989', 'reputation', 'lover',
            'folklore', 'evermore', 'midnights', 'tortured poets',
            'grammy', 'billboard', 'swiftie', 'eras tour'
        ],
        exclusionTerms: [
            'actor', 'twilight', 'lautner', 'werewolf', 'sharkboy'
        ],
        type: 'musician'
    },
    'taylor lautner': {
        aliases: ['taylor lautner', 'taylor daniel lautner'],
        contextKeywords: [
            'actor', 'twilight', 'jacob black', 'werewolf', 'sharkboy',
            'lavagirl', 'abduction', 'grown ups', 'valentine\'s day'
        ],
        exclusionTerms: [
            'singer', 'songwriter', 'musician', 'pop star', 'grammy',
            'fearless', 'speak now', 'red', '1989', 'swiftie'
        ],
        type: 'actor'
    }
};

/**
 * Detects celebrity names in a search query
 * @param {string} query - The search query
 * @returns {Array} Array of detected celebrities with their info
 */
export function detectCelebritiesInQuery(query) {
    const queryLower = query.toLowerCase();
    const detectedCelebrities = [];
    
    for (const [celebrityKey, celebrityData] of Object.entries(CELEBRITY_DATABASE)) {
        // Check if any alias matches (partial match for flexibility)
        const aliasMatch = celebrityData.aliases.some(alias => 
            queryLower.includes(alias.toLowerCase())
        );
        
        if (aliasMatch) {
            detectedCelebrities.push({
                name: celebrityKey,
                data: celebrityData,
                searchName: celebrityData.aliases[0] // Use primary name
            });
        }
    }
    
    return detectedCelebrities;
}

/**
 * Analyzes if an image result matches the intended celebrity based on metadata
 * @param {Object} imageResult - Image result with metadata
 * @param {Object} celebrity - Celebrity data from database
 * @returns {Object} Score and analysis
 */
export function scoreCelebrityMatch(imageResult, celebrity) {
    // Combine all available metadata for analysis
    const metadata = [
        imageResult.title || '',
        imageResult.ogTitle || '',
        imageResult.ogDescription || '',
        imageResult.ogAlt || '',
        imageResult.pageUrl || '',
        imageResult.source || '',
        imageResult.sourceName || ''
    ].join(' ').toLowerCase();
    
    let score = 0;
    let positiveMatches = [];
    let negativeMatches = [];
    
    // Check for positive context keywords
    for (const keyword of celebrity.contextKeywords) {
        if (metadata.includes(keyword.toLowerCase())) {
            score += 2;
            positiveMatches.push(keyword);
        }
    }
    
    // Check for exclusion terms (strong negative signal)
    for (const exclusionTerm of celebrity.exclusionTerms) {
        if (metadata.includes(exclusionTerm.toLowerCase())) {
            score -= 5; // Heavy penalty for wrong celebrity indicators
            negativeMatches.push(exclusionTerm);
        }
    }
    
    // Boost for exact name matches in metadata
    const exactNameMatch = celebrity.aliases.some(alias => 
        metadata.includes(alias.toLowerCase())
    );
    if (exactNameMatch) {
        score += 3;
        positiveMatches.push('exact_name_match');
    }
    
    return {
        score,
        positiveMatches,
        negativeMatches,
        isLikelyMatch: score > 0,
        isDefinitelyWrong: negativeMatches.length > 0
    };
}

/**
 * Filters image results to remove wrong celebrities and boost correct ones
 * @param {Array} results - Array of image results
 * @param {Array} detectedCelebrities - Celebrities detected in the query
 * @param {Object} options - Filtering options
 * @returns {Array} Filtered and scored results
 */
export function filterCelebrityResults(results, detectedCelebrities, options = {}) {
    if (!detectedCelebrities || detectedCelebrities.length === 0) {
        return results; // No celebrities detected, return as-is
    }
    
    const {
        strictMode = true,
        minScore = 0,
        maxResults = 20
    } = options;
    
    console.log(`[BCelebrity] Filtering ${results.length} results for celebrities:`, 
                detectedCelebrities.map(c => c.name));
    
    const scoredResults = results.map(result => {
        let totalScore = 0;
        let celebrityAnalysis = {};
        let shouldExclude = false;
        
        // Analyze against each detected celebrity
        for (const celebrity of detectedCelebrities) {
            const analysis = scoreCelebrityMatch(result, celebrity.data);
            celebrityAnalysis[celebrity.name] = analysis;
            
            // If this is definitely the wrong celebrity, mark for exclusion
            if (analysis.isDefinitelyWrong) {
                shouldExclude = true;
                console.log(`[BCelebrity] Excluding result with wrong celebrity indicators for ${celebrity.name}:`, 
                           analysis.negativeMatches);
            }
            
            // Add to total score (can be negative)
            totalScore += analysis.score;
        }
        
        return {
            ...result,
            _celebrityScore: totalScore,
            _celebrityAnalysis: celebrityAnalysis,
            _shouldExclude: shouldExclude
        };
    });
    
    // Filter out results with wrong celebrity indicators
    let filteredResults = scoredResults.filter(result => !result._shouldExclude);
    
    // If strict filtering left us with too few results, be more lenient
    if (strictMode && filteredResults.length < 5 && scoredResults.length > filteredResults.length) {
        console.log(`[BCelebrity] Strict filtering left only ${filteredResults.length} results, relaxing...`);
        // Keep results with neutral or positive scores
        filteredResults = scoredResults.filter(result => result._celebrityScore >= -2);
    }
    
    // Sort by celebrity score (higher is better) combined with existing boosts
    filteredResults.sort((a, b) => {
        const aFinalScore = (a._celebrityScore || 0) + (a._hiresBoost || 0);
        const bFinalScore = (b._celebrityScore || 0) + (b._hiresBoost || 0);
        return bFinalScore - aFinalScore;
    });
    
    console.log(`[BCelebrity] Filtered to ${filteredResults.length} results with celebrity disambiguation`);
    
    return filteredResults.slice(0, maxResults);
}

/**
 * Enhances a search query with celebrity-specific terms for better disambiguation
 * @param {string} originalQuery - The original search query
 * @param {Array} detectedCelebrities - Detected celebrities
 * @returns {string} Enhanced query
 */
export function enhanceQueryForCelebrities(originalQuery, detectedCelebrities) {
    if (!detectedCelebrities || detectedCelebrities.length === 0) {
        return originalQuery;
    }
    
    // For now, return the original query as search APIs might not benefit from extra terms
    // In the future, we could add disambiguating terms like "singer" or "actress"
    return originalQuery;
}