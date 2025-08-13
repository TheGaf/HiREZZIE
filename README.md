# hiREZZIE

A Chrome extension that finds the newest and greatest Hi-Res images from the internet using multiple search engines.

## 🔧 Setup & Installation

### Prerequisites
- Node.js (for building the configuration)
- Chrome browser

### Environment Variables

Before building, set up your API keys as environment variables:

```bash
export BRAVE_KEY="your-brave-search-api-key"
export SERPAPI_KEY="your-serpapi-key"
export GOOGLEIMAGES_KEY="your-google-custom-search-api-key"
export GOOGLE_SEARCH_KEY="your-google-custom-search-engine-id"
export GNEWS_KEY="your-news-api-key"
```

#### How to Get API Keys

1. **Brave Search API** (`BRAVE_KEY`)
   - Visit: https://api.search.brave.com/
   - Sign up and get your API key

2. **SerpApi** (`SERPAPI_KEY`)
   - Visit: https://serpapi.com/
   - Create account and get API key

3. **Google Custom Search** (`GOOGLEIMAGES_KEY` & `GOOGLE_SEARCH_KEY`)
   - Visit: https://developers.google.com/custom-search/v1/introduction
   - Create a Custom Search Engine and get both the API key and Engine ID

4. **NewsAPI** (`GNEWS_KEY`) - Optional, for future use
   - Visit: https://newsapi.org/
   - Register and get API key

### Building

1. Clone the repository
2. Set your environment variables (see above)
3. Build the configuration:

```bash
npm run build
```

This will generate a `config.js` file with your API keys.

### Development

For development with placeholder values:

```bash
npm run dev
```

### Loading in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the hiREZZIE directory
5. The extension should now be available in your browser

## 🚀 Usage

1. Click the hiREZZIE icon in your Chrome toolbar
2. Enter your search query
3. Browse high-resolution images from multiple sources

## 🔍 Search Sources

- **Google Images** (via Custom Search API)
- **Brave Search** (via Brave Search API)
- **SerpApi** (Google Images via SerpApi)
- **Yahoo Images** (web scraping)

## 📝 Notes

- The `config.js` file is auto-generated and should not be committed to version control
- API keys are safely stored in environment variables during build time
- The extension works with whatever API keys you provide - missing keys will use placeholder values
- All searches filter for high-resolution images and remove stock photo sites

## 🛡️ Security

- API keys are read from environment variables at build time
- Generated `config.js` is excluded from version control via `.gitignore`
- No sensitive data is hardcoded in the source code