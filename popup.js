// hiREZZIE Popup Controller
class HiRezziePopup {
  constructor() {
    this.config = null;
    this.initializeConfig().then(() => {
      this.initializeEventListeners();
      this.validateSearch();
    });
  }
  
  async initializeConfig() {
    // Merge defaults with options from storage
    const defaults = {
      exactDefault: true
    };
    const stored = await new Promise(resolve => chrome.storage.sync.get(['exactDefault'], resolve));
    this.config = { ...defaults, ...stored };
  }
  
  initializeEventListeners() {
    // Search button and input
    document.getElementById('searchBtn').addEventListener('click', () => this.performSearch());
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.performSearch();
    });
    
    // Validate on input change
    document.getElementById('searchInput').addEventListener('input', () => this.validateSearch());
    
    // Logo error handling
    const popupLogo = document.getElementById('popupLogo');
    if (popupLogo) {
      popupLogo.addEventListener('error', () => {
        popupLogo.style.display = 'none';
        const logoContainer = popupLogo.parentElement;
        logoContainer.innerHTML = '<h1 style="font-size: 28px; font-weight: 700; color: var(--neon-cyan); font-family: Faustina, serif;">hiREZZIE</h1>';
      });
    }
  }
  
  validateSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    if (!searchInput || !searchBtn) {
      return; // Elements not ready yet
    }
    
    const query = searchInput.value.trim();
    
    // Just disable/enable the button, don't change text
    searchBtn.disabled = !query;
    
    // Keep button text as "Search" always
    searchBtn.textContent = 'Search';
  }
  
  async performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    
    if (!query) {
      return;
    }
    

    
    // Build search parameters
    const params = new URLSearchParams({
      q: query,
      categories: 'images',
      useAI: 'false',
      exact: this.config.exactDefault ? 'true' : 'false'
    });
    
    // Open results page
    chrome.tabs.create({
      url: `results.html?${params.toString()}`
    });
    
    // Close popup
    window.close();
  }
  

  
  escapeHtml(text) {
    if (!text) return '';
    
    // First decode HTML entities
    const decoded = this.decodeHtmlEntities(String(text));
    
    // Then escape for safe display
    const div = document.createElement('div');
    div.textContent = decoded;
    return div.innerHTML;
  }
  
  decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new HiRezziePopup();
});