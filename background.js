// Simple background service worker for hiREZZIE

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'searchImages') {
    searchImages(request.query)
      .then(images => {
        sendResponse({ success: true, images });
      })
      .catch(error => {
        console.error('Search error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep message channel open for async response
  }
});

async function searchImages(query) {
  const images = [];
  
  try {
    // Try multiple sources in parallel
    const searches = [
      searchGoogleImages(query),
      searchBingImages(query),
      searchUnsplash(query)
    ];
    
    const results = await Promise.allSettled(searches);
    
    // Combine results
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        images.push(...result.value);
      }
    });
    
    // Remove duplicates and filter for hi-res
    const uniqueImages = filterAndDedupeImages(images);
    
    // Sort by estimated quality/resolution
    uniqueImages.sort((a, b) => {
      const scoreA = getImageScore(a);
      const scoreB = getImageScore(b);
      return scoreB - scoreA;
    });
    
    return uniqueImages.slice(0, 50); // Return top 50
    
  } catch (error) {
    console.error('Search failed:', error);
    return [];
  }
}

async function searchGoogleImages(query) {
  try {
    // Using Google Custom Search API (free tier: 100 queries/day)
    // You'll need to get your own API key and search engine ID
    const apiKey = 'YOUR_GOOGLE_API_KEY'; // Replace with actual key
    const searchEngineId = 'YOUR_SEARCH_ENGINE_ID'; // Replace with actual ID
    
    if (!apiKey || apiKey === 'YOUR_GOOGLE_API_KEY') {
      console.log('Google API key not configured');
      return [];
    }
    
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&searchType=image&imgSize=large&num=10`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.items) {
      return data.items.map(item => ({
        url: item.link,
        thumbnail: item.image?.thumbnailLink || item.link,
        title: item.title,
        source: 'Google',
        sourceUrl: item.image?.contextLink || item.link,
        width: item.image?.width,
        height: item.image?.height
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Google search error:', error);
    return [];
  }
}

async function searchBingImages(query) {
  try {
    // Bing Image Search API
    const apiKey = 'YOUR_BING_API_KEY'; // Replace with actual key
    
    if (!apiKey || apiKey === 'YOUR_BING_API_KEY') {
      console.log('Bing API key not configured');
      return [];
    }
    
    const url = `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(query)}&count=20&size=Large&imageType=Photo`;
    
    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey
      }
    });
    
    const data = await response.json();
    
    if (data.value) {
      return data.value.map(item => ({
        url: item.contentUrl,
        thumbnail: item.thumbnailUrl,
        title: item.name,
        source: 'Bing',
        sourceUrl: item.hostPageUrl,
        width: item.width,
        height: item.height
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Bing search error:', error);
    return [];
  }
}

async function searchUnsplash(query) {
  try {
    // Unsplash API (free tier: 50 requests/hour)
    const accessKey = 'YOUR_UNSPLASH_ACCESS_KEY'; // Replace with actual key
    
    if (!accessKey || accessKey === 'YOUR_UNSPLASH_ACCESS_KEY') {
      console.log('Unsplash API key not configured');
      return [];
    }
    
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=20&order_by=relevant`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Client-ID ${accessKey}`
      }
    });
    
    const data = await response.json();
    
    if (data.results) {
      return data.results.map(item => ({
        url: item.urls.full,
        thumbnail: item.urls.small,
        title: item.alt_description || item.description || 'Unsplash image',
        source: 'Unsplash',
        sourceUrl: item.links.html,
        width: item.width,
        height: item.height
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Unsplash search error:', error);
    return [];
  }
}

function filterAndDedupeImages(images) {
  const seen = new Set();
  const filtered = [];
  
  for (const image of images) {
    // Skip if no URL
    if (!image.url) continue;
    
    // Simple deduplication by URL
    const urlKey = image.url.toLowerCase();
    if (seen.has(urlKey)) continue;
    seen.add(urlKey);
    
    // Basic hi-res filtering
    const width = parseInt(image.width) || 0;
    const height = parseInt(image.height) || 0;
    const megapixels = (width * height) / 1000000;
    
    // Accept if: no dimensions available (common) OR decent quality
    if ((width === 0 || height === 0) || megapixels >= 0.5) {
      filtered.push(image);
    }
  }
  
  return filtered;
}

function getImageScore(image) {
  let score = 0;
  
  const width = parseInt(image.width) || 0;
  const height = parseInt(image.height) || 0;
  const megapixels = (width * height) / 1000000;
  
  // Score by resolution
  if (megapixels >= 50) score += 1000;
  else if (megapixels >= 24) score += 500;
  else if (megapixels >= 16) score += 300;
  else if (megapixels >= 12) score += 200;
  else if (megapixels >= 8) score += 100;
  else if (megapixels >= 4) score += 50;
  else if (megapixels >= 2) score += 25;
  else if (megapixels >= 1) score += 10;
  else if (megapixels >= 0.5) score += 5;
  
  // Bonus for high dimensions
  if (width >= 4000 || height >= 4000) score += 100;
  if (width >= 2000 || height >= 2000) score += 50;
  
  // Unknown dimensions get middle score
  if (width === 0 || height === 0) score += 25;
  
  return score;
}
