let searchTimer;
let currentQuery = '';

document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const imageGrid = document.getElementById('imageGrid');
  const loadingDiv = document.querySelector('.loading');
  const timerSpan = document.getElementById('timer');

  // Get query from URL
  const urlParams = new URLSearchParams(window.location.search);
  const query = urlParams.get('q') || '';
  
  if (query) {
    searchInput.value = query;
    performSearch(query);
  }

  function startTimer() {
    const startTime = Date.now();
    searchTimer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      timerSpan.textContent = `${elapsed.toFixed(1)}s`;
    }, 100);
  }

  function stopTimer() {
    if (searchTimer) {
      clearInterval(searchTimer);
      searchTimer = null;
    }
  }

  function showLoading() {
    loadingDiv.style.display = 'flex';
    imageGrid.innerHTML = '';
    startTimer();
  }

  function hideLoading() {
    loadingDiv.style.display = 'none';
    stopTimer();
  }

  function createSkeletonGrid() {
    const skeletonHTML = Array(9).fill(0).map(() => 
      '<div class="skeleton-card"></div>'
    ).join('');
    imageGrid.innerHTML = skeletonHTML;
  }

  function displayImages(images) {
    if (!images || images.length === 0) {
      imageGrid.innerHTML = '<div class="no-results">No high-resolution images found. Try different search terms.</div>';
      return;
    }

    imageGrid.innerHTML = '';
    
    images.forEach((image, index) => {
      const imageCard = document.createElement('div');
      imageCard.className = 'image-card';
      
      const imageLink = document.createElement('a');
      imageLink.href = image.url;
      imageLink.target = '_blank';
      imageLink.className = 'image-link';
      imageLink.rel = 'noopener noreferrer';
      
      const img = document.createElement('img');
      img.className = 'image-thumb loading';
      img.alt = image.title || 'High resolution image';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      
      // Handle image load
      img.onload = () => {
        img.classList.remove('loading');
        img.classList.add('loaded');
      };
      
      img.onerror = () => {
        imageCard.style.display = 'none';
      };
      
      img.src = image.thumbnail || image.url;
      
      imageLink.appendChild(img);
      imageCard.appendChild(imageLink);
      
      // Add credit if available
      if (image.source) {
        const credit = document.createElement('div');
        credit.className = 'image-credit';
        credit.innerHTML = `<a href="${image.sourceUrl || image.url}" target="_blank" rel="noopener noreferrer">${image.source}</a>`;
        imageCard.appendChild(credit);
      }
      
      imageGrid.appendChild(imageCard);
    });
  }

  async function performSearch(query) {
    if (!query.trim()) return;
    
    currentQuery = query.trim();
    showLoading();
    createSkeletonGrid();
    
    try {
      // Send message to background script
      const response = await chrome.runtime.sendMessage({
        action: 'searchImages',
        query: currentQuery
      });
      
      hideLoading();
      
      if (response && response.success) {
        displayImages(response.images);
      } else {
        imageGrid.innerHTML = '<div class="no-results">Search failed. Please try again.</div>';
      }
      
    } catch (error) {
      console.error('Search error:', error);
      hideLoading();
      imageGrid.innerHTML = '<div class="no-results">Search error. Please try again.</div>';
    }
  }

  // Search button click
  searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
      // Update URL
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('q', query);
      window.history.pushState({}, '', newUrl);
      
      performSearch(query);
    }
  });

  // Enter key
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) {
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('q', query);
        window.history.pushState({}, '', newUrl);
        
        performSearch(query);
      }
    }
  });
});
