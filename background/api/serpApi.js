// background/api/serpApi.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

export async function searchSerpApiImages(query, apiKey, offset = 0, options = {}) {
  if (!apiKey) {
    console.warn('[SerpApi] API key is missing.');
    return [];
  }

  // Send query as-is, like Google Images Large
  const cleanQuery = query.trim();
  
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[SerpApi] Query too short or empty');
    return [];
  }

  const start = offset + 1;
  const sortMode = options.sortMode || 'recent';
  
  // Simple URL like Google Images Large
  const baseUrl = 'https://serpapi.com/search.json';
  const params = new URLSearchParams({
    engine: 'google_images',
    q: cleanQuery,
    api_key: apiKey,
    tbs: sortMode === 'recent' ? 'isz:l,sort:date' : 'isz:l', // Large images only
    ijn: Math.floor(offset/100),
    start: start,
    num: 100
  });

  try {
    const response = await fetch(`${baseUrl}?${params}`);
    if (!response.ok) {
      console.warn(`[SerpApi] Request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const images = (data.images_results || [])
      .filter(image => image.original && image.original.startsWith('http'))
      .map(image => ({
        title: cleanHtml(image.title || ''),
        url: image.original,
        imageUrl: image.original,
        pageUrl: image.link,
        source: getDomain(image.link || ''),
        sourceName: cleanHtml(image.source || getDomain(image.link || '')),
        thumbnail: image.thumbnail,
        width: image.original_width || image.width || null,
        height: image.original_height || image.height || null
      }));

    // Simple dedup by URL
    const seen = new Set();
    return images.filter(img => {
      const key = img.imageUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  } catch (error) {
    console.error('[SerpApi] Search failed:', error.message);
    return [];
  }
}
