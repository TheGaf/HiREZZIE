chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'searchImages') {
    searchImages(request.query, request.mode)
      .then(images => {
        sendResponse({ success: true, images });
      })
      .catch(error => {
        console.error('Search error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep message channel open
  }
});

async function getApiKeys() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKeys'], (result) => {
      resolve(result.apiKeys || {});
    });
  });
}

async function searchImages(query, mode) {
  console.log(`Searching for: ${query} (${mode} mode)`);
  
  const API_KEYS = await getApiKeys();
  const allImages = [];
  
  // Try multiple sources
  const searches = [
    searchBing(query, mode),
    searchYahoo(query, mode)
  ];
  
  // Only use paid APIs if keys are configured
  if (API_KEYS.google?.apiKey && API_KEYS.google?.cx) {
    searches.push(searchGoogle(query, mode, API_KEYS.google));
  }
  
  if (API_KEYS.serpapi) {
    searches.push(searchSerpApi(query, mode, API_KEYS.serpapi));
  }
  
  if (API_KEYS.brave) {
    searches.push(searchBrave(query, mode, API_KEYS.brave));
  }
  
  const results = await Promise.allSettled(searches);
  
  results.forEach((result, index) => {
    const sources = ['Bing', 'Yahoo', 'Google', 'SerpApi', 'Brave'];
    if (result.status === 'fulfilled' && result.value) {
      console.log(`${sources[index]} returned ${result.value.length} images`);
      allImages.push(...result.value);
    } else {
      console.log(`${sources[index]} failed:`, result.reason);
    }
  });
  
  // Remove duplicates and filter for quality
  const uniqueImages = filterImages(allImages);
  
  // Sort by quality/relevance
  uniqueImages.sort((a, b) => {
    const scoreA = getImageScore(a, query, mode);
    const scoreB = getImageScore(b, query, mode);
    return scoreB - scoreA;
  });
  
  return uniqueImages.slice(0, 50);
}

async function searchGoogle(query, mode, keys) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${keys.apiKey}&cx=${keys.cx}&q=${encodeURIComponent(query)}&searchType=image&imgSize=xlarge&num=10`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google API error: ${response.status}`);
    
    const data = await response.json();
    
    return (data.items || []).map(item => ({
      url: item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      title: item.title,
      source: 'Google',
      sourceUrl: item.image?.contextLink || item.link,
      width: item.image?.width,
      height: item.image?.height
    }));
  } catch (error) {
    console.error('Google search error:', error);
    return [];
  }
}

async function searchBing(query, mode) {
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:imagesize-wallpaper&FORM=IRFLTR`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) throw new Error(`Bing error: ${response.status}`);
    
    const html = await response.text();
    const images = [];
    
    // Extract image data from Bing's JSON
    const jsonMatch = html.match(/var _w=({.*?});/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        if (data.IG && data.IG.IM) {
          data.IG.IM.forEach(item => {
            if (images.length >= 15) return;
            
            images.push({
              url: item.mu || item.murl,
              thumbnail: item.turl || item.tu,
              title: item.t || query,
              source: 'Bing',
              sourceUrl: item.ru || item.purl,
              width: parseInt(item.w) || 0,
              height: parseInt(item.h) || 0
            });
          });
        }
      } catch (parseError) {
        console.log('Bing parse error:', parseError);
      }
    }
    
    return images;
  } catch (error) {
    console.error('Bing search error:', error);
    return [];
  }
}

async function searchYahoo(query, mode) {
  try {
    const url = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}&imgsz=wallpaper`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) throw new Error(`Yahoo error: ${response.status}`);
    
    const html = await response.text();
    const images = [];
    
    // Extract from Yahoo's JSON data
    const imageRegex = /"url":"([^"]+)","ow":(\d+),"oh":(\d+)[^}]*"ru":"([^"]+)"/g;
    let match;
    
    while ((match = imageRegex.exec(html)) !== null && images.length < 15) {
      try {
        const imageUrl = decodeURIComponent(match[1].replace(/\\/g, ''));
        const width = parseInt(match[2]);
        const height = parseInt(match[3]);
        const sourceUrl = decodeURIComponent(match[4].replace(/\\/g, ''));
        
        if (width >= 1200 && height >= 800) {
          images.push({
            url: imageUrl,
            thumbnail: imageUrl,
            title: `${query} - Yahoo`,
            source: 'Yahoo',
            sourceUrl: sourceUrl,
            width: width,
            height: height
          });
        }
      } catch (parseError) {
        continue;
      }
    }
    
    return images;
  } catch (error) {
    console.error('Yahoo search error:', error);
    return [];
  }
}

async function searchSerpApi(query, mode, apiKey) {
  try {
    const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&api_key=${apiKey}&tbs=isz:l&num=20`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`SerpApi error: ${response.status}`);
    
    const data = await response.json();
    
    return (data.images_results || []).map(item => ({
      url: item.original,
      thumbnail: item.thumbnail,
      title: item.title || query,
      source: 'Google (SerpApi)',
      sourceUrl: item.link,
      width: item.original_width,
      height: item.original_height
    }));
  } catch (error) {
    console.error('SerpApi search error:', error);
    return [];
  }
}

async function searchBrave(query, mode, apiKey) {
  try {
    const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=20`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      }
    });
    
    if (!response.ok) throw new Error(`Brave error: ${response.status}`);
    
    const data = await response.json();
    
    return (data.results || []).map(item => ({
      url: item.src,
      thumbnail: item.thumbnail?.src || item.src,
      title: item.title || query,
      source: 'Brave',
      sourceUrl: item.url,
      width: item.properties?.width,
      height: item.properties?.height
    }));
  } catch (error) {
    console.error('Brave search error:', error);
    return [];
  }
}

function filterImages(images) {
  const seen = new Set();
  const blocked = ['facebook.com', 'instagram.com', 'twitter.com', 'pinterest.com', 'shutterstock.com'];
  
  return images.filter(image => {
    if (!image.url) return false;
    
    // Check for blocked domains
    const isBlocked = blocked.some(domain => 
      image.url.toLowerCase().includes(domain) || 
      (image.sourceUrl && image.sourceUrl.toLowerCase().includes(domain))
    );
    if (isBlocked) return false;
    
    // Remove duplicates
    const urlKey = image.url.toLowerCase();
    if (seen.has(urlKey)) return false;
    seen.add(urlKey);
    
    // Basic size filter
    const width = parseInt(image.width) || 0;
    const height = parseInt(image.height) || 0;
    
    // Accept if no dimensions (common) or meets size requirements
    if (width === 0 || height === 0) return true;
    return width >= 800 && height >= 600;
  });
}

function getImageScore(image, query, mode) {
  let score = 0;
  
  const width = parseInt(image.width) || 0;
  const height = parseInt(image.height) || 0;
  const megapixels = (width * height) / 1000000;
  
  // Resolution scoring
  if (megapixels >= 50) score += 1000;
  else if (megapixels >= 24) score += 800;
  else if (megapixels >= 16) score += 600;
  else if (megapixels >= 8) score += 400;
  else if (megapixels >= 4) score += 200;
  else if (megapixels >= 2) score += 100;
  else if (megapixels >= 1) score += 50;
  
  // Dimension bonuses
  if (width >= 4000 || height >= 4000) score += 100;
  else if (width >= 2000 || height >= 2000) score += 50;
  
  // Unknown dimensions get middle score
  if (width === 0 || height === 0) score += 75;
  
  // Relevance scoring
  const queryLower = query.toLowerCase();
  const titleLower = (image.title || '').toLowerCase();
  if (titleLower.includes(queryLower)) score += 50;
  
  // Source priority
  if (image.source === 'Google (SerpApi)') score += 20;
  else if (image.source === 'Google') score += 15;
  else if (image.source === 'Bing') score += 10;
  
  return score;
}
