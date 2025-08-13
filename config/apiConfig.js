// config/apiConfig.js - Centralized API configuration for hiREZZIE
export const API_CONFIG = {
  // Global settings
  global: {
    timeout: 15000, // 15 seconds
    retryAttempts: 2,
    retryDelay: 1000,
    maxConcurrentRequests: 6,
    userAgent: 'Mozilla/5.0 (compatible; hiREZZIE/3.0.1; +https://github.com/TheGaf/HiREZZIE)'
  },

  // Provider-specific configurations
  providers: {
    gnews: {
      name: 'Google News',
      baseUrl: 'https://gnews.io/api/v4',
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000 // 1 minute
      },
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 30000 // 30 seconds
      },
      timeout: 10000,
      cacheTTL: 300000, // 5 minutes
      endpoints: {
        search: '/search'
      },
      requiredParams: ['token'],
      defaultParams: {
        lang: 'en',
        country: 'us',
        max: 10
      }
    },

    newsapi: {
      name: 'NewsAPI.org',
      baseUrl: 'https://newsapi.org/v2',
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000 // 1 minute
      },
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 30000
      },
      timeout: 10000,
      cacheTTL: 300000,
      endpoints: {
        everything: '/everything',
        topHeadlines: '/top-headlines'
      },
      requiredParams: ['apiKey'],
      defaultParams: {
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 20
      }
    },

    brave: {
      name: 'Brave Search',
      baseUrl: 'https://api.search.brave.com/res/v1',
      rateLimit: {
        maxRequests: 50,
        windowMs: 60000
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000
      },
      timeout: 12000,
      cacheTTL: 600000, // 10 minutes
      endpoints: {
        web: '/web/search',
        images: '/images/search'
      },
      requiredParams: ['X-Subscription-Token'],
      defaultParams: {
        country: 'US',
        search_lang: 'en',
        ui_lang: 'en-US',
        count: 20,
        offset: 0,
        safesearch: 'moderate'
      }
    },

    bing: {
      name: 'Bing Images',
      baseUrl: 'https://www.bing.com',
      rateLimit: {
        maxRequests: 30,
        windowMs: 60000
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000
      },
      timeout: 15000,
      cacheTTL: 600000,
      endpoints: {
        images: '/images/search'
      },
      requiredParams: [],
      defaultParams: {
        form: 'QBIR',
        first: 1,
        count: 35,
        mkt: 'en-US'
      }
    },

    google_cse: {
      name: 'Google Custom Search',
      baseUrl: 'https://www.googleapis.com/customsearch/v1',
      rateLimit: {
        maxRequests: 100,
        windowMs: 86400000 // 24 hours (daily quota)
      },
      circuitBreaker: {
        failureThreshold: 2,
        resetTimeout: 120000 // 2 minutes
      },
      timeout: 10000,
      cacheTTL: 1800000, // 30 minutes
      endpoints: {
        search: ''
      },
      requiredParams: ['key', 'cx'],
      defaultParams: {
        searchType: 'image',
        imgSize: 'xxlarge',
        imgType: 'photo',
        num: 10,
        safe: 'medium',
        fileType: 'jpg,png,webp'
      }
    },

    serpapi: {
      name: 'SerpApi Google Images',
      baseUrl: 'https://serpapi.com/search',
      rateLimit: {
        maxRequests: 100,
        windowMs: 3600000 // 1 hour
      },
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeout: 60000
      },
      timeout: 15000,
      cacheTTL: 1800000,
      endpoints: {
        search: ''
      },
      requiredParams: ['api_key'],
      defaultParams: {
        engine: 'google_images',
        hl: 'en',
        gl: 'us',
        num: 20,
        safe: 'medium',
        tbs: 'isz:l' // Large images
      }
    },

    youtube: {
      name: 'YouTube Data API',
      baseUrl: 'https://www.googleapis.com/youtube/v3',
      rateLimit: {
        maxRequests: 10000,
        windowMs: 86400000 // 24 hours
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 120000
      },
      timeout: 10000,
      cacheTTL: 600000,
      endpoints: {
        search: '/search',
        videos: '/videos'
      },
      requiredParams: ['key'],
      defaultParams: {
        part: 'snippet',
        type: 'video',
        order: 'relevance',
        maxResults: 25,
        safeSearch: 'moderate'
      }
    },

    vimeo: {
      name: 'Vimeo API',
      baseUrl: 'https://api.vimeo.com',
      rateLimit: {
        maxRequests: 1000,
        windowMs: 3600000 // 1 hour
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 120000
      },
      timeout: 12000,
      cacheTTL: 600000,
      endpoints: {
        search: '/videos'
      },
      requiredParams: ['Authorization'],
      defaultParams: {
        per_page: 25,
        sort: 'relevant',
        filter: 'CC'
      }
    },

    dailymotion: {
      name: 'Dailymotion API',
      baseUrl: 'https://www.dailymotion.com/api',
      rateLimit: {
        maxRequests: 300,
        windowMs: 3600000 // 1 hour
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 120000
      },
      timeout: 12000,
      cacheTTL: 600000,
      endpoints: {
        search: '/videos'
      },
      requiredParams: [],
      defaultParams: {
        limit: 20,
        sort: 'relevance',
        fields: 'id,title,description,thumbnail_large_url,url'
      }
    }
  },

  // Priority and fallback configuration
  searchStrategy: {
    // Free sources (primary)
    free: ['gnews', 'newsapi', 'brave', 'bing'],
    
    // Paid sources (fallback)
    paid: ['google_cse', 'serpapi'],
    
    // Video sources
    video: ['youtube', 'vimeo', 'dailymotion'],

    // Parallel processing settings
    parallel: {
      maxConcurrent: 3,
      timeout: 20000, // Total timeout for parallel requests
      minSuccessful: 1 // Minimum successful responses needed
    },

    // Quality thresholds
    quality: {
      minFileSize: 150000, // 150KB
      minDimension: 800, // 800px minimum width or height
      preferredDimension: 2000, // 2000px preferred
      maxAspectRatio: 3.0, // Reject images with extreme aspect ratios
      validFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    }
  },

  // Caching strategy
  cache: {
    apiResponses: {
      ttl: 300000, // 5 minutes
      maxSize: 200
    },
    searchResults: {
      ttl: 600000, // 10 minutes
      maxSize: 50
    },
    imageValidation: {
      ttl: 1800000, // 30 minutes
      maxSize: 500
    }
  },

  // Error handling
  errors: {
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    cooldownStatusCodes: [403, 429],
    permanentFailureCodes: [401, 404],
    cooldownDuration: {
      403: 1800000, // 30 minutes
      429: 3600000, // 1 hour
      500: 900000,  // 15 minutes
      502: 300000,  // 5 minutes
      503: 600000,  // 10 minutes
      504: 300000   // 5 minutes
    }
  }
};

// Provider management utilities
export class ApiConfigManager {
  constructor(config = API_CONFIG) {
    this.config = config;
    this.overrides = new Map();
  }

  getProviderConfig(provider) {
    const baseConfig = this.config.providers[provider];
    const overrides = this.overrides.get(provider) || {};
    
    return {
      ...baseConfig,
      ...overrides
    };
  }

  overrideProvider(provider, overrides) {
    this.overrides.set(provider, {
      ...this.overrides.get(provider),
      ...overrides
    });
  }

  getSearchStrategy() {
    return this.config.searchStrategy;
  }

  getCacheConfig() {
    return this.config.cache;
  }

  getErrorConfig() {
    return this.config.errors;
  }

  // Get providers by priority for a search mode
  getProvidersByMode(mode = 'recent', includeVideo = false) {
    const strategy = this.getSearchStrategy();
    let providers = [...strategy.free];
    
    if (includeVideo) {
      providers.push(...strategy.video);
    }
    
    // Add paid sources as fallback if configured
    if (mode === 'relevant') {
      providers.push(...strategy.paid);
    }
    
    return providers.filter(provider => 
      this.config.providers[provider] && this._isProviderEnabled(provider)
    );
  }

  _isProviderEnabled(provider) {
    const config = this.getProviderConfig(provider);
    return config && !config.disabled;
  }

  // Get timeout for provider
  getTimeout(provider) {
    const config = this.getProviderConfig(provider);
    return config?.timeout || this.config.global.timeout;
  }

  // Get rate limit config for provider
  getRateLimit(provider) {
    const config = this.getProviderConfig(provider);
    return config?.rateLimit || { maxRequests: 10, windowMs: 60000 };
  }

  // Get circuit breaker config for provider
  getCircuitBreakerConfig(provider) {
    const config = this.getProviderConfig(provider);
    return config?.circuitBreaker || { failureThreshold: 5, resetTimeout: 60000 };
  }

  // Build request URL for provider endpoint
  buildUrl(provider, endpoint, params = {}) {
    const config = this.getProviderConfig(provider);
    if (!config) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const baseUrl = config.baseUrl;
    const endpointPath = config.endpoints[endpoint];
    
    if (endpointPath === undefined) {
      throw new Error(`Unknown endpoint ${endpoint} for provider ${provider}`);
    }

    const url = new URL(endpointPath, baseUrl);
    
    // Add default params
    const allParams = { ...config.defaultParams, ...params };
    
    for (const [key, value] of Object.entries(allParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  // Validate required parameters for provider
  validateParams(provider, params) {
    const config = this.getProviderConfig(provider);
    if (!config) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const missing = config.requiredParams?.filter(param => !params[param]) || [];
    
    if (missing.length > 0) {
      throw new Error(`Missing required parameters for ${provider}: ${missing.join(', ')}`);
    }

    return true;
  }

  // Get all enabled providers
  getAllEnabledProviders() {
    return Object.keys(this.config.providers).filter(provider => 
      this._isProviderEnabled(provider)
    );
  }

  // Get provider statistics
  getProviderStats() {
    const stats = {};
    
    for (const provider of this.getAllEnabledProviders()) {
      const config = this.getProviderConfig(provider);
      stats[provider] = {
        name: config.name,
        enabled: !config.disabled,
        timeout: this.getTimeout(provider),
        rateLimit: this.getRateLimit(provider),
        circuitBreaker: this.getCircuitBreakerConfig(provider),
        cacheTTL: config.cacheTTL
      };
    }
    
    return stats;
  }
}

// Global config manager instance
export const apiConfig = new ApiConfigManager();

// Utility functions
export function getProviderConfig(provider) {
  return apiConfig.getProviderConfig(provider);
}

export function buildApiUrl(provider, endpoint, params) {
  return apiConfig.buildUrl(provider, endpoint, params);
}

export function validateApiParams(provider, params) {
  return apiConfig.validateParams(provider, params);
}

export function getProvidersByMode(mode, includeVideo = false) {
  return apiConfig.getProvidersByMode(mode, includeVideo);
}