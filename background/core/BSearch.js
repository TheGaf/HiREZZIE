// background/core/BSearch.js
import { filterAndScoreResults, resetDuplicateCache } from './BTrust.js';
import { fetchOpenGraphData, headCheck } from '../utils/BUtils.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchBraveImages } from '../api/brave.js';
import { searchBingImages } from '../api/bing.js';

async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    console.log(`[BSearch] Searching images for query: "${query}" with offset: ${offset}`);
    
    // Only support images category now
    if (category !== 'images') {
        console.warn(`[BSearch] Unsupported category: ${category}. Only 'images' is supported.`);
        return { items: [], totalValid: 0 };
    }
    
    let promises = [];
    const sortMode = options.sortMode || 'recent';
    
    // Build a refined query for image engines to improve co-occurrence
    let refinedQuery = query;
    try {
        const parts = String(query).split(/\s+(?:and|&|vs|x|with|,|\+)+\s+/i).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
            // Special-case common ambiguous names
            const a = parts[0].toLowerCase();
            const b = parts[1].toLowerCase();
            if ((a.includes('jordan') && b.includes('pippen')) || (a.includes('pippen') && b.includes('jordan'))) {
                refinedQuery = '"Michael Jordan" "Scottie Pippen"';
                if (/\bgame\b|\bbulls\b/i.test(query)) refinedQuery += ' (game OR Bulls)';
            } else {
                refinedQuery = parts.map(p => `"${p}"`).join(' ');
            }
        }
    } catch {}
    
    // Primary image search APIs
    if (searchConfig?.preferGoogleCSE && apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
        // Load runtime options (blacklist, min sizes)
        const opt = await new Promise(resolve => chrome.storage.sync.get(['blacklist','imgSize','minWidth','minHeight','minBytes','exactDefault'], resolve));
        const blacklist = opt.blacklist || [];
        const mergedOptions = { ...options, exactPhrases: (options.exactPhrases ?? opt.exactDefault ?? true), blacklist, imgSize: opt.imgSize };
        promises.push(searchGoogleImages(refinedQuery, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset, mergedOptions));
    }
    
    // Free image sources with rate limiting
    promises.push(searchBraveImages(refinedQuery, apiKeys.brave, offset));
    
    // Multiple Bing pages for better volume
    const bingOffsets = [offset, offset + 50, offset + 100];
    for (const off of bingOffsets) {
        promises.push(searchBingImages(refinedQuery, off, { sortMode }));
    }
    
    // Paid SerpApi when enabled
    if (apiKeys?.serpApi && searchConfig?.usePaidImageAPIs) {
        promises.push(searchSerpApiImages(refinedQuery, apiKeys.serpApi, offset, options));
    }

    console.log(`[BSearch] Made ${promises.length} API calls for images`);
    const results = await Promise.allSettled(promises);
    console.log(`[BSearch] API results for images:`, results);
    
    const validResults = results
        .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
        .flatMap(res => res.value);
    
    console.log(`[BSearch] Valid results for images: ${validResults.length} (offset: ${offset})`);
    
    // Prefer images with larger dimensions
    validResults.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    
    return { items: validResults, totalValid: validResults.length };
}

export async function performSearch(query, categories, settings, offset = 0, options = {}) {
    // Reset duplicate cache for new searches
    if (offset === 0) {
        resetDuplicateCache();
    }
    
    // Force images only for streamlined architecture
    if (!categories.includes('images')) {
        categories = ['images'];
    }
    
    const { apiKeys, searchConfig } = settings;
    const allResults = {};

    // Process only images category
    const categoryResultsObj = await searchCategory('images', query, apiKeys, searchConfig, offset, { ...options, pass: 'strict' });
    const categoryResults = categoryResultsObj.items || categoryResultsObj;
    const totalValid = categoryResultsObj.totalValid || (categoryResults?.length || 0);
    
    // Add category and original query to each result for downstream scoring
    const resultsWithCategory = categoryResults.map(result => ({ ...result, category: 'images', _query: query }));
    
    // Parse query for phrase/term context
    const qNorm = query.toLowerCase();
    const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
    const knownPhrases = ['hot ones'];
    const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
    let residual = qNorm;
    phrases.forEach(p => { residual = residual.replace(p, ' '); });
    const terms = residual.split(/\s+/).filter(Boolean);
    options.__phrases = phrases;
    options.__terms = terms;

    // Extract from article pages: get Open Graph/Twitter/candidate images
    for (const result of resultsWithCategory) {
        try {
            const direct = result.imageUrl || result.url || '';
            if (/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(direct)) {
                result.imageUrl = direct;
                result.thumbnail = direct;
                continue;
            }
            const og = await fetchOpenGraphData(result.pageUrl || result.url);
            if (og && (og.image || (og.images && og.images.length))) {
                const imgs = (og.images && og.images.length) ? og.images : [{ url: og.image, alt: og.title || '' }];
                const q = (query || '').toLowerCase();
                const entityParts = q.split(/\s+(?:vs|x|and|&|with)\s+/g).map(s => s.trim()).filter(Boolean);
                function scoreCand(c) {
                    const alt = (c.alt || '').toLowerCase();
                    let s = 0;
                    if (alt.includes(q)) s += 3;
                    let fileName = '';
                    try { const u = new URL(c.url); fileName = (u.pathname.split('/').pop() || '').toLowerCase(); } catch {}
                    const entityAllInAlt = entityParts.length > 1 && entityParts.every(e => alt.includes(e));
                    const entityAllInName = entityParts.length > 1 && entityParts.every(e => fileName.includes(e.replace(/\s+/g,'-')) || fileName.includes(e.replace(/\s+/g,'_')) || fileName.includes(e));
                    if (entityAllInAlt || entityAllInName) s += 4;
                    if (c.url) s += 1;
                    return s;
                }
                let best = imgs.reduce((a, c) => (scoreCand(c) > scoreCand(a || {}) ? c : a), null);
                result.imageUrl = (best && best.url) || og.image;
                result.thumbnail = result.imageUrl;
                result.ogTitle = og.title;
                result.ogDescription = og.description;
                result.ogAlt = (best && best.alt) || og.alt;
            }
        } catch (e) { /* ignore */ }
    }

    // Improved de-duplication: collapse by normalized image filename key
    const normalizeKey = (u) => {
        try {
            const url = new URL(u);
            let name = (url.pathname.split('/').pop() || '').toLowerCase();
            // strip params-like suffixes and common size suffixes
            name = name.replace(/\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$/, '');
            name = name.replace(/[-_]?\d{2,4}x\d{2,4}$/, '');
            return name;
        } catch { return (u || '').toLowerCase(); }
    };
    const bestByKey = new Map();
    for (const r of resultsWithCategory) {
        const key = normalizeKey(r.imageUrl || r.url || '');
        const cur = bestByKey.get(key);
        const area = (Number(r.width || 0) * Number(r.height || 0)) || 0;
        const curArea = cur ? ((Number(cur.width || 0) * Number(cur.height || 0)) || 0) : 0;
        if (!cur || area > curArea) bestByKey.set(key, r);
    }
    // replace array with best unique items
    while (resultsWithCategory.length) resultsWithCategory.pop();
    resultsWithCategory.push(...bestByKey.values());

    // Drop any items without a direct image URL to avoid broken page links
    for (let i = resultsWithCategory.length - 1; i >= 0; i--) {
        if (!resultsWithCategory[i].imageUrl) resultsWithCategory.splice(i, 1);
    }

    // Enhanced quality filtering with higher resolution preference
    const enhancedResults = resultsWithCategory.filter(result => {
        const width = Number(result.width || 0);
        const height = Number(result.height || 0);
        
        // Prioritize high-resolution images (≥2000px on either dimension preferred)
        if (width >= 2000 || height >= 2000) return true;
        
        // Still allow smaller high-quality images (≥1200px)
        if (width >= 1200 || height >= 1200) return true;
        
        // Allow if we have good metadata but no dimensions
        if (!width && !height) return true;
        
        return false;
    });

    // Use enhanced results if we have enough, otherwise fall back to all results
    const finalResults = enhancedResults.length >= 10 ? enhancedResults : resultsWithCategory;

    // HEAD verification to enforce size/type and fix broken links
    const checks = await Promise.allSettled(finalResults.slice(0, 80).map(async r => {
        const url = r.imageUrl || r.url;
        // Trust common direct file URLs without HEAD to keep volume high
        const isDirectFile = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(url);
        let info = { ok: isDirectFile, contentLength: null };
        if (!isDirectFile) {
            info = await headCheck(url);
        }
        // Enhanced file size validation (≥150KB minimum)
        if (!info.ok || (info.contentLength && info.contentLength < 150_000)) {
            // Try fallbacks from page candidates (og.images)
            try {
                const og = await fetchOpenGraphData(r.pageUrl || r.url);
                const altImgs = (og && og.images) || [];
                for (const cand of altImgs) {
                    const test = await headCheck(cand.url);
                    if (test.ok && (!test.contentLength || test.contentLength >= 150_000)) {
                        r.imageUrl = cand.url; r.thumbnail = cand.url; info = test; break;
                    }
                }
            } catch {}
        }
        return info;
    }));
    
    for (let i = checks.length - 1; i >= 0; i--) {
        const res = checks[i];
        if (res.status === 'fulfilled') {
            const info = res.value;
            if (!info.ok) { finalResults.splice(i, 1); continue; }
            if (info.contentLength && info.contentLength < 150_000) { finalResults.splice(i, 1); }
        }
    }
    
    const maxItems = 60; // Increased for better selection
    allResults.images = filterAndScoreResults(finalResults, maxItems);
    console.log(`[BSearch] Top ${maxItems} results for images:`, allResults.images.length);

    // If volume is low, do a relaxed expansion pass
    const current = allResults.images || [];
    const MIN_TARGET = 25;
    if (current.length < MIN_TARGET) {
        console.log('[BSearch] Images too few, running relaxed expansion pass');
        const relaxedRaw = await searchCategory('images', query, apiKeys, searchConfig, offset, { pass: 'relaxed', minTermMatches: 1 });
        const relaxedWithMeta = (relaxedRaw.items || relaxedRaw).map(r => ({ ...r, category: 'images', _query: query }));
        const merged = [...current];
        const seen = new Set(current.map(r => (r.imageUrl || r.url).toLowerCase()));
        for (const r of relaxedWithMeta) {
            const key = (r.imageUrl || r.url).toLowerCase();
            if (!seen.has(key)) { merged.push(r); seen.add(key); }
        }
        allResults.images = filterAndScoreResults(merged, 60);
    }

    // Final validation across the curated image set
    if (allResults.images && allResults.images.length) {
        const allowedExt = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i;
        const validated = [];
        const candidates = allResults.images.slice(0, 50);
        const headResults = await Promise.allSettled(candidates.map(async r => {
            const url = r.imageUrl || r.url || '';
            if (!/^https?:\/\//i.test(url)) return { ok: false };
            if (!allowedExt.test(url)) {
                // Still allow if HEAD says it's an image
                const info = await headCheck(url);
                return { ok: info.ok && (!info.contentLength || info.contentLength >= 150_000), info, r };
            }
            const info = await headCheck(url);
            return { ok: info.ok && (!info.contentLength || info.contentLength >= 150_000), info, r };
        }));
        headResults.forEach(res => {
            if (res.status === 'fulfilled' && res.value.ok) validated.push(res.value.r);
        });
        if (validated.length) allResults.images = validated;
    }

    allResults.__meta = { totalValid: { images: totalValid } };
    return allResults;
}

// New function for loading more results
export async function loadMoreResults(query, category, settings, offset, options = {}) {
    console.log(`[BSearch] LoadMore: query="${query}", category="${category}", offset=${offset}`);
    
    // Force images only
    if (category !== 'images') {
        console.warn(`[BSearch] LoadMore: Unsupported category: ${category}. Only 'images' is supported.`);
        return [];
    }
    
    const { apiKeys, searchConfig } = settings;
    const categoryResultsObj = await searchCategory('images', query, apiKeys, searchConfig, offset, options);
    const categoryResults = categoryResultsObj.items || categoryResultsObj;
    
    // Add category and original query to each result for downstream scoring
    const resultsWithCategory = categoryResults.map(result => ({ ...result, category: 'images', _query: query }));
    console.log(`[BSearch] LoadMore: got ${categoryResults.length} raw results for images`);
    
    const filteredResults = filterAndScoreResults(resultsWithCategory, 30); // Load more: up to 30 results
    console.log(`[BSearch] LoadMore: filtered to ${filteredResults.length} results for images`);
    return filteredResults;
}
