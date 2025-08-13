// background/api/news.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

async function fetchNews(url, sourceName, processor) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[${sourceName}] Request failed: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return processor(data);
  } catch (error) {
    console.error(`[${sourceName}] Search failed:`, error.message);
    return [];
  }
}

/**
 * Fetches news articles from NewsAPI.org.
 * @param {string} query The search query.
 * @param {string} apiKey The NewsAPI.org API key.
 * @param {object} searchConfig The search configuration.
 * @param {number} offset The offset for pagination (default: 0).
 * @returns {Promise<Array>} A promise that resolves to an array of formatted news articles.
 */
export async function searchNewsAPIOrg(query, apiKey, searchConfig, offset = 0, days = 1) {
  if (!apiKey) {
    console.warn('[NewsAPI.org] API key is missing.');
    return [];
  }

  // Clean up the query for better API compatibility
  const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim();
  
  const page = Math.floor(offset / 20) + 1; // NewsAPI.org uses page-based pagination
  let url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(cleanQuery)}&language=en&pageSize=20&page=${page}&apiKey=${apiKey}`;
  if (typeof days === 'number' && days > 0) {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    url += `&sortBy=publishedAt&from=${fromDate}`;
  } else {
    url += `&sortBy=relevancy`;
  }

  return fetchNews(url, 'NewsAPI.org', (data) => {
    return (data.articles || []).map(article => ({
      title: cleanHtml(article.title),
      url: article.url,
      snippet: cleanHtml(article.description),
      source: cleanHtml(article.source.name),
      publishedAt: article.publishedAt,
      thumbnail: article.urlToImage,
    }));
  });
}
