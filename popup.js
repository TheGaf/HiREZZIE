document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  // Load saved query
  chrome.storage.local.get(['lastQuery'], (result) => {
    if (result.lastQuery) {
      searchInput.value = result.lastQuery;
    }
  });

  function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      searchInput.focus();
      return;
    }

    // Save query
    chrome.storage.local.set({ lastQuery: query });

    // Open results page
    const resultsUrl = chrome.runtime.getURL(`results.html?q=${encodeURIComponent(query)}`);
    chrome.tabs.create({ url: resultsUrl });
    
    // Close popup
    window.close();
  }

  // Search button click
  searchBtn.addEventListener('click', performSearch);

  // Enter key
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  // Focus search input
  searchInput.focus();
});
