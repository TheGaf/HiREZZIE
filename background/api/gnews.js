// background/api/gnews.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

/**
 * Fetches news articles from the GNews API.
 * @param {string} query The search query.
 * @param {string} apiKey The GNews API key.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted news articles.
 */
export async function searchGNews(query, apiKey, offset = 0, days = 1) {
  if (!apiKey) {
    console.warn('[GNews API] API key is missing.');
    return [];
  }

  // Clean up the query for better API compatibility
  const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim();
  
  // Build URL; when days is null/undefined, do NOT restrict by date and use relevance sort
  let url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(cleanQuery)}&lang=en&max=50&token=${apiKey}&offset=${offset}&in=title,description`;
  if (typeof days === 'number' && days > 0) {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    url += `&sortby=publishedAt&from=${fromDate}`;
  } else {
    url += `&sortby=relevance`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[GNews API] Request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.articles || []).map(article => ({
      title: cleanHtml(article.title),
      url: article.url,
      snippet: cleanHtml(article.description),
      source: cleanHtml(article.source.name),
      publishedAt: article.publishedAt,
      thumbnail: article.image,
    }));
  } catch (error) {
    console.error('[GNews API] Search failed:', error.message);
    return [];
  }
}
