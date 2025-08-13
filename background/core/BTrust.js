// background/core/BTrust.js

function isEnglishContent(title, snippet) {
    const nonEnglishRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F]/;
    return !nonEnglishRegex.test(title + ' ' + (snippet || ''));
}

// Global cache to prevent duplicates across searches
let seenResults = new Set();

function normalizeImageSignature(imageUrl, width, height) {
    try {
        const url = new URL(imageUrl);
        let name = url.pathname.split('/').pop() || '';
        let base = name.toLowerCase();
        base = base.replace(/\.(jpg|jpeg|png|webp|gif|bmp|tiff|svg)(\?.*)?$/, '');
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
        const pa = (Number(existing.width || 0) * Number(existing.height || 0)) || 0;
        const pb = (Number(r.width || 0) * Number(r.height || 0)) || 0;
        if (pb > pa) {
            signatureToBest.set(sig, r);
        }
    }
    return Array.from(signatureToBest.values());
}

// ULTRA HIGH-RES scoring - prioritize massive images
function getHiResScore(result) {
    const w = Number(result.width || 0);
    const h = Number(result.height || 0);
    const pixelCount = w * h;
    const megaPixels = pixelCount / 1_000_000;
    
    let score = 0;
    
    // ULTRA HIGH-RES SCORING (much more aggressive)
    if (megaPixels >= 50) score += 1000;      // 50MP+ = ULTRA premium
    else if (megaPixels >= 24) score += 500;  // 24MP+ = Professional camera quality
    else if (megaPixels >= 16) score += 300;  // 16MP+ = High-end phone/camera
    else if (megaPixels >= 12) score += 200;  // 12MP+ = Modern phone quality
    else if (megaPixels >= 8) score += 100;   // 8MP+ = Decent quality
    else if (megaPixels >= 4) score += 50;    // 4MP+ = Minimum acceptable
    else if (megaPixels >= 2) score += 10;    // 2MP+ = Low quality
    // Under 2MP gets 0 points
    
    // Bonus for specific high-res dimensions
    if (w >= 8000 || h >= 8000) score += 200; // 8K resolution
    if (w >= 6000 || h >= 6000) score += 150; // 6K resolution  
    if (w >= 4000 || h >= 4000) score += 100; // 4K resolution
    if (w >= 3000 || h >= 3000) score += 50;  // 3K resolution
    
    // Aspect ratio bonus (prefer standard ratios)
    if (w > 0 && h > 0) {
        const ratio = w / h;
        if (ratio >= 0.5 && ratio <= 2.0) score += 25; // Reasonable aspect ratio
    }
    
    return score;
}

// Enhanced collaboration scoring function with aggressive filename analysis
function scoreCollaborationResult(result, entities) {
    const haystack = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || result.url || ''}`.toLowerCase();
    
    // Extract filename and URL path for deeper analysis
    let filename = '';
    let urlPath = '';
    try {
        const url = new URL(result.imageUrl || result.url || '');
        filename = (url.pathname.split('/').pop() || '').toLowerCase();
        urlPath = url.pathname.toLowerCase();
    } catch (e) {
        // If URL parsing fails, try basic extraction
        const urlStr = result.imageUrl || result.url || '';
        filename = urlStr.split('/').pop()?.toLowerCase() || '';
        urlPath = urlStr.toLowerCase();
    }
    
    // Create comprehensive search context including filename analysis
    const filenameContext = filename.replace(/[-_]/g, ' ').replace(/\.(jpg|jpeg|png|webp|gif|bmp|tiff|svg)(\?.*)?$/, '');
    const urlContext = urlPath.replace(/[-_]/g, ' ');
    const fullContext = `${haystack} ${filenameContext} ${urlContext}`;
    
    let score = 0;
    const entityMatches = entities.filter(e => fullContext.includes(e.toLowerCase())).length;
    
    // AGGRESSIVE COLLABORATION DETECTION: Check for both entities in filename/URL
    const entitiesInFilename = entities.filter(e => filenameContext.includes(e.toLowerCase())).length;
    const entitiesInUrlPath = entities.filter(e => urlContext.includes(e.toLowerCase())).length;
    
    // HIGHEST PRIORITY: Both entities in filename or URL path (true collaboration indicators)
    if (entitiesInFilename >= 2 || entitiesInUrlPath >= 2) {
        score += 200; // Massive boost for filename/URL collaboration evidence
        console.log(`[BTrust] FILENAME/URL COLLABORATION found: ${filename || urlPath} contains both entities`);
    }
    // SECOND PRIORITY: Both entities mentioned anywhere in metadata
    else if (entityMatches >= 2) {
        score += 100;
        
        // Extra boost for collaboration keywords
        if (/\b(and|with|featuring|feat\.?|collab|together|duet)\b/i.test(fullContext)) {
            score += 50;
        }
        
        // Photo context boost
        if (/\b(photo|picture|image|shot|pic)\b/i.test(fullContext)) {
            score += 20;
        }
        
        // Event context boost  
        if (/\b(concert|performance|show|event|festival|tour)\b/i.test(fullContext)) {
            score += 30;
        }
    } 
    // LOWER PRIORITY: Single entity but with strong collaboration context
    else if (entityMatches === 1) {
        // Base score for single entity
        score += 25;
        
        // Boost single entity with collaboration context
        if (/\b(and|with|featuring|feat\.?|collab|together|duet)\b/i.test(fullContext)) {
            score += 20;
        }
        
        // Additional boost if the other entity appears in any form (partial matches)
        const otherEntity = entities.find(e => !fullContext.includes(e.toLowerCase()));
        if (otherEntity) {
            const entityParts = otherEntity.toLowerCase().split(' ');
            const hasPartialMatch = entityParts.some(part => part.length > 2 && fullContext.includes(part));
            if (hasPartialMatch) {
                score += 15;
                console.log(`[BTrust] Partial entity match found for: ${otherEntity}`);
            }
        }
    }
    
    // Penalty for results with no entity matches (shouldn't happen but safety check)
    if (entityMatches === 0) {
        score -= 50;
    }
    
    // ADD HI-RES SCORE to collaboration score
    score += getHiResScore(result);
    
    return score;
}

export function filterAndScoreResults(results, maxResults = 20) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BTrust] Processing ${results.length} results for ULTRA HI-RES curation`);
    
    // Check if this is a collaboration search
    const collaboration = results[0]?._collaboration;
    const isCollaborationSearch = collaboration?.isCollaboration && collaboration?.entities?.length >= 2;
    
    if (isCollaborationSearch) {
        console.log(`[BTrust] COLLABORATION SEARCH detected for entities:`, collaboration.entities);
        
        // Score all results for collaboration relevance + HI-RES
        const scoredResults = results.map(result => ({
            ...result,
            _collaborationScore: scoreCollaborationResult(result, collaboration.entities),
            _hiResScore: getHiResScore(result)
        }));
        
        // AGGRESSIVE COLLABORATION FILTERING: Apply minimum collaboration threshold
        let collaborationResults = scoredResults.filter(result => {
            // STRICT COLLABORATION REQUIREMENT: Must have meaningful collaboration score
            const collabScore = result._collaborationScore || 0;
            const hiResScore = result._hiResScore || 0;
            
            // Minimum collaboration score threshold (before hi-res bonus)
            // This ensures we only show results that actually relate to BOTH entities
            const collaborationScoreOnly = collabScore - hiResScore;
            return collaborationScoreOnly >= 75; // Minimum threshold for collaboration relevance
        });
        
        console.log(`[BTrust] AGGRESSIVE collaboration filtering: ${collaborationResults.length} results meet collaboration threshold`);
        
        // If too few results with strict collaboration, relax to medium threshold
        if (collaborationResults.length < 5) {
            console.log(`[BTrust] Relaxing collaboration threshold due to limited results`);
            collaborationResults = scoredResults.filter(result => {
                const collabScore = result._collaborationScore || 0;
                const hiResScore = result._hiResScore || 0;
                const collaborationScoreOnly = collabScore - hiResScore;
                return collaborationScoreOnly >= 40; // Relaxed threshold
            });
        }
        
        // Apply HI-RES filtering to collaboration results
        const hiResResults = collaborationResults.filter(result => {
            // English content only
            if (!isEnglishContent(result.title, result.snippet)) return false;
            
            // Must have image URL
            if (!result.imageUrl && !/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '')) return false;
            
            // ULTRA HI-RES REQUIREMENT: Must be at least 2MP (minimum acceptable)
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const megaPixels = (w * h) / 1_000_000;
            
            if (megaPixels >= 2) return true; // 2MP minimum
            
            // If no dimensions available, allow it (will be sorted low)
            if (w === 0 || h === 0) return true;
            
            return false; // Under 2MP = reject
        });
        
        console.log(`[BTrust] HI-RES filtering: ${hiResResults.length} results meet minimum 2MP requirement`);
        
        // Sort by COMBINED collaboration + hi-res score
        hiResResults.sort((a, b) => {
            const totalScoreA = (a._collaborationScore || 0) + (a._hiResScore || 0);
            const totalScoreB = (b._collaborationScore || 0) + (b._hiResScore || 0);
            return totalScoreB - totalScoreA;
        });
        
        console.log(`[BTrust] Final HI-RES collaboration results: ${hiResResults.length}, top scores:`, 
            hiResResults.slice(0, 5).map(r => ({ 
                title: r.title?.substring(0, 50), 
                collabScore: r._collaborationScore,
                hiResScore: r._hiResScore,
                megaPixels: ((Number(r.width || 0) * Number(r.height || 0)) / 1_000_000).toFixed(1),
                source: r.source
            }))
        );
        
        // Remove duplicates
        const uniqueResults = dedupeImagesBySignature(hiResResults);
        
        return uniqueResults.slice(0, maxResults).map(result => ({
            ...result,
            curated: true,
            curationMessage: `HI-RES collaboration: ${collaboration.entities.join(' + ')}`
        }));
    }
    
    // REGULAR (NON-COLLABORATION) ULTRA HI-RES SEARCH
    const filteredResults = results.filter(result => {
        const english = isEnglishContent(result.title, result.snippet);
        
        if (!english) {
            console.log(`[BTrust] Filtered out non-English content: "${result.title}"`);
            return false;
        }
        
        // Must have image URL
        if (!result.imageUrl && !/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '')) {
            return false;
        }
        
        // ULTRA HI-RES REQUIREMENT: Must be at least 2MP
        const w = Number(result.width || 0);
        const h = Number(result.height || 0);
        const megaPixels = (w * h) / 1_000_000;
        
        if (megaPixels >= 2) return true; // 2MP minimum
        
        // If no dimensions available, allow it (will be sorted low)
        if (w === 0 || h === 0) return true;
        
        return false; // Under 2MP = reject
    });
    
    console.log(`[BTrust] After HI-RES filtering: ${filteredResults.length} results`);
    
    let uniqueResults;
    if (filteredResults.length > 0 && filteredResults[0].category === 'images') {
        const deduped = dedupeImagesBySignature(filteredResults);
        uniqueResults = deduped.filter(result => {
            const key = (result.imageUrl || result.url).toLowerCase().trim();
            if (seenResults.has(key)) return false;
            seenResults.add(key);
            return true;
        });
    } else {
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
    
    // ULTRA HI-RES SCORING AND SORTING
    const withUltraHiResBoost = uniqueResults.map(result => {
        const hiResScore = getHiResScore(result);
        const w = Number(result.width || 0);
        const h = Number(result.height || 0);
        const megaPixels = ((w * h) / 1_000_000).toFixed(1);
        
        return { 
            ...result, 
            curated: true,
            curationMessage: `ULTRA HI-RES: ${megaPixels}MP (${w}×${h})`,
            _hiResScore: hiResScore
        };
    });

    // Sort by HI-RES score (highest resolution first)
    withUltraHiResBoost.sort((a, b) => {
        return (b._hiResScore || 0) - (a._hiResScore || 0);
    });

    console.log(`[BTrust] Top HI-RES results:`, 
        withUltraHiResBoost.slice(0, 5).map(r => ({
            megaPixels: ((Number(r.width || 0) * Number(r.height || 0)) / 1_000_000).toFixed(1),
            dimensions: `${r.width}×${r.height}`,
            score: r._hiResScore,
            source: r.source
        }))
    );

    return withUltraHiResBoost.slice(0, maxResults);
}

export function resetDuplicateCache() {
    seenResults.clear();
    console.log('[BTrust] Duplicate cache reset for new search');
}
