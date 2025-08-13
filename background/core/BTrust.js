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
    
    // Simple image de-duplication and high-res filtering
    let uniqueResults;
    if (filteredResults.length > 0 && filteredResults[0].category === 'images') {
        // Filter for high-res images: ≥1000px or ≥500KB
        const highResResults = filteredResults.filter(result => {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const bytes = Number(result.byteSize || 0);
            return w >= 1000 || h >= 1000 || bytes >= 500_000;
        });
        
        // Simple deduplication by URL
        uniqueResults = dedupeImagesBySignature(highResResults).filter(result => {
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
    
    console.log(`[BTrust] After filtering for high-res and removing duplicates: ${uniqueResults.length} results`);
    
    // Simple sorting by image size (largest first)
    const withCurationFlag = uniqueResults.map(result => ({
        ...result, 
        curated: true,
        curationMessage: "I personally curated this from the best sources available"
    }));

    // Sort by pixel count for images, otherwise keep original order
    withCurationFlag.sort((a, b) => {
        if (a.category === 'images' && b.category === 'images') {
            const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
            const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
            return bPixels - aPixels;
        }
        return 0; // Keep original order for non-images
    });

    return withCurationFlag.slice(0, maxResults);
}

// Function to reset the duplicate cache for new searches
export function resetDuplicateCache() {
    seenResults.clear();
    console.log('[BTrust] Duplicate cache reset for new search');
}
