// background/services/ImageLoader.js
/**
 * Progressive image loading service with WebP/AVIF support
 */

class ImageLoader {
  constructor() {
    this.cache = new Map();
    this.loadingQueue = new Set();
    this.maxConcurrentLoads = 6;
    this.currentLoads = 0;
    this.supportedFormats = null;
    this.checkFormatSupport();
  }

  /**
   * Check browser support for modern image formats
   */
  async checkFormatSupport() {
    this.supportedFormats = {
      webp: await this.checkImageFormat('data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='),
      avif: await this.checkImageFormat('data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEAwgMg8f8D///8WfhwB8+ErK42A='),
      jpeg: true, // Always supported
      png: true   // Always supported
    };
  }

  /**
   * Check if image format is supported
   */
  checkImageFormat(dataUri) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = dataUri;
    });
  }

  /**
   * Get optimal image format based on browser support
   */
  getOptimalFormat(originalUrl) {
    if (!this.supportedFormats) return originalUrl;

    // If URL already has a format, check if we can optimize it
    const url = new URL(originalUrl);
    const path = url.pathname.toLowerCase();
    
    // For APIs that support format conversion, add format parameter
    if (this.supportsFormatConversion(url.hostname)) {
      if (this.supportedFormats.avif) {
        url.searchParams.set('format', 'avif');
      } else if (this.supportedFormats.webp) {
        url.searchParams.set('format', 'webp');
      }
      return url.toString();
    }

    return originalUrl;
  }

  /**
   * Check if the host supports format conversion
   */
  supportsFormatConversion(hostname) {
    const convertibleHosts = [
      'images.unsplash.com',
      'cdn.pixabay.com',
      'images.pexels.com',
      // Add other hosts that support format conversion
    ];
    
    return convertibleHosts.some(host => hostname.includes(host));
  }

  /**
   * Create multiple size variants for responsive loading
   */
  createSizeVariants(originalUrl, sizes = [400, 800, 1200, 1600]) {
    const variants = [];
    
    for (const size of sizes) {
      const url = this.addSizeParameter(originalUrl, size);
      if (url !== originalUrl) {
        variants.push({
          url,
          width: size,
          media: `(max-width: ${size}px)`
        });
      }
    }
    
    // Add original as fallback
    variants.push({
      url: originalUrl,
      width: 'original',
      media: null
    });
    
    return variants;
  }

  /**
   * Add size parameter to URL if supported
   */
  addSizeParameter(url, size) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Different APIs have different size parameter formats
      if (hostname.includes('unsplash.com')) {
        urlObj.searchParams.set('w', size);
      } else if (hostname.includes('pixabay.com')) {
        urlObj.searchParams.set('w', size);
      } else if (hostname.includes('pexels.com')) {
        urlObj.searchParams.set('w', size);
      } else if (hostname.includes('images.unsplash.com')) {
        // Unsplash supports direct URL manipulation
        return url.replace(/(\?.*)?$/, `?w=${size}&q=80&fm=webp&fit=max`);
      }
      
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * Load image with progressive enhancement
   */
  async loadImage(originalUrl, options = {}) {
    const {
      sizes = [400, 800, 1200],
      quality = 80,
      placeholder = true,
      onProgress = null,
      timeout = 10000
    } = options;

    // Check cache first
    const cacheKey = `${originalUrl}:${JSON.stringify(options)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Add to loading queue if not already loading
    if (this.loadingQueue.has(cacheKey)) {
      return this.waitForLoad(cacheKey);
    }

    this.loadingQueue.add(cacheKey);

    try {
      const result = await this.performLoad(originalUrl, options);
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      this.loadingQueue.delete(cacheKey);
    }
  }

  /**
   * Wait for an image that's already being loaded
   */
  async waitForLoad(cacheKey) {
    while (this.loadingQueue.has(cacheKey)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.cache.get(cacheKey);
  }

  /**
   * Perform the actual image loading
   */
  async performLoad(originalUrl, options) {
    const { timeout = 10000, onProgress } = options;

    // Wait for available slot
    await this.waitForLoadSlot();
    this.currentLoads++;

    try {
      // Get optimal format
      const optimizedUrl = this.getOptimalFormat(originalUrl);
      
      // Create size variants
      const variants = this.createSizeVariants(optimizedUrl, options.sizes);
      
      // Generate placeholder if requested
      let placeholder = null;
      if (options.placeholder) {
        placeholder = await this.generatePlaceholder(optimizedUrl);
      }

      // Load the primary image
      const primaryImage = await this.loadSingleImage(variants[0].url, timeout, onProgress);
      
      return {
        primaryUrl: variants[0].url,
        originalUrl,
        variants,
        placeholder,
        metadata: {
          width: primaryImage.naturalWidth,
          height: primaryImage.naturalHeight,
          aspectRatio: primaryImage.naturalWidth / primaryImage.naturalHeight,
          loadTime: primaryImage.loadTime,
          format: this.detectImageFormat(variants[0].url)
        }
      };
    } finally {
      this.currentLoads--;
    }
  }

  /**
   * Wait for an available loading slot
   */
  async waitForLoadSlot() {
    while (this.currentLoads >= this.maxConcurrentLoads) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Load a single image with timeout
   */
  loadSingleImage(url, timeout, onProgress) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const startTime = performance.now();
      
      const timeoutId = setTimeout(() => {
        reject(new Error(`Image load timeout: ${url}`));
      }, timeout);

      img.onload = () => {
        clearTimeout(timeoutId);
        img.loadTime = performance.now() - startTime;
        resolve(img);
      };

      img.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to load image: ${url}`));
      };

      // Track progress if possible
      if (onProgress && img.addEventListener) {
        img.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            onProgress(progress);
          }
        });
      }

      img.src = url;
    });
  }

  /**
   * Generate a placeholder image
   */
  async generatePlaceholder(url) {
    try {
      // Create a small blurred version
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 20;
      canvas.height = 20;

      const img = await this.loadSingleImage(url, 5000);
      
      // Draw scaled down version
      ctx.filter = 'blur(2px)';
      ctx.drawImage(img, 0, 0, 20, 20);
      
      return canvas.toDataURL('image/jpeg', 0.3);
    } catch {
      // Fallback: generate a solid color placeholder
      return this.generateColorPlaceholder();
    }
  }

  /**
   * Generate a solid color placeholder
   */
  generateColorPlaceholder(color = '#f0f0f0') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 20;
    canvas.height = 20;
    
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 20, 20);
    
    return canvas.toDataURL();
  }

  /**
   * Detect image format from URL
   */
  detectImageFormat(url) {
    const path = url.toLowerCase();
    if (path.includes('.webp') || path.includes('format=webp')) return 'webp';
    if (path.includes('.avif') || path.includes('format=avif')) return 'avif';
    if (path.includes('.png')) return 'png';
    if (path.includes('.gif')) return 'gif';
    return 'jpeg';
  }

  /**
   * Preload images for better performance
   */
  async preloadImages(urls, options = {}) {
    const { maxConcurrent = 3, priority = 'low' } = options;
    const results = [];
    
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(url => 
        this.loadImage(url, { ...options, placeholder: false })
          .catch(error => ({ url, error }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Create a responsive image element
   */
  createResponsiveImage(imageData, options = {}) {
    const {
      className = '',
      alt = '',
      loading = 'lazy',
      sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
    } = options;

    const img = document.createElement('img');
    img.className = className;
    img.alt = alt;
    img.loading = loading;

    // Set up srcset for responsive loading
    if (imageData.variants && imageData.variants.length > 1) {
      const srcset = imageData.variants
        .filter(v => v.width !== 'original')
        .map(v => `${v.url} ${v.width}w`)
        .join(', ');
      
      img.srcset = srcset;
      img.sizes = sizes;
    }

    // Set primary source
    img.src = imageData.primaryUrl;

    // Add placeholder while loading
    if (imageData.placeholder) {
      img.style.backgroundImage = `url(${imageData.placeholder})`;
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
    }

    return img;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      currentLoads: this.currentLoads,
      queueSize: this.loadingQueue.size,
      supportedFormats: this.supportedFormats,
      memoryUsage: this.estimateCacheMemoryUsage()
    };
  }

  /**
   * Estimate memory usage of image cache
   */
  estimateCacheMemoryUsage() {
    let totalSize = 0;
    
    for (const [key, data] of this.cache) {
      // Rough estimation based on key and data structure
      totalSize += key.length * 2; // key size
      totalSize += JSON.stringify(data).length * 2; // data size
    }
    
    return {
      bytes: totalSize,
      kb: (totalSize / 1024).toFixed(2),
      mb: (totalSize / (1024 * 1024)).toFixed(2)
    };
  }

  /**
   * Clear the image cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Remove expired entries from cache
   */
  cleanupCache(maxAge = 30 * 60 * 1000) { // 30 minutes
    const now = Date.now();
    const toDelete = [];
    
    for (const [key, data] of this.cache) {
      if (data.timestamp && (now - data.timestamp > maxAge)) {
        toDelete.push(key);
      }
    }
    
    toDelete.forEach(key => this.cache.delete(key));
    return toDelete.length;
  }
}

// Export singleton instance
export const imageLoader = new ImageLoader();