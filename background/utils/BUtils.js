// background/utils/BUtils.js
/**
 * BUtils provides common helper functions used across the background script modules.
 */

// Rate limiting and retry logic
class RateLimiter {
  constructor() {
    this.apiCalls = new Map(); // domain -> { count, resetTime }
    this.maxCallsPerMinute = 30; // Conservative limit per domain
    this.retryDelays = [1000, 2000, 4000, 8000]; // Exponential backoff
  }

  async throttle(url) {
    const domain = getDomain(url);
    const now = Date.now();
    const calls = this.apiCalls.get(domain) || { count: 0, resetTime: now + 60000 };
    
    // Reset counter if a minute has passed
    if (now > calls.resetTime) {
      calls.count = 0;
      calls.resetTime = now + 60000;
    }
    
    // If we're at the limit, wait until reset
    if (calls.count >= this.maxCallsPerMinute) {
      const waitTime = calls.resetTime - now;
      if (waitTime > 0) {
        console.log(`[BUtils] Rate limiting ${domain}, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        calls.count = 0;
        calls.resetTime = Date.now() + 60000;
      }
    }
    
    calls.count++;
    this.apiCalls.set(domain, calls);
  }
}

const rateLimiter = new RateLimiter();

// Enhanced fetch with retry logic and rate limiting
export async function fetchWithRetry(url, options = {}, retryCount = 0) {
  await rateLimiter.throttle(url);
  
  try {
    const response = await fetch(url, {
      ...options,
      timeout: 10000 // 10 second timeout
    });
    
    // Handle rate limiting (429) and server errors (5xx)
    if (response.status === 429 || response.status >= 500) {
      if (retryCount < rateLimiter.retryDelays.length) {
        const delay = rateLimiter.retryDelays[retryCount];
        console.log(`[BUtils] Retrying ${url} after ${delay}ms (status: ${response.status})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retryCount + 1);
      }
    }
    
    return response;
  } catch (error) {
    // Retry on network errors
    if (retryCount < rateLimiter.retryDelays.length) {
      const delay = rateLimiter.retryDelays[retryCount];
      console.log(`[BUtils] Retrying ${url} after ${delay}ms (error: ${error.message})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1);
    }
    throw error;
  }
}

export function getFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    // Use a reliable favicon service
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${domain}`;
  } catch {
    return 'icon48.png'; // Fallback to a default icon
  }
}

export function cleanHtml(text) {
  if (typeof text !== 'string') return '';
  // Service workers don't have access to the DOM, so use regex for basic cleaning.
  // 1. Strip out <script> and <style> tags and their content.
  let cleaned = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  // 2. Strip out all other HTML tags, leaving their content.
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // 3. Decode common HTML entities.
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return cleaned.trim();
}

export function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'invalid.url';
  }
}

// Remove trackers, fragments, normalize ordering of query keys
export function canonicalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    // Remove known trackers
    const params = url.searchParams;
    const tracked = [];
    params.forEach((_, k) => {
      if (/^(utm_|gclid|fbclid|mc_)/i.test(k)) tracked.push(k);
    });
    tracked.forEach(k => params.delete(k));
    // Sort query keys for stable representation
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    entries.forEach(([k, v]) => url.searchParams.append(k, v));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export async function headCheck(url) {
  try {
    const res = await fetchWithRetry(url, { method: 'HEAD' });
    const contentType = res.headers.get('content-type') || '';
    const lenStr = res.headers.get('content-length');
    const contentLength = lenStr ? Number(lenStr) : null;
    // Only allow real bitmap-like image types. Exclude svg/gif to avoid placeholders/animations.
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'
    ];
    const isAllowed = allowedTypes.some(t => contentType.toLowerCase().includes(t));
    const ok = res.ok && isAllowed;
    return { ok, contentType, contentLength };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

export async function fetchOpenGraphData(pageUrl) {
  try {
    const response = await fetchWithRetry(pageUrl);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const html = await response.text();

    // Helpers to extract one or multiple meta values
    const getMetaFirst = (prop) => {
      const re = new RegExp(`<meta[^>]+(?:name|property)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
      const m = html.match(re);
      return m ? m[1] : null;
    };
    const getMetaAll = (prop) => {
      const re = new RegExp(`<meta[^>]+(?:name|property)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'ig');
      const out = []; let m;
      while ((m = re.exec(html)) !== null) out.push(m[1]);
      return out;
    };

    const resolveUrl = (maybe, base) => {
      try { return new URL(maybe, base).toString(); } catch { return maybe; }
    };

    const title = getMetaFirst('og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || '';
    const description = getMetaFirst('og:description') || getMetaFirst('description') || '';
    const siteName = getMetaFirst('og:site_name') || getDomain(pageUrl);
    const canonical = getMetaFirst('og:url') || pageUrl;

    // Gather all candidate images from common tags
    const imageProps = [
      'og:image:secure_url','og:image:url','og:image','twitter:image:src','twitter:image'
    ];
    let candidates = [];
    for (const p of imageProps) {
      const vals = getMetaAll(p);
      candidates.push(...vals);
    }
    // Fallback: link rel="image_src"
    const linkMatch = html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
    if (linkMatch) candidates.push(linkMatch[1]);

    candidates = candidates
      .map(src => resolveUrl(src, canonical))
      .filter(Boolean);

    // Choose by declared width/height when present
    const widthVals = getMetaAll('og:image:width').map(Number);
    const heightVals = getMetaAll('og:image:height').map(Number);
    let chosen = candidates[0] || null;
    if (candidates.length > 1 && widthVals.length && heightVals.length) {
      let bestIdx = 0; let bestArea = 0;
      for (let i = 0; i < Math.min(widthVals.length, heightVals.length); i++) {
        const area = (Number(widthVals[i]) || 0) * (Number(heightVals[i]) || 0);
        if (area > bestArea && candidates[i]) { bestArea = area; bestIdx = i; }
      }
      if (candidates[bestIdx]) chosen = candidates[bestIdx];
    } else if (candidates.length > 0) {
      chosen = candidates[0];
    }

    // Try to resolve alt text by finding the <img> whose src matches the chosen image (by basename)
    let altText = '';
    const imageCandidates = [];
    try {
      const imgTagRe = /<img\b[^>]*>/ig;
      const srcRe = /\bsrc=["']([^"']+)["']/i;
      const altRe = /\balt=["']([^"']*)["']/i;
      const dataSrcRe = /\b(data-src|data-original|data-lazy-src)=["']([^"']+)["']/i;
      const srcsetRe = /\bsrcset=["']([^"']+)["']/i;
      let m;
      const chosenBase = (() => { try { const u = new URL(chosen || ''); return (u.pathname.split('/').pop() || '').toLowerCase(); } catch { return ''; } })();
      while ((m = imgTagRe.exec(html)) !== null) {
        const tag = m[0];
        let src = null;
        const srcM = tag.match(srcRe);
        if (srcM) src = srcM[1];
        const dataM = tag.match(dataSrcRe);
        if (!src && dataM) src = dataM[2];
        const srcsetM = tag.match(srcsetRe);
        if (!src && srcsetM) {
          // pick the largest candidate in srcset
          try {
            const parts = srcsetM[1].split(',').map(s => s.trim());
            let best = null; let bestW = 0;
            for (const part of parts) {
              const [u, w] = part.split(/\s+/);
              const ww = parseInt(w, 10) || 0;
              if (ww > bestW) { bestW = ww; best = u; }
            }
            if (best) src = best;
          } catch {}
        }
        if (!src) continue;
        const abs = resolveUrl(src, canonical);
        const absBase = (() => { try { const u = new URL(abs || ''); return (u.pathname.split('/').pop() || '').toLowerCase(); } catch { return ''; } })();
        const altM = tag.match(altRe);
        const alt = altM && altM[1] ? altM[1] : '';
        imageCandidates.push({ url: abs, alt });
        if (!altText && chosen && (abs === chosen || (chosenBase && absBase && absBase.includes(chosenBase)))) {
          if (alt) altText = alt;
        }
      }
    } catch {}

    return {
      title,
      description,
      image: chosen,
      alt: altText,
      images: imageCandidates,
      siteName,
      url: canonical
    };
  } catch (error) {
    // Reduce console noise; return a structured error quietly
    return { error: true, message: error.message, url: pageUrl };
  }
}
