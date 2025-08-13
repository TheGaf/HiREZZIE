// background/core/BSearch.js
import { filterAndScoreResults, resetDuplicateCache } from './BTrust.js';
import { fetchOpenGraphData, headCheck } from '../utils/BUtils.js';
import { searchGNews } from '../api/gnews.js';
import { searchNewsAPIOrg } from '../api/news.js';
import { searchSerpApiImages } from '../api/serpApi.js';
import { searchGoogleImages } from '../api/googleImages.js';
import { searchYouTube } from '../api/youtube.js';
import { searchVimeo } from '../api/vimeo.js';
import { searchDailymotion } from '../api/dailymotion.js';
import { searchBrave } from '../api/brave.js';
import { searchBraveImages } from '../api/brave.js';
import { searchBingImages } from '../api/bing.js';

// Enhanced collaboration detection function
function detectCollaborationIntent(query) {
    const normalized = query.toLowerCase().trim();
    
    // Split on collaboration keywords and common separators
    const collaborationPattern = /\s+(?:and|&|vs|x|with|feat\.?|featuring|,|\+|×)+\s+/i;
    const entities = normalized.split(collaborationPattern).map(s => s.trim()).filter(Boolean);
    
    // Also check for simple space-separated artist names (common pattern)
    const spaceEntities = normalized.split(/\s+/).filter(Boolean);
    const hasMultipleWords = spaceEntities.length >= 2;
    
    // Check if this looks like multiple people/artists
    const hasMultipleEntities = entities.length >= 2;
    const hasCollaborationKeywords = collaborationPattern.test(normalized);
    
    // Detect common artist name patterns (two capitalized words often = two artists)
    const capitalizedWords = query.split(/\s+/).filter(word => 
        word.length > 2 && word[0] === word[0].toUpperCase()
    );
    const likelyMultipleArtists = capitalizedWords.length >= 2 && hasMultipleWords;
    
    const isCollaboration = hasMultipleEntities || hasCollaborationKeywords || likelyMultipleArtists;
    
    // Use the most specific entity split available
    let finalEntities;
    if (hasMultipleEntities) {
        finalEntities = entities;
    } else if (likelyMultipleArtists && capitalizedWords.length === 2) {
        finalEntities = capitalizedWords;
    } else {
        finalEntities = [normalized];
    }
    
    console.log(`[BSearch] Collaboration detection:`, {
        query,
        isCollaboration,
        entities: finalEntities,
        hasMultipleEntities,
        hasCollaborationKeywords,
        likelyMultipleArtists
    });
    
    return {
        isCollaboration,
        entities: finalEntities,
        originalQuery: query,
        hasExplicitCollaborationWords: hasCollaborationKeywords
    };
}

// Enhanced search category function with collaboration support
async function searchCategory(category, query, apiKeys, searchConfig, offset = 0, options = {}) {
    console.log(`[BSearch] Searching category: ${category} for query: "${query}" with offset: ${offset}`);
    
    // Detect collaboration intent
    const collaboration = detectCollaborationIntent(query);
    
    let promises = [];
    const sortMode = options.sortMode || 'recent';
    
    switch (category) {
        case 'articles':
            // Wider window if relevant; otherwise recent only
            if (sortMode === 'relevant') {
                promises.push(searchGNews(query, apiKeys.gnews, offset, 30));
                promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 30));
            } else {
                promises.push(searchGNews(query, apiKeys.gnews, offset, 1));
                promises.push(searchNewsAPIOrg(query, apiKeys.newsapi_org, searchConfig, offset, 1));
            }
            promises.push(searchBrave(query, apiKeys.brave, offset));
            break;
            
        case 'images':
            // Build enhanced query variants for collaborations
            let searchQueries = [query]; // Original query as fallback
            
            if (collaboration.isCollaboration && collaboration.entities.length >= 2) {
                const [entity1, entity2] = collaboration.entities.slice(0, 2); // Take first two
                
                // Create multiple query variants optimized for finding collaborations
                searchQueries = [
                    `"${entity1}" "${entity2}"`, // Quoted for exact matching
                    `"${entity1} and ${entity2}"`, // Explicit collaboration
                    `"${entity1} with ${entity2}"`, // With variant
                    `${entity1} ${entity2} together`, // Together keyword
                    `${entity1} ${entity2} collaboration`, // Collaboration keyword
                    `${entity1} ${entity2} photo`, // Photo keyword
                    collaboration.hasExplicitCollaborationWords ? query : `${entity1} and ${entity2}`, // Enhanced original
                    query // Original as final fallback
                ];
                
                console.log(`[BSearch] Using collaboration-focused queries:`, searchQueries.slice(0, 4));
            }
            
            // Use the most specific query for API calls
            const refinedQuery = searchQueries[0];
            
            // Build a refined query for image engines to improve co-occurrence
            let apiQuery = refinedQuery;
            try {
                if (collaboration.isCollaboration && collaboration.entities.length >= 2) {
                    const [a, b] = collaboration.entities;
                    // Special handling for known ambiguous cases
                    if ((a.includes('jordan') && b.includes('pippen')) || (a.includes('pippen') && b.includes('jordan'))) {
                        apiQuery = '"Michael Jordan" "Scottie Pippen"';
                        if (/\bgame\b|\bbulls\b/i.test(query)) apiQuery += ' (game OR Bulls)';
                    } else {
                        // General collaboration query enhancement
                        apiQuery = `"${a}" "${b}"`;
                    }
                }
            } catch (e) {
                console.warn('[BSearch] Query enhancement failed, using original:', e);
            }
            
            // Free-only mode: build images from article sources by extracting OG images
            if (searchConfig?.usePaidImageAPIs === false) {
                const dayWindows = (sortMode === 'relevant') ? [null, 30, 90] : [1, 3, 7];
                for (const d of dayWindows) {
                    promises.push(searchGNews(apiQuery, apiKeys.gnews, offset, d));
                    promises.push(searchNewsAPIOrg(apiQuery, apiKeys.newsapi_org, searchConfig, offset, d));
                }
                promises.push(searchBrave(apiQuery, apiKeys.brave, offset));
                promises.push(searchBraveImages(apiQuery, apiKeys.brave, offset));
                
                const bingOffsets = [0, 50, 100, 150, 200];
                for (const off of bingOffsets) {
                    promises.push(searchBingImages(apiQuery, off, { sortMode }));
                }
                break;
            }
            
            // Enhanced API calls with collaboration context
            if (searchConfig?.preferGoogleCSE && apiKeys.googleImages?.apiKey && apiKeys.googleImages?.cx) {
                const opt = await new Promise(resolve => chrome.storage.sync.get(['blacklist','imgSize','minWidth','minHeight','minBytes','exactDefault'], resolve));
                const blacklist = opt.blacklist || [];
                const mergedOptions = { 
                    ...options, 
                    exactPhrases: collaboration.isCollaboration ? true : (options.exactPhrases ?? opt.exactDefault ?? true), 
                    blacklist, 
                    imgSize: opt.imgSize,
                    collaboration: collaboration // Pass collaboration context
                };
                promises.push(searchGoogleImages(apiQuery, apiKeys.googleImages.apiKey, apiKeys.googleImages.cx, offset, mergedOptions));
            }
            
            // Free fallback image sources with enhanced queries
            promises.push(searchBraveImages(apiQuery, apiKeys.brave, offset));
            const bingOffsets2 = [0, 50, 100, 150, 200];
            for (const off of bingOffsets2) {
                promises.push(searchBingImages(apiQuery, off, { sortMode }));
            }
            
            // Paid SerpApi with collaboration support
            if (apiKeys?.serpApi && searchConfig?.usePaidImageAPIs) {
                const serpOptions = { 
                    ...options, 
                    collaboration: collaboration,
                    queryVariants: searchQueries.slice(0, 5), // Top 5 variants for maximum coverage
                    exactPhrases: collaboration.isCollaboration ? true : options.exactPhrases
                };
                promises.push(searchSerpApiImages(apiQuery, apiKeys.serpApi, offset, serpOptions));
            }
            break;
            
        case 'videos':
            // Enhanced video search for collaborations
            let videoQuery = query;
            if (collaboration.isCollaboration && collaboration.entities.length >= 2) {
                const [entity1, entity2] = collaboration.entities;
                videoQuery = `"${entity1}" "${entity2}"`;
            }
            
            promises.push(searchYouTube(videoQuery, apiKeys.youtube, offset));
            break;
    }

    console.log(`[BSearch] Made ${promises.length} API calls for ${category}`);
    const results = await Promise.allSettled(promises);
    console.log(`[BSearch] API results for ${category}:`, results);
    
    const validResults = results
        .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
        .flatMap(res => res.value);
    
    console.log(`[BSearch] Valid results for ${category}: ${validResults.length} (offset: ${offset})`);
    
    // Add collaboration context to each result for downstream processing
    const resultsWithContext = validResults.map(result => ({ 
        ...result, 
        category, 
        _query: query,
        _collaboration: collaboration
    }));
    
    // Prefer images with inherent large dimensions if provided
    if (category === 'images') {
        resultsWithContext.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    }
    
    return { items: resultsWithContext, totalValid: validResults.length };
}

export async function performSearch(query, categories, settings, offset = 0, options = {}) {
    // Reset duplicate cache for new searches
    if (offset === 0) {
        resetDuplicateCache();
    }
    
    const { apiKeys, searchConfig } = settings;
    const allResults = {};

    const totalValidMeta = {};
    for (const category of categories) {
        const categoryResultsObj = await searchCategory(category, query, apiKeys, searchConfig, offset, { ...options, pass: 'strict' });
        const categoryResults = categoryResultsObj.items || categoryResultsObj;
        totalValidMeta[category] = categoryResultsObj.totalValid || (categoryResults?.length || 0);
        
        // For images, compute phrase/term context but defer strict filtering until after OG/ALT enrichment
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
            for (const result of categoryResults) {
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

            // Enhanced de-duplication with collaboration awareness
            const normalizeKey = (u) => {
                try {
                    const url = new URL(u);
                    let name = (url.pathname.split('/').pop() || '').toLowerCase();
                    name = name.replace(/\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$/, '');
                    name = name.replace(/[-_]?\d{2,4}x\d{2,4}$/, '');
                    return name;
                } catch { return (u || '').toLowerCase(); }
            };
            
            const bestByKey = new Map();
            for (const r of categoryResults) {
                const key = normalizeKey(r.imageUrl || r.url || '');
                const cur = bestByKey.get(key);
                const area = (Number(r.width || 0) * Number(r.height || 0)) || 0;
                const curArea = cur ? ((Number(cur.width || 0) * Number(cur.height || 0)) || 0) : 0;
                if (!cur || area > curArea) bestByKey.set(key, r);
            }
            
            // Replace array with best unique items
            while (categoryResults.length) categoryResults.pop();
            categoryResults.push(...bestByKey.values());

            // Drop any items without a direct image URL
            for (let i = categoryResults.length - 1; i >= 0; i--) {
                if (!categoryResults[i].imageUrl) categoryResults.splice(i, 1);
            }

            // ENHANCED collaboration-aware relevance filtering
            const collaboration = categoryResults[0]?._collaboration;
            if (collaboration && collaboration.isCollaboration && collaboration.entities.length >= 2) {
                console.log(`[BSearch] Applying collaboration filtering for:`, collaboration.entities);
                
                const entities = collaboration.entities.map(e => e.toLowerCase());
                const requireAll = settings?.searchConfig?.requireAllTerms === true;
                const minMP = settings?.searchConfig?.minImageMegaPixels || 0;

                const collaborationMatches = (r, relaxedMin = null) => {
                    const hay = `${r.ogTitle || ''} ${r.ogDescription || ''} ${r.ogAlt || ''} ${r.title || ''} ${r.pageUrl || r.url || ''}`.toLowerCase();
                    
                    // For collaborations, strongly prefer content that mentions ALL entities
                    const entityMatches = entities.filter(e => hay.includes(e)).length;
                    
                    if (relaxedMin !== null) {
                        // Relaxed mode: at least one entity match
                        return entityMatches >= Math.max(1, relaxedMin);
                    } else {
                        // Strict mode: prefer both entities, but allow single strong matches
                        if (entityMatches >= 2) return true; // Perfect match
                        if (entityMatches >= 1 && hay.includes('and')) return true; // Single entity + collaboration word
                        if (entityMatches >= 1 && hay.includes('with')) return true; // Single entity + with
                        return entityMatches >= 1; // Single entity as fallback
                    }
                };

                // Three-stage filtering: strict -> medium -> relaxed
                let strictlyKept = [];
                for (const r of categoryResults) {
                    if (!collaborationMatches(r)) continue;
                    const hasDims = Number(r.width) > 0 && Number(r.height) > 0;
                    const mp = hasDims ? ((Number(r.width) * Number(r.height)) / 1_000_000) : 0;
                    if (!hasDims || mp >= minMP) strictlyKept.push(r);
                }
                
                // If strict filtering yields too few results, try medium filtering
                if (strictlyKept.length < 15) {
                    console.log(`[BSearch] Strict collaboration filtering yielded ${strictlyKept.length}, trying medium`);
                    const mediumKept = [];
                    for (const r of categoryResults) {
                        if (collaborationMatches(r, 1)) mediumKept.push(r);
                    }
                    strictlyKept = mediumKept.length > strictlyKept.length ? mediumKept : strictlyKept;
                }
                
                // Final fallback: keep all if we have very few
                const finalResults = strictlyKept.length >= 10 ? strictlyKept : categoryResults;
                
                while (categoryResults.length) categoryResults.pop();
                categoryResults.push(...finalResults);
                
                console.log(`[BSearch] Collaboration filtering: ${finalResults.length} results after filtering`);
            } else {
                // Regular content filtering for non-collaboration queries
                const qNorm = query.toLowerCase();
                const quoted = Array.from(qNorm.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
                const knownPhrases = ['hot ones'];
                const phrases = [...new Set([...quoted, ...knownPhrases.filter(p => qNorm.includes(p))])];
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
                    if (!phrases.every(p => hay.includes(p))) return false;
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

                let softKept = [];
                for (const r of categoryResults) {
                    if (contentMatches(r, entities.length > 1 ? 1 : 2)) softKept.push(r);
                }
                if (softKept.length === 0) softKept = categoryResults;
                const strictlyKept = [];
                for (const r of softKept) {
                    if (!contentMatches(r)) continue;
                    const hasDims = Number(r.width) > 0 && Number(r.height) > 0;
                    const mp = hasDims ? ((Number(r.width) * Number(r.height)) / 1_000_000) : 0;
                    if (!hasDims || mp >= minMP) strictlyKept.push(r);
                }
                while (categoryResults.length) categoryResults.pop();
                categoryResults.push(...(strictlyKept.length ? strictlyKept : softKept));
            }

            // HEAD verification to enforce size/type and fix broken links
            const checks = await Promise.allSettled(categoryResults.slice(0, 160).map(async r => {
                const url = r.imageUrl || r.url;
                const isDirectFile = /\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(url);
                let info = { ok: isDirectFile, contentLength: null };
                if (!isDirectFile) {
                    info = await headCheck(url);
                }
                if (!info.ok || (info.contentLength && info.contentLength < 150_000)) {
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
                    if (!info.ok) { categoryResults.splice(i, 1); continue; }
                    if (info.contentLength && info.contentLength < 150_000) { categoryResults.splice(i, 1); }
                }
            }
        }
        
        // For articles without thumbnails, try to fetch Open Graph data
        if (category === 'articles') {
            for (const result of categoryResults) {
                if (!result.thumbnail) {
                    try {
                        const ogData = await fetchOpenGraphData(result.url);
                        if (ogData && ogData.image) {
                            result.thumbnail = ogData.image;
                            console.log(`[BSearch] Added OG image for: ${result.title}`);
                        }
                    } catch (error) {
                        console.warn(`[BSearch] Failed to fetch OG data for: ${result.url}`);
                    }
                }
            }
        }
        
        const maxItems = 100;
        allResults[category] = filterAndScoreResults(categoryResults, maxItems);
        console.log(`[BSearch] Top ${maxItems} results for ${category}:`, allResults[category].length);
    }

    // Enhanced volume expansion for collaboration searches
    if (categories.length === 1 && categories[0] === 'images') {
        const current = allResults.images || [];
        const MIN_TARGET = 25;
        const collaboration = current[0]?._collaboration;
        
        if (current.length < MIN_TARGET) {
            console.log('[BSearch] Images too few, running relaxed expansion pass');
            const relaxedOptions = { 
                pass: 'relaxed', 
                minTermMatches: collaboration?.isCollaboration ? 1 : 2,
                collaboration: collaboration
            };
            const relaxedRaw = await searchCategory('images', query, apiKeys, searchConfig, offset, relaxedOptions);
            const relaxedWithMeta = (relaxedRaw.items || relaxedRaw).map(r => ({ ...r, category: 'images', _query: query, _collaboration: collaboration }));
            const merged = [...current];
            const seen = new Set(current.map(r => (r.imageUrl || r.url).toLowerCase()));
            for (const r of relaxedWithMeta) {
                const key = (r.imageUrl || r.url).toLowerCase();
                if (!seen.has(key)) { merged.push(r); seen.add(key); }
            }
            allResults.images = filterAndScoreResults(merged, 60);
        }

        // Enhanced SerpApi supplement with collaboration context
        const afterRelax = allResults.images || [];
        if (afterRelax.length < MIN_TARGET && apiKeys?.serpApi && searchConfig?.usePaidImageAPIs !== false) {
            try {
                console.log('[BSearch] Still low volume; fetching supplemental images from SerpApi');
                const serpOptions = {
                    exactPhrases: collaboration?.isCollaboration ? true : options?.exactPhrases,
                    autoRelax: true,
                    sortMode: options?.sortMode,
                    collaboration: collaboration
                };
                const serp = await searchSerpApiImages(query, apiKeys.serpApi, 0, serpOptions);
                let serpMore = [];
                if (serp.length < 80) {
                    const p2 = await searchSerpApiImages(query, apiKeys.serpApi, 100, serpOptions);
                    serpMore.push(...p2);
                }
                if (serp.length + serpMore.length < 120) {
                    const p3 = await searchSerpApiImages(query, apiKeys.serpApi, 200, serpOptions);
                    serpMore.push(...p3);
                }
                const serpWithMeta = serp.map(r => ({ ...r, category: 'images', _query: query, _collaboration: collaboration }));
                const serpMoreWithMeta = serpMore.map(r => ({ ...r, category: 'images', _query: query, _collaboration: collaboration }));
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

    allResults.__meta = { totalValid: totalValidMeta };
    return allResults;
}

// New function for loading more results
export async function loadMoreResults(query, category, settings, offset, options = {}) {
    console.log(`[BSearch] LoadMore: query="${query}", category="${category}", offset=${offset}`);
    const { apiKeys, searchConfig } = settings;
    const categoryResultsObj = await searchCategory(category, query, apiKeys, searchConfig, offset, options);
    const categoryResults = categoryResultsObj.items || categoryResultsObj;
    console.log(`[BSearch] LoadMore: got ${categoryResults.length} raw results for ${category}`);
    const filteredResults = filterAndScoreResults(categoryResults, 30);
    console.log(`[BSearch] LoadMore: filtered to ${filteredResults.length} results for ${category}`);
    return filteredResults;
}
