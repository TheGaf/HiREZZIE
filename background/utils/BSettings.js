// background/utils/BSettings.js

const DEFAULT_SETTINGS = {
    apiKeys: {
        gnews: '', // Will be set in options
        newsapi_org: '',
        newsapi_ai: '',
        serpApi: '',
        googleImages: {
            apiKey: '',
            cx: ''
        },
        youtube: '',
        vimeo: '',
        brave: '',
        google_search: '',
        openai: '',
        groq: ''
    },
    searchConfig: {
        usePaidImageAPIs: true,
        preferGoogleCSE: false,
        requireAllTerms: false,
        minImageMegaPixels: 2
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
