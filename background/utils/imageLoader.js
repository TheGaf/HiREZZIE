// utils/imageLoader.js - Optimized image loading
export class ImageLoader {
    constructor() {
        this.loadingImages = new Map();
        this.observer = this.createIntersectionObserver();
    }
    
    createIntersectionObserver() {
        return new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    this.loadImage(img);
                    this.observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '50px',
            threshold: 0.1
        });
    }
    
    async loadWithFallbacks(src, fallbacks = []) {
        const sources = [src, ...fallbacks].filter(Boolean);
        
        for (const source of sources) {
            try {
                await this.loadSingleImage(source);
                return source;
            } catch (error) {
                console.warn(`Failed to load image: ${source}`, error);
                continue;
            }
        }
        
        throw new Error('All image sources failed to load');
    }
    
    loadSingleImage(src) {
        if (this.loadingImages.has(src)) {
            return this.loadingImages.get(src);
        }
        
        const promise = new Promise((resolve, reject) => {
            const img = new Image();
            
            const cleanup = () => {
                img.onload = null;
                img.onerror = null;
                img.onabort = null;
                this.loadingImages.delete(src);
            };
            
            img.onload = () => {
                cleanup();
                resolve(img);
            };
            
            img.onerror = () => {
                cleanup();
                reject(new Error(`Failed to load image: ${src}`));
            };
            
            img.onabort = () => {
                cleanup();
                reject(new Error(`Image loading aborted: ${src}`));
            };
            
            // Set timeout for slow loading images
            setTimeout(() => {
                if (this.loadingImages.has(src)) {
                    cleanup();
                    reject(new Error(`Image loading timeout: ${src}`));
                }
            }, 30000); // 30 second timeout
            
            img.src = src;
        });
        
        this.loadingImages.set(src, promise);
        return promise;
    }
    
    observeImage(imgElement) {
        if (imgElement && this.observer) {
            this.observer.observe(imgElement);
        }
    }
    
    unobserveImage(imgElement) {
        if (imgElement && this.observer) {
            this.observer.unobserve(imgElement);
        }
    }
    
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.loadingImages.clear();
    }
}

export const imageLoader = new ImageLoader();
