// hiREZZIE Enhanced Popup Controller with Search Suggestions
class HiRezziePopup {
  constructor() {
    this.config = null;
    this.searchHistory = [];
    this.searchSuggestions = [];
    this.currentSuggestionIndex = -1;
    this.suggestionController = null;
    
    this.initializeConfig().then(() => {
      this.initializeEventListeners();
      this.loadSearchHistory();
      this.validateSearch();
    });
  }
  
  async initializeConfig() {
    // Merge defaults with options from storage
    const defaults = {
      exactDefault: true,
      enableSearchSuggestions: true,
      enableAutoComplete: true,
      maxSuggestions: 8
    };
    const stored = await new Promise(resolve => 
      chrome.storage.sync.get(['exactDefault', 'enableSearchSuggestions', 'enableAutoComplete'], resolve)
    );
    this.config = { ...defaults, ...stored };
  }
  
  async loadSearchHistory() {
    try {
      const data = await new Promise(resolve => 
        chrome.storage.local.get(['searchHistory'], resolve)
      );
      this.searchHistory = data.searchHistory || [];
    } catch (error) {
      console.warn('[Popup] Failed to load search history:', error);
      this.searchHistory = [];
    }
  }
  
  async saveSearchHistory() {
    try {
      await new Promise(resolve => 
        chrome.storage.local.set({ searchHistory: this.searchHistory }, resolve)
      );
    } catch (error) {
      console.warn('[Popup] Failed to save search history:', error);
    }
  }
  
  addToSearchHistory(query) {
    if (!query || query.length < 2) return;
    
    // Remove existing occurrence
    this.searchHistory = this.searchHistory.filter(item => item.query !== query);
    
    // Add to beginning
    this.searchHistory.unshift({
      query,
      timestamp: Date.now(),
      count: (this.searchHistory.find(item => item.query === query)?.count || 0) + 1
    });
    
    // Keep only last 50 searches
    this.searchHistory = this.searchHistory.slice(0, 50);
    
    this.saveSearchHistory();
  }
  
  initializeEventListeners() {
    // Search button and input with enhanced functionality
    document.getElementById('searchBtn').addEventListener('click', () => this.performSearch());
    
    const searchInput = document.getElementById('searchInput');
    
    // Enhanced input event handling
    searchInput.addEventListener('input', (e) => {
      this.validateSearch();
      if (this.config.enableSearchSuggestions) {
        this.handleSearchInput(e.target.value);
      }
    });
    
    // Enhanced keypress handling with navigation
    searchInput.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
    });
    
    // Focus handling for suggestions
    searchInput.addEventListener('focus', () => {
      if (this.config.enableSearchSuggestions) {
        this.showSuggestions();
      }
    });
    
    searchInput.addEventListener('blur', (e) => {
      // Delay hiding to allow suggestion clicks
      setTimeout(() => {
        if (!e.relatedTarget?.closest('.suggestions-container')) {
          this.hideSuggestions();
        }
      }, 100);
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      this.handleGlobalKeyDown(e);
    });

    // Sort toggle persistence
    const sortToggle = document.getElementById('popupSortToggle');
    if (sortToggle) {
      chrome.storage.sync.get(['sortMode'], ({ sortMode }) => {
        sortToggle.checked = sortMode === 'relevant';
      });
      sortToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ sortMode: sortToggle.checked ? 'relevant' : 'recent' });
      });
    }
    
    // Logo error handling
    const popupLogo = document.getElementById('popupLogo');
    if (popupLogo) {
      popupLogo.addEventListener('error', () => {
        popupLogo.style.display = 'none';
        const logoContainer = popupLogo.parentElement;
        logoContainer.innerHTML = '<h1 style="font-size: 28px; font-weight: 700; color: var(--neon-cyan); font-family: Faustina, serif;">hiREZZIE</h1>';
      });
    }
    
    // Initialize suggestions container
    this.initializeSuggestionsContainer();
  }
  
  initializeSuggestionsContainer() {
    if (!this.config.enableSearchSuggestions) return;
    
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    // Create suggestions container
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'suggestions-container';
    suggestionsContainer.style.display = 'none';
    
    // Insert after search input
    searchInput.parentNode.insertBefore(suggestionsContainer, searchInput.nextSibling);
  }
  
  handleSearchInput(value) {
    if (this.suggestionController) {
      this.suggestionController.abort();
    }
    
    this.suggestionController = new AbortController();
    
    // Debounce suggestions
    clearTimeout(this.suggestionTimeout);
    this.suggestionTimeout = setTimeout(() => {
      this.generateSuggestions(value);
    }, 200);
  }
  
  handleKeyDown(e) {
    const suggestionsContainer = document.querySelector('.suggestions-container');
    const suggestions = suggestionsContainer?.querySelectorAll('.suggestion-item') || [];
    
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (this.currentSuggestionIndex >= 0 && suggestions[this.currentSuggestionIndex]) {
          this.selectSuggestion(suggestions[this.currentSuggestionIndex].textContent);
        } else {
          this.performSearch();
        }
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        if (suggestions.length > 0) {
          this.currentSuggestionIndex = Math.min(this.currentSuggestionIndex + 1, suggestions.length - 1);
          this.highlightSuggestion();
        }
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        if (suggestions.length > 0) {
          this.currentSuggestionIndex = Math.max(this.currentSuggestionIndex - 1, -1);
          this.highlightSuggestion();
        }
        break;
        
      case 'Escape':
        e.preventDefault();
        this.hideSuggestions();
        document.getElementById('searchInput').blur();
        break;
        
      case 'Tab':
        if (this.currentSuggestionIndex >= 0 && suggestions[this.currentSuggestionIndex]) {
          e.preventDefault();
          this.selectSuggestion(suggestions[this.currentSuggestionIndex].textContent);
        }
        break;
    }
  }
  
  handleGlobalKeyDown(e) {
    // Global keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'k':
        case '/':
          e.preventDefault();
          document.getElementById('searchInput').focus();
          break;
          
        case 'Enter':
          e.preventDefault();
          this.performSearch();
          break;
      }
    }
    
    // Alt + number for quick searches (popular queries)
    if (e.altKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      const popularQueries = this.getPopularQueries();
      if (popularQueries[index]) {
        document.getElementById('searchInput').value = popularQueries[index].query;
        this.performSearch();
      }
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
  
  generateSuggestions(value) {
    if (!value || value.length < 2) {
      this.hideSuggestions();
      return;
    }
    
    const suggestions = [];
    const lowerValue = value.toLowerCase();
    
    // Add history-based suggestions
    const historySuggestions = this.searchHistory
      .filter(item => item.query.toLowerCase().includes(lowerValue))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(item => ({
        text: item.query,
        type: 'history',
        count: item.count
      }));
    
    suggestions.push(...historySuggestions);
    
    // Add contextual suggestions based on common patterns
    const contextualSuggestions = this.generateContextualSuggestions(value);
    suggestions.push(...contextualSuggestions);
    
    // Add auto-completion suggestions
    if (this.config.enableAutoComplete) {
      const autoCompleteSuggestions = this.generateAutoCompleteSuggestions(value);
      suggestions.push(...autoCompleteSuggestions);
    }
    
    // Remove duplicates and limit results
    const uniqueSuggestions = suggestions
      .filter((item, index, arr) => arr.findIndex(s => s.text === item.text) === index)
      .slice(0, this.config.maxSuggestions);
    
    this.showSuggestions(uniqueSuggestions);
  }
  
  generateContextualSuggestions(value) {
    const suggestions = [];
    const lowerValue = value.toLowerCase();
    
    // Common search patterns and enhancements
    const patterns = [
      { trigger: /\b\w+\s+\w+$/, suffix: ' high resolution' },
      { trigger: /\b\w+$/, suffix: ' wallpaper' },
      { trigger: /\b\w+$/, suffix: ' 4K' },
      { trigger: /\b\w+$/, suffix: ' HD' },
      { trigger: /\bvs\b/, context: 'comparison' },
      { trigger: /\band\b/, context: 'combination' }
    ];
    
    patterns.forEach(pattern => {
      if (pattern.trigger.test(lowerValue) && pattern.suffix) {
        const suggestion = value + pattern.suffix;
        if (!suggestions.find(s => s.text === suggestion)) {
          suggestions.push({
            text: suggestion,
            type: 'contextual',
            label: 'Suggested'
          });
        }
      }
    });
    
    return suggestions.slice(0, 2);
  }
  
  generateAutoCompleteSuggestions(value) {
    // Common search terms and completions
    const commonTerms = [
      'high resolution', 'wallpaper', '4K', 'HD', 'ultra HD', 'retina',
      'desktop', 'mobile', 'portrait', 'landscape', 'abstract',
      'nature', 'city', 'space', 'technology', 'art', 'photography'
    ];
    
    const lowerValue = value.toLowerCase();
    
    return commonTerms
      .filter(term => term.toLowerCase().startsWith(lowerValue) && term.length > value.length)
      .slice(0, 3)
      .map(term => ({
        text: term,
        type: 'autocomplete',
        label: 'Complete'
      }));
  }
  
  showSuggestions(suggestions = []) {
    const suggestionsContainer = document.querySelector('.suggestions-container');
    if (!suggestionsContainer) return;
    
    if (suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }
    
    suggestionsContainer.innerHTML = '';
    this.currentSuggestionIndex = -1;
    
    suggestions.forEach((suggestion, index) => {
      const suggestionElement = document.createElement('div');
      suggestionElement.className = 'suggestion-item';
      suggestionElement.dataset.index = index;
      
      const icon = this.getSuggestionIcon(suggestion.type);
      const label = suggestion.label || this.getSuggestionLabel(suggestion.type);
      
      suggestionElement.innerHTML = `
        <div class="suggestion-content">
          <span class="suggestion-icon">${icon}</span>
          <span class="suggestion-text">${suggestion.text}</span>
          <span class="suggestion-label">${label}</span>
        </div>
      `;
      
      suggestionElement.addEventListener('click', () => {
        this.selectSuggestion(suggestion.text);
      });
      
      suggestionsContainer.appendChild(suggestionElement);
    });
    
    suggestionsContainer.style.display = 'block';
  }
  
  hideSuggestions() {
    const suggestionsContainer = document.querySelector('.suggestions-container');
    if (suggestionsContainer) {
      suggestionsContainer.style.display = 'none';
    }
    this.currentSuggestionIndex = -1;
  }
  
  highlightSuggestion() {
    const suggestions = document.querySelectorAll('.suggestion-item');
    
    suggestions.forEach((item, index) => {
      if (index === this.currentSuggestionIndex) {
        item.classList.add('highlighted');
      } else {
        item.classList.remove('highlighted');
      }
    });
    
    // Update input value with highlighted suggestion
    if (this.currentSuggestionIndex >= 0 && suggestions[this.currentSuggestionIndex]) {
      const suggestionText = suggestions[this.currentSuggestionIndex].querySelector('.suggestion-text').textContent;
      // Optionally preview the suggestion in the input
      // document.getElementById('searchInput').value = suggestionText;
    }
  }
  
  selectSuggestion(suggestionText) {
    document.getElementById('searchInput').value = suggestionText;
    this.hideSuggestions();
    this.validateSearch();
    
    // Optionally trigger search immediately
    // this.performSearch();
  }
  
  getSuggestionIcon(type) {
    switch (type) {
      case 'history': return '🕒';
      case 'contextual': return '💡';
      case 'autocomplete': return '✨';
      default: return '🔍';
    }
  }
  
  getSuggestionLabel(type) {
    switch (type) {
      case 'history': return 'Recent';
      case 'contextual': return 'Suggested';
      case 'autocomplete': return 'Complete';
      default: return '';
    }
  }
  
  getPopularQueries() {
    return this.searchHistory
      .sort((a, b) => b.count - a.count)
      .slice(0, 9);
  }
  
  async performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    
    if (!query) {
      return;
    }
    
    // Add to search history
    this.addToSearchHistory(query);
    
    // Build search parameters
    const sortToggle = document.getElementById('popupSortToggle');
    const mode = sortToggle && sortToggle.checked ? 'relevant' : 'recent';

    const params = new URLSearchParams({
      q: query,
      categories: 'images',
      useAI: 'false',
      exact: this.config.exactDefault ? 'true' : 'false',
      mode
    });
    
    // Show loading state
    const searchBtn = document.getElementById('searchBtn');
    const originalText = searchBtn.textContent;
    searchBtn.textContent = 'Searching...';
    searchBtn.disabled = true;
    
    try {
      // Open results page
      chrome.tabs.create({
        url: `results.html?${params.toString()}`
      });
      
      // Close popup after a brief delay to show feedback
      setTimeout(() => {
        window.close();
      }, 100);
      
    } catch (error) {
      console.error('[Popup] Failed to open results:', error);
      
      // Restore button state
      searchBtn.textContent = originalText;
      searchBtn.disabled = false;
      
      // Show error feedback
      this.showErrorFeedback('Failed to open search results');
    }
  }
  
  showErrorFeedback(message) {
    // Create or update error message
    let errorElement = document.getElementById('error-feedback');
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.id = 'error-feedback';
      errorElement.className = 'error-feedback';
      
      const searchInput = document.getElementById('searchInput');
      searchInput.parentNode.insertBefore(errorElement, searchInput.nextSibling);
    }
    
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      if (errorElement) {
        errorElement.style.display = 'none';
      }
    }, 3000);
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