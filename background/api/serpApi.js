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

  // Send query as-is, no modification or cleaning
  const rawQuery = String(query || '').trim();
  
  // If query is empty, return empty results
  if (!rawQuery) {
    console.warn('[SerpApi] Query is empty');
    return [];
  }

  const start = offset + 1; // SerpApi uses 1-based indexing
  // Focus on high-resolution images only
  const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(rawQuery)}&api_key=${apiKey}&tbs=isz:l&ijn=${Math.floor(offset/100)}&start=${start}&num=100`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[SerpApi] Request failed: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const results = (data.images_results || [])
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
      }))
      .filter(image => {
        // Filter for high-res images: ≥1000px width or height
        const w = Number(image.width || 0);
        const h = Number(image.height || 0);
        return w >= 1000 || h >= 1000;
      });

    // Simple de-dup by URL and sort by size
    const seen = new Set();
    const uniqueResults = results.filter(r => {
      const k = r.imageUrl.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Sort by pixel count (largest first)
    uniqueResults.sort((a, b) => {
      const aPixels = (Number(a.width || 0) * Number(a.height || 0)) || 0;
      const bPixels = (Number(b.width || 0) * Number(b.height || 0)) || 0;
      return bPixels - aPixels;
    });

    return uniqueResults;
  } catch (error) {
    console.error('[SerpApi] Search failed:', error.message);
    return [];
  }
}
