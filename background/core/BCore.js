// background/core/BCore.js
import * as BSearch from './BSearch.js';
import { getSettings } from '../utils/BSettings.js';
import { fetchOpenGraphData } from '../utils/BUtils.js';

let settings;
let settingsReadyPromise;

// Initialize settings when the extension starts
async function initialize() {
    settings = await getSettings();
    console.log('[BCore] Settings initialized.');
}

// Kick off settings load and store the promise so listeners can await readiness
settingsReadyPromise = initialize();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!settings) {
        console.warn('[BCore] Settings not initialized yet; awaiting readyPromise.');
        settingsReadyPromise.then(() => {
            // Re-dispatch internally after settings load
            switch (message.action) {
                case 'search':
                    handleSearch(message, sendResponse);
                    break;
                case 'load_more':
                    handleLoadMore(message, sendResponse);
                    break;
                case 'fetch_og_data':
                    handleFetchOgData(message, sendResponse);
                    break;
                case 'test_ai_connection':
                    handleTestAIConnection(sendResponse);
                    break;
                default:
                    sendResponse({ error: 'Unknown action' });
            }
        });
        return true; // keep the sendResponse alive
    }
    
    switch (message.action) {
        case 'search':
            handleSearch(message, sendResponse);
            break;
        case 'search_stream':
            handleSearchStream(message, sendResponse);
            break;
        case 'load_more':
            handleLoadMore(message, sendResponse);
            break;
        case 'fetch_og_data':
            handleFetchOgData(message, sendResponse);
            break;
        case 'test_ai_connection':
            handleTestAIConnection(sendResponse);
            break;
        default:
            console.warn('[BCore] Unknown message action:', message.action);
            sendResponse({ error: 'Unknown action' });
    }
    
    return true; // Indicates that the response is sent asynchronously
});

async function handleSearch(message, sendResponse) {
    try {
        console.log('[BCore] Starting search for:', message.query, 'categories:', message.categories);
        const results = await BSearch.performSearch(message.query, message.categories, settings, 0, message.options || {});
        console.log('[BCore] Search completed, results:', results);
        sendResponse({ data: results });
    } catch (error) {
        console.error('[BCore] Search failed:', error);
        sendResponse({ error: error.message, data: {} });
    }
}

async function handleLoadMore(message, sendResponse) {
    try {
        console.log('[BCore] Loading more for category:', message.category, 'offset:', message.offset);
        const results = await BSearch.loadMoreResults(message.query, message.category, settings, message.offset);
        console.log('[BCore] Load more completed, results:', results);
        sendResponse({ data: results });
    } catch (error) {
        console.error('[BCore] Load more failed:', error);
        sendResponse({ error: error.message, data: [] });
    }
}

async function handleFetchOgData(message, sendResponse) {
    try {
        const ogData = await fetchOpenGraphData(message.url);
        sendResponse({ success: true, data: ogData });
    } catch (error) {
        console.error(`[BCore] Failed to fetch OG data for ${message.url}:`, error);
        sendResponse({ success: false, error: error.message });
    }
}

// Streaming variant: sends partial batches back to the caller incrementally
async function handleSearchStream(message, sendResponse) {
    try {
        const { query, categories } = message;
        console.log('[BCore] Streaming search for:', query, 'categories:', categories);
        // Kick off the search but do not await; we will stream via chrome.runtime ports
        const port = chrome.tabs.connect(message.tabId || sender?.tab?.id, { name: 'searchStream' });
        (async () => {
            for (const category of categories) {
                const batch = await BSearch.performSearch(query, [category], settings, 0);
                port.postMessage({ category, data: batch[category] || [] });
            }
            port.postMessage({ done: true });
            port.disconnect();
        })();
        sendResponse({ ok: true });
    } catch (error) {
        console.error('[BCore] Streaming search failed:', error);
        sendResponse({ error: error.message });
    }
}

function handleTestAIConnection(sendResponse) {
    // For now, return that AI is not available
    sendResponse({ connected: false, reason: 'AI not configured' });
}
