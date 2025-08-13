// background/utils/BSettings.js

const DEFAULT_SETTINGS = {
    apiKeys: {
        // News APIs
        gnews: 'GNEWS_KEY',
        newsapi_org: 'NEWSAPI_AI_KEY',
        newsapi_ai: 'NEWSAPI_AI_KEY',
        
        // Image APIs (High-res web images only, no stock photos)
        serpApi: 'SERPAPI_KEY',
        googleImages: {
            apiKey: 'GOOGLEIMAGES_KEY',
            cx: '452a8aa1a91e64d00'
        },
        
        // Video APIs
        youtube: 'YOUTUBE_KEY',
        vimeo: 'VIMEO_KEY',
        
        // Search APIs
        brave: 'BRAVE_KEY',
        google_search: 'GOOGLE_SEARCH_KEY',
        
        // AI APIs (for future use)
        openai: 'OPENAI_KEY',
        groq: 'GROQ_KEY'
    },
    searchConfig: {
        newsFreshnessDays: 90,
        maxResultsPerCategory: 50,
            preferGoogleCSE: true,
            usePaidImageAPIs: false,
        minImageMegaPixels: 4,
        requireAllTerms: true
    }
};

export async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['apiKeys', 'searchConfig'], (result) => {
            const settings = {
                apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...result.apiKeys },
                searchConfig: { ...DEFAULT_SETTINGS.searchConfig, ...result.searchConfig }
            };
            resolve(settings);
        });
    });
}

export async function saveSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.local.set(settings, () => {
            resolve();
        });
    });
}
