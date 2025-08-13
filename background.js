// background.js - Main service worker entry point
console.log('[hiREZZIE] Service worker starting...');

// Import the main background logic
import('./background/core/BCore.js').catch(error => {
    console.error('[hiREZZIE] Failed to load BCore:', error);
    
    // Fallback: basic message handler
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.error('[hiREZZIE] BCore not loaded, cannot handle:', message.action);
        sendResponse({ error: 'Background script failed to load' });
        return true;
    });
});

// Service worker lifecycle logging
chrome.runtime.onStartup.addListener(() => {
    console.log('[hiREZZIE] Extension startup');
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log('[hiREZZIE] Extension installed/updated:', details.reason);
});
