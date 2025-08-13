// background/api/bing.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

// Scrape Bing Images HTML (no API) and extract image/page URLs from the iusc "m" JSON
export async function searchBingImages(query, offset = 0, options = {}) {
  try {
    const cleanQuery = (query || '').replace(/[^\w\s"'&:,.-]/g, ' ').trim();
    if (!cleanQuery) return [];

    // Detect collaboration intent
    const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);
    const hasCoOccurrenceIntent = queryTokens.length >= 2;
    
    // Build collaboration-focused query variants for Bing
    let searchQueries = [];
    
    if (hasCoOccurrenceIntent) {
      const entities = cleanQuery.split(/\s+(?:and|&|x|with|vs|feat\.?|featuring|,|\+)+\s+/i)
        .map(s => s.trim()).filter(Boolean);
      
      if (entities.length >= 2) {
        // Collaboration-focused queries for Bing
        searchQueries = [
          `"${entities[0]}" "${entities[1]}"`, // Both names quoted
          `${entities[0]} and ${entities[1]}`, // Natural language
          `${entities[0]} with ${entities[1]}`, // With connector
          `${entities[0]} ${entities[1]} together`, // Together keyword
          cleanQuery // Original query as fallback
        ];
      } else {
        // Multi-token without clear entities
        searchQueries = [
          `"${cleanQuery}"`, // Full phrase quoted
          `${queryTokens[0]} ${queryTokens[1]}`, // First two tokens
          cleanQuery // Original
        ];
      }
    } else {
      searchQueries = [cleanQuery];
    }

    const sortMode = options.sortMode || 'recent';
    const base = 'https://www.bing.com/images/search';
    const first = Math.max(0, Number(offset) || 0);
    
    const allResults = [];
    
    // Try each collaboration query variant
    for (const searchQuery of searchQueries.slice(0, 3)) { // Limit to 3 variants
      const params = new URLSearchParams({ q: searchQuery });
      
      // Prefer large photo images
      const qftBits = ['+filterui:imagesize-large', '+filterui:photo-photo'];
      if (sortMode === 'recent') {
        // last 7 days for freshness
        qftBits.push('+filterui:age-lt7days');
      }
      params.set('qft', qftBits.join(''));
      params.set('first', String(first));
      
      const url = `${base}?${params.toString()}`;

      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) {
        console.warn(`[Bing] HTML fetch failed for query "${searchQuery}": ${res.status}`);
        continue;
      }
      const html = await res.text();

      const regex = /class="iusc"[^>]*\bm="([^"]+)"/ig;
      let m;
      while ((m = regex.exec(html)) !== null) {
        try {
          const raw = m[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&');
          const meta = JSON.parse(raw);
          const imageUrl = meta.murl || meta.imgurl || meta.thumb || '';
          const pageUrl = meta.purl || meta.surl || '';
          if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) continue;
          
          allResults.push({
            title: cleanHtml(meta.t || ''),
            url: imageUrl,
            imageUrl,
            pageUrl,
            source: getDomain(pageUrl || imageUrl),
            thumbnail: meta.turl || imageUrl,
            _searchVariant: searchQuery // Track which query found this result
          });
          
          if (allResults.length >= 200) break; // Collect more results from collaboration searches
        } catch (_) { /* ignore parse errors */ }
      }
      
      // Rate limiting between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Dedupe by URL
    const seen = new Set();
    const uniqueResults = allResults.filter(result => {
      const key = result.imageUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // Sort collaboration results first
    uniqueResults.sort((a, b) => {
      // Prioritize results from collaboration-specific queries
      const aIsCollab = hasCoOccurrenceIntent && a._searchVariant && a._searchVariant !== cleanQuery;
      const bIsCollab = hasCoOccurrenceIntent && b._searchVariant && b._searchVariant !== cleanQuery;
      
      if (aIsCollab && !bIsCollab) return -1;
      if (!aIsCollab && bIsCollab) return 1;
      
      return 0; // Keep original order for same type
    });
    
    console.log(`[Bing] Found ${uniqueResults.length} results using ${searchQueries.length} query variants for "${cleanQuery}"`);
    return uniqueResults.slice(0, 120); // Return top results
    
  } catch (e) {
    console.error('[Bing] Scrape failed:', e?.message);
    return [];
  }
}

