// background/utils/BSettings.js

const DEFAULT_SETTINGS = {
    apiKeys: {
        gnews: process.env.GNEWS_KEY,
        newsapi_org: process.env.NEWSAPI_ORG_KEY,
        newsapi_ai: process.env.NEWSAPI_AI_KEY,
        serpApi: process.env.SERPAPI_KEY,
        googleImages: {
            apiKey: process.env.GOOGLEIMAGES_KEY,
            cx: process.env.GOOGLEIMAGES_CX // if you want cx from env too
        },
        youtube: process.env.YOUTUBE_KEY,
        vimeo: process.env.VIMEO_KEY,
        brave: process.env.BRAVE_KEY,
        google_search: process.env.GOOGLE_SEARCH_KEY,
        openai: process.env.OPENAI_KEY,
        groq: process.env.GROQ_KEY // fixed typo from GROG_KEY
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
