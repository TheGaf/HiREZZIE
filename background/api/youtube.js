// background/api/youtube.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

/**
 * Fetches videos from the YouTube Data API.
 * @param {string} query The search query.
 * @param {string} apiKey The YouTube Data API key.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted video results.
 */
export async function searchYouTube(query, apiKey, offset = 0) {
  if (!apiKey) {
    console.warn('[YouTube API] API key is missing.');
    return [];
  }

  // Clean up the query for better API compatibility
  const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim();
  
  // If query is too short or empty, return empty results
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[YouTube API] Query too short or empty');
    return [];
  }
  
  // Use offset for pagination - YouTube uses maxResults and we'll adjust based on offset
  const maxResults = Math.min(20, 50 - offset); // Increase results
  // Prioritize recent videos - last 7 days
  const publishedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(cleanQuery)}&type=video&maxResults=${maxResults}&key=${apiKey}&order=date&publishedAfter=${publishedAfter}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[YouTube API] Request failed: ${response.status} for query: "${cleanQuery}"`);
      return [];
    }

    const data = await response.json();
    
    if (!data.items || !Array.isArray(data.items)) {
      console.warn('[YouTube API] No valid results returned');
      return [];
    }
    
    return data.items.map(item => ({
      title: cleanHtml(item.snippet.title || ''),
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      snippet: cleanHtml(item.snippet.description || ''),
      source: 'YouTube',
      publishedAt: item.snippet.publishedAt || new Date().toISOString(),
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || '',
      author: cleanHtml(item.snippet.channelTitle || ''),
    }));
  } catch (error) {
    console.error('[YouTube API] Search failed:', error.message);
    return [];
  }
}
