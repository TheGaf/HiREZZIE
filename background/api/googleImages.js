// background/api/googleImages.js
import { cleanHtml, getDomain, canonicalizeUrl } from '../utils/BUtils.js';

export async function searchGoogleImages(query, apiKey, cx, offset = 0, options = {}) {
  if (!apiKey || !cx) {
    console.warn('[Google Images API] API key or CX is missing.');
    return [];
  }

  // Send query as-is, like Google Images Large
  const cleanQuery = query.trim();
  const start = Math.max(1, (offset % 90) + 1);
  
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}`
    + `&q=${encodeURIComponent(cleanQuery)}`
    + `&searchType=image&num=10&start=${start}`
    + `&imgSize=xxlarge&imgType=photo&safe=off`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Google Images API] Request failed: ${response.status}`);
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

    // Filter for large images only
    items = items.filter(it => {
      const bigEnough = (it.width && it.width >= 1500) || (it.height && it.height >= 1500);
      const fatEnough = it.byteSize && it.byteSize >= 1_000_000;
      return bigEnough || fatEnough;
    });

    // Simple dedup by URL
    const seen = new Set();
    items = items.filter(it => {
      const key = it.imageUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by size
    items.sort((a, b) => {
      const aa = (a.width || 0) * (a.height || 0);
      const bb = (b.width || 0) * (b.height || 0);
      if (bb !== aa) return bb - aa;
      return (b.byteSize || 0) - (a.byteSize || 0);
    });

    return items;
  } catch (error) {
    console.error('[Google Images API] Search failed:', error.message);
    return [];
  }
}
