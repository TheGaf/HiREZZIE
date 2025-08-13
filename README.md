Act as a senior Chrome MV3 engineer. Build a minimal extension named hiREZZIE that finds the newest and greatest hi-resolution photos on the public web fast. No chat, no summaries, no text answers. Images only.

Platform
- Chrome MV3 with service_worker background.
- Permissions: storage, activeTab, declarativeNetRequest if needed for blocklists, fetch to remote hosts.
- host_permissions: <all_urls>, https://www.googleapis.com/*.
- No personal data. No analytics. Console logs only.

Branding and layout
- Dark theme #0a0a0a. No borders. Subtle 8px rounding on images and cards.
- Name: hiREZZIE. Tagline: “Finds the newest and greatest HiRes images from the internet.”
- Logo: HIRezzie.png.
- Show a centered “Built by” line with a QR bug on popup and results.
- Mobile: one centered column 400px wide.
- Desktop ≥1200px: centered 3-column grid, 360px fixed columns with even gaps.
- Search bar is unboxed and pinned to the center column on desktop.
- Square thumbnails using object-fit: cover. Rounded corners. No borders.
- Prevent logo squish: max-width 100 percent, height auto, centered.

UI flows
- Popup shows: logo, built by line, search input, Recent or Relevant toggle, Search button.
- Results page header repeats these controls.
- Loading state shows message, live seconds timer, and a 3×3 skeleton grid.
- Each result card shows a square image and a credit line with source page link and an “Open image” link to the direct image. Both open in new tabs.
- Clicking Search or changing the toggle re-runs the query in place.

Modes
- Recent: bias to very fresh results by using tighter date windows on news and article endpoints.
- Relevant: favor strong query and entity co-occurrence and overall quality.

Quality and validation
- Return 25 to 50 results. Aim for 50.
- Always display direct image URLs only.
- HEAD check where possible. Content-Type must be image/jpeg, image/png, image/webp, or image/avif. Content-Length ≥150 KB when present.
- Prefer width or height ≥2000 px or file size ≥1.5 MB.
- Add boosts at 4 MP and 8 MP.

Relevance and entities
- Detect entities by splitting on “and”, “&”, “vs”, “x”, “with”.
- Quote multi-word entities in refined queries.
- Rank highest when all entities appear in metadata across OG title, OG description, alt text, page title, or URL slug.
- Allow single-entity matches only as padding if volume is low.

De-duplication
- Deduplicate by exact URL and by simple signature (strip query trackers and fragments, sort params, compare base and dimensions).
- Keep the highest resolution or largest byte size variant.

Progressive loading
- Show an initial batch quickly.
- Background load more in steps until 50 images or exhaustion.
- Keep skeletons until images render. Fade in on load.

Inputs and persistence
- Query is free text. Treat multi-word entities as phrases internally.
- Toggle mode persists in chrome.storage.sync.
- Pass query and mode via URL params between popup and results.

Sources pipeline
- Free first: GNews (key), NewsAPI (key), Brave web and images if available, Bing Images via HTML parsing.
- Optional paid fallbacks: Google CSE Images (imgSize=xxlarge, imgType=photo), SerpApi Google Images.
- Provider cooldown: after 403, 429, or 5xx, set a 60 minute cooldown before retry.

Filtering
- Maintain an internal denylist: Instagram, Twitter or X, Reddit, YouTube, Facebook, Pinterest, print-on-demand and generic merch, common CDNs that serve low value thumbs.
- Allow large portals such as Yahoo, MSN, Wikipedia only if image quality passes thresholds.
- Score candidates by OG fields, alt, title, and URL slug. Drop zero-match items unless needed for padding.

Extraction and validation
- If result is an article: collect OG and Twitter card images plus <img> tags (src, data-src, srcset) and alt. Choose the best candidate by relevance and pixels. HEAD validate.
- If result is a direct image: validate extension and confirm type and size by HEAD.

Ranking
- Score = co-occurrence boost + pixel boost (4 MP, 8 MP) + term coverage.
- Sort by score, then by pixel area.
- If below 25, interleave by host to increase diversity and relax dedupe slightly.

Error handling
- Guard all network calls with timeouts and retries. Skip failed providers. Never render broken or non-image URLs.
- If nothing qualifies, show “No images found” with guidance to try Relevant mode or a simpler query.

Accessibility and performance
- ARIA roles and labels on inputs and regions. Live region for result count and loading.
- Images use loading="lazy", decoding="async", referrerpolicy="no-referrer".
- No horizontal scroll. Visible focus states. Fast first paint with skeletons and smooth fade-ins.

Deliverables for Copilot
- manifest.json with MV3 config and permissions.
- background.js service_worker that orchestrates providers, cooldowns, and ranking.
- popup.html, popup.css, popup.js.
- results.html, results.css, results.js with grid, skeletons, timer, and infinite step loader.
- providers/*.js for GNews, NewsAPI, Brave, Bing HTML, and optional Google CSE and SerpApi.
- utils/*.js for fetch with HEAD, URL normalization, entity parsing, ranking, dedupe, and storage.
