// background/core/BTrust.js

// Sources to completely filter out
const BLOCKED_SOURCES = [
    'facebook.com',
    // 'instagram.com', // allowed per user request
    'pinterest.com',
    'tiktok.com',
    'twitter.com',
    'x.com',
    'snapchat.com',
    'linkedin.com',
    'tumblr.com',
    'reddit.com', 'redd.it',
    'flickr.com',
    'deviantart.com',
    'behance.net',
    '500px.com',
    // Social/CDN platforms (hard blocked)
    'youtube.com', 'youtu.be', 'ytimg.com',
    'fbcdn.net', 'fbsbx.com',
    // 'cdninstagram.com', // allowed per user request
    'threads.net',
    'tiktokcdn.com', 'ttwcdn.com',
    'twimg.com', 't.co',
    'imgur.com', 'giphy.com',
    'vk.com', 'weibo.com', 'bilibili.com',
    'unsplash.com',
    'pexels.com',
    'shutterstock.com',
    'gettyimages.com',
    'istockphoto.com',
    'adobe.com',
    'canva.com',
    'medium.com',
    'substack.com',
    'quora.com',
    // Allow major news portals back in for more volume
    // 'yahoo.com',
    // 'aol.com',
    // 'msn.com',
    'buzzfeed.com',
    'vice.com',
    'vox.com',
    'huffpost.com',
    'huffingtonpost.com',
    'boredpanda.com',
    'distractify.com',
    'viralnova.com',
    'upworthy.com',
    'littlethings.com',
    // 'wikipedia.org',
    // 'en.wikipedia.org',
    'wikimedia.org',
    // Commerce/merch listing domains often off-topic for image news relevance
    'lazada.vn', 'lazada.com', 'shopee', 'mercari', 'poshmark.com', 'ebay.com', 'amazon.com', 'shopify.com', 'merchbar.com', 'weverse.io', 'kpopmart', 'kpopstore',
    // Shopping/retail (general)
    'walmart.com', 'target.com', 'bestbuy.com', 'aliexpress.com', 'alibaba.com', 'etsy.com', 'redbubble.com', 'teepublic.com', 'zazzle.com', 'cafepress.com',
    // Sneakers/athletics commerce & catalog/release calendars
    'stockx.com', 'goat.com', 'flightclub.com', 'stadiumgoods.com', 'sneakersnstuff.com', 'footlocker.com', 'finishline.com', 'eastbay.com', 'champssports.com', 'hibbett.com', 'jdsports.com',
    // Brand commerce
    'nike.com', 'adidas.com', 'newbalance.com', 'reebok.com', 'puma.com',
    // Sneaker news/release hubs (often product-forward)
    'sneakernews.com', 'solecollector.com', 'nicekicks.com'
];

// Domain-agnostic: avoid hardcoding preferred sources to keep general-purpose relevance

// No social-specific allowlists; we rely on query-term coverage and size/quality signals

function isBlockedSource(sourceName, url) {
    if (!sourceName && !url) return false;
    
    const sourceLower = sourceName ? sourceName.toLowerCase() : '';
    const urlLower = url ? url.toLowerCase() : '';
    // Parse hostname to catch commerce subdomains like store.*, shop.*, merch.*
    let host = '';
    try { host = new URL(url || '').hostname.toLowerCase(); } catch {}
    const subdomainBlocked = host.startsWith('store.') || host.startsWith('shop.') || host.startsWith('merch.');
    
    return subdomainBlocked || BLOCKED_SOURCES.some(blocked => 
        sourceLower.includes(blocked) || urlLower.includes(blocked) || host.includes(blocked)
    );
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
    
    // Less aggressive filtering - focus on quality over strict blocking
    const filteredResults = results.filter(result => {
        const blocked = isBlockedSource(result.source, result.url);
        // More lenient language restriction to get better volume
        const english = isEnglishContent(result.title, result.snippet);
        const hasValidImage = result.imageUrl || /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(result.url || '');
        
        // Enhanced quality checks for high-res focus
        const width = Number(result.width || 0);
        const height = Number(result.height || 0);
        const meetsQualityThreshold = width >= 1200 || height >= 1200 || (width * height) >= 2_000_000;

        if (blocked) {
            console.log(`[BTrust] Filtered out blocked source: "${result.source}" (${result.url})`);
        }
        if (!english) {
            console.log(`[BTrust] Filtered out non-English content: "${result.title}"`);
        }
        if (!hasValidImage) {
            console.log(`[BTrust] Filtered out - no valid image URL`);
        }
        if (!meetsQualityThreshold) {
            console.log(`[BTrust] Filtered out low quality: ${width}x${height} from ${result.source}`);
        }
        
        return !blocked && english && hasValidImage && meetsQualityThreshold;
    });
    
    console.log(`[BTrust] After enhanced filtering: ${filteredResults.length} results`);
    // Enhanced deduplication that preserves highest quality variants
    let uniqueResults;
    if (filteredResults.length > 0 && filteredResults[0].category === 'images') {
        // Smart deduplication for images - preserve best quality version
        const deduped = dedupeImagesBySignature(filteredResults);
        uniqueResults = deduped.filter(result => {
            const key = (result.imageUrl || result.url).toLowerCase().trim();
            if (seenResults.has(key)) return false;
            seenResults.add(key);
            return true;
        });
    } else {
        // Standard URL deduplication
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
    
    // More lenient minimum thresholds for better results
    const MIN_RESULTS = 20;
    if (uniqueResults.length < MIN_RESULTS && filteredResults.length > uniqueResults.length) {
        console.log(`[BTrust] Only ${uniqueResults.length} unique results, relaxing deduplication for better volume`);
        const additionalResults = [];
        const byHost = new Map();
        for (const r of filteredResults) {
            const key = (r.imageUrl || r.url).toLowerCase().trim();
            if (seenResults.has(key)) continue;
            const host = (() => { try { return new URL(r.pageUrl || r.url || '').hostname; } catch { return 'unknown'; } })();
            if (!byHost.has(host)) byHost.set(host, []);
            byHost.get(host).push(r);
        }
        // Interleave by host for diversity
        const hostKeys = Array.from(byHost.keys());
        let pointer = 0;
        while (additionalResults.length < Math.min(MIN_RESULTS - uniqueResults.length, 40) && hostKeys.length > 0) {
            const host = hostKeys[pointer % hostKeys.length];
            const bucket = byHost.get(host);
            const candidate = bucket && bucket.shift();
            if (candidate) {
                additionalResults.push(candidate);
            } else {
                hostKeys.splice(pointer % hostKeys.length, 1);
                continue;
            }
            pointer++;
        }
        
        additionalResults.forEach(result => {
            const key = result.url.toLowerCase().trim();
            seenResults.add(key);
        });
        
        uniqueResults.push(...additionalResults);
    }

    console.log(`[BTrust] After removing duplicates: ${uniqueResults.length} results`);
    
    // Enhanced high-resolution priority scoring
    const withHiResBoost = uniqueResults.map(result => {
        let scoreBoost = 0;
        if (result.category === 'images') {
            const w = Number(result.width || 0);
            const h = Number(result.height || 0);
            const pixelCount = w * h;
            
            // Strong preference for high resolution images
            if (pixelCount >= 16_000_000) scoreBoost += 5; // 16MP+
            else if (pixelCount >= 8_000_000) scoreBoost += 3; // 8MP+
            else if (pixelCount >= 4_000_000) scoreBoost += 2; // 4MP+
            else if (w >= 2000 || h >= 2000) scoreBoost += 1; // At least 2000px in one dimension

            // Co-occurrence boost: prefer images whose metadata mentions all entities
            const query = (result._query || '').toLowerCase();
            const entities = query.split(/\s+(?:and|&|vs|x|with)\s+/g).map(s => s.trim()).filter(Boolean);
            const hay = `${result.ogTitle || ''} ${result.ogDescription || ''} ${result.ogAlt || ''} ${result.title || ''} ${result.pageUrl || ''}`.toLowerCase();
            if (entities.length > 1) {
                const all = entities.every(e => hay.includes(e));
                const any = entities.some(e => hay.includes(e));
                if (all) scoreBoost += 4; // strong co-occurrence
                else if (any) scoreBoost += 1; // partial match
            } else {
                // Token coverage for single entity queries
                const tokens = query.split(/\s+/).filter(Boolean);
                const matches = tokens.filter(t => hay.includes(t)).length;
                if (matches >= Math.min(3, tokens.length)) scoreBoost += 2;
                else if (matches >= 2) scoreBoost += 1;
            }
        }
        const curatedResult = { 
            ...result, 
            curated: true,
            curationMessage: "High-resolution image curated from premium sources",
            _hiresBoost: scoreBoost
        };
        console.log(`[BTrust] Curated result: "${result.title}" from "${result.source}" (boost: ${scoreBoost})`);
        return curatedResult;
    });

    // Enhanced sorting: prioritize high-res boost and pixel count
    withHiResBoost.sort((a, b) => {
        const boostDiff = (b._hiresBoost || 0) - (a._hiresBoost || 0);
        if (boostDiff !== 0) return boostDiff;
        const pa = (Number(a.width || 0) * Number(a.height || 0)) || 0;
        const pb = (Number(b.width || 0) * Number(b.height || 0)) || 0;
        return pb - pa;
    });

    return withHiResBoost.slice(0, maxResults);
}

// Function to reset the duplicate cache for new searches
export function resetDuplicateCache() {
    seenResults.clear();
    console.log('[BTrust] Duplicate cache reset for new search');
}
