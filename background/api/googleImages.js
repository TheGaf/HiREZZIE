// background/api/googleImages.js
import { cleanHtml, getDomain, canonicalizeUrl } from '../utils/BUtils.js';

/**
 * Fetch images from Google Programmable Search (Custom Search API).
 * Uses image search with large sizes and returns normalized results.
 */
export async function searchGoogleImages(query, apiKey, cx, offset = 0, options = {}) {
  if (!apiKey || !cx) {
    console.warn('[Google Images API] API key or CX is missing.');
    return [];
  }

  const quote = (s) => `"${s}"`;
  const blacklist = options.blacklist || [];
  
  // Detect collaboration intent for multi-term queries
  const queryTokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  const hasCoOccurrenceIntent = queryTokens.length >= 2;
  
  // Build collaboration-focused query variants
  let searchQueries = [];
  
  if (hasCoOccurrenceIntent) {
    // Collaboration-focused queries
    const entities = query.split(/\s+(?:and|&|x|with|vs|feat\.?|featuring|,|\+)+\s+/i)
      .map(s => s.trim()).filter(Boolean);
    
    if (entities.length >= 2) {
      // Exact collaboration queries
      searchQueries = [
        `"${entities[0]}" "${entities[1]}"`, // Both names quoted
        `"${entities[0]}" AND "${entities[1]}"`, // AND operator
        `${entities[0]} and ${entities[1]}`, // Natural language
        `${entities[0]} with ${entities[1]}`, // With connector
        `${entities[0]} x ${entities[1]}`, // X connector  
        query // Original query as fallback
      ];
    } else {
      // Multi-token queries without clear entities
      searchQueries = [
        queryTokens.map(quote).join(' '), // All tokens quoted
        `"${queryTokens.join(' ')}"`, // Full phrase quoted
        queryTokens.join(' AND '), // AND between all tokens
        query // Original query
      ];
    }
  } else {
    // Single term or simple query
    searchQueries = [quote(query)];
  }
  
  const allResults = [];
  
  // Try each collaboration query variant
  for (const searchQuery of searchQueries.slice(0, 3)) { // Limit to 3 variants to avoid rate limits
    const q = searchQuery + (blacklist.length ? ' ' + blacklist.map(d => `-site:${d}`).join(' ') : '');
    const start = Math.max(1, (offset % 90) + 1); // API allows start up to 91 for num=10
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}`
      + `&q=${encodeURIComponent(q)}`
      + `&searchType=image&num=10&start=${start}`
      + `&imgSize=xxlarge&imgType=photo&safe=off`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[Google Images API] Request failed for query "${searchQuery}": ${response.status}`);
        continue;
      }

      const data = await response.json();
      const items = (data.items || [])
        .filter(item => item.link && item.link.startsWith('http'))
        .map(item => ({
          title: cleanHtml(item.title),
          url: canonicalizeUrl(item.link),
          snippet: cleanHtml(item.snippet || ''),
          source: getDomain(item.link),
          thumbnail: item.image?.thumbnailLink || item.link,
          imageUrl: canonicalizeUrl(item.link),
          width: Number(item.image?.width || 0) || null,
          height: Number(item.image?.height || 0) || null,
          byteSize: Number(item.image?.byteSize || 0) || null,
          mime: item.mime || null,
          contextLink: item.image?.contextLink || item.link,
          publishedAt: new Date().toISOString(),
          _searchVariant: searchQuery // Track which query variant found this result
        }));

      allResults.push(...items);
      
      // Rate limiting between requests
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn(`[Google Images API] Search failed for query "${searchQuery}":`, error.message);
    }
  }

  // Dedupe and filter results
  let items = allResults;

  // Pre-filter by Google-reported dimensions/bytes when present  
  items = items.filter(it => {
    const bigEnough = (it.width && it.width >= 2000) || (it.height && it.height >= 2000);
    const fatEnough = it.byteSize && it.byteSize >= 1_500_000;
    return bigEnough || fatEnough;
  });

  // Dedupe by host+path+size (keep first; later we keep largest after merging sources)
  const seen = new Set();
  items = items.filter(it => {
    try {
      const u = new URL(it.imageUrl);
      const key = `${u.hostname}${u.pathname}|${it.width || 0}x${it.height || 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch { return true; }
  });

  // Sort collaboration results first, then by area and byte size
  items.sort((a, b) => {
    // Prioritize results from collaboration queries
    const aIsCollab = hasCoOccurrenceIntent && a._searchVariant && a._searchVariant !== query;
    const bIsCollab = hasCoOccurrenceIntent && b._searchVariant && b._searchVariant !== query;
    
    if (aIsCollab && !bIsCollab) return -1;
    if (!aIsCollab && bIsCollab) return 1;
    
    // Then sort by size
    const aa = (a.width || 0) * (a.height || 0);
    const bb = (b.width || 0) * (b.height || 0);
    if (bb !== aa) return bb - aa;
    return (b.byteSize || 0) - (a.byteSize || 0);
  });

  console.log(`[Google Images API] Found ${items.length} results using ${searchQueries.length} query variants for "${query}"`);
  return items;
}
