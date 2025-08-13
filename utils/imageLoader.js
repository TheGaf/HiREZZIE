// utils/imageLoader.js - Optimized image handling for hiREZZIE
import { imageCache } from './cache.js';
import { telemetry } from './telemetry.js';

export class ImageLoader {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 6;
    this.timeout = options.timeout || 15000;
    this.retryAttempts = options.retryAttempts || 2;
    this.retryDelay = options.retryDelay || 1000;
    
    this.activeRequests = new Set();
    this.requestQueue = [];
    this.abortController = new AbortController();
  }

  // Load image with optimization and caching
  async loadImage(url, options = {}) {
    const cached = this._getCachedImageInfo(url);
    if (cached && !options.skipCache) {
      telemetry.trackCacheOperation('image_load', true);
      return cached;
    }

    telemetry.trackCacheOperation('image_load', false);
    
    return this._loadImageWithRetry(url, options);
  }

  _getCachedImageInfo(url) {
    const cacheKey = imageCache.constructor.getImageKey(url);
    return imageCache.get(cacheKey);
  }

  _setCachedImageInfo(url, info) {
    const cacheKey = imageCache.constructor.getImageKey(url);
    imageCache.set(cacheKey, info, 1800000); // 30 minutes
  }

  async _loadImageWithRetry(url, options, attempt = 0) {
    try {
      return await this._loadImageInternal(url, options);
    } catch (error) {
      if (attempt < this.retryAttempts && this._isRetryableError(error)) {
        console.log(`[ImageLoader] Retrying ${url} (attempt ${attempt + 1}/${this.retryAttempts})`);
        await this._delay(this.retryDelay * Math.pow(2, attempt)); // Exponential backoff
        return this._loadImageWithRetry(url, options, attempt + 1);
      }
      throw error;
    }
  }

  async _loadImageInternal(url, options) {
    const startTime = Date.now();
    
    // Wait for available slot
    await this._waitForSlot();
    
    const requestId = this._generateRequestId();
    this.activeRequests.add(requestId);
    
    try {
      // HEAD request to validate image
      const headInfo = await this._headCheck(url);
      
      if (!this._isValidImage(headInfo)) {
        throw new Error(`Invalid image: ${headInfo.contentType || 'unknown type'}`);
      }

      // Load the actual image for dimensions if needed
      let dimensions = null;
      if (options.loadDimensions) {
        dimensions = await this._getImageDimensions(url);
      }

      const imageInfo = {
        url,
        contentType: headInfo.contentType,
        contentLength: headInfo.contentLength,
        lastModified: headInfo.lastModified,
        dimensions,
        validated: true,
        timestamp: Date.now()
      };

      this._setCachedImageInfo(url, imageInfo);
      
      const loadTime = Date.now() - startTime;
      telemetry.trackImageLoad(url, true, loadTime, headInfo.contentLength);
      
      return imageInfo;
    } catch (error) {
      const loadTime = Date.now() - startTime;
      telemetry.trackImageLoad(url, false, loadTime);
      throw error;
    } finally {
      this.activeRequests.delete(requestId);
      this._processQueue();
    }
  }

  async _headCheck(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        referrerPolicy: 'no-referrer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; hiREZZIE/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        contentType: response.headers.get('content-type'),
        contentLength: parseInt(response.headers.get('content-length')) || null,
        lastModified: response.headers.get('last-modified'),
        status: response.status
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _isValidImage(headInfo) {
    const { contentType, contentLength } = headInfo;
    
    // Check content type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (!contentType || !validTypes.some(type => contentType.toLowerCase().includes(type))) {
      return false;
    }

    // Check minimum file size (150KB)
    if (contentLength !== null && contentLength < 150000) {
      return false;
    }

    return true;
  }

  async _getImageDimensions(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
      };
      
      img.onload = () => {
        cleanup();
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          aspectRatio: img.naturalWidth / img.naturalHeight
        });
      };
      
      img.onerror = () => {
        cleanup();
        reject(new Error('Failed to load image for dimensions'));
      };
      
      // Set timeout
      setTimeout(() => {
        cleanup();
        reject(new Error('Image dimension loading timeout'));
      }, this.timeout);
      
      img.src = url;
    });
  }

  async _waitForSlot() {
    if (this.activeRequests.size < this.maxConcurrent) {
      return;
    }

    return new Promise(resolve => {
      this.requestQueue.push(resolve);
    });
  }

  _processQueue() {
    if (this.requestQueue.length > 0 && this.activeRequests.size < this.maxConcurrent) {
      const resolve = this.requestQueue.shift();
      resolve();
    }
  }

  _generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _isRetryableError(error) {
    if (error.name === 'AbortError') return false;
    if (error.message && error.message.includes('Invalid image')) return false;
    return true;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Batch image validation
  async validateImages(urls, options = {}) {
    const batchSize = options.batchSize || 10;
    const results = [];
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchPromises = batch.map(url => 
        this.loadImage(url, options).catch(error => ({
          url,
          error: error.message,
          valid: false
        }))
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(result => 
        result.status === 'fulfilled' ? result.value : result.reason
      ));
      
      // Small delay between batches to avoid overwhelming
      if (i + batchSize < urls.length) {
        await this._delay(100);
      }
    }
    
    return results;
  }

  // Preload images for better UX
  preloadImages(urls, priority = 'low') {
    return Promise.allSettled(
      urls.map(url => this.loadImage(url, { priority }))
    );
  }

  // Cancel all pending requests
  cancelAll() {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.activeRequests.clear();
    this.requestQueue.forEach(resolve => resolve());
    this.requestQueue = [];
  }

  // Get loader statistics
  getStats() {
    return {
      activeRequests: this.activeRequests.size,
      queuedRequests: this.requestQueue.length,
      maxConcurrent: this.maxConcurrent,
      cacheStats: imageCache.getStats()
    };
  }
}

// Progressive image loading with intersection observer
export class LazyImageLoader {
  constructor(options = {}) {
    this.imageLoader = new ImageLoader(options);
    this.threshold = options.threshold || 0.1;
    this.rootMargin = options.rootMargin || '50px';
    this.placeholderClass = options.placeholderClass || 'image-placeholder';
    this.loadedClass = options.loadedClass || 'image-loaded';
    
    this.observer = null;
    this.observedImages = new WeakMap();
    this._initObserver();
  }

  _initObserver() {
    if (!('IntersectionObserver' in window)) {
      console.warn('[LazyImageLoader] IntersectionObserver not supported');
      return;
    }

    this.observer = new IntersectionObserver(
      this._handleIntersection.bind(this),
      {
        threshold: this.threshold,
        rootMargin: this.rootMargin
      }
    );
  }

  async _handleIntersection(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        const imageData = this.observedImages.get(img);
        
        if (imageData && !imageData.loading) {
          await this._loadImage(img, imageData);
        }
      }
    }
  }

  async _loadImage(img, imageData) {
    imageData.loading = true;
    
    try {
      // Show skeleton/placeholder
      img.classList.add(this.placeholderClass);
      
      // Validate image first
      const imageInfo = await this.imageLoader.loadImage(imageData.src);
      
      // Load the actual image
      await this._loadImageElement(img, imageData.src);
      
      // Image loaded successfully
      img.classList.remove(this.placeholderClass);
      img.classList.add(this.loadedClass);
      
      // Store image info for later use
      img.dataset.imageInfo = JSON.stringify(imageInfo);
      
      // Stop observing this image
      this.observer.unobserve(img);
      this.observedImages.delete(img);
      
    } catch (error) {
      console.warn(`[LazyImageLoader] Failed to load image: ${imageData.src}`, error);
      img.classList.remove(this.placeholderClass);
      img.classList.add('image-error');
      
      // Show error placeholder
      this._showErrorPlaceholder(img);
    }
  }

  _loadImageElement(img, src) {
    return new Promise((resolve, reject) => {
      const tempImg = new Image();
      
      tempImg.onload = () => {
        img.src = src;
        img.style.opacity = '0';
        
        // Fade in animation
        requestAnimationFrame(() => {
          img.style.transition = 'opacity 0.3s ease-in-out';
          img.style.opacity = '1';
          resolve();
        });
      };
      
      tempImg.onerror = reject;
      tempImg.src = src;
    });
  }

  _showErrorPlaceholder(img) {
    img.src = 'data:image/svg+xml;base64,' + btoa(`
      <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#1a1a1a"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#666" font-family="Arial" font-size="14">
          Image unavailable
        </text>
      </svg>
    `);
  }

  // Observe an image for lazy loading
  observe(img, src, options = {}) {
    if (!this.observer) {
      // Fallback: load immediately
      img.src = src;
      return;
    }

    this.observedImages.set(img, {
      src,
      loading: false,
      ...options
    });
    
    this.observer.observe(img);
  }

  // Stop observing all images
  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.imageLoader.cancelAll();
  }
}

// Global instances
export const imageLoader = new ImageLoader();
export const lazyImageLoader = new LazyImageLoader();

// Utility functions
export async function validateImageUrl(url) {
  try {
    const imageInfo = await imageLoader.loadImage(url);
    return {
      valid: true,
      ...imageInfo
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      url
    };
  }
}

export function createImageElement(src, alt = '', options = {}) {
  const img = document.createElement('img');
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  
  if (options.className) {
    img.className = options.className;
  }
  
  if (options.lazy !== false) {
    lazyImageLoader.observe(img, src, options);
  } else {
    img.src = src;
  }
  
  return img;
}

export function preloadCriticalImages(urls) {
  return imageLoader.preloadImages(urls.slice(0, 6)); // Preload first 6 images
}