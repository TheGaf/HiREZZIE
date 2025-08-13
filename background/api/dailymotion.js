// background/api/dailymotion.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

/**
 * Fetches videos from Dailymotion API.
 * @param {string} query The search query.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted video results.
 */
export async function searchDailymotion(query, offset = 0) {
  const limit = 5;
  
    // Clean up the query for better API compatibility - use simpler terms
  const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim().split(' ').slice(0, 2).join(' ');
  
  // If query is too short or empty, return empty results
  if (!cleanQuery || cleanQuery.length < 2) {
    console.warn('[Dailymotion] Query too short or empty');
    return [];
  }
  
  // Ensure offset is within reasonable bounds
  const safeOffset = Math.max(0, Math.min(offset, 100));
  
  // Get recent videos - last 30 days
  const createdAfter = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  
  const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(cleanQuery)}&limit=${limit}&offset=${safeOffset}&fields=title,url,description,created_time,thumbnail_large_url,owner.screenname&sort=relevance&created_after=${createdAfter}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Dailymotion] Request failed: ${response.status} for query: "${cleanQuery}" with offset: ${safeOffset}`);
      // Return empty array instead of throwing error
      return [];
    }

    const data = await response.json();
    
    if (!data.list || !Array.isArray(data.list)) {
      console.warn('[Dailymotion] No valid results returned');
      return [];
    }
    
    return data.list.map(video => ({
      title: cleanHtml(video.title || ''),
      url: video.url || '',
      snippet: cleanHtml(video.description || ''),
      source: 'Dailymotion',
      publishedAt: video.created_time ? new Date(video.created_time * 1000).toISOString() : new Date().toISOString(),
      thumbnail: video.thumbnail_large_url || '',
      author: cleanHtml(video['owner.screenname'] || ''),
    }));
  } catch (error) {
    console.error('[Dailymotion] Search failed:', error.message);
    return [];
  }
}
