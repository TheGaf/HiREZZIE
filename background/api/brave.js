// background/api/brave.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

/**
 * Fetches search results from Brave Search API.
 * @param {string} query The search query.
 * @param {string} apiKey The Brave Search API key.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted search results.
 */
export async function searchBrave(query, apiKey, offset = 0) {
  if (!apiKey) {
    console.warn('[Brave Search] API key is missing.');
    return [];
  }

  // More selective query cleaning - preserve quotes and operators for collaboration searches
  let cleanQuery = query.trim();
  
  // Only clean if query doesn't contain quotes (indicating intentional search operators)
  if (!/"[^"]*"/.test(cleanQuery)) {
    // Remove problematic characters but preserve basic search operators
    cleanQuery = cleanQuery.replace(/[^\w\s"&+()-]/g, ' ').trim();
  }
  
  // If query is too short or empty, return empty results
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[Brave Search] Query too short or empty');
    return [];
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(cleanQuery)}&count=10&offset=${offset}`;

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
    return (data.web?.results || []).map(result => ({
      title: cleanHtml(result.title),
      url: result.url,
      snippet: cleanHtml(result.description),
      source: getDomain(result.url),
      publishedAt: new Date().toISOString(), // Brave doesn't provide dates
      thumbnail: result.profile?.image || null,
    }));
  } catch (error) {
    console.error('[Brave Search] Search failed:', error.message);
    return [];
  }
}

/**
 * Fetches images from Brave Search API.
 * @param {string} query The search query.
 * @param {string} apiKey The Brave Search API key.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted image results.
 */
export async function searchBraveImages(query, apiKey, offset = 0) {
  if (!apiKey) {
    console.warn('[Brave Search] API key is missing.');
    return [];
  }

  // More selective query cleaning - preserve quotes and operators for collaboration searches
  let cleanQuery = query.trim();
  
  // Only clean if query doesn't contain quotes (indicating intentional search operators)
  if (!/"[^"]*"/.test(cleanQuery)) {
    // Remove problematic characters but preserve basic search operators
    cleanQuery = cleanQuery.replace(/[^\w\s"&+()-]/g, ' ').trim();
  }
  
  // If query is too short or empty, return empty results
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[Brave Search] Query too short or empty');
    return [];
  }

  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(cleanQuery)}&count=10&offset=${offset}&safesearch=moderate&size=large`;

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
        thumbnail: image.properties.url, // Use the same URL for thumbnail
        imageUrl: image.properties.url,
        width: image.properties.width || 0,
        height: image.properties.height || 0,
      }));
  } catch (error) {
    console.error('[Brave Search] Search failed:', error.message);
    return [];
  }
} 