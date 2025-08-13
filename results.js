// results.js - Working version matching RIGHTDESIGN
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    const initialMode = urlParams.get('mode');
    const categories = ['images'];
    const useAI = false;
    const exact = urlParams.get('exact') === 'true';

    const resultsRoot = document.getElementById('results');
    const resultsGrid = document.getElementById('imageGrid');
    // Define (possibly absent) counter elements to avoid reference errors
    const resultsCuratedEl = document.getElementById('resultsCurated') || null;
    const resultsTotalEl = document.getElementById('resultsTotal') || null;
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const loadingDiv = document.querySelector('.loading');
    const timerEl = document.getElementById('timer');
    const urlTicker = null; // removed ticker display
    const queryTitle = document.getElementById('queryTitle');

    // Category offsets for pagination (images only)
    let categoryOffsets = { images: 0 };

    // Store category sections for filtering (images only)
    let categorySections = {};

    // Initialize offsets from sessionStorage
    const getStoredOffset = (category) => {
        const stored = sessionStorage.getItem(`offset_${category}`);
        return stored ? parseInt(stored) : 0;
    };

    const setStoredOffset = (category, offset) => {
        sessionStorage.setItem(`offset_${category}`, offset.toString());
    };

    // Initialize offsets
    Object.keys(categoryOffsets).forEach(category => {
        categoryOffsets[category] = getStoredOffset(category);
    });

    // Clear all offsets for new search
    if (query) {
        Object.keys(categoryOffsets).forEach(category => {
            sessionStorage.removeItem(`offset_${category}`);
            categoryOffsets[category] = 0;
        });
    }

    // Set search bar text
    if (searchInput && query) {
        searchInput.value = query;
    }

    // No category filter buttons in simplified UI

    // New search functionality
    function getSortMode() {
        const toggle = document.getElementById('sortToggle');
        return (toggle && toggle.checked) ? 'relevant' : 'recent';
    }

    // Initialize toggle from URL mode, otherwise from stored mode
    const modeReady = new Promise((resolve) => {
        const applyMode = (mode) => {
            const toggle = document.getElementById('sortToggle');
            if (toggle) toggle.checked = (mode === 'relevant');
            resolve();
        };
        if (initialMode === 'relevant' || initialMode === 'recent') {
            applyMode(initialMode);
            return;
        }
        try {
            chrome.storage.sync.get(['sortMode'], ({ sortMode }) => {
                applyMode(sortMode === 'relevant' ? 'relevant' : 'recent');
            });
        } catch {
            applyMode('recent');
        }
    });

    function performNewSearch() {
        const newQuery = searchInput.value.trim();
        if (!newQuery) return;
        if (newQuery && newQuery !== query) {
            // Clear all offsets for new search
            Object.keys(categoryOffsets).forEach(category => {
                sessionStorage.removeItem(`offset_${category}`);
            });
            
            // Navigate to new search
            const mode = getSortMode();
            const newUrl = `results.html?q=${encodeURIComponent(newQuery)}&categories=images&exact=true&mode=${mode}`;
            window.location.href = newUrl;
        } else if (newQuery === query) {
            // Re-run the same search in place
            runSearch(newQuery);
        }
    }

    let currentSearchController = null;

function cancelCurrentSearch() {
    if (currentSearchController) {
        currentSearchController.abort();
        currentSearchController = null;
        console.log('[Results] Cancelled previous search');
    }
}

    // Search button click
    if (searchBtn) {
        searchBtn.addEventListener('click', performNewSearch);
    }

    // Enter key in search input
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performNewSearch();
            }
        });
    }

    // Timer handling
    let startTime = performance.now();
    let timerInterval = null;
    function startTimer() {
        if (!timerEl) return;
        startTime = performance.now();
        timerInterval = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            timerEl.textContent = `${elapsed.toFixed(1)}s`;
        }, 100);
    }
    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
    }

    const showLoading = (isLoading) => {
        if (loadingDiv) loadingDiv.style.display = isLoading ? 'flex' : 'none';
        if (isLoading) startTimer(); else stopTimer();
    };

    // URL ticker
    function pushUrlTick(url) {
        if (!urlTicker) return;
        urlTicker.innerHTML = '';
        const tick = document.createElement('div');
        tick.className = 'tick';
        try {
            const u = new URL(url);
            tick.textContent = u.hostname + u.pathname;
        } catch {
            tick.textContent = url;
        }
        urlTicker.appendChild(tick);
    }

    // Show live URLs while waiting by probing results as they arrive

    const pickDirectImageUrl = (r) => {
        const img = r?.imageUrl || null;
        if (img) return img;
        const u = r?.url || '';
        if (/\.(jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(u)) return u;
        return null;
    };

    const renderImageCard = (result) => {
        if (!result) return null;
        const directUrl = pickDirectImageUrl(result);
        if (!directUrl) return null;
        const card = document.createElement('div');
        card.className = 'image-card';

        const imageHref = directUrl;
        const pageHref = result.contextLink || result.pageUrl || result.link || result.sourceUrl || imageHref;
        const sourceText = result.source || '';

        card.innerHTML = `
            <a class="image-link" href="${imageHref}" target="_blank" rel="noopener noreferrer">
                <img class="image-thumb loading" src="${imageHref}" alt="${result.title || sourceText}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
            </a>
            <div class="image-credit"><a href="${pageHref}" target="_blank" rel="noopener noreferrer">${sourceText}</a> · <a href="${imageHref}" target="_blank" rel="noopener noreferrer">Open image</a></div>
        `;

        const img = card.querySelector('.image-thumb');
        if (img) {
            const onLoad = () => {
                img.classList.remove('loading');
                img.classList.add('loaded');
            };
            img.addEventListener('load', onLoad, { once: true });
            img.addEventListener('error', () => {
                img.classList.remove('loading');
                img.classList.add('loaded');
            }, { once: true });
        }

        return card;
    };



    // Directly render images into the grid (no category wrapper)
    const renderImagesIntoGrid = (results) => {
        const hadAny = resultsGrid.querySelectorAll('.image-card').length > 0;
        if (results && results.length > 0) {
            let appended = 0;
            const seen = new Set(Array.from(resultsGrid.querySelectorAll('.image-card a.image-link')).map(a => a.href));
            results.forEach(result => {
                const node = renderImageCard(result);
                if (node) {
                    const href = node.querySelector('a.image-link')?.href;
                    if (href && !seen.has(href)) { resultsGrid.appendChild(node); appended += 1; seen.add(href); }
                }
            });
            // Only show no-results if we still have zero cards total
            const totalNow = resultsGrid.querySelectorAll('.image-card').length;
            if (appended === 0 && totalNow === 0) {
                resultsRoot.innerHTML = '<p class="no-results">No direct images found from these sources.</p>';
            }
            if (resultsCuratedEl) resultsCuratedEl.textContent = String(totalNow);
        } else if (!hadAny) {
            resultsRoot.innerHTML = '<p class="no-results">No images found.</p>';
        }
    };

function runSearch(q) {
    // Add this line at the beginning
    cancelCurrentSearch();
    currentSearchController = new AbortController();
    
    const useQuery = q || query;
    if (!useQuery) return;
    showLoading(true);
        // pre-fill grid with skeletons to show progress
        if (resultsGrid) {
          resultsGrid.innerHTML = '';
          // add grey skeletons while network is in flight
          for (let i = 0; i < 9; i++) {
            const sk = document.createElement('div');
            sk.className = 'skeleton-card';
            resultsGrid.appendChild(sk);
          }
        }
        const params = new URLSearchParams(window.location.search);
        const modeParam = params.get('mode') || getSortMode();
        chrome.runtime.sendMessage({
            action: 'search',
            query: useQuery,
            categories,
            useAI,
            options: { exactPhrases: exact, sortMode: modeParam }
        }, (response) => {
            // Keep loader visible while we potentially fetch more
            
            if (response && response.data) {
                // Clear existing content
                resultsGrid.innerHTML = '';
                if (resultsCuratedEl) resultsCuratedEl.textContent = '0';
                if (resultsTotalEl) resultsTotalEl.textContent = '0';
                
                const resultsByCategory = response.data;
                // Meta count from backend (e.g., total valid before curation)
                // no counter requested
                const imageResults = resultsByCategory.images || [];
                // ticker removed
                renderImagesIntoGrid(imageResults);
                // Progressive background loading using load_more
                const targetCount = 25;
                const offsets = [50, 100, 150, 200, 250, 300];
                let i = 0;
                const pump = () => {
                    const current = resultsGrid.querySelectorAll('.image-card').length;
                    if (current >= targetCount || i >= offsets.length) { showLoading(false); return; }
                    chrome.runtime.sendMessage({ action: 'load_more', category: 'images', query: useQuery, offset: offsets[i++] }, (more) => {
                        const arr = (more && more.data) || [];
                        if (Array.isArray(arr) && arr.length) renderImagesIntoGrid(arr);
                        pump();
                    });
                };
                pump();
            
            } else {
                resultsRoot.innerHTML = '<p>No results found. Try a different search term.</p>';
            }
        });
    }

    if (query) {
        modeReady.then(() => runSearch(query));
    }
});
