// components/skeletonLoader.js - Loading state components for hiREZZIE
export class SkeletonLoader {
  constructor(options = {}) {
    this.animationDuration = options.animationDuration || 1500;
    this.shimmerColor = options.shimmerColor || 'rgba(255, 255, 255, 0.1)';
    this.backgroundColor = options.backgroundColor || 'rgba(255, 255, 255, 0.05)';
    this.borderRadius = options.borderRadius || '8px';
  }

  // Create skeleton CSS for animations
  createSkeletonStyles() {
    const styleId = 'skeleton-loader-styles';
    if (document.getElementById(styleId)) return; // Already exists

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes skeleton-shimmer {
        0% {
          background-position: -200px 0;
        }
        100% {
          background-position: calc(200px + 100%) 0;
        }
      }

      .skeleton {
        background: ${this.backgroundColor};
        background-image: linear-gradient(
          90deg,
          ${this.backgroundColor} 0px,
          ${this.shimmerColor} 40px,
          ${this.backgroundColor} 80px
        );
        background-size: 200px 100%;
        background-repeat: no-repeat;
        border-radius: ${this.borderRadius};
        animation: skeleton-shimmer ${this.animationDuration}ms ease-in-out infinite;
      }

      .skeleton-image {
        width: 100%;
        height: 100%;
        background: ${this.backgroundColor};
        background-image: linear-gradient(
          90deg,
          ${this.backgroundColor} 0px,
          ${this.shimmerColor} 40px,
          ${this.backgroundColor} 80px
        );
        background-size: 200px 100%;
        background-repeat: no-repeat;
        border-radius: ${this.borderRadius};
        animation: skeleton-shimmer ${this.animationDuration}ms ease-in-out infinite;
        position: relative;
      }

      .skeleton-image::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 40px;
        height: 40px;
        background: ${this.shimmerColor};
        border-radius: 4px;
        opacity: 0.3;
      }

      .skeleton-text {
        height: 16px;
        margin: 8px 0;
        background: ${this.backgroundColor};
        background-image: linear-gradient(
          90deg,
          ${this.backgroundColor} 0px,
          ${this.shimmerColor} 40px,
          ${this.backgroundColor} 80px
        );
        background-size: 200px 100%;
        background-repeat: no-repeat;
        border-radius: 4px;
        animation: skeleton-shimmer ${this.animationDuration}ms ease-in-out infinite;
      }

      .skeleton-text--short { width: 60%; }
      .skeleton-text--medium { width: 80%; }
      .skeleton-text--long { width: 100%; }

      .skeleton-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }

      .skeleton-card {
        background: rgba(0, 0, 0, 0.3);
        border-radius: ${this.borderRadius};
        padding: 16px;
        backdrop-filter: blur(10px);
      }

      .skeleton-fade-in {
        opacity: 0;
        animation: skeleton-fade-in 0.3s ease-in-out forwards;
      }

      @keyframes skeleton-fade-in {
        to { opacity: 1; }
      }

      .skeleton-fade-out {
        animation: skeleton-fade-out 0.3s ease-in-out forwards;
      }

      @keyframes skeleton-fade-out {
        to { opacity: 0; }
      }

      /* Responsive skeleton grid */
      @media (max-width: 768px) {
        .skeleton-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (min-width: 1200px) {
        .skeleton-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
    `;

    document.head.appendChild(style);
  }

  // Create a skeleton placeholder element
  createSkeleton(type = 'image', options = {}) {
    this.createSkeletonStyles();

    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-fade-in';

    switch (type) {
      case 'image':
        return this._createImageSkeleton(skeleton, options);
      case 'text':
        return this._createTextSkeleton(skeleton, options);
      case 'card':
        return this._createCardSkeleton(skeleton, options);
      case 'search':
        return this._createSearchSkeleton(skeleton, options);
      case 'grid':
        return this._createGridSkeleton(skeleton, options);
      default:
        skeleton.className = 'skeleton';
        return skeleton;
    }
  }

  _createImageSkeleton(skeleton, options) {
    const width = options.width || '100%';
    const height = options.height || '200px';
    const aspectRatio = options.aspectRatio || null;

    skeleton.style.width = width;
    skeleton.style.height = aspectRatio ? 'auto' : height;
    if (aspectRatio) {
      skeleton.style.aspectRatio = aspectRatio;
    }
    skeleton.className += ' skeleton-image';

    return skeleton;
  }

  _createTextSkeleton(skeleton, options) {
    const lines = options.lines || 1;
    const width = options.width || '100%';
    const height = options.height || '16px';

    skeleton.style.width = width;

    if (lines === 1) {
      skeleton.className += ' skeleton-text';
      skeleton.style.height = height;
      if (options.variant) {
        skeleton.className += ` skeleton-text--${options.variant}`;
      }
    } else {
      skeleton.style.display = 'flex';
      skeleton.style.flexDirection = 'column';
      skeleton.style.gap = '8px';

      for (let i = 0; i < lines; i++) {
        const line = document.createElement('div');
        line.className = 'skeleton-text';
        line.style.height = height;

        // Vary line widths for more natural look
        if (i === lines - 1 && lines > 1) {
          line.className += ' skeleton-text--short';
        }

        skeleton.appendChild(line);
      }
    }

    return skeleton;
  }

  _createCardSkeleton(skeleton, options) {
    const imageHeight = options.imageHeight || '200px';
    const includeTitle = options.includeTitle !== false;
    const includeDescription = options.includeDescription !== false;

    skeleton.className += ' skeleton-card';

    // Image skeleton
    const imageSkeleton = this._createImageSkeleton(document.createElement('div'), {
      height: imageHeight
    });
    skeleton.appendChild(imageSkeleton);

    // Content area
    const content = document.createElement('div');
    content.style.padding = '16px 0 0 0';

    if (includeTitle) {
      const title = this._createTextSkeleton(document.createElement('div'), {
        height: '20px',
        variant: 'medium'
      });
      content.appendChild(title);
    }

    if (includeDescription) {
      const description = this._createTextSkeleton(document.createElement('div'), {
        lines: 2,
        height: '14px'
      });
      content.appendChild(description);
    }

    skeleton.appendChild(content);
    return skeleton;
  }

  _createSearchSkeleton(skeleton, options) {
    const showTimer = options.showTimer !== false;
    const showProgress = options.showProgress !== false;

    skeleton.style.textAlign = 'center';
    skeleton.style.padding = '40px 20px';

    // Search icon skeleton
    const icon = document.createElement('div');
    icon.className = 'skeleton';
    icon.style.width = '48px';
    icon.style.height = '48px';
    icon.style.borderRadius = '50%';
    icon.style.margin = '0 auto 20px auto';
    skeleton.appendChild(icon);

    // Loading text
    const text = this._createTextSkeleton(document.createElement('div'), {
      width: '200px',
      height: '18px'
    });
    text.style.margin = '0 auto';
    skeleton.appendChild(text);

    if (showTimer) {
      // Timer skeleton
      const timer = this._createTextSkeleton(document.createElement('div'), {
        width: '80px',
        height: '14px',
        variant: 'short'
      });
      timer.style.margin = '12px auto';
      skeleton.appendChild(timer);
    }

    if (showProgress) {
      // Progress bar skeleton
      const progress = document.createElement('div');
      progress.className = 'skeleton';
      progress.style.width = '60%';
      progress.style.height = '4px';
      progress.style.margin = '20px auto';
      progress.style.borderRadius = '2px';
      skeleton.appendChild(progress);
    }

    return skeleton;
  }

  _createGridSkeleton(skeleton, options) {
    const count = options.count || 9;
    const columns = options.columns || 3;
    const cardOptions = options.cardOptions || {};

    skeleton.className += ' skeleton-grid';
    
    // Override grid columns if specified
    if (columns) {
      skeleton.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    }

    for (let i = 0; i < count; i++) {
      const card = this._createCardSkeleton(document.createElement('div'), cardOptions);
      // Stagger the animation slightly for each card
      card.style.animationDelay = `${i * 100}ms`;
      skeleton.appendChild(card);
    }

    return skeleton;
  }

  // Create a skeleton that matches specific content
  createMatchingSkeleton(element) {
    const rect = element.getBoundingClientRect();
    const skeleton = this.createSkeleton('image', {
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });

    // Copy positioning
    skeleton.style.position = 'absolute';
    skeleton.style.top = `${rect.top}px`;
    skeleton.style.left = `${rect.left}px`;
    skeleton.style.zIndex = '1000';

    return skeleton;
  }

  // Show loading state with skeleton
  showLoading(container, type = 'grid', options = {}) {
    this.hideLoading(container); // Clear any existing loading state

    const skeleton = this.createSkeleton(type, options);
    skeleton.dataset.skeletonLoader = 'true';
    
    container.appendChild(skeleton);
    return skeleton;
  }

  // Hide loading state
  hideLoading(container) {
    const skeletons = container.querySelectorAll('[data-skeleton-loader="true"]');
    skeletons.forEach(skeleton => {
      skeleton.classList.add('skeleton-fade-out');
      setTimeout(() => {
        if (skeleton.parentNode) {
          skeleton.parentNode.removeChild(skeleton);
        }
      }, 300);
    });
  }

  // Replace skeleton with actual content
  replaceWithContent(skeleton, content) {
    if (!skeleton || !content) return;

    // Fade out skeleton
    skeleton.classList.add('skeleton-fade-out');
    
    // Prepare content
    content.style.opacity = '0';
    content.classList.add('skeleton-fade-in');

    // Insert content
    skeleton.parentNode.insertBefore(content, skeleton);

    // Animate transition
    setTimeout(() => {
      content.style.opacity = '1';
      if (skeleton.parentNode) {
        skeleton.parentNode.removeChild(skeleton);
      }
    }, 150);
  }

  // Create a skeleton that reveals content progressively
  createProgressiveSkeleton(container, itemCount = 9) {
    const skeleton = this.createSkeleton('grid', { count: itemCount });
    container.appendChild(skeleton);

    let revealedCount = 0;
    const cards = skeleton.querySelectorAll('.skeleton-card');

    const revealNext = () => {
      if (revealedCount < cards.length) {
        const card = cards[revealedCount];
        card.classList.add('skeleton-fade-out');
        
        setTimeout(() => {
          if (card.parentNode) {
            card.parentNode.removeChild(card);
          }
        }, 300);

        revealedCount++;
      }
    };

    return { skeleton, revealNext };
  }
}

// Global skeleton loader instance
export const skeletonLoader = new SkeletonLoader();

// Utility functions
export function showImageGridSkeleton(container, count = 9, columns = 3) {
  return skeletonLoader.showLoading(container, 'grid', {
    count,
    columns,
    cardOptions: {
      imageHeight: '200px',
      includeTitle: true,
      includeDescription: false
    }
  });
}

export function showSearchSkeleton(container) {
  return skeletonLoader.showLoading(container, 'search', {
    showTimer: true,
    showProgress: true
  });
}

export function hideAllSkeletons(container) {
  skeletonLoader.hideLoading(container);
}

// React-like component for creating skeletons
export function createSkeletonComponent(type, props = {}) {
  const skeleton = skeletonLoader.createSkeleton(type, props);
  
  return {
    element: skeleton,
    show() {
      skeleton.classList.add('skeleton-fade-in');
    },
    hide() {
      skeleton.classList.add('skeleton-fade-out');
      setTimeout(() => {
        if (skeleton.parentNode) {
          skeleton.parentNode.removeChild(skeleton);
        }
      }, 300);
    },
    replaceWith(content) {
      skeletonLoader.replaceWithContent(skeleton, content);
    }
  };
}

// Higher-order function for loading states
export function withSkeleton(asyncFunction, skeletonType = 'image', skeletonOptions = {}) {
  return async function(container, ...args) {
    const skeleton = skeletonLoader.showLoading(container, skeletonType, skeletonOptions);
    
    try {
      const result = await asyncFunction.apply(this, args);
      skeletonLoader.hideLoading(container);
      return result;
    } catch (error) {
      skeletonLoader.hideLoading(container);
      throw error;
    }
  };
}