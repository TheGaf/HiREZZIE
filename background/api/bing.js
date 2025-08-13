// background/api/bing.js
import { cleanHtml, getDomain } from '../utils/BUtils.js';

export async function searchBingImages(query, offset = 0, options = {}) {
  try {
    // Send query as-is, like Google Images Large
    const cleanQuery = query.trim();
    if (!cleanQuery || cleanQuery.length < 2) return [];

    const sortMode = options.sortMode || 'recent';
    const base = 'https://www.bing.com/images/search';
    const params = new URLSearchParams({ q: cleanQuery });
    
    // Large photo images filter
    const qftBits = ['+filterui:imagesize-large', '+filterui:photo-photo'];
    if (sortMode === 'recent') {
      qftBits.push('+filterui:age-lt7days');
    }
    params.set('qft', qftBits.join(''));
    
    const first = Math.max(0, Number(offset) || 0);
    params.set('first', String(first));
    const url = `${base}?${params.toString()}`;

    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      console.warn(`[Bing] HTML fetch failed: ${res.status}`);
      return [];
    }
    const html = await res.text();

    const results = [];
    const regex = /class="iusc"[^>]*\bm="([^"]+)"/ig;
    let m;
    while ((m = regex.exec(html)) !== null) {
      try {
        const raw = m[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&');
        const meta = JSON.parse(raw);
        const imageUrl = meta.murl || meta.imgurl || meta.thumb || '';
        const pageUrl = meta.purl || meta.surl || '';
        if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) continue;
        results.push({
          title: cleanHtml(meta.t || ''),
          url: imageUrl,
          imageUrl,
          pageUrl,
          source: getDomain(pageUrl || imageUrl),
          thumbnail: meta.turl || imageUrl
        });
        if (results.length >= 50) break;
      } catch (_) { /* ignore parse errors */ }
    }
    return results;
  } catch (e) {
    console.error('[Bing] Scrape failed:', e?.message);
    return [];
  }
}
