// Simple background service worker for hiREZZIE

// API Configuration - replace with your actual key values
const API_CONFIG = {
  google: {
    apiKey: 'YOUR_GOOGLEIMAGES_KEY_VALUE_HERE',  // Your GOOGLEIMAGES_KEY value
    searchEngineId: 'YOUR_GOOGLE_SEARCH_KEY_VALUE_HERE'  // Your GOOGLE_SEARCH_KEY value
  },
  brave: {
    apiKey: 'YOUR_BRAVE_KEY_VALUE_HERE'  // Your BRAVE_KEY value
  },
  serpapi: {
    apiKey: 'YOUR_SERPAPI_KEY_VALUE_HERE'  // Your SERPAPI_KEY value
  },
  newsapi: {
    apiKey: 'YOUR_GNEWS_KEY_VALUE_HERE'  // Your GNEWS_KEY value
  }
};

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
    console.log(`Searching for: ${query}`);
    
    // Try multiple sources in parallel - real web sources only
    const searches = [
      searchSerpApiImages(query),
      searchBraveImages(query),
      searchGoogleImages(query),
      searchYahooImages(query)
    ];
    
    const results = await Promise.allSettled(searches);
    
    // Combine results
    results.forEach((result, index) => {
      const sources = ['SerpApi', 'Brave', 'Google', 'Yahoo'];
      if (result.status === 'fulfilled' && result.value) {
        console.log(`${sources[index]} returned ${result.value.length} images`);
        images.push(...result.value);
      } else {
        console.log(`${sources[index]} failed:`, result.reason);
      }
    });
    
    console.log(`Total images before filtering: ${images.length}`);
    
    // Remove duplicates and filter for hi-res
    const uniqueImages = filterAndDedupeImages(images);
    
    console.log(`Images after filtering: ${uniqueImages.length}`);
    
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

async function searchYahooImages(query) {
  try {
    // Yahoo Images search via web scraping
    const url = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}&imgsz=large`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    
    // Basic regex to extract image data from Yahoo's JSON
    const imageRegex = /"url":"([^"]+)","ow":(\d+),"oh":(\d+).*?"ru":"([^"]+)"/g;
    const images = [];
    let match;
    
    while ((match = imageRegex.exec(html)) !== null && images.length < 20) {
      const imageUrl = match[1].replace(/\\u/g, '%u').replace(/\\/g, '');
      const width = parseInt(match[2]);
      const height = parseInt(match[3]);
      const sourceUrl = match[4].replace(/\\u/g, '%u').replace(/\\/g, '');
      
      // Filter for decent size
      if (width >= 800 || height >= 600) {
        images.push({
          url: decodeURIComponent(imageUrl),
          thumbnail: decodeURIComponent(imageUrl),
          title: 'Yahoo Image',
          source: 'Yahoo',
          sourceUrl: decodeURIComponent(sourceUrl),
          width: width,
          height: height
        });
      }
    }
    
    return images;
  } catch (error) {
    console.error('Yahoo search error:', error);
    return [];
  }
}

async function searchSerpApiImages(query) {
  try {
    const apiKey = API_CONFIG.serpapi.apiKey;
    
    if (!apiKey || apiKey.startsWith('YOUR_')) {
      console.log('SerpApi key not configured');
      return [];
    }
    
    const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&ijn=0&api_key=${apiKey}&tbs=isz:l`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.images_results) {
      return data.images_results.map(item => ({
        url: item.original,
        thumbnail: item.thumbnail,
        title: item.title || 'Image',
        source: 'Google (SerpApi)',
        sourceUrl: item.link,
        width: item.original_width,
        height: item.original_height
      }));
    }
    
    return [];
  } catch (error) {
    console.error('SerpApi search error:', error);
    return [];
  }
}

async function searchBraveImages(query) {
  try {
    const apiKey = API_CONFIG.brave.apiKey;
    
    if (!apiKey || apiKey.startsWith('YOUR_')) {
      console.log('Brave API key not configured');
      return [];
    }
    
    const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=20`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    });
    
    const data = await response.json();
    
    if (data.results) {
      return data.results.map(item => ({
        url: item.src,
        thumbnail: item.thumbnail?.src || item.src,
        title: item.title || 'Brave Image',
        source: 'Brave',
        sourceUrl: item.url,
        width: item.properties?.width,
        height: item.properties?.height
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Brave search error:', error);
    return [];
  }
}

async function searchGoogleImages(query) {
  try {
    const apiKey = API_CONFIG.google.apiKey;
    const searchEngineId = API_CONFIG.google.searchEngineId;
    
    if (!apiKey || apiKey.startsWith('YOUR_')) {
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

function filterAndDedupeImages(images) {
  const seen = new Set();
  const filtered = [];
  
  // Block stock photo sites and low-quality sources
  const blockedDomains = [
    'shutterstock.com', 'istockphoto.com', 'getty', 'alamy.com',
    'depositphotos.com', 'dreamstime.com', '123rf.com', 
    'pexels.com', 'pixabay.com', 'unsplash.com'
  ];
  
  for (const image of images) {
    // Skip if no URL
    if (!image.url) continue;
    
    // Block stock photo sites
    const isBlocked = blockedDomains.some(domain => 
      image.url.toLowerCase().includes(domain) || 
      (image.sourceUrl && image.sourceUrl.toLowerCase().includes(domain))
    );
    if (isBlocked) continue;
    
    // Simple deduplication by URL
    const urlKey = image.url.toLowerCase();
    if (seen.has(urlKey)) continue;
    seen.add(urlKey);
    
    // Basic hi-res filtering
    const width = parseInt(image.width) || 0;
    const height = parseInt(image.height) || 0;
    const megapixels = (width * height) / 1000000;
    
    // Accept if: no dimensions available (common) OR 0.3MP+
    if ((width === 0 || height === 0) || megapixels >= 0.3) {
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
  else if (megapixels >= 0.3) score += 5;
  
  // Bonus for high dimensions
  if (width >= 4000 || height >= 4000) score += 100;
  if (width >= 2000 || height >= 2000) score += 50;
  if (width >= 1500 || height >= 1500) score += 25;
  
  // Unknown dimensions get middle score
  if (width === 0 || height === 0) score += 30;
  
  return score;
}
