// background/core/BTrust.js

// Remove all blocking - comment out or empty the blocked sources
const BLOCKED_SOURCES = [
    // Remove all entries - no blocking!
];

// Simplify the blocking function to never block anything
function isBlockedSource(sourceName, url) {
    // No blocking - always return false
    return false;
}

function isEnglishContent(title, snippet) {
    // Check if content contains non-English characters
    const nonEnglishRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/;
    return !nonEnglishRegex.test(title + ' ' + (snippet || ''));
}

// Global cache to prevent duplicates across searches - reset on new search
let seenResults = new Set();

function normalizeImageSignature(imageUrl, width, height) {
    try {
        const url = new URL(imageUrl);
        let name = url.pathname.split('/').pop() || '';
        let base = name.toLowerCase();
        // Strip extension
        base = base.replace(/\.(jpg|jpeg|png|webp|gif|bmp|tiff|svg)(\?.*)?$/, '');
        // Remove common size/dimension and variant suffixes
        base = base
            .replace(/[-_]?\d{2,4}x\d{2,4}$/, '')
            .replace(/@\d+x$/, '')
            .replace(/[-_](scaled|large|medium|small|thumbnail|thumb|cropped|edited|retina|hd|uhd|4k|8k)$/, '')
            .replace(/[-_]{2,}/g, '-');
        const w = Number(width || 0);
        const h = Number(height || 0);
        const wb = Math.round(w / 64);
        const hb = Math.round(h / 64);
        return `${base}|${wb}x${hb}`;
    } catch {
        return `${imageUrl}`;
    }
}

function dedupeImagesBySignature(results) {
    const signatureToBest = new Map();
    for (const r of results) {
        const imgUrl = r.imageUrl || r.url || '';
        const sig = normalizeImageSignature(imgUrl, r.width, r.height);
        const existing = signatureToBest.get(sig);
        if (!existing) {
            signatureToBest.set(sig, r);
            continue;
        }
        // Prefer higher pixel count; fallback to longer content-length if present later
        const pa = (Number(existing.width || 0) * Number(existing.height || 0)) || 0;
        const pb = (Number(r.width || 0) * Number(r.height || 0)) || 0;
        if (pb > pa) {
            signatureToBest.set(sig, r);
        }
    }
    return Array.from(signatureToBest.values());
}

// Celebrity disambiguation: profession keywords for context analysis
const PROFESSION_KEYWORDS = {
    musician: ['singer', 'artist', 'musician', 'song', 'album', 'music', 'concert', 'tour', 'Grammy', 'Billboard', 'recording', 'vocals', 'performer', 'band', 'songwriter', 'pop', 'rock', 'hip-hop', 'rap', 'country', 'jazz', 'classical'],
    actor: ['actor', 'actress', 'movie', 'film', 'cinema', 'Hollywood', 'television', 'TV', 'series', 'show', 'drama', 'comedy', 'thriller', 'Oscar', 'Emmy', 'screen', 'cast', 'role', 'character', 'director', 'producer'],
    athlete: ['athlete', 'sports', 'player', 'team', 'game', 'match', 'championship', 'league', 'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'Olympics', 'coach', 'stadium', 'field'],
    model: ['model', 'fashion', 'runway', 'designer', 'brand', 'photoshoot', 'magazine', 'cover', 'style', 'beauty', 'makeup', 'clothing', 'fashion week'],
    author: ['author', 'writer', 'book', 'novel', 'publisher', 'bestseller', 'literature', 'writing', 'poet', 'journalism', 'columnist'],
    politician: ['politician', 'president', 'senator', 'governor', 'mayor', 'congress', 'parliament', 'election', 'campaign', 'politics', 'government', 'policy', 'law', 'vote'],
    businessperson: ['CEO', 'founder', 'entrepreneur', 'business', 'company', 'corporation', 'startup', 'investor', 'executive', 'billionaire', 'millionaire', 'Forbes']
};

// Enhanced entity detection for celebrity names
function extractCelebrityEntities(query) {
    const lowerQuery = query.toLowerCase();
    
    // Split on common separators, but be more nuanced about celebrity names
    let entities = [];
    
    // First, try splitting on clear separators
    const splitPatterns = [
        /\s+(?:and|&|vs\.?|x|with|feat\.?|featuring)\s+/gi,
        /\s*,\s*/g,  // comma separated
        /\s+\+\s+/g  // plus separated
    ];
    
    let foundSeparator = false;
    for (const pattern of splitPatterns) {
        if (pattern.test(query)) {
            entities = query.split(pattern).map(e => e.trim()).filter(e => e.length > 0);
            foundSeparator = true;
            break;
        }
    }
    
    // If no clear separator found, try to detect multiple names heuristically
    if (!foundSeparator) {
        const words = query.split(/\s+/);
        
        // For exactly 3 words, assume "FirstName LastName ThirdName" -> "FirstName LastName" + "ThirdName"
        if (words.length === 3) {
            entities = [`${words[0]} ${words[1]}`, words[2]];
        }
        // For exactly 4 words, assume two full names: "FirstName LastName FirstName LastName"
        else if (words.length === 4) {
            entities = [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`];
        }
        // For 5 words, try "FirstName LastName FirstName LastName ExtraName"
        else if (words.length === 5) {
            entities = [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`, words[4]];
        }
        // For 6 words, assume three full names: "FirstName LastName FirstName LastName FirstName LastName"
        else if (words.length === 6) {
            entities = [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`, `${words[4]} ${words[5]}`];
        }
        else {
            entities = [query]; // Single entity or unclear pattern
        }
    }
    
    // Clean and filter entities
    entities = entities
        .map(e => e.trim())
        .filter(e => e.length > 0)
        .filter(e => {
            // Filter out single characters or very short words
            return e.length > 2;
        });
    
    console.log(`[BTrust] Extracted celebrity entities from "${query}": [${entities.join(', ')}]`);
    return entities;
}

// Analyze profession context from metadata
function analyzeProfessionContext(metadata, entities) {
    const hay = metadata.toLowerCase();
    const professionScores = {};
    
    // Count profession keywords for each profession type
    for (const [profession, keywords] of Object.entries(PROFESSION_KEYWORDS)) {
        professionScores[profession] = 0;
        for (const keyword of keywords) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            const matches = (hay.match(regex) || []).length;
            professionScores[profession] += matches;
        }
    }
    
    // Find the dominant profession(s)
    const maxScore = Math.max(...Object.values(professionScores));
    const dominantProfessions = Object.entries(professionScores)
        .filter(([_, score]) => score > 0 && score >= maxScore * 0.7) // Within 70% of max score
        .map(([profession, _]) => profession);
    
    console.log(`[BTrust] Profession analysis for entities [${entities.join(', ')}]: ${JSON.stringify(professionScores)} -> dominant: [${dominantProfessions.join(', ')}]`);
    return { professionScores, dominantProfessions };
}

export function filterAndScoreResults(results, maxResults = 20) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BTrust] Processing ${results.length} results for curation`);
    
    // Filter out only non-English content (no source blocking!)
    const filteredResults = results.filter(result => {
        const english = isEnglishContent(result.title, result.snippet);

        if (!english) {
            console.log(`[BTrust] Filtered out non-English content: "${result.title}"`);
        }
        
        return english && (result.imageUrl || /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || ''));
    });
    
    console.log(`[BTrust] After filtering (English only): ${filteredResults.length} results`);
    
    let uniqueResults;
    if (filteredResults.length > 0 && filteredResults[0].category === 'images') {
        // Special image de-duplication across different source sites
        const deduped = dedupeImagesBySignature(filteredResults);
        // Still guard against exact URL dupes
        uniqueResults = deduped.filter(result => {
            const key = (result.imageUrl || result.url).toLowerCase().trim();
            if (seenResults.has(key)) return false;
            seenResults.add(key);
            return true;
        });
    } else {
        // Only filter out exact URL duplicates (very lenient)
        uniqueResults = filteredResults.filter(result => {
            const key = result.url.toLowerCase().trim();
            if (seenResults.has(key)) {
                console.log(`[BTrust] Exact duplicate URL detected: "${result.url}" - skipping`);
                return false;
            }
            seenResults.add(key);
            return true;
        });
    }
    
    console.log(`[BTrust] After removing duplicates: ${uniqueResults.length} results`);
    
    // Prefer high-resolution images and strong query coverage when category is images
    const withHiResBoost = uniqueResults.map(result => {
        let scoreBoost = 0;
        if (result.category === 'images') {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            // Boost if >= 4MP; stronger boost >= 8MP
            if (pixelCount >= 8_000_000) scoreBoost += 2;
            else if (pixelCount >= 4_000_000) scoreBoost += 1;

            // ENHANCED CELEBRITY DISAMBIGUATION SYSTEM
            const query = (result._query || '').toLowerCase();
            const entities = extractCelebrityEntities(query);
            const hay = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || ''}`.toLowerCase();
            
            if (entities.length > 1) {
                // Multi-celebrity query - apply disambiguation logic
                const { professionScores, dominantProfessions } = analyzeProfessionContext(hay, entities);
                
                // Check for entity co-occurrence with better name matching
                const allEntitiesPresent = entities.every(entity => {
                    const entityWords = entity.toLowerCase().split(/\s+/);
                    // Check if all words of the entity appear in the metadata
                    return entityWords.every(word => hay.includes(word));
                });
                
                const someEntitiesPresent = entities.some(entity => {
                    const entityWords = entity.toLowerCase().split(/\s+/);
                    // Check if at least half the words of the entity appear
                    const matchingWords = entityWords.filter(word => hay.includes(word));
                    return matchingWords.length >= Math.ceil(entityWords.length / 2);
                });
                
                if (allEntitiesPresent) {
                    // Strong co-occurrence boost - all celebrities mentioned
                    scoreBoost += 6;
                    console.log(`[BTrust] Strong co-occurrence: all entities [${entities.join(', ')}] found in metadata`);
                    
                    // Additional boost for profession context consistency
                    if (dominantProfessions.length > 0) {
                        scoreBoost += 2;
                        console.log(`[BTrust] Profession context boost: [${dominantProfessions.join(', ')}]`);
                    }
                } else if (someEntitiesPresent) {
                    // Partial match - apply profession-based disambiguation with name specificity
                    const { professionScores, dominantProfessions } = analyzeProfessionContext(hay, entities);
                    const totalProfessionScore = Object.values(professionScores).reduce((a, b) => a + b, 0);
                    
                    // Check how many specific entities are matched (not just partial words)
                    const exactEntityMatches = entities.filter(entity => {
                        const entityWords = entity.toLowerCase().split(/\s+/);
                        return entityWords.every(word => hay.includes(word));
                    }).length;
                    
                    if (totalProfessionScore > 0) {
                        // Base profession boost
                        let boost = Math.min(3, totalProfessionScore);
                        
                        // Additional boost for exact entity matches
                        if (exactEntityMatches > 0) {
                            boost += exactEntityMatches * 2; // 2 points per exact entity match
                            console.log(`[BTrust] Exact entity matches: ${exactEntityMatches}, total boost: ${boost}`);
                        }
                        
                        scoreBoost += boost;
                        console.log(`[BTrust] Profession-based disambiguation boost: ${boost}`);
                    } else {
                        // No clear profession context - minimal boost
                        if (exactEntityMatches > 0) {
                            scoreBoost += exactEntityMatches; // At least reward exact matches
                        } else {
                            scoreBoost += 1;
                        }
                    }
                } else {
                    // No entities found - check if it's a different celebrity with same name
                    const queryWords = query.split(/\s+/).filter(Boolean);
                    const wordMatches = queryWords.filter(word => hay.includes(word)).length;
                    
                    if (wordMatches > 0) {
                        // Name collision detection - penalize if wrong profession context
                        const totalProfessionScore = Object.values(professionScores).reduce((a, b) => a + b, 0);
                        
                        if (totalProfessionScore === 0) {
                            // No profession context - likely irrelevant
                            scoreBoost -= 2;
                            console.log(`[BTrust] Name collision penalty: no profession context for word matches`);
                        } else {
                            // Has some profession context but wrong celebrity
                            scoreBoost += Math.max(0, Math.min(2, totalProfessionScore - 1));
                        }
                    }
                }
            } else {
                // Single entity or unclear split - fallback to token coverage with profession awareness
                const tokens = query.split(/\s+/).filter(Boolean);
                const matches = tokens.filter(t => hay.includes(t)).length;
                
                if (matches >= Math.min(3, tokens.length)) {
                    scoreBoost += 2;
                } else if (matches >= 2) {
                    scoreBoost += 1;
                }
                
                // Add profession context bonus for single-entity queries too
                const { professionScores } = analyzeProfessionContext(hay, [query]);
                const totalProfessionScore = Object.values(professionScores).reduce((a, b) => a + b, 0);
                if (totalProfessionScore > 0) {
                    scoreBoost += Math.min(1, totalProfessionScore);
                }
            }
        }
        const curatedResult = { 
            ...result, 
            curated: true,
            curationMessage: "I personally curated this from the best sources available",
            _hiresBoost: scoreBoost
        };
        console.log(`[BTrust] Curated result: "${result.title}" from "${result.source}" (boost: ${scoreBoost})`);
        return curatedResult;
    });

    // Sort by combined score: hi-res boost + pixel count
    withHiResBoost.sort((a, b) => {
        const aScore = (a._hiresBoost || 0);
        const bScore = (b._hiresBoost || 0);
        
        // Primary sort by disambiguation/quality boost
        if (aScore !== bScore) {
            return bScore - aScore;
        }
        
        // Secondary sort by pixel count for similar scores
        const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        return bPixels - aPixels;
    });

    console.log(`[BTrust] Final curated results: ${withHiResBoost.length}, returning top ${maxResults}`);
    return withHiResBoost.slice(0, maxResults);
}

// Function to reset the duplicate cache for new searches
export function resetDuplicateCache() {
    seenResults.clear();
    console.log('[BTrust] Duplicate cache reset for new search');
}
