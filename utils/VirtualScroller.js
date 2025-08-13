// utils/VirtualScroller.js
/**
 * Virtual scrolling implementation for large result sets
 */

class VirtualScroller {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      itemHeight: options.itemHeight || 200,
      bufferSize: options.bufferSize || 5,
      threshold: options.threshold || 100,
      debounceMs: options.debounceMs || 16,
      estimateSize: options.estimateSize || null,
      ...options
    };

    this.items = [];
    this.visibleItems = new Map();
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.totalHeight = 0;
    this.startIndex = 0;
    this.endIndex = 0;

    // Intersection Observer for lazy loading
    this.intersectionObserver = null;
    this.resizeObserver = null;

    // Performance tracking
    this.scrollPerformance = {
      lastScrollTime: 0,
      frameId: null,
      isScrolling: false
    };

    this.init();
  }

  /**
   * Initialize the virtual scroller
   */
  init() {
    this.setupContainer();
    this.setupObservers();
    this.bindEvents();
    this.updateDimensions();
  }

  /**
   * Setup container styles and structure
   */
  setupContainer() {
    // Ensure container has proper styles
    const computedStyle = getComputedStyle(this.container);
    if (computedStyle.position === 'static') {
      this.container.style.position = 'relative';
    }
    if (computedStyle.overflow !== 'auto' && computedStyle.overflow !== 'scroll') {
      this.container.style.overflow = 'auto';
    }

    // Create viewport and spacer elements
    this.viewport = document.createElement('div');
    this.viewport.className = 'virtual-scroll-viewport';
    this.viewport.style.position = 'relative';
    this.viewport.style.minHeight = '100%';

    this.spacer = document.createElement('div');
    this.spacer.className = 'virtual-scroll-spacer';
    this.spacer.style.position = 'absolute';
    this.spacer.style.top = '0';
    this.spacer.style.left = '0';
    this.spacer.style.right = '0';
    this.spacer.style.pointerEvents = 'none';

    this.container.appendChild(this.viewport);
    this.container.appendChild(this.spacer);
  }

  /**
   * Setup intersection and resize observers
   */
  setupObservers() {
    // Intersection observer for lazy loading
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => this.handleIntersection(entries),
        {
          root: this.container,
          rootMargin: `${this.options.threshold}px`,
          threshold: 0
        }
      );
    }

    // Resize observer for container dimension changes
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(
        (entries) => this.handleResize(entries)
      );
      this.resizeObserver.observe(this.container);
    }
  }

  /**
   * Bind scroll and other events
   */
  bindEvents() {
    this.handleScroll = this.debounce(this.onScroll.bind(this), this.options.debounceMs);
    this.container.addEventListener('scroll', this.handleScroll, { passive: true });

    // Handle window resize
    this.handleWindowResize = this.debounce(this.updateDimensions.bind(this), 100);
    window.addEventListener('resize', this.handleWindowResize);
  }

  /**
   * Set the data items to be virtually scrolled
   */
  setItems(items) {
    this.items = items;
    this.calculateTotalHeight();
    this.render();
  }

  /**
   * Add new items to the list
   */
  addItems(newItems) {
    this.items.push(...newItems);
    this.calculateTotalHeight();
    this.render();
  }

  /**
   * Update container dimensions
   */
  updateDimensions() {
    const rect = this.container.getBoundingClientRect();
    this.containerHeight = rect.height;
    this.calculateVisibleRange();
    this.render();
  }

  /**
   * Calculate total height of all items
   */
  calculateTotalHeight() {
    if (this.options.estimateSize) {
      this.totalHeight = this.items.reduce((total, item, index) => {
        return total + (this.options.estimateSize(item, index) || this.options.itemHeight);
      }, 0);
    } else {
      this.totalHeight = this.items.length * this.options.itemHeight;
    }

    this.spacer.style.height = `${this.totalHeight}px`;
  }

  /**
   * Calculate which items should be visible
   */
  calculateVisibleRange() {
    if (!this.items.length) {
      this.startIndex = 0;
      this.endIndex = 0;
      return;
    }

    this.scrollTop = this.container.scrollTop;

    // Calculate start index
    if (this.options.estimateSize) {
      this.startIndex = this.findStartIndexWithVariableHeight();
    } else {
      this.startIndex = Math.floor(this.scrollTop / this.options.itemHeight);
    }

    // Calculate how many items fit in viewport plus buffer
    const visibleCount = Math.ceil(this.containerHeight / this.options.itemHeight);
    const totalVisible = visibleCount + (this.options.bufferSize * 2);

    this.startIndex = Math.max(0, this.startIndex - this.options.bufferSize);
    this.endIndex = Math.min(this.items.length, this.startIndex + totalVisible);
  }

  /**
   * Find start index for variable height items
   */
  findStartIndexWithVariableHeight() {
    let currentHeight = 0;
    let index = 0;

    while (index < this.items.length && currentHeight < this.scrollTop) {
      const itemHeight = this.options.estimateSize(this.items[index], index) || this.options.itemHeight;
      currentHeight += itemHeight;
      index++;
    }

    return Math.max(0, index - 1);
  }

  /**
   * Calculate item position for variable heights
   */
  calculateItemPosition(index) {
    if (!this.options.estimateSize) {
      return index * this.options.itemHeight;
    }

    let position = 0;
    for (let i = 0; i < index; i++) {
      position += this.options.estimateSize(this.items[i], i) || this.options.itemHeight;
    }
    return position;
  }

  /**
   * Render visible items
   */
  render() {
    this.calculateVisibleRange();

    // Remove items that are no longer visible
    const itemsToRemove = [];
    for (const [index, element] of this.visibleItems) {
      if (index < this.startIndex || index >= this.endIndex) {
        itemsToRemove.push(index);
      }
    }

    itemsToRemove.forEach(index => {
      const element = this.visibleItems.get(index);
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
      this.visibleItems.delete(index);
    });

    // Add new visible items
    for (let i = this.startIndex; i < this.endIndex; i++) {
      if (!this.visibleItems.has(i) && this.items[i]) {
        this.renderItem(i);
      }
    }

    this.updateScrolling();
  }

  /**
   * Render a single item
   */
  renderItem(index) {
    const item = this.items[index];
    if (!item) return;

    const element = this.createItemElement(item, index);
    const position = this.calculateItemPosition(index);

    element.style.position = 'absolute';
    element.style.top = `${position}px`;
    element.style.left = '0';
    element.style.right = '0';
    element.style.zIndex = '1';
    
    // Set height if not variable
    if (!this.options.estimateSize) {
      element.style.height = `${this.options.itemHeight}px`;
    }

    this.viewport.appendChild(element);
    this.visibleItems.set(index, element);

    // Observe for intersection if available
    if (this.intersectionObserver) {
      this.intersectionObserver.observe(element);
    }

    // Trigger custom render event
    if (this.options.onItemRender) {
      this.options.onItemRender(element, item, index);
    }
  }

  /**
   * Create an item element (should be overridden)
   */
  createItemElement(item, index) {
    if (this.options.renderItem) {
      return this.options.renderItem(item, index);
    }

    // Default item renderer
    const element = document.createElement('div');
    element.className = 'virtual-scroll-item';
    element.textContent = `Item ${index}`;
    return element;
  }

  /**
   * Handle scroll events
   */
  onScroll() {
    this.scrollPerformance.lastScrollTime = performance.now();
    this.scrollPerformance.isScrolling = true;

    if (this.scrollPerformance.frameId) {
      cancelAnimationFrame(this.scrollPerformance.frameId);
    }

    this.scrollPerformance.frameId = requestAnimationFrame(() => {
      this.render();
      
      // Check if scrolling has stopped
      setTimeout(() => {
        if (performance.now() - this.scrollPerformance.lastScrollTime > 100) {
          this.scrollPerformance.isScrolling = false;
          this.onScrollEnd();
        }
      }, 100);
    });

    // Trigger scroll event
    if (this.options.onScroll) {
      this.options.onScroll(this.scrollTop, this.startIndex, this.endIndex);
    }
  }

  /**
   * Handle scroll end
   */
  onScrollEnd() {
    if (this.options.onScrollEnd) {
      this.options.onScrollEnd(this.scrollTop, this.startIndex, this.endIndex);
    }

    // Check if we need to load more items
    if (this.options.onLoadMore && this.endIndex >= this.items.length - this.options.bufferSize) {
      this.options.onLoadMore();
    }
  }

  /**
   * Update scrolling performance indicators
   */
  updateScrolling() {
    if (this.scrollPerformance.isScrolling) {
      this.container.classList.add('is-scrolling');
    } else {
      this.container.classList.remove('is-scrolling');
    }
  }

  /**
   * Handle intersection observer events
   */
  handleIntersection(entries) {
    entries.forEach(entry => {
      if (this.options.onItemVisible) {
        this.options.onItemVisible(entry.target, entry.isIntersecting);
      }
    });
  }

  /**
   * Handle resize observer events
   */
  handleResize(entries) {
    this.updateDimensions();
  }

  /**
   * Scroll to a specific item
   */
  scrollToItem(index, behavior = 'smooth') {
    if (index < 0 || index >= this.items.length) return;

    const position = this.calculateItemPosition(index);
    this.container.scrollTo({
      top: position,
      behavior
    });
  }

  /**
   * Scroll to top
   */
  scrollToTop(behavior = 'smooth') {
    this.container.scrollTo({
      top: 0,
      behavior
    });
  }

  /**
   * Get visible items information
   */
  getVisibleItems() {
    return {
      startIndex: this.startIndex,
      endIndex: this.endIndex,
      count: this.endIndex - this.startIndex,
      items: this.items.slice(this.startIndex, this.endIndex)
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      totalItems: this.items.length,
      visibleItems: this.visibleItems.size,
      scrollTop: this.scrollTop,
      containerHeight: this.containerHeight,
      totalHeight: this.totalHeight,
      isScrolling: this.scrollPerformance.isScrolling,
      lastScrollTime: this.scrollPerformance.lastScrollTime
    };
  }

  /**
   * Debounce function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Destroy the virtual scroller
   */
  destroy() {
    // Remove event listeners
    this.container.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleWindowResize);

    // Disconnect observers
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Clear visible items
    this.visibleItems.clear();

    // Remove DOM elements
    if (this.viewport && this.viewport.parentNode) {
      this.viewport.parentNode.removeChild(this.viewport);
    }
    if (this.spacer && this.spacer.parentNode) {
      this.spacer.parentNode.removeChild(this.spacer);
    }

    // Cancel any pending animation frames
    if (this.scrollPerformance.frameId) {
      cancelAnimationFrame(this.scrollPerformance.frameId);
    }
  }
}

export { VirtualScroller };