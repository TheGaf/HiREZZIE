// background/config/apiConfig.js
/**
 * Centralized API configuration and management
 */

export const API_CONFIGS = {
  googleImages: {
    name: 'Google Images',
    baseUrl: 'https://www.googleapis.com/customsearch/v1',
    rateLimit: {
      requestsPerSecond: 10,
      requestsPerMinute: 100,
      requestsPerDay: 10000
    },
    timeout: 5000,
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      initialDelay: 1000
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 30000,
      monitorTimeout: 2000
    },
    priority: 1,
    categories: ['images'],
    queryTypes: ['all']
  },
  
  serpApi: {
    name: 'SerpApi',
    baseUrl: 'https://serpapi.com/search',
    rateLimit: {
      requestsPerSecond: 5,
      requestsPerMinute: 50,
      requestsPerDay: 1000
    },
    timeout: 8000,
    retryConfig: {
      maxRetries: 2,
      backoffMultiplier: 2,
      initialDelay: 1500
    },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeout: 60000,
      monitorTimeout: 5000
    },
    priority: 2,
    categories: ['images'],
    queryTypes: ['all'],
    paid: true
  },
  
  brave: {
    name: 'Brave Search',
    baseUrl: 'https://api.search.brave.com',
    rateLimit: {
      requestsPerSecond: 3,
      requestsPerMinute: 30,
      requestsPerDay: 2000
    },
    timeout: 6000,
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 1.5,
      initialDelay: 800
    },
    circuitBreaker: {
      failureThreshold: 4,
      resetTimeout: 20000,
      monitorTimeout: 3000
    },
    priority: 3,
    categories: ['images', 'articles'],
    queryTypes: ['all']
  },
  
  bing: {
    name: 'Bing Images',
    baseUrl: 'https://api.bing.microsoft.com',
    rateLimit: {
      requestsPerSecond: 8,
      requestsPerMinute: 100,
      requestsPerDay: 5000
    },
    timeout: 5000,
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      initialDelay: 1000
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 25000,
      monitorTimeout: 2500
    },
    priority: 4,
    categories: ['images'],
    queryTypes: ['all']
  },
  
  youtube: {
    name: 'YouTube',
    baseUrl: 'https://www.googleapis.com/youtube/v3',
    rateLimit: {
      requestsPerSecond: 5,
      requestsPerMinute: 50,
      requestsPerDay: 1000000
    },
    timeout: 4000,
    retryConfig: {
      maxRetries: 2,
      backoffMultiplier: 2,
      initialDelay: 1000
    },
    circuitBreaker: {
      failureThreshold: 4,
      resetTimeout: 15000,
      monitorTimeout: 2000
    },
    priority: 1,
    categories: ['videos'],
    queryTypes: ['all']
  },
  
  gnews: {
    name: 'Google News',
    baseUrl: 'https://gnews.io/api/v4',
    rateLimit: {
      requestsPerSecond: 2,
      requestsPerMinute: 20,
      requestsPerDay: 100
    },
    timeout: 6000,
    retryConfig: {
      maxRetries: 3,
      backoffMultiplier: 2,
      initialDelay: 1200
    },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeout: 30000,
      monitorTimeout: 4000
    },
    priority: 1,
    categories: ['articles'],
    queryTypes: ['all']
  },
  
  newsapi: {
    name: 'NewsAPI.org',
    baseUrl: 'https://newsapi.org/v2',
    rateLimit: {
      requestsPerSecond: 1,
      requestsPerMinute: 10,
      requestsPerDay: 100
    },
    timeout: 7000,
    retryConfig: {
      maxRetries: 2,
      backoffMultiplier: 2,
      initialDelay: 1500
    },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeout: 45000,
      monitorTimeout: 5000
    },
    priority: 2,
    categories: ['articles'],
    queryTypes: ['all']
  }
};

export const FEATURE_FLAGS = {
  useIntelligentSourceSelection: true,
  enableCircuitBreaker: true,
  enableRateLimiting: true,
  enableResultCaching: true,
  enableProgressiveImageLoading: true,
  enableVirtualScrolling: true,
  enablePerformanceMonitoring: true,
  enableLocalTelemetry: true,
  preferFreeAPIs: false,
  requireAllTerms: false,
  minImageMegaPixels: 2.0,
  maxCacheSize: 100,
  cacheExpirationMinutes: 5,
  enableSearchSuggestions: true,
  enableAutoComplete: true
};

export const ENVIRONMENT_CONFIG = {
  development: {
    enableDebugLogs: true,
    enablePerformanceLogging: true,
    cacheExpirationMinutes: 1,
    maxRetries: 1
  },
  production: {
    enableDebugLogs: false,
    enablePerformanceLogging: false,
    cacheExpirationMinutes: 5,
    maxRetries: 3
  }
};

/**
 * Get configuration for a specific API
 */
export function getApiConfig(apiName) {
  return API_CONFIGS[apiName] || null;
}

/**
 * Get all APIs for a specific category
 */
export function getApisForCategory(category) {
  return Object.entries(API_CONFIGS)
    .filter(([_, config]) => config.categories.includes(category))
    .sort(([_, a], [__, b]) => a.priority - b.priority)
    .map(([name, config]) => ({ name, ...config }));
}

/**
 * Get feature flag value
 */
export function getFeatureFlag(flagName) {
  return FEATURE_FLAGS[flagName] ?? false;
}

/**
 * Get environment-specific configuration
 */
export function getEnvironmentConfig() {
  const env = chrome?.runtime?.getManifest?.()?.version?.includes('dev') ? 'development' : 'production';
  return ENVIRONMENT_CONFIG[env] || ENVIRONMENT_CONFIG.production;
}

/**
 * Check if API should be used based on query characteristics
 */
export function shouldUseApi(apiName, queryType, category, options = {}) {
  const config = getApiConfig(apiName);
  if (!config) return false;
  
  // Check category support
  if (!config.categories.includes(category)) return false;
  
  // Check if paid APIs are disabled
  if (config.paid && options.preferFreeAPIs) return false;
  
  // Query type filtering (for future use)
  if (!config.queryTypes.includes('all') && !config.queryTypes.includes(queryType)) {
    return false;
  }
  
  return true;
}