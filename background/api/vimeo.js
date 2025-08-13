// background/api/vimeo.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

/**
 * Fetches videos from the Vimeo API.
 * @param {string} query The search query.
 * @param {string} apiKey The Vimeo API key (access token).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted video results.
 */
export async function searchVimeo(query, apiKey) {
  if (!apiKey) {
    console.warn('[Vimeo API] API key is missing.');
    return [];
  }

  const url = `https://api.vimeo.com/videos?query=${encodeURIComponent(query)}&per_page=5&sort=relevant`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      console.warn(`[Vimeo API] Request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.data || []).map(video => ({
      title: cleanHtml(video.name),
      url: video.link,
      snippet: cleanHtml(video.description),
      source: 'Vimeo',
      publishedAt: video.created_time,
      thumbnail: video.pictures.base_link,
      author: cleanHtml(video.user.name),
    }));
  } catch (error) {
    console.error('[Vimeo API] Search failed:', error.message);
    return [];
  }
}
