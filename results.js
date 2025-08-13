let currentQuery = '';

document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const imageGrid = document.getElementById('imageGrid');
  const loadingDiv = document.querySelector('.loading');

  // Get query from URL
  const urlParams = new URLSearchParams(window.location.search);
  const query = urlParams.get('q') || '';
  
  if (query) {
    searchInput.value = query;
    performSearch(query);
  }

  function showLoading() {
    loadingDiv.style.display = 'flex';
    imageGrid.innerHTML = '';
  }

  function hideLoading() {
    loadingDiv.style.display = 'none';
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
      // Use imageUrl for direct image link, fallback to url
      imageLink.href = image.imageUrl || image.url;
      imageLink.target = '_blank';
      imageLink.className = 'image-link';
      imageLink.rel = 'noopener noreferrer';
      
      const img = document.createElement('img');
      img.className = 'image-thumb';
      img.alt = image.title || 'High resolution image';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      
      img.onerror = () => {
        imageCard.style.display = 'none';
      };
      
      // Use imageUrl for the thumbnail, fallback to url
      img.src = image.imageUrl || image.thumbnail || image.url;
      
      imageLink.appendChild(img);
      imageCard.appendChild(imageLink);
      
      // Add clean credit with just source name
      if (image.source) {
        const credit = document.createElement('div');
        credit.className = 'image-credit';
        // Credit links to the source page, not the image
        const sourceUrl = image.pageUrl || image.url;
        credit.innerHTML = `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${image.source}</a>`;
        imageCard.appendChild(credit);
      }
      
      imageGrid.appendChild(imageCard);
    });
  }

  async function performSearch(query) {
    if (!query.trim()) return;
    
    currentQuery = query.trim();
    showLoading();
    
    try {
      // Send message to background script
      const response = await chrome.runtime.sendMessage({
        action: 'search',
        query: currentQuery,
        categories: ['images']
      });
      
      hideLoading();
      
      if (response && response.data && response.data.images) {
        displayImages(response.data.images);
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
