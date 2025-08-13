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

  // Use exact query with quotes for phrase matching 
  const quotedQuery = `"${query.trim()}"`;
  
  const start = Math.max(1, (offset % 90) + 1); // API allows start up to 91 for num=10
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}`
    + `&q=${encodeURIComponent(quotedQuery)}`
    + `&searchType=image&num=10&start=${start}`
    + `&imgSize=xxlarge&imgType=photo&safe=off`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      try {
        const err = await response.json();
        console.warn('[Google Images API] Request failed:', response.status, err?.error?.message || err);
      } catch {
        console.warn(`[Google Images API] Request failed: ${response.status}`);
      }
      return [];
    }

    const data = await response.json();
    let items = (data.items || [])
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
        publishedAt: new Date().toISOString()
      }));

    // Basic size filter: Keep images ≥400px on any side OR ≥50KB filesize
    items = items.filter(it => {
      const bigEnough = (it.width && it.width >= 400) || (it.height && it.height >= 400);
      const fatEnough = it.byteSize && it.byteSize >= 50_000;
      return bigEnough || fatEnough || (!it.width && !it.height && !it.byteSize); // Accept if no size info
    });

    // Simple dedup by URL
    const seen = new Set();
    items = items.filter(it => {
      const key = it.imageUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by pixel count (larger images first)
    items.sort((a, b) => {
      const aa = (a.width || 0) * (a.height || 0);
      const bb = (b.width || 0) * (b.height || 0);
      return bb - aa;
    });

    return items;
  } catch (error) {
    console.error('[Google Images API] Search failed:', error.message);
    return [];
  }
}
