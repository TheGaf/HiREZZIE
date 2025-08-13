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

  // Use exact query with quotes for phrase matching
  const quotedQuery = `"${query.trim()}"`;
  
  const start = offset + 1; // SerpApi uses 1-based indexing
  
  // Simple URL construction - focus on large, high-resolution images
  const makeUrl = (q, tbs) => `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(q)}&api_key=${apiKey}&tbs=${tbs}&ijn=${Math.floor(offset/100)}&start=${start}&num=100`;

  try {
    const results = [];
    
    // Focus on large, high-resolution images sorted by relevance
    const tbsOptions = [
      'isz:l',            // Large images
      'isz:lt,islt:4mp',  // 4MP+ images
      'isz:lt,islt:2mp'   // 2MP+ images
    ];
    
    for (const tbs of tbsOptions) {
      const response = await fetch(makeUrl(quotedQuery, tbs));
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
      
      if (results.length >= 100) break; // Limit to 100 results
    }

    // Simple de-dup by URL
    const seen = new Set();
    const combined = results.filter(r => {
      const k = r.imageUrl.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return combined;
  } catch (error) {
    console.error('[SerpApi] Search failed:', error.message);
    return [];
  }
}
