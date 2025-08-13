// background.js - Main service worker entry point for hiREZZIE
console.log('[hiREZZIE] Service worker starting...');

// Use static import instead of dynamic import (Chrome MV3 requirement)
import './background/core/BCore.js';

// Service worker lifecycle logging
chrome.runtime.onStartup.addListener(() => {
    console.log('[hiREZZIE] Extension startup - Service worker activated');
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log('[hiREZZIE] Extension installed/updated:', details.reason);
    
    // Set default settings on first install
    if (details.reason === 'install') {
        console.log('[hiREZZIE] First time install - setting up defaults');
        chrome.storage.sync.set({
            exactDefault: true
        });
    }
});

// Handle extension icon click (if popup fails to load)
chrome.action.onClicked.addListener((tab) => {
    console.log('[hiREZZIE] Extension icon clicked, opening results page');
    chrome.tabs.create({
        url: chrome.runtime.getURL('results.html?q=&categories=images')
    });
});

// Global error handler for the service worker
self.addEventListener('error', (event) => {
    console.error('[hiREZZIE] Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('[hiREZZIE] Unhandled promise rejection:', event.reason);
});

// Keep service worker alive with periodic activity
setInterval(() => {
    // Minimal activity to prevent service worker from sleeping
    chrome.storage.local.get(['keepAlive'], () => {
        // This just prevents the service worker from being terminated
    });
}, 25000); // Every 25 seconds

console.log('[hiREZZIE] Background service worker fully initialized');
