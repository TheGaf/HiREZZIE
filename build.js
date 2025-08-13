const fs = require('fs');
const path = require('path');

// Read environment variables
const config = {
  google: {
    apiKey: process.env.GOOGLEIMAGES_KEY || '',
    searchEngineId: process.env.GOOGLE_SEARCH_KEY || ''
  },
  brave: {
    apiKey: process.env.BRAVE_KEY || ''
  },
  serpapi: {
    apiKey: process.env.SERPAPI_KEY || ''
  },
  newsapi: {
    apiKey: process.env.GNEWS_KEY || ''
  }
};

// Generate config.js
const configContent = `// Auto-generated config file - do not edit manually
const API_CONFIG = ${JSON.stringify(config, null, 2)};

// Export for background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API_CONFIG;
}
`;

// Write to config.js
fs.writeFileSync('config.js', configContent);

console.log('✅ Config generated successfully!');
console.log('Keys found:');
console.log(`- Google Images: ${config.google.apiKey ? '✓' : '✗'}`);
console.log(`- Google Search: ${config.google.searchEngineId ? '✓' : '✗'}`);
console.log(`- Brave: ${config.brave.apiKey ? '✓' : '✗'}`);
console.log(`- SerpApi: ${config.serpapi.apiKey ? '✓' : '✗'}`);
console.log(`- NewsAPI: ${config.newsapi.apiKey ? '✓' : '✗'}`);
