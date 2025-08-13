// background/api/serpApi.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

/**
 * Fetches images from SerpApi (using Google Images engine).
 * @param {string} query The search query.
 * @param {string} apiKey The SerpApi API key.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted image results.
 */
export async function searchSerpApiImages(query, apiKey, offset = 0, options = {}) {
  if (!apiKey) {
    console.warn('[SerpApi] API key is missing.');
    return [];
  }

  // Clean up the query for better API compatibility
  const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim();
  
  // If query is too short or empty, return empty results
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[SerpApi] Query too short or empty');
    return [];
  }

  const start = offset + 1; // SerpApi uses 1-based indexing
  // Prioritize recent images with better sorting and ensure HIRES
  // Request larger images and recent ones; use 100 results to have room to filter client-side
  const sortMode = options.sortMode || 'recent';
  const makeUrl = (q, tbs) => `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(q)}&api_key=${apiKey}&tbs=${tbs}&ijn=${Math.floor(offset/100)}&start=${start}&num=100`;

  // Detect co-occurrence intent: split on common connectors
  const entities = cleanQuery.split(/\s+(?:and|&|x|with|vs|feat\.?|featuring|,|\+)+\s+/i).map(s => s.trim()).filter(Boolean);
  const hasCoOccurrenceIntent = entities.length >= 2 && entities.every(e => e.split(/\s+/).length >= 1);

  // Build up to three query variants to bias Google Images toward co-occurrence
  const quote = (s) => `"${s}"`;
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const hasHotOnes = /\bhot\s+ones\b/i.test(cleanQuery);
  let variants = hasCoOccurrenceIntent ? [
    `"${entities[0]}" "${entities[1]}"`,
    `"${entities[0]}" AND "${entities[1]}"`,
    `${entities[0]} and ${entities[1]}`
  ] : [
    cleanQuery,
    tokens.map(quote).join(' '),
    tokens.length >= 2 ? `${quote(tokens[0])} ${quote(tokens[1])} ${tokens.slice(2).map(quote).join(' ')}`.trim() : tokens.map(quote).join(' '),
    hasHotOnes && tokens.length >= 2 ? `${quote(tokens[0])} ${quote(tokens[1])} ${quote('hot ones')}` : null,
    hasHotOnes ? `${quote('hot ones')} ${tokens.filter(t => t.toLowerCase() !== 'hot' && t.toLowerCase() !== 'ones').map(quote).join(' ')}`.trim() : null
  ].filter(Boolean);

  // Exact phrases option: bias heavily toward exact phrase results
  if (options.exactPhrases) {
    const fullPhrase = quote(cleanQuery);
    const allTokensQuoted = tokens.map(quote).join(' ');
    variants = [fullPhrase, allTokensQuoted];
  }

  try {
    const results = [];
    const tbsTiers = sortMode === 'relevant' ? [
      'isz:lt,islt:8mp',
      'isz:lt,islt:4mp',
      'isz:l',
      'isz:lt,islt:2mp'
    ] : [
      'isz:lt,islt:8mp,sort:date',
      'isz:lt,islt:4mp,sort:date',
      'isz:l,sort:date',
      'isz:lt,islt:2mp,sort:date'
    ];
    for (const tbs of tbsTiers) {
      for (const v of variants.slice(0, 6)) {
        const response = await fetch(makeUrl(v, tbs));
        if (!response.ok) {
          console.warn(`[SerpApi] Request failed: ${response.status}`);
          continue;
        }
        const data = await response.json();
        const mapped = (data.images_results || [])
          .filter(image => image.original && image.original.startsWith('http'))
          .map(image => ({
            title: cleanHtml(image.title),
            url: image.original,
            imageUrl: image.original,
            pageUrl: image.link,
            source: getDomain(image.link),
            sourceName: cleanHtml(image.source || getDomain(image.link)),
            thumbnail: image.thumbnail,
            width: image.original_width || image.width || null,
            height: image.original_height || image.height || null
          }));
        results.push(...mapped);
      }
      if (results.length >= 150) break;
    }

    // Simple de-dup by URL
    const seen = new Set();
    let combined = results.filter(r => {
      const k = r.imageUrl.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (hasCoOccurrenceIntent || tokens.length >= 2) {
      const required = hasCoOccurrenceIntent ? entities : tokens;
      const lcEntities = required.map(e => e.toLowerCase());
      if (hasHotOnes && !lcEntities.includes('hot ones')) lcEntities.push('hot ones');

      const autoRelax = options.autoRelax !== false;
      const minPool = 80; // aim for a larger pool so we can curate 50 reliably
      const filterByMatches = (arr, min) => arr.filter(r => {
        const hay = `${r.title || ''} ${r.pageUrl || ''} ${r.source || ''}`.toLowerCase();
        const matches = lcEntities.filter(e => hay.includes(e)).length;
        return matches >= min;
      });

      combined = filterByMatches(combined, lcEntities.length);
      if (autoRelax && combined.length < minPool && lcEntities.length > 2) {
        combined = filterByMatches(results, lcEntities.length - 1);
      }
      if (autoRelax && combined.length < minPool) {
        combined = filterByMatches(results, Math.min(2, lcEntities.length));
      }
      if (autoRelax && combined.length < 15) {
        combined = filterByMatches(results, 1);
      }
      // Final fill: if still short, append additional one-term matches (unique) up to a healthy buffer
      if (autoRelax && combined.length < 60) {
        const pool = filterByMatches(results, 1);
        const seenFill = new Set(combined.map(r => (r.imageUrl || r.url || '').toLowerCase()));
        for (const r of pool) {
          const k = (r.imageUrl || r.url || '').toLowerCase();
          if (!seenFill.has(k)) {
            combined.push(r);
            seenFill.add(k);
            if (combined.length >= 120) break;
          }
        }
      }
    }

    return combined;
  } catch (error) {
    console.error('[SerpApi] Search failed:', error.message);
    return [];
  }
}
