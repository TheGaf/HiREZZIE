// components/virtualScroller.js - Efficient virtual scrolling for large image lists
export class VirtualScroller {
  constructor(container, options = {}) {
    this.container = container;
    this.itemHeight = options.itemHeight || 200;
    this.buffer = options.buffer || 5; // Extra items to render outside viewport
    this.threshold = options.threshold || 0.8; // Load more threshold
    this.batchSize = options.batchSize || 20;
    
    this.items = [];
    this.visibleItems = [];
    this.startIndex = 0;
    this.endIndex = 0;
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.totalHeight = 0;
    
    this.onLoadMore = options.onLoadMore;
    this.onItemRender = options.onItemRender;
    this.onItemVisible = options.onItemVisible;
    
    this._setupContainer();
    this._setupScrollListener();
    this._setupIntersectionObserver();
  }

  _setupContainer() {
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';
    
    // Create viewport for rendered items
    this.viewport = document.createElement('div');
    this.viewport.style.position = 'relative';
    this.viewport.style.width = '100%';
    this.container.appendChild(this.viewport);
    
    // Create spacer to maintain scroll height
    this.spacer = document.createElement('div');
    this.spacer.style.position = 'absolute';
    this.spacer.style.top = '0';
    this.spacer.style.left = '0';
    this.spacer.style.right = '0';
    this.spacer.style.pointerEvents = 'none';
    this.container.appendChild(this.spacer);
  }

  _setupScrollListener() {
    let ticking = false;
    
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this._updateVisibleItems();
          this._checkLoadMore();
          ticking = false;
        });
        ticking = true;
      }
    };

    this.container.addEventListener('scroll', handleScroll, { passive: true });
    
    // Also listen for resize
    const resizeObserver = new ResizeObserver(() => {
      this._updateDimensions();
      this._updateVisibleItems();
    });
    
    resizeObserver.observe(this.container);
  }

  _setupIntersectionObserver() {
    if (!('IntersectionObserver' in window)) return;
    
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && this.onItemVisible) {
            const index = parseInt(entry.target.dataset.index);
            if (!isNaN(index)) {
              this.onItemVisible(this.items[index], index);
            }
          }
        });
      },
      {
        root: this.container,
        threshold: 0.1
      }
    );
  }

  _updateDimensions() {
    this.containerHeight = this.container.clientHeight;
    this.scrollTop = this.container.scrollTop;
    this.totalHeight = this.items.length * this.itemHeight;
    
    // Update spacer height
    this.spacer.style.height = `${this.totalHeight}px`;
  }

  _updateVisibleItems() {
    this._updateDimensions();
    
    const startIndex = Math.max(0, 
      Math.floor(this.scrollTop / this.itemHeight) - this.buffer
    );
    
    const endIndex = Math.min(this.items.length - 1,
      Math.floor((this.scrollTop + this.containerHeight) / this.itemHeight) + this.buffer
    );

    if (startIndex === this.startIndex && endIndex === this.endIndex) {
      return; // No change needed
    }

    this.startIndex = startIndex;
    this.endIndex = endIndex;
    
    this._renderVisibleItems();
  }

  _renderVisibleItems() {
    // Clear existing items
    this._clearRenderedItems();
    
    // Create new visible items
    this.visibleItems = [];
    
    for (let i = this.startIndex; i <= this.endIndex; i++) {
      if (i >= this.items.length) break;
      
      const item = this.items[i];
      const element = this._createItemElement(item, i);
      
      if (element) {
        this.visibleItems.push({ element, index: i });
        this.viewport.appendChild(element);
        
        // Observe for intersection
        if (this.intersectionObserver) {
          this.intersectionObserver.observe(element);
        }
      }
    }
  }

  _createItemElement(item, index) {
    const element = document.createElement('div');
    element.style.position = 'absolute';
    element.style.top = `${index * this.itemHeight}px`;
    element.style.height = `${this.itemHeight}px`;
    element.style.width = '100%';
    element.style.boxSizing = 'border-box';
    element.dataset.index = index;
    
    // Let the caller customize the element
    if (this.onItemRender) {
      this.onItemRender(element, item, index);
    }
    
    return element;
  }

  _clearRenderedItems() {
    // Remove from intersection observer
    if (this.intersectionObserver) {
      this.visibleItems.forEach(({ element }) => {
        this.intersectionObserver.unobserve(element);
      });
    }
    
    // Remove elements
    this.viewport.innerHTML = '';
    this.visibleItems = [];
  }

  _checkLoadMore() {
    if (!this.onLoadMore) return;
    
    const scrollPercent = (this.scrollTop + this.containerHeight) / this.totalHeight;
    
    if (scrollPercent > this.threshold) {
      this.onLoadMore();
    }
  }

  // Public methods
  setItems(items) {
    this.items = items;
    this._updateDimensions();
    this._updateVisibleItems();
  }

  addItems(newItems) {
    this.items.push(...newItems);
    this._updateDimensions();
    this._updateVisibleItems();
  }

  insertItems(index, newItems) {
    this.items.splice(index, 0, ...newItems);
    this._updateDimensions();
    this._updateVisibleItems();
  }

  removeItem(index) {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      this._updateDimensions();
      this._updateVisibleItems();
    }
  }

  updateItem(index, newItem) {
    if (index >= 0 && index < this.items.length) {
      this.items[index] = newItem;
      
      // Re-render if currently visible
      const visibleItem = this.visibleItems.find(vi => vi.index === index);
      if (visibleItem && this.onItemRender) {
        visibleItem.element.innerHTML = '';
        this.onItemRender(visibleItem.element, newItem, index);
      }
    }
  }

  scrollToIndex(index, behavior = 'smooth') {
    const targetTop = index * this.itemHeight;
    this.container.scrollTo({
      top: targetTop,
      behavior
    });
  }

  scrollToTop(behavior = 'smooth') {
    this.container.scrollTo({
      top: 0,
      behavior
    });
  }

  getVisibleRange() {
    return {
      start: this.startIndex,
      end: this.endIndex,
      count: this.endIndex - this.startIndex + 1
    };
  }

  getScrollPosition() {
    return {
      top: this.scrollTop,
      percentage: this.totalHeight > 0 ? (this.scrollTop / (this.totalHeight - this.containerHeight)) * 100 : 0
    };
  }

  refresh() {
    this._updateDimensions();
    this._updateVisibleItems();
  }

  destroy() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    
    this._clearRenderedItems();
    this.container.innerHTML = '';
  }
}

// Grid-based virtual scroller for image galleries
export class VirtualImageGrid extends VirtualScroller {
  constructor(container, options = {}) {
    const gridOptions = {
      ...options,
      itemHeight: options.rowHeight || 250,
      buffer: options.buffer || 2 // Rows to buffer
    };
    
    super(container, gridOptions);
    
    this.columns = options.columns || 3;
    this.gap = options.gap || 16;
    this.itemsPerRow = this.columns;
    this.rowHeight = gridOptions.itemHeight;
    
    this._setupGridContainer();
  }

  _setupGridContainer() {
    this.viewport.style.display = 'grid';
    this.viewport.style.gridTemplateColumns = `repeat(${this.columns}, 1fr)`;
    this.viewport.style.gap = `${this.gap}px`;
    this.viewport.style.padding = `${this.gap}px`;
  }

  _updateDimensions() {
    this.containerHeight = this.container.clientHeight;
    this.scrollTop = this.container.scrollTop;
    
    // Calculate total rows needed
    this.totalRows = Math.ceil(this.items.length / this.itemsPerRow);
    this.totalHeight = this.totalRows * (this.rowHeight + this.gap);
    
    // Update spacer height
    this.spacer.style.height = `${this.totalHeight}px`;
  }

  _updateVisibleItems() {
    this._updateDimensions();
    
    const startRow = Math.max(0, 
      Math.floor(this.scrollTop / (this.rowHeight + this.gap)) - this.buffer
    );
    
    const endRow = Math.min(this.totalRows - 1,
      Math.floor((this.scrollTop + this.containerHeight) / (this.rowHeight + this.gap)) + this.buffer
    );

    const startIndex = startRow * this.itemsPerRow;
    const endIndex = Math.min(this.items.length - 1, (endRow + 1) * this.itemsPerRow - 1);

    if (startIndex === this.startIndex && endIndex === this.endIndex) {
      return;
    }

    this.startIndex = startIndex;
    this.endIndex = endIndex;
    
    this._renderVisibleRows();
  }

  _renderVisibleRows() {
    this._clearRenderedItems();
    
    // Set grid positioning for visible area
    const startRow = Math.floor(this.startIndex / this.itemsPerRow);
    this.viewport.style.transform = `translateY(${startRow * (this.rowHeight + this.gap)}px)`;
    
    this.visibleItems = [];
    
    for (let i = this.startIndex; i <= this.endIndex; i++) {
      if (i >= this.items.length) break;
      
      const item = this.items[i];
      const element = this._createGridItemElement(item, i);
      
      if (element) {
        this.visibleItems.push({ element, index: i });
        this.viewport.appendChild(element);
        
        if (this.intersectionObserver) {
          this.intersectionObserver.observe(element);
        }
      }
    }
  }

  _createGridItemElement(item, index) {
    const element = document.createElement('div');
    element.style.height = `${this.rowHeight}px`;
    element.style.overflow = 'hidden';
    element.dataset.index = index;
    
    if (this.onItemRender) {
      this.onItemRender(element, item, index);
    }
    
    return element;
  }

  // Update column count (responsive)
  setColumns(columns) {
    this.columns = columns;
    this.itemsPerRow = columns;
    this.viewport.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    this._updateDimensions();
    this._updateVisibleItems();
  }

  // Get current column count
  getColumns() {
    return this.columns;
  }
}

// Utility function to create a responsive virtual grid
export function createResponsiveImageGrid(container, images, options = {}) {
  const defaultOptions = {
    rowHeight: 250,
    gap: 16,
    columns: 3,
    loadMoreThreshold: 0.8,
    ...options
  };

  // Calculate responsive columns
  const getResponsiveColumns = () => {
    const width = container.clientWidth;
    if (width < 768) return 1;
    if (width < 1200) return 2;
    return defaultOptions.columns;
  };

  const grid = new VirtualImageGrid(container, {
    ...defaultOptions,
    columns: getResponsiveColumns(),
    onItemRender: (element, item, index) => {
      if (options.onItemRender) {
        options.onItemRender(element, item, index);
      } else {
        // Default image rendering
        element.innerHTML = `
          <div class="image-card" style="height: 100%; position: relative;">
            <img src="${item.imageUrl}" alt="${item.altText || ''}" 
                 style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;"
                 loading="lazy" decoding="async" referrerpolicy="no-referrer">
            <div class="image-overlay" style="position: absolute; bottom: 0; left: 0; right: 0; 
                 background: linear-gradient(transparent, rgba(0,0,0,0.7)); padding: 12px; 
                 border-radius: 0 0 8px 8px;">
              <div style="color: white; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${item.title || 'Untitled'}
              </div>
            </div>
          </div>
        `;
      }
    }
  });

  // Handle responsive changes
  const resizeObserver = new ResizeObserver(() => {
    const newColumns = getResponsiveColumns();
    if (newColumns !== grid.getColumns()) {
      grid.setColumns(newColumns);
    }
  });
  
  resizeObserver.observe(container);

  // Set initial items
  grid.setItems(images);

  return grid;
}