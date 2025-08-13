// background/core/BTrust.js

// Sources to completely filter out - STREAMLINED LIST
const BLOCKED_SOURCES = [
    // Social Media (low quality, watermarked, or hard to access)
    'twitter.com', 'x.com', 'twimg.com', 't.co',
    
    // Wikipedia (low res, generic images)
    'wikipedia.org', 'wikimedia.org', 'wikiquote.org', 'fandom.com', 'wikia.com',
    
    // Shopping/E-commerce Sites
    'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'bestbuy.com',
    'shopify.com', 'lazada.com', 'shopee', 'aliexpress.com', 'alibaba.com',
    'mercari', 'poshmark.com', 'merchbar.com', 'weverse.io',
    
    // Print-on-Demand & Merch Sites
    'redbubble.com', 'teepublic.com', 'zazzle.com', 'cafepress.com',
    
    // Stock Photo Houses (watermarked, paid content)
    'shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'adobe.com'
];

function isBlockedSource(sourceName, url) {
    if (!sourceName && !url) return false;
    
    const sourceLower = sourceName ? sourceName.toLowerCase() : '';
    const urlLower = url ? url.toLowerCase() : '';
    let host = '';
    try { host = new URL(url || '').hostname.toLowerCase(); } catch {}
    
    // Block obvious shopping subdomains
    const subdomainBlocked = host.startsWith('store.') || host.startsWith('shop.') || host.startsWith('merch.');
    
    return subdomainBlocked || BLOCKED_SOURCES.some(blocked => 
        sourceLower.includes(blocked) || urlLower.includes(blocked) || host.includes(blocked)
    );
}

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

// Enhanced collaboration scoring function with RELAXED thresholds
function scoreCollaborationResult(result, entities) {
    const haystack = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || result.url || ''}`.toLowerCase();
    
    let score = 0;
    const entityMatches = entities.filter(e => haystack.includes(e.toLowerCase())).length;
    
    // PRIORITY: Both entities mentioned = huge boost
    if (entityMatches >= 2) {
        score += 100; // Massive boost for both entities
        
        // Extra boost for collaboration keywords
        if (/\b(and|with|featuring|feat\.?|collab|together|duet)\b/i.test(haystack)) {
            score += 50;
        }
        
        // Photo context boost
        if (/\b(photo|picture|image|shot|pic)\b/i.test(haystack)) {
            score += 20;
        }
        
        // Event context boost  
        if (/\b(concert|performance|show|event|festival|tour)\b/i.test(haystack)) {
            score += 30;
        }
    } else if (entityMatches === 1) {
        // RELAXED: Single entity gets decent score for collaboration searches
        score += 25; // Increased from 5 to 25
        
        // Boost single entity with collaboration context
        if (/\b(and|with|featuring|feat\.?|collab|together|duet)\b/i.test(haystack)) {
            score += 20; // Increased from 10 to 20
        }
    }
    
    // Size/quality boost
    const pixelCount = (Number(result.width || 0) * Number(result.height || 0));
    if (pixelCount >= 8_000_000) score += 10;
    else if (pixelCount >= 4_000_000) score += 5;
    
    return score;
}

export function filterAndScoreResults(results, maxResults = 20) {
    if (!results || results.length === 0) {
        return [];
    }

    console.log(`[BTrust] Processing ${results.length} results for curation`);
    
    // Check if this is a collaboration search
    const collaboration = results[0]?._collaboration;
    const isCollaborationSearch = collaboration?.isCollaboration && collaboration?.entities?.length >= 2;
    
    if (isCollaborationSearch) {
        console.log(`[BTrust] COLLABORATION SEARCH detected for entities:`, collaboration.entities);
        
        // STEP 1: Score all results for collaboration relevance
        const scoredResults = results.map(result => ({
            ...result,
            _collaborationScore: scoreCollaborationResult(result, collaboration.entities)
        }));
        
        // STEP 2: RELAXED filtering for collaborations
        const collaborationResults = scoredResults.filter(result => {
            // Block bad sources
            if (isBlockedSource(result.source, result.url)) return false;
            
            // English content only
            if (!isEnglishContent(result.title, result.snippet)) return false;
            
            // Must have image URL
            if (!result.imageUrl && !/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '')) return false;
            
            // RELAXED COLLABORATION FILTER: Much lower threshold
            return result._collaborationScore >= 15; // Reduced from 50 to 15
        });
        
        console.log(`[BTrust] Collaboration filtering: ${collaborationResults.length} results with score >= 15`);
        
        // STEP 3: If still too few, try very low threshold
        let finalResults = collaborationResults;
        if (finalResults.length < 5) {
            console.log(`[BTrust] Too few results, trying very low threshold (score >= 5)`);
            finalResults = scoredResults.filter(result => {
                if (isBlockedSource(result.source, result.url)) return false;
                if (!isEnglishContent(result.title, result.snippet)) return false;
                if (!result.imageUrl && !/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '')) return false;
                return result._collaborationScore >= 5;
            });
        }
        
        // STEP 4: Emergency fallback - show any valid images
        if (finalResults.length < 3) {
            console.log(`[BTrust] Emergency fallback - showing all valid images`);
            finalResults = scoredResults.filter(result => {
                if (isBlockedSource(result.source, result.url)) return false;
                if (!isEnglishContent(result.title, result.snippet)) return false;
                if (!result.imageUrl && !/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '')) return false;
                return true; // Accept any valid image
            });
        }
        
        // STEP 5: Sort by collaboration score + pixel count
        finalResults.sort((a, b) => {
            const scoreDiff = (b._collaborationScore || 0) - (a._collaborationScore || 0);
            if (scoreDiff !== 0) return scoreDiff;
            
            const pa = (Number(a.width || 0) * Number(a.height || 0)) || 0;
            const pb = (Number(b.width || 0) * Number(b.height || 0)) || 0;
            return pb - pa;
        });
        
        console.log(`[BTrust] Final collaboration results: ${finalResults.length}, top scores:`, 
            finalResults.slice(0, 5).map(r => ({ 
                title: r.title?.substring(0, 50), 
                score: r._collaborationScore 
            }))
        );
        
        // Remove duplicates
        const uniqueResults = dedupeImagesBySignature(finalResults);
        
        return uniqueResults.slice(0, maxResults).map(result => ({
            ...result,
            curated: true,
            curationMessage: `Collaboration search: ${collaboration.entities.join(' + ')}`
        }));
    }
    
    // REGULAR (NON-COLLABORATION) SEARCH LOGIC
    const filteredResults = results.filter(result => {
        const blocked = isBlockedSource(result.source, result.url);
        const english = isEnglishContent(result.title, result.snippet);

        if (blocked) {
            console.log(`[BTrust] Filtered out blocked source: "${result.source}" (${result.url})`);
        }
        if (!english) {
            console.log(`[BTrust] Filtered out non-English content: "${result.title}"`);
        }
        
        return !blocked && english && (result.imageUrl || /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || ''));
    });
    
    console.log(`[BTrust] After filtering blocked sources: ${filteredResults.length} results`);
    
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
    
    // Regular scoring and sorting
    const withHiResBoost = uniqueResults.map(result => {
        let scoreBoost = 0;
        if (result.category === 'images') {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            if (pixelCount >= 8_000_000) scoreBoost += 2;
            else if (pixelCount >= 4_000_000) scoreBoost += 1;
        }
        return { 
            ...result, 
            curated: true,
            curationMessage: "I personally curated this from the best sources available",
            _hiresBoost: scoreBoost
        };
    });

    withHiResBoost.sort((a, b) => {
        const boostDiff = (b._hiresBoost || 0) - (a._hiresBoost || 0);
        if (boostDiff !== 0) return boostDiff;
        const pa = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const pb = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        return pb - pa;
    });

    return withHiResBoost.slice(0, maxResults);
}

export function resetDuplicateCache() {
    seenResults.clear();
    console.log('[BTrust] Duplicate cache reset for new search');
}
