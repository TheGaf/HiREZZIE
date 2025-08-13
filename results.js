// results.js - Enhanced version with performance monitoring and infinite scroll
import { VirtualScroller } from './utils/VirtualScroller.js';
import { PerformanceMonitor } from './utils/PerformanceMonitor.js';

document.addEventListener('DOMContentLoaded', function() {
    // Initialize performance monitoring
    const performanceMonitor = new PerformanceMonitor({
        enabled: true,
        sampleRate: 1.0
    });
    
    // Track page load performance
    const pageLoadTimer = performanceMonitor.timeFunction('page_load', () => {
        return new Promise(resolve => {
            if (document.readyState === 'complete') {
                resolve();
            } else {
                window.addEventListener('load', resolve);
            }
        });
    });
    
    pageLoadTimer();
    
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

    // Enhanced state management
    let isSearching = false;
    let currentQuery = query;
    let searchAbortController = null;
    let virtualScroller = null;
    let allResults = [];
    let isInfiniteScrollEnabled = true;
    let lastSearchTime = 0;

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

    // Enhanced loading states with skeleton screens
    function createSkeletonCard() {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-card';
        skeleton.innerHTML = `
            <div class="skeleton-image"></div>
            <div class="skeleton-content">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-subtitle"></div>
                <div class="skeleton-line skeleton-metadata"></div>
            </div>
        `;
        return skeleton;
    }

    function showSkeletonGrid(count = 12) {
        if (!resultsGrid) return;
        
        resultsGrid.innerHTML = '';
        resultsGrid.classList.add('loading-grid');
        
        for (let i = 0; i < count; i++) {
            const skeleton = createSkeletonCard();
            // Stagger animation for visual appeal
            skeleton.style.animationDelay = `${i * 0.1}s`;
            resultsGrid.appendChild(skeleton);
        }
    }

    function hideSkeletonGrid() {
        if (resultsGrid) {
            resultsGrid.classList.remove('loading-grid');
        }
    }

    // Enhanced loading state management
    const showLoading = (isLoading, withProgress = false) => {
        if (loadingDiv) {
            loadingDiv.style.display = isLoading ? 'flex' : 'none';
            
            if (isLoading && withProgress) {
                // Add progress indicator
                let progressEl = loadingDiv.querySelector('.search-progress');
                if (!progressEl) {
                    progressEl = document.createElement('div');
                    progressEl.className = 'search-progress';
                    progressEl.innerHTML = `
                        <div class="progress-bar">
                            <div class="progress-fill"></div>
                        </div>
                        <div class="progress-text">Searching...</div>
                    `;
                    loadingDiv.appendChild(progressEl);
                }
            }
        }
        
        if (isLoading) {
            startTimer();
            showSkeletonGrid();
        } else {
            stopTimer();
            hideSkeletonGrid();
        }
    };

    // Update progress during search
    function updateSearchProgress(progress, text) {
        const progressFill = document.querySelector('.progress-fill');
        const progressText = document.querySelector('.progress-text');
        
        if (progressFill) {
            progressFill.style.width = `${Math.min(100, progress)}%`;
        }
        
        if (progressText && text) {
            progressText.textContent = text;
        }
    }

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

    // Enhanced search function with cancellation and performance monitoring
    function runSearch(q) {
        const searchTimer = performanceMonitor.startTimer('user_search');
        const useQuery = q || currentQuery;
        
        if (!useQuery) return;
        
        // Prevent duplicate searches
        const now = performance.now();
        if (isSearching || (now - lastSearchTime < 500)) {
            console.log('[Results] Search throttled or already in progress');
            return;
        }
        
        // Cancel any existing search
        if (searchAbortController) {
            searchAbortController.abort();
        }
        
        searchAbortController = new AbortController();
        isSearching = true;
        lastSearchTime = now;
        currentQuery = useQuery;
        
        showLoading(true, true);
        updateSearchProgress(10, 'Initializing search...');
        
        // Reset state
        allResults = [];
        if (virtualScroller) {
            virtualScroller.setItems([]);
        }
        
        const params = new URLSearchParams(window.location.search);
        const modeParam = params.get('mode') || getSortMode();
        
        updateSearchProgress(20, 'Sending search request...');
        
        chrome.runtime.sendMessage({
            action: 'search',
            query: useQuery,
            categories,
            useAI,
            options: { 
                exactPhrases: exact, 
                sortMode: modeParam,
                enablePerformanceMonitoring: true,
                cancellationToken: searchAbortController.signal
            }
        }, (response) => {
            if (searchAbortController.signal.aborted) {
                console.log('[Results] Search was cancelled');
                return;
            }
            
            isSearching = false;
            
            if (chrome.runtime.lastError) {
                console.error('[Results] Search failed:', chrome.runtime.lastError);
                handleSearchError(chrome.runtime.lastError);
                return;
            }
            
            updateSearchProgress(60, 'Processing results...');
            
            if (response && response.data) {
                handleSearchSuccess(response, useQuery, searchTimer);
            } else {
                handleSearchError(new Error('No results found'));
            }
        });
    }

    // Handle successful search response
    function handleSearchSuccess(response, query, searchTimer) {
        try {
            updateSearchProgress(80, 'Rendering results...');
            
            // Clear existing content
            if (resultsGrid) {
                resultsGrid.innerHTML = '';
            }
            if (resultsCuratedEl) resultsCuratedEl.textContent = '0';
            if (resultsTotalEl) resultsTotalEl.textContent = '0';
            
            const resultsByCategory = response.data;
            const imageResults = resultsByCategory.images || [];
            
            // Store results globally
            allResults = imageResults;
            
            // Update counters
            if (resultsCuratedEl) resultsCuratedEl.textContent = imageResults.length;
            if (resultsTotalEl) resultsTotalEl.textContent = imageResults.length;
            
            updateSearchProgress(90, 'Setting up virtual scroll...');
            
            // Initialize or update virtual scroller for performance
            if (imageResults.length > 20) {
                initializeVirtualScroller(imageResults);
            } else {
                renderImagesDirectly(imageResults);
            }
            
            updateSearchProgress(100, 'Complete!');
            
            // Start progressive loading in background
            if (isInfiniteScrollEnabled) {
                startProgressiveLoading(query);
            }
            
            const duration = searchTimer.end({ 
                success: true, 
                resultCount: imageResults.length,
                query: query.substring(0, 30) // Truncate for privacy
            });
            
            // Record user interaction
            performanceMonitor.recordMetric('search_complete', {
                duration,
                resultCount: imageResults.length,
                query: query.substring(0, 30),
                mode: getSortMode()
            });
            
            setTimeout(() => showLoading(false), 500); // Brief delay to show 100%
            
        } catch (error) {
            console.error('[Results] Error handling search success:', error);
            handleSearchError(error);
        }
    }

    // Handle search errors
    function handleSearchError(error) {
        isSearching = false;
        showLoading(false);
        
        console.error('[Results] Search error:', error);
        
        // Show user-friendly error message
        if (resultsRoot) {
            resultsRoot.innerHTML = `
                <div class="error-container">
                    <div class="error-icon">⚠️</div>
                    <h3>Search Error</h3>
                    <p>We couldn't complete your search. Please try again.</p>
                    <button class="retry-button" onclick="runSearch('${currentQuery}')">
                        Try Again
                    </button>
                </div>
            `;
        }
        
        // Record error for telemetry
        performanceMonitor.recordMetric('search_error', {
            error: error.message,
            query: currentQuery?.substring(0, 30)
        });
    }

    // Initialize virtual scroller for large result sets
    function initializeVirtualScroller(items) {
        if (virtualScroller) {
            virtualScroller.destroy();
        }
        
        // Create container for virtual scroller if needed
        let scrollContainer = document.getElementById('virtual-scroll-container');
        if (!scrollContainer) {
            scrollContainer = document.createElement('div');
            scrollContainer.id = 'virtual-scroll-container';
            scrollContainer.style.height = '80vh';
            scrollContainer.style.overflow = 'auto';
            
            if (resultsGrid) {
                resultsGrid.style.display = 'none';
                resultsGrid.parentNode.insertBefore(scrollContainer, resultsGrid);
            }
        }
        
        virtualScroller = new VirtualScroller(scrollContainer, {
            itemHeight: 250, // Approximate height of image cards
            bufferSize: 5,
            renderItem: (item, index) => createImageCard(item, index),
            onLoadMore: () => {
                if (isInfiniteScrollEnabled && !isSearching) {
                    loadMoreResults();
                }
            },
            onItemVisible: (element, isVisible) => {
                if (isVisible) {
                    // Lazy load images when visible
                    lazyLoadImage(element);
                }
            }
        });
        
        virtualScroller.setItems(items);
        console.log(`[Results] Virtual scroller initialized with ${items.length} items`);
    }

    // Render images directly for smaller result sets
    function renderImagesDirectly(items) {
        if (!resultsGrid) return;
        
        // Hide virtual scroller if it exists
        const scrollContainer = document.getElementById('virtual-scroll-container');
        if (scrollContainer) {
            scrollContainer.style.display = 'none';
        }
        
        resultsGrid.style.display = '';
        resultsGrid.innerHTML = '';
        
        items.forEach((item, index) => {
            const imageCard = createImageCard(item, index);
            resultsGrid.appendChild(imageCard);
            
            // Lazy load images with intersection observer
            lazyLoadImage(imageCard);
        });
        
        console.log(`[Results] Rendered ${items.length} images directly`);
    }

    // Create enhanced image card with better error handling
    function createImageCard(item, index) {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.dataset.index = index;
        
        // Add progressive image loading
        const imageUrl = item.imageUrl || item.url;
        const title = item.title || item.ogTitle || 'Untitled';
        const source = item.source || 'Unknown';
        const dimensions = item.width && item.height ? `${item.width}×${item.height}` : '';
        
        card.innerHTML = `
            <div class="image-container">
                <div class="image-placeholder">
                    <div class="placeholder-icon">🖼️</div>
                </div>
                <img class="lazy-image" 
                     data-src="${imageUrl}" 
                     alt="${title}"
                     style="display: none;">
                <div class="image-overlay">
                    <div class="image-info">
                        <span class="dimensions">${dimensions}</span>
                        <span class="source">${source}</span>
                    </div>
                </div>
            </div>
            <div class="card-content">
                <h3 class="card-title" title="${title}">${title}</h3>
                <p class="card-source">${source}</p>
            </div>
        `;
        
        // Add click handler
        card.addEventListener('click', () => {
            performanceMonitor.recordMetric('image_click', {
                index,
                source,
                imageUrl: imageUrl.substring(0, 50)
            });
            
            openImageModal(item, index);
        });
        
        return card;
    }

    // Enhanced lazy loading with intersection observer
    let imageObserver = null;
    
    function initializeImageObserver() {
        if (imageObserver) return;
        
        imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    lazyLoadImage(entry.target);
                }
            });
        }, {
            rootMargin: '100px',
            threshold: 0.1
        });
    }
    
    function lazyLoadImage(cardElement) {
        const img = cardElement.querySelector('.lazy-image');
        const placeholder = cardElement.querySelector('.image-placeholder');
        
        if (!img || img.dataset.loaded === 'true') return;
        
        const imageUrl = img.dataset.src;
        if (!imageUrl) return;
        
        // Create new image for preloading
        const tempImg = new Image();
        
        tempImg.onload = () => {
            img.src = imageUrl;
            img.style.display = 'block';
            img.dataset.loaded = 'true';
            
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            
            // Add fade-in animation
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                img.style.opacity = '1';
            }, 10);
        };
        
        tempImg.onerror = () => {
            // Show error state
            if (placeholder) {
                placeholder.innerHTML = '<div class="placeholder-icon error">❌</div>';
                placeholder.style.backgroundColor = '#f5f5f5';
            }
        };
        
        tempImg.src = imageUrl;
        
        // Unobserve after loading starts
        if (imageObserver) {
            imageObserver.unobserve(cardElement);
        }
    }

    // Progressive loading for infinite scroll
    let progressiveLoadingController = null;
    
    function startProgressiveLoading(query) {
        if (progressiveLoadingController) {
            progressiveLoadingController.abort();
        }
        
        progressiveLoadingController = new AbortController();
        
        // Load more results in background
        const targetCount = 50;
        const offsets = [50, 100, 150, 200, 250, 300];
        let offsetIndex = 0;
        
        const loadBatch = () => {
            if (progressiveLoadingController.signal.aborted) return;
            if (allResults.length >= targetCount || offsetIndex >= offsets.length) return;
            
            chrome.runtime.sendMessage({
                action: 'load_more',
                category: 'images',
                query: query,
                offset: offsets[offsetIndex++]
            }, (response) => {
                if (progressiveLoadingController.signal.aborted) return;
                
                const newResults = (response && response.data) || [];
                if (Array.isArray(newResults) && newResults.length > 0) {
                    allResults.push(...newResults);
                    
                    // Update display
                    if (virtualScroller) {
                        virtualScroller.addItems(newResults);
                    } else {
                        // Add to grid directly
                        newResults.forEach((item, index) => {
                            const imageCard = createImageCard(item, allResults.length - newResults.length + index);
                            resultsGrid?.appendChild(imageCard);
                            lazyLoadImage(imageCard);
                        });
                    }
                    
                    // Update counters
                    if (resultsCuratedEl) resultsCuratedEl.textContent = allResults.length;
                    if (resultsTotalEl) resultsTotalEl.textContent = allResults.length;
                    
                    console.log(`[Results] Progressive loading added ${newResults.length} results (total: ${allResults.length})`);
                    
                    // Continue loading
                    setTimeout(loadBatch, 1000); // Delay between batches
                }
            });
        };
        
        // Start loading after initial render
        setTimeout(loadBatch, 2000);
    }

    // Load more results on demand
    function loadMoreResults() {
        if (isSearching) return;
        
        isSearching = true;
        const offset = allResults.length;
        
        chrome.runtime.sendMessage({
            action: 'load_more',
            category: 'images',
            query: currentQuery,
            offset: offset
        }, (response) => {
            isSearching = false;
            
            const newResults = (response && response.data) || [];
            if (Array.isArray(newResults) && newResults.length > 0) {
                allResults.push(...newResults);
                
                if (virtualScroller) {
                    virtualScroller.addItems(newResults);
                } else {
                    newResults.forEach((item, index) => {
                        const imageCard = createImageCard(item, offset + index);
                        resultsGrid?.appendChild(imageCard);
                        lazyLoadImage(imageCard);
                    });
                }
                
                // Update counters
                if (resultsCuratedEl) resultsCuratedEl.textContent = allResults.length;
                if (resultsTotalEl) resultsTotalEl.textContent = allResults.length;
                
                performanceMonitor.recordMetric('load_more', {
                    newResultCount: newResults.length,
                    totalResults: allResults.length
                });
            }
        });
    }

    // Simple modal for image viewing (placeholder for openImageModal)
    function openImageModal(item, index) {
        console.log('Opening image modal for:', item.title || item.url);
        // This would open a full-screen image viewer
        // Implementation depends on specific modal requirements
    }

    // Initialize observers and performance monitoring
    initializeImageObserver();

    if (query) {
        modeReady.then(() => runSearch(query));
    }
});