// No importScripts needed - we'll load config from storage

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

async function getApiConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiConfig'], (result) => {
      resolve(result.apiConfig || {
        google: { apiKey: '', searchEngineId: '' },
        brave: { apiKey: '' },
        serpapi: { apiKey: '' },
        newsapi: { apiKey: '' }
      });
    });
  });
}

async function searchImages(query) {
  const API_CONFIG = await getApiConfig();
  const images = [];
  
  try {
    console.log(`🔍 Searching for: ${query}`);
    
    // Try multiple sources in parallel
    const searches = [
      searchSerpApiImages(query, API_CONFIG),
      searchBraveImages(query, API_CONFIG), 
      searchGoogleImages(query, API_CONFIG),
      searchYahooImages(query),
      searchBingImages(query)
    ];
    
    const results = await Promise.allSettled(searches);
    
    // Combine results
    results.forEach((result, index) => {
      const sources = ['SerpApi', 'Brave', 'Google', 'Yahoo', 'Bing'];
      if (result.status === 'fulfilled' && result.value) {
        console.log(`✅ ${sources[index]} returned ${result.value.length} images`);
        images.push(...result.value);
      } else {
        console.log(`❌ ${sources[index]} failed:`, result.reason?.message || result.reason);
      }
    });
    
    console.log(`📊 Total images before filtering: ${images.length}`);
    
    // Remove duplicates and filter for hi-res
    const uniqueImages = filterAndDedupeImages(images, query);
    
    console.log(`✨ Images after filtering: ${uniqueImages.length}`);
    
    // Sort by estimated quality/resolution  
    uniqueImages.sort((a, b) => {
      const scoreA = getImageScore(a, query);
      const scoreB = getImageScore(b, query);
      return scoreB - scoreA;
    });
    
    return uniqueImages.slice(0, 50); // Return top 50
    
  } catch (error) {
    console.error('❌ Search failed:', error);
    return [];
  }
}

async function searchSerpApiImages(query, config) {
  try {
    const apiKey = config.serpapi?.apiKey;
    
    if (!apiKey) {
      console.log('🔶 SerpApi key not configured');
      return [];
    }
    
    console.log('🔶 Searching SerpApi...');
    
    const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&ijn=0&api_key=${apiKey}&tbs=isz:l,imgo:1`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`SerpApi error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`SerpApi: ${data.error}`);
    }
    
    if (data.images_results) {
      const images = data.images_results.slice(0, 20).map(item => ({
        url: item.original,
        thumbnail: item.thumbnail,
        title: item.title || `${query} - Google`,
        source: 'Google (SerpApi)',
        sourceUrl: item.link,
        width: item.original_width,
        height: item.original_height
      }));
      
      console.log(`🔶 SerpApi found ${images.length} images`);
      return images;
    }
    
    return [];
    
  } catch (error) {
    console.error('🔶 SerpApi search error:', error);
    return [];
  }
}

async function searchBraveImages(query, config) {
  try {
    const apiKey = config.brave?.apiKey;
    
    if (!apiKey) {
      console.log('🟠 Brave API key not configured');
      return [];
    }
    
    console.log('🟠 Searching Brave...');
    
    const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=20`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    });
    
    if (!response.ok) {
      throw new Error(`Brave API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.results) {
      const images = data.results.map(item => ({
        url: item.src,
        thumbnail: item.thumbnail?.src || item.src,
        title: item.title || `${query} - Brave`,
        source: 'Brave',
        sourceUrl: item.url,
        width: item.properties?.width,
        height: item.properties?.height
      }));
      
      console.log(`🟠 Brave found ${images.length} images`);
      return images;
    }
    
    return [];
    
  } catch (error) {
    console.error('🟠 Brave search error:', error);
    return [];
  }
}

async function searchGoogleImages(query, config) {
  try {
    const apiKey = config.google?.apiKey;
    const searchEngineId = config.google?.searchEngineId;
    
    if (!apiKey || !searchEngineId) {
      console.log('🔴 Google API key not configured');
      return [];
    }
    
    console.log('🔴 Searching Google...');
    
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&searchType=image&imgSize=xlarge&num=10`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Google: ${data.error.message}`);
    }
    
    if (data.items) {
      const images = data.items.map(item => ({
        url: item.link,
        thumbnail: item.image?.thumbnailLink || item.link,
        title: item.title || `${query} - Google`,
        source: 'Google',
        sourceUrl: item.image?.contextLink || item.link,
        width: item.image?.width,
        height: item.image?.height
      }));
      
      console.log(`🔴 Google found ${images.length} images`);
      return images;
    }
    
    return [];
    
  } catch (error) {
    console.error('🔴 Google search error:', error);
    return [];
  }
}

async function searchYahooImages(query) {
  try {
    console.log('🟡 Searching Yahoo Images...');
    
    const url = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}&imgsz=wallpaper`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Yahoo API error: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract image data from Yahoo's page
    const imageRegex = /"url":"([^"]+)","ow":(\d+),"oh":(\d+)[^}]*"ru":"([^"]+)"/g;
    const images = [];
    let match;
    
    while ((match = imageRegex.exec(html)) !== null && images.length < 15) {
      try {
        const imageUrl = decodeURIComponent(match[1].replace(/\\u[\dA-F]{4}/gi, '').replace(/\\/g, ''));
        const width = parseInt(match[2]);
        const height = parseInt(match[3]);
        const sourceUrl = decodeURIComponent(match[4].replace(/\\u[\dA-F]{4}/gi, '').replace(/\\/g, ''));
        
        // Filter for decent size - Yahoo has good large images
        if (width >= 1200 && height >= 800) {
          images.push({
            url: imageUrl,
            thumbnail: imageUrl,
            title: `Yahoo - ${query}`,
            source: 'Yahoo',
            sourceUrl: sourceUrl,
            width: width,
            height: height
          });
        }
      } catch (parseError) {
        console.log('Yahoo parse error:', parseError);
        continue;
      }
    }
    
    console.log(`🟡 Yahoo found ${images.length} images`);
    return images;
    
  } catch (error) {
    console.error('🟡 Yahoo search error:', error);
    return [];
  }
}

async function searchBingImages(query) {
  try {
    console.log('🔵 Searching Bing Images...');
    
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:imagesize-wallpaper&FORM=IRFLTR`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Bing API error: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract from Bing's JSON data
    const jsonMatch = html.match(/var _w=({.*?});/);
    if (!jsonMatch) return [];
    
    try {
      const data = JSON.parse(jsonMatch[1]);
      const images = [];
      
      if (data.IG && data.IG.IM) {
        data.IG.IM.forEach(item => {
          if (images.length >= 15) return;
          
          const width = parseInt(item.w) || 0;
          const height = parseInt(item.h) || 0;
          
          if (width >= 1200 || height >= 800) {
            images.push({
              url: item.mu || item.murl,
              thumbnail: item.turl || item.tu,
              title: item.t || `Bing - ${query}`,
              source: 'Bing',
              sourceUrl: item.ru || item.purl,
              width: width,
              height: height
            });
          }
        });
      }
      
      console.log(`🔵 Bing found ${images.length} images`);
      return images;
      
    } catch (parseError) {
      console.log('Bing parse error:', parseError);
      return [];
    }
    
  } catch (error) {
    console.error('🔵 Bing search error:', error);
    return [];
  }
}

function filterAndDedupeImages(images, query) {
  const seen = new Set();
  const filtered = [];
  
  // Block low-quality and stock photo domains
  const blockedDomains = [
    'shutterstock.com', 'istockphoto.com', 'gettyimages.com', 'alamy.com',
    'depositphotos.com', 'dreamstime.com', '123rf.com', 'fotolia.com',
    'bigstockphoto.com', 'canstockphoto.com', 'stockfresh.com',
    'facebook.com', 'instagram.com', 'twitter.com', 'pinterest.com',
    'reddit.com', 'youtube.com', 'tiktok.com', 'snapchat.com'
  ];
  
  // Extract query entities for relevance scoring
  const queryTerms = query.toLowerCase().split(/[\s\-_&]+/).filter(term => term.length > 2);
  
  for (const image of images) {
    // Skip if no URL
    if (!image.url) continue;
    
    // Block domains
    const hostname = getHostname(image.url) || '';
    const sourceHostname = getHostname(image.sourceUrl) || '';
    
    const isBlocked = blockedDomains.some(domain => 
      hostname.includes(domain) || sourceHostname.includes(domain)
    );
    if (isBlocked) continue;
    
    // Deduplicate by URL
    const urlKey = normalizeUrl(image.url);
    if (seen.has(urlKey)) continue;
    seen.add(urlKey);
    
    // Basic size filtering
    const width = parseInt(image.width) || 0;
    const height = parseInt(image.height) || 0;
    const megapixels = (width * height) / 1000000;
    
    // Accept if: no dimensions (common) OR meets size requirements
    const sizeOk = (width === 0 || height === 0) || 
                   (width >= 800 && height >= 600) || 
                   megapixels >= 0.5;
    
    if (sizeOk) {
      // Add relevance score
      image.relevanceScore = calculateRelevance(image, queryTerms);
      filtered.push(image);
    }
  }
  
  return filtered;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Remove tracking parameters
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];
    paramsToRemove.forEach(param => u.searchParams.delete(param));
    
    // Sort remaining params for consistency
    u.searchParams.sort();
    
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function calculateRelevance(image, queryTerms) {
  let score = 0;
  const text = `${image.title} ${image.source} ${getHostname(image.url)} ${getHostname(image.sourceUrl)}`.toLowerCase();
  
  queryTerms.forEach(term => {
    if (text.includes(term)) {
      score += 10;
    }
  });
  
  return score;
}

function getImageScore(image, query) {
  let score = 0;
  
  const width = parseInt(image.width) || 0;
  const height = parseInt(image.height) || 0;
  const megapixels = (width * height) / 1000000;
  
  // Score by resolution
  if (megapixels >= 50) score += 1000;      // 50MP+ (8K)
  else if (megapixels >= 24) score += 800;   // 24MP+ (6K)
  else if (megapixels >= 16) score += 600;   // 16MP+ (5K)
  else if (megapixels >= 12) score += 400;   // 12MP+ (4K)
  else if (megapixels >= 8) score += 300;    // 8MP+ (4K)
  else if (megapixels >= 4) score += 200;    // 4MP+ (QHD)
  else if (megapixels >= 2) score += 100;    // 2MP+ (FHD)
  else if (megapixels >= 1) score += 50;     // 1MP+ (HD)
  else if (megapixels >= 0.5) score += 25;   // 0.5MP+
  
  // Bonus for high dimensions
  if (width >= 7680 || height >= 4320) score += 200; // 8K
  else if (width >= 3840 || height >= 2160) score += 150; // 4K
  else if (width >= 2560 || height >= 1440) score += 100; // QHD
  else if (width >= 1920 || height >= 1080) score += 50;  // FHD
  
  // Unknown dimensions get middle score (many high-res images don't report size)
  if (width === 0 || height === 0) score += 75;
  
  // Add relevance score
  score += image.relevanceScore || 0;
  
  // Source priority
  if (image.source?.includes('SerpApi')) score += 20;
  else if (image.source?.includes('Google')) score += 15;
  else if (image.source?.includes('Bing')) score += 10;
  else if (image.source?.includes('Yahoo')) score += 8;
  else if (image.source?.includes('Brave')) score += 5;
  
  return score;
}
