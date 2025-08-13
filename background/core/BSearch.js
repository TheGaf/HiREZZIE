// background/core/BSearch.js
import { filterAndScoreResults, resetDuplicateCache } from './BTrust.js';
import { fetchOpenGraphData, headCheck } from '../utils/BUtils.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchBraveImages } from '../api/brave.js';
import { searchBingImages } from '../api/bing.js';

// Rate limiting and retry logic
const API_CALL_DELAY = 100; // ms between API calls
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // Base delay for exponential backoff

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryAPICall(apiFunction, ...args) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                // Exponential backoff
                const delayMs = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
                console.log(`[BSearch] Retry attempt ${attempt} after ${delayMs}ms delay`);
                await delay(delayMs);
            }
            return await apiFunction(...args);
        } catch (error) {
            console.warn(`[BSearch] API call attempt ${attempt + 1} failed:`, error.message);
            if (attempt === MAX_RETRIES - 1) {
                console.error(`[BSearch] All ${MAX_RETRIES} attempts failed for API call`);
                return [];
            }
        }
    }
    return [];
}

async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    console.log(`[BSearch] Searching images for query: "${query}" with offset: ${offset}`);
    let promises = [];
    const sortMode = options.sortMode || 'recent';
    
    // Only handle images now - simplified architecture
    if (category !== 'images') {
        console.warn(`[BSearch] Category "${category}" not supported - images only`);
        return { items: [], totalValid: 0 };
    }
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
    
    // Enhanced image API calls with rate limiting
    const apiCalls = [];
    
    // Google Images API (if configured)
    if (searchConfig?.preferGoogleCSE && apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
        const opt = await new Promise(resolve => chrome.storage.sync.get(['blacklist','imgSize','minWidth','minHeight','minBytes','exactDefault'], resolve));
        const blacklist = opt.blacklist || [];
        const mergedOptions = { ...options, exactPhrases: (options.exactPhrases ?? opt.exactDefault ?? true), blacklist, imgSize: opt.imgSize };
        apiCalls.push(() => retryAPICall(searchGoogleImages, refinedQuery, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset, mergedOptions));
    }
    
    // Free image sources with staggered calls to avoid rate limits
    apiCalls.push(() => retryAPICall(searchBraveImages, refinedQuery, apiKeys.brave, offset));
    
    // Multiple Bing pages for better volume
    const bingOffsets = [0, 50, 100, 150, 200];
    for (const off of bingOffsets) {
        apiCalls.push(() => retryAPICall(searchBingImages, refinedQuery, off, { sortMode }));
    }
    
    // Paid SerpApi only when enabled
    if (apiKeys?.serpApi && searchConfig?.usePaidImageAPIs) {
        apiCalls.push(() => retryAPICall(searchSerpApiImages, refinedQuery, apiKeys.serpApi, offset, options));
    }
    
    // Execute API calls with delays to prevent rate limiting
    for (let i = 0; i < apiCalls.length; i++) {
        if (i > 0) await delay(API_CALL_DELAY);
        promises.push(apiCalls[i]());
    }

    console.log(`[BSearch] Made ${promises.length} API calls for images`);
    const results = await Promise.allSettled(promises);
    console.log(`[BSearch] API results for images:`, results);
    
    const validResults = results
        .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
        .flatMap(res => res.value);
    
    console.log(`[BSearch] Valid results for images: ${validResults.length} (offset: ${offset})`);
    
    // Enhanced quality filtering - prioritize images ≥2000px width/height
    const qualityFiltered = validResults.filter(result => {
        const width = Number(result.width || 0);
        const height = Number(result.height || 0);
        
        // High quality threshold: at least 2000px in one dimension or 4MP total
        const meetsQuality = width >= 2000 || height >= 2000 || (width * height) >= 4_000_000;
        
        if (!meetsQuality) {
            console.log(`[BSearch] Filtered low quality image: ${width}x${height} from ${result.source}`);
        }
        return meetsQuality;
    });
    
    console.log(`[BSearch] After quality filtering: ${qualityFiltered.length} images`);
    
    // Sort by pixel count to prioritize highest resolution
    qualityFiltered.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    
    return { items: qualityFiltered, totalValid: qualityFiltered.length };
}

export async function performSearch(query, categories, settings, offset = 0, options = {}) {
    // Reset duplicate cache for new searches
    if (offset === 0) {
        resetDuplicateCache();
    }
    
    const { apiKeys, searchConfig } = settings;
    const allResults = {};

    // Force categories to images only - streamlined architecture
    const imageCategories = ['images'];
    
    console.log(`[BSearch] Performing streamlined image-only search for: "${query}"`);

    const totalValidMeta = {};
    for (const category of imageCategories) {
        const categoryResultsObj = await searchCategory(category, query, apiKeys, searchConfig, offset, { ...options, pass: 'strict' });
        const categoryResults = categoryResultsObj.items || categoryResultsObj;
        totalValidMeta[category] = categoryResultsObj.totalValid || (categoryResults?.length || 0);
        
        // Add category and original query to each result for downstream scoring
        const resultsWithCategory = categoryResults.map(result => ({ ...result, category, _query: query }));
        // For images, compute phrase/term context and perform enhanced processing
        if (category === 'images') {
            const qNorm = query.toLowerCase();
            const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
            const knownPhrases = ['hot ones'];
            const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
            let residual = qNorm;
            phrases.forEach(p => { residual = residual.replace(p, ' '); });
            const terms = residual.split(/\s+/).filter(Boolean);
            options.__phrases = phrases;
            options.__terms = terms;
        }

        // For images, extract from article pages: get Open Graph/Twitter/candidate images
        if (category === 'images') {
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

            // Stronger de-duplication: collapse by normalized image filename key
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

            // CONTENT-FIRST relevance filtering (phrases then terms) now that OG fields are available
            const qNorm = query.toLowerCase();
            const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
            const knownPhrases = ['hot ones'];
            const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
            // parse entities around connectors: vs, x, and, &
            const entityParts = qNorm.split(/\s+(?:vs|x|and|&|with)\s+/g).map(s => s.trim()).filter(Boolean);
            const entities = entityParts.length > 1 ? entityParts : [];
            let residual = qNorm;
            phrases.forEach(p => { residual = residual.replace(p, ' '); });
            residual = residual.replace(/\b(vs|x|and|&|with)\b/g, ' ');
            const terms = residual.split(/\s+/).filter(Boolean);
            const requireAll = settings?.searchConfig?.requireAllTerms === true;
            const minMP = settings?.searchConfig?.minImageMegaPixels || 0;

            const contentMatches = (r, relaxedMin = null) => {
                const hay = `${r.ogTitle || ''} ${r.ogDescription || ''} ${r.ogAlt || ''} ${r.title || ''} ${r.pageUrl || r.url || ''}`.toLowerCase();
                // For multi-entity queries, require both entities or allow at least one strong match when relaxed
                if (!phrases.every(p => hay.includes(p))) return false; // always require phrases
                if (entities.length > 1) {
                    const entityMatches = entities.filter(e => hay.includes(e)).length;
                    if (relaxedMin !== null) {
                        if (entityMatches < 1) return false;
                    } else if (entityMatches < 2) {
                        return false;
                    }
                }
                if (terms.length === 0) return true;
                if (requireAll && relaxedMin === null) return terms.every(t => hay.includes(t));
                const minMatches = relaxedMin ?? 1;
                const matched = terms.filter(t => hay.includes(t)).length;
                return matched >= minMatches;
            };

            // Two-stage: soft filter first to avoid zeroes, then hard filter if still big pool
            let softKept = [];
            for (const r of resultsWithCategory) {
                if (contentMatches(r, entities.length > 1 ? 1 : 2)) softKept.push(r);
            }
            if (softKept.length === 0) softKept = resultsWithCategory; // fallback
            const strictlyKept = [];
            for (const r of softKept) {
                if (!contentMatches(r)) continue;
                const hasDims = Number(r.width) > 0 && Number(r.height) > 0;
                const mp = hasDims ? ((Number(r.width) * Number(r.height)) / 1_000_000) : 0;
                if (!hasDims || mp >= minMP) strictlyKept.push(r);
            }
            while (resultsWithCategory.length) resultsWithCategory.pop();
            resultsWithCategory.push(...(strictlyKept.length ? strictlyKept : softKept));

            // Enhanced HEAD verification with better size thresholds (≥150KB)
            const checks = await Promise.allSettled(resultsWithCategory.slice(0, 160).map(async r => {
                const url = r.imageUrl || r.url;
                // Trust common direct file URLs without HEAD to keep volume high
                const isDirectFile = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(url);
                let info = { ok: isDirectFile, contentLength: null };
                if (!isDirectFile) {
                    info = await headCheck(url);
                }
                // Enhanced threshold: 150KB minimum for quality
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
                    if (!info.ok) { resultsWithCategory.splice(i, 1); continue; }
                    if (info.contentLength && info.contentLength < 150_000) { resultsWithCategory.splice(i, 1); }
                }
            }
        }
        
        const maxItems = 100; // allow larger pool before curation
        allResults[category] = filterAndScoreResults(resultsWithCategory, maxItems);
        console.log(`[BSearch] Top ${maxItems} results for ${category}:`, allResults[category].length);
    }

    // If images volume is low, do a relaxed expansion pass to find "similar" results
    if (categories.length === 1 && categories[0] === 'images') {
        const current = allResults.images || [];
        const MIN_TARGET = 25;
        if (current.length < MIN_TARGET) {
            console.log('[BSearch] Images too few, running relaxed expansion pass');
            const relaxedRaw = await searchCategory('images', query, apiKeys, searchConfig, offset, { pass: 'relaxed', minTermMatches: 2 });
            const relaxedWithMeta = (relaxedRaw.items || relaxedRaw).map(r => ({ ...r, category: 'images', _query: query }));
            const merged = [...current];
            const seen = new Set(current.map(r => (r.imageUrl || r.url).toLowerCase()));
            for (const r of relaxedWithMeta) {
                const key = (r.imageUrl || r.url).toLowerCase();
                if (!seen.has(key)) { merged.push(r); seen.add(key); }
            }
            allResults.images = filterAndScoreResults(merged, 60);
        }

        // Final safety net: if still below target, pull from SerpApi (Google Images engine)
        const afterRelax = allResults.images || [];
        if (afterRelax.length < MIN_TARGET && apiKeys?.serpApi && searchConfig?.usePaidImageAPIs !== false) {
            try {
                console.log('[BSearch] Still low volume; fetching supplemental images from SerpApi');
                const serp = await searchSerpApiImages(query, apiKeys.serpApi, 0, { exactPhrases: options?.exactPhrases, autoRelax: true, sortMode: options?.sortMode });
                // pull additional pages if needed
                let serpMore = [];
                if (serp.length < 80) {
                    const p2 = await searchSerpApiImages(query, apiKeys.serpApi, 100, { exactPhrases: options?.exactPhrases, autoRelax: true, sortMode: options?.sortMode });
                    serpMore.push(...p2);
                }
                if (serp.length + serpMore.length < 120) {
                    const p3 = await searchSerpApiImages(query, apiKeys.serpApi, 200, { exactPhrases: options?.exactPhrases, autoRelax: true, sortMode: options?.sortMode });
                    serpMore.push(...p3);
                }
                const serpWithMeta = serp.map(r => ({ ...r, category: 'images', _query: query }));
                const serpMoreWithMeta = serpMore.map(r => ({ ...r, category: 'images', _query: query }));
                // Merge with existing and dedupe via curation layer
                const merged2 = [...afterRelax];
                const seen2 = new Set(afterRelax.map(r => (r.imageUrl || r.url).toLowerCase()));
                for (const r of serpWithMeta) {
                    const key = (r.imageUrl || r.url).toLowerCase();
                    if (!seen2.has(key)) { merged2.push(r); seen2.add(key); }
                }
                for (const r of serpMoreWithMeta) {
                    const key = (r.imageUrl || r.url).toLowerCase();
                    if (!seen2.has(key)) { merged2.push(r); seen2.add(key); }
                }
                allResults.images = filterAndScoreResults(merged2, 60);
            } catch (e) {
                console.warn('[BSearch] SerpApi supplement failed:', e?.message);
            }
        }
    }

    // Enhanced final validation for higher quality images
    if (allResults.images && allResults.images.length) {
        const allowedExt = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i;
        const validated = [];
        const candidates = allResults.images.slice(0, 60);
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

    allResults.__meta = { totalValid: totalValidMeta };
    return allResults;
}

// New function for loading more results
export async function loadMoreResults(query, category, settings, offset, options = {}) {
    console.log(`[BSearch] LoadMore: query="${query}", category="${category}", offset=${offset}`);
    
    // Only support images in streamlined architecture
    if (category !== 'images') {
        console.warn(`[BSearch] LoadMore: Category "${category}" not supported - images only`);
        return [];
    }
    
    const { apiKeys, searchConfig } = settings;
    const categoryResultsObj = await searchCategory(category, query, apiKeys, searchConfig, offset, options);
    const categoryResults = categoryResultsObj.items || categoryResultsObj;
    // Add category and original query to each result for downstream scoring
    const resultsWithCategory = categoryResults.map(result => ({ ...result, category, _query: query }));
    console.log(`[BSearch] LoadMore: got ${categoryResults.length} raw results for ${category}`);
    const filteredResults = filterAndScoreResults(resultsWithCategory, 30); // Load more: up to 30 results
    console.log(`[BSearch] LoadMore: filtered to ${filteredResults.length} results for ${category}`);
    return filteredResults;
}
