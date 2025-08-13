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
        // First try to get from local storage (new format)
        chrome.storage.local.get(['apiKeys', 'searchConfig'], (localResult) => {
            if (localResult.apiKeys || localResult.searchConfig) {
                // Found new format, use it
                const settings = {
                    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...localResult.apiKeys },
                    searchConfig: { ...DEFAULT_SETTINGS.searchConfig, ...localResult.searchConfig }
                };
                console.log('[BSettings] Loaded settings from local storage:', settings);
                resolve(settings);
            } else {
                // Fall back to sync storage (old format) and migrate
                chrome.storage.sync.get(['apiKey', 'cx', 'braveApiKey'], (syncResult) => {
                    const migratedApiKeys = {
                        ...DEFAULT_SETTINGS.apiKeys,
                        brave: syncResult.braveApiKey || '',
                        googleImages: {
                            apiKey: syncResult.apiKey || '',
                            cx: syncResult.cx || ''
                        }
                    };
                    
                    const settings = {
                        apiKeys: migratedApiKeys,
                        searchConfig: { ...DEFAULT_SETTINGS.searchConfig }
                    };
                    
                    // Save migrated settings to local storage for future use
                    if (syncResult.apiKey || syncResult.cx || syncResult.braveApiKey) {
                        chrome.storage.local.set(settings, () => {
                            console.log('[BSettings] Migrated settings from sync to local storage');
                        });
                    }
                    
                    console.log('[BSettings] Loaded and migrated settings from sync storage:', settings);
                    resolve(settings);
                });
            }
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
