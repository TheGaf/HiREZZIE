// background/api/brave.js  
import { cleanHtml, getDomain } from '../utils/BUtils.js';

export async function searchBraveImages(query, apiKey, offset = 0) {
  if (!apiKey) {
    console.warn('[Brave Search] API key is missing.');
    return [];
  }

  // Send query as-is, like Google Images Large
  const cleanQuery = query.trim();
  
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[Brave Search] Query too short or empty');
    return [];
  }

  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(cleanQuery)}&count=20&offset=${offset}&safesearch=moderate&size=large`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      }
    });

    if (!response.ok) {
      console.warn(`[Brave Search] Request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.results || [])
      .filter(image => image.properties?.url && image.properties.url.startsWith('http'))
      .map(image => ({
        title: cleanHtml(image.title || ''),
        url: image.properties.url,
        snippet: `Source: ${cleanHtml(image.source || '')}`,
        source: getDomain(image.properties.url),
        thumbnail: image.properties.url,
        imageUrl: image.properties.url,
      }));
  } catch (error) {
    console.error('[Brave Search] Search failed:', error.message);
    return [];
  }
}
