// background/utils/BSettings.js

const DEFAULT_SETTINGS = {
    apiKeys: {
        gnews: '',
        newsapi_org: '',
        newsapi_ai: '',
        serpApi: '',
        googleImages: {
            apiKey: '',
            cx: ''
        },
        youtube: '',
        vimeo: '',
        brave: '', // Make sure this is here
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
        // Check both local and sync storage for API keys
        chrome.storage.local.get(['apiKeys', 'searchConfig'], (localResult) => {
            chrome.storage.sync.get(['apiKeys', 'searchConfig'], (syncResult) => {
                // Merge settings from both storages, prioritizing local
                const mergedApiKeys = {
                    ...DEFAULT_SETTINGS.apiKeys,
                    ...syncResult.apiKeys,
                    ...localResult.apiKeys
                };
                
                const mergedSearchConfig = {
                    ...DEFAULT_SETTINGS.searchConfig,
                    ...syncResult.searchConfig,
                    ...localResult.searchConfig
                };
                
                const settings = {
                    apiKeys: mergedApiKeys,
                    searchConfig: mergedSearchConfig
                };
                
                console.log('[BSettings] Loaded settings:', {
                    brave: settings.apiKeys.brave ? 'SET' : 'MISSING',
                    google: settings.apiKeys.googleImages?.apiKey ? 'SET' : 'MISSING'
                });
                
                resolve(settings);
            });
        });
    });
}

export async function saveSettings(settings) {
    return new Promise((resolve) => {
        // Save to both local and sync storage
        chrome.storage.local.set(settings, () => {
            chrome.storage.sync.set(settings, () => {
                console.log('[BSettings] Settings saved to both storages');
                resolve();
            });
        });
    });
}
