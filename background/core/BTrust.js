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

// Celebrity profession context mapping for disambiguation
const CELEBRITY_CONTEXTS = {
    // Music industry
    'singer': ['music', 'album', 'song', 'concert', 'tour', 'billboard', 'grammy', 'spotify', 'musician', 'artist', 'vocalist'],
    'musician': ['music', 'album', 'song', 'concert', 'tour', 'billboard', 'grammy', 'spotify', 'band', 'artist'],
    'rapper': ['rap', 'hip hop', 'album', 'music', 'billboard', 'grammy', 'spotify', 'track'],
    
    // Entertainment industry
    'actress': ['movie', 'film', 'tv', 'television', 'series', 'show', 'hollywood', 'oscar', 'emmy', 'director', 'cinema'],
    'actor': ['movie', 'film', 'tv', 'television', 'series', 'show', 'hollywood', 'oscar', 'emmy', 'director', 'cinema'],
    'director': ['movie', 'film', 'tv', 'television', 'series', 'show', 'hollywood', 'oscar', 'emmy', 'cinema'],
    
    // Sports
    'nfl': ['football', 'quarterback', 'touchdown', 'super bowl', 'draft', 'playoff', 'sports', 'athlete', 'team'],
    'nba': ['basketball', 'nba', 'playoff', 'championship', 'sports', 'athlete', 'team', 'court'],
    'athlete': ['sports', 'championship', 'olympics', 'competition', 'team', 'training'],
    
    // Other professions
    'model': ['fashion', 'runway', 'photoshoot', 'vogue', 'modeling', 'catwalk'],
    'influencer': ['social media', 'instagram', 'tiktok', 'youtube', 'followers', 'content creator'],
    'politician': ['politics', 'government', 'senator', 'congress', 'election', 'campaign']
};

/**
 * Analyzes celebrity context from image metadata to disambiguate between people with similar names
 * @param {string} query - The search query
 * @param {string} metadata - Combined metadata (title, description, alt text, etc.)
 * @returns {Object} Context analysis with profession hints and confidence
 */
function analyzeCelebrityContext(query, metadata) {
    const queryLower = query.toLowerCase();
    const metaLower = metadata.toLowerCase();
    
    // Extract potential celebrity names from query (look for multiple words that could be names)
    const words = query.split(/\s+/);
    const potentialNames = [];
    
    // Look for sequences of 2+ capitalized words or common name patterns
    for (let i = 0; i < words.length - 1; i++) {
        const twoWords = words[i] + ' ' + words[i + 1];
        // Check if it looks like a name (starts with capital or is commonly capitalized)
        if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(twoWords) || 
            /^[a-z]+\s+[a-z]+/.test(twoWords.toLowerCase()) && twoWords.length >= 6) {
            potentialNames.push(twoWords);
        }
    }
    
    // Check for profession context in metadata
    const foundContexts = {};
    let totalContextScore = 0;
    
    for (const [profession, keywords] of Object.entries(CELEBRITY_CONTEXTS)) {
        let contextScore = 0;
        let keywordMatches = [];
        
        for (const keyword of keywords) {
            if (metaLower.includes(keyword)) {
                contextScore += 1;
                keywordMatches.push(keyword);
                
                // Boost score if keyword appears multiple times or in title
                const occurrences = (metaLower.match(new RegExp(keyword, 'g')) || []).length;
                if (occurrences > 1) contextScore += 0.5;
            }
        }
        
        if (contextScore > 0) {
            foundContexts[profession] = {
                score: contextScore,
                keywords: keywordMatches
            };
            totalContextScore += contextScore;
        }
    }
    
    // Determine primary profession context
    let primaryContext = null;
    let primaryScore = 0;
    for (const [profession, data] of Object.entries(foundContexts)) {
        if (data.score > primaryScore) {
            primaryContext = profession;
            primaryScore = data.score;
        }
    }
    
    return {
        potentialNames,
        primaryContext,
        primaryScore,
        allContexts: foundContexts,
        totalScore: totalContextScore,
        hasContext: totalContextScore > 0
    };
}

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

            // Enhanced co-occurrence boost with celebrity disambiguation
            const query = (result._query || '').toLowerCase();
            const entities = query.split(/\s+(?:and|&|vs|x|with)\s+/g).map(s => s.trim()).filter(Boolean);
            const hay = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || ''}`.toLowerCase();
            
            // Analyze celebrity context for disambiguation
            const contextAnalysis = analyzeCelebrityContext(query, hay);
            
            if (entities.length > 1) {
                const all = entities.every(e => hay.includes(e));
                const any = entities.some(e => hay.includes(e));
                
                if (all) {
                    scoreBoost += 4; // strong co-occurrence
                    
                    // Additional boost if celebrity context is consistent
                    if (contextAnalysis.hasContext) {
                        scoreBoost += 2;
                        console.log(`[BTrust] Celebrity context boost: ${contextAnalysis.primaryContext} (${contextAnalysis.primaryScore} keywords)`);
                    }
                } else if (any) {
                    // Check for celebrity context conflicts
                    if (contextAnalysis.hasContext) {
                        // If we have strong context but not all entities match, this might be wrong celebrity
                        const nameInQuery = contextAnalysis.potentialNames.some(name => 
                            entities.some(entity => entity.includes(name.toLowerCase().split(' ')[0]))
                        );
                        
                        if (nameInQuery && contextAnalysis.primaryScore >= 2) {
                            // Strong context but missing entities suggests wrong celebrity
                            scoreBoost -= 2;
                            console.log(`[BTrust] Celebrity context conflict detected, reducing score for: ${result.title}`);
                        } else {
                            scoreBoost += 1; // keep as padding if needed
                        }
                    } else {
                        scoreBoost += 1; // keep as padding if needed
                    }
                }
            } else {
                // Single entity search - enhanced with celebrity context
                const tokens = query.split(/\s+/).filter(Boolean);
                const matches = tokens.filter(t => hay.includes(t)).length;
                
                // Apply celebrity context scoring for single-name searches
                if (contextAnalysis.hasContext && contextAnalysis.potentialNames.length > 0) {
                    // Check if query contains a celebrity name
                    const queryContainsCelebrity = contextAnalysis.potentialNames.some(name => 
                        query.toLowerCase().includes(name.toLowerCase())
                    );
                    
                    if (queryContainsCelebrity) {
                        // Boost for relevant celebrity context
                        scoreBoost += Math.min(3, contextAnalysis.primaryScore);
                        console.log(`[BTrust] Celebrity-specific boost: ${contextAnalysis.primaryContext}`);
                    }
                }
                
                // Original token-based scoring
                if (matches >= Math.min(3, tokens.length)) scoreBoost += 2;
                else if (matches >= 2) scoreBoost += 1;
            }
        }
        const curatedResult = { 
            ...result, 
            curated: true,
            curationMessage: "I personally curated this from the best sources available",
            _hiresBoost: scoreBoost
        };
        console.log(`[BTrust] Curated result: "${result.title}" from "${result.source}"`);
        return curatedResult;
    });

    // Simple sort: prioritize co-occurrence/hires boost and pixel count
    const sorted = withHiResBoost.sort((a, b) => {
        const aScore = (a._hiresBoost || 0);
        const bScore = (b._hiresBoost || 0);
        if (aScore !== bScore) return bScore - aScore;
        
        // Fallback to pixel count
        const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        return bPixels - aPixels;
    });

    return sorted.slice(0, maxResults);
}

// Function to reset the duplicate cache for new searches
export function resetDuplicateCache() {
    seenResults.clear();
    console.log('[BTrust] Duplicate cache reset for new search');
}
