// proxy.js
import express from 'express';
import fetch from 'node-fetch'; // or use built-in fetch if Node 18+

const app = express();
const PORT = process.env.PORT || 3000;
const NEWSAPI_KEY = process.env.NEWSAPI_KEY; // set this before running

if (!NEWSAPI_KEY) {
  console.error('Set NEWSAPI_KEY environment variable');
  process.exit(1);
}

app.get('/news', async (req, res) => {
  try {
    const { q, page = 1, pageSize = 25 } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q parameter' });

    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', q);
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('language', 'en');
    url.searchParams.set('page', page);
    url.searchParams.set('pageSize', pageSize);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: NEWSAPI_KEY
      }
    });
    const data = await response.json();

    // Allow your extension to fetch it
    res.set('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.options('/news', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  res.sendStatus(204);
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});
