// utils/ErrorBoundary.js
/**
 * Error boundary utilities for graceful error handling
 */

class ErrorBoundary {
  constructor(options = {}) {
    this.options = {
      enableLogging: true,
      enableRetry: true,
      maxRetries: 3,
      retryDelay: 1000,
      fallbackContent: 'Something went wrong. Please try again.',
      onError: null,
      ...options
    };

    this.errors = new Map();
    this.retryAttempts = new Map();
    this.errorListeners = new Set();
  }

  /**
   * Wrap a function with error boundary
   */
  wrap(fn, context = {}) {
    return async (...args) => {
      const operationId = context.id || `${fn.name || 'anonymous'}_${Date.now()}`;
      
      try {
        const result = await fn.apply(this, args);
        this.clearError(operationId);
        return result;
      } catch (error) {
        return this.handleError(error, operationId, context, fn, args);
      }
    };
  }

  /**
   * Handle an error with retries and fallbacks
   */
  async handleError(error, operationId, context, originalFn, originalArgs) {
    const errorInfo = {
      error,
      operationId,
      context,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    this.recordError(operationId, errorInfo);
    this.notifyError(errorInfo);

    if (this.options.enableLogging) {
      console.error('[ErrorBoundary] Error caught:', {
        operationId,
        error: error.message,
        stack: error.stack,
        context
      });
    }

    // Try to recover with retries
    if (this.options.enableRetry && this.shouldRetry(operationId, error)) {
      return this.retry(operationId, originalFn, originalArgs, context);
    }

    // Apply fallback strategy
    return this.applyFallback(error, context);
  }

  /**
   * Record error for tracking
   */
  recordError(operationId, errorInfo) {
    if (!this.errors.has(operationId)) {
      this.errors.set(operationId, []);
    }
    
    this.errors.get(operationId).push(errorInfo);
    
    // Limit error history
    const errors = this.errors.get(operationId);
    if (errors.length > 10) {
      errors.splice(0, errors.length - 10);
    }
  }

  /**
   * Check if operation should be retried
   */
  shouldRetry(operationId, error) {
    const retryCount = this.retryAttempts.get(operationId) || 0;
    
    // Don't retry if max attempts reached
    if (retryCount >= this.options.maxRetries) {
      return false;
    }

    // Don't retry certain types of errors
    if (this.isNonRetryableError(error)) {
      return false;
    }

    return true;
  }

  /**
   * Check if error is non-retryable
   */
  isNonRetryableError(error) {
    const nonRetryableTypes = [
      'SyntaxError',
      'TypeError',
      'ReferenceError',
      'RangeError'
    ];

    if (nonRetryableTypes.includes(error.constructor.name)) {
      return true;
    }

    // HTTP errors that shouldn't be retried
    if (error.status) {
      const nonRetryableStatuses = [400, 401, 403, 404, 422];
      return nonRetryableStatuses.includes(error.status);
    }

    return false;
  }

  /**
   * Retry the operation
   */
  async retry(operationId, originalFn, originalArgs, context) {
    const retryCount = this.retryAttempts.get(operationId) || 0;
    this.retryAttempts.set(operationId, retryCount + 1);

    // Calculate delay with exponential backoff
    const delay = this.options.retryDelay * Math.pow(2, retryCount);
    
    if (this.options.enableLogging) {
      console.log(`[ErrorBoundary] Retrying operation ${operationId} (attempt ${retryCount + 1}/${this.options.maxRetries}) after ${delay}ms`);
    }

    await this.sleep(delay);

    try {
      const result = await originalFn.apply(this, originalArgs);
      this.clearError(operationId);
      return result;
    } catch (error) {
      return this.handleError(error, operationId, context, originalFn, originalArgs);
    }
  }

  /**
   * Apply fallback strategy
   */
  applyFallback(error, context) {
    // Try context-specific fallback first
    if (context.fallback) {
      try {
        return context.fallback(error);
      } catch (fallbackError) {
        console.error('[ErrorBoundary] Fallback failed:', fallbackError);
      }
    }

    // Apply default fallback
    if (context.returnType === 'array') {
      return [];
    } else if (context.returnType === 'object') {
      return {};
    } else if (context.returnType === 'string') {
      return this.options.fallbackContent;
    }

    // For DOM operations, create error element
    if (context.isDomOperation) {
      return this.createErrorElement(error, context);
    }

    // Default: throw the error
    throw error;
  }

  /**
   * Create error display element
   */
  createErrorElement(error, context) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-boundary';
    errorDiv.style.cssText = `
      padding: 20px;
      margin: 10px 0;
      background-color: #fee;
      border: 1px solid #fcc;
      border-radius: 4px;
      color: #c33;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const message = document.createElement('div');
    message.style.fontWeight = 'bold';
    message.style.marginBottom = '10px';
    message.textContent = this.options.fallbackContent;

    const details = document.createElement('details');
    details.style.fontSize = '0.9em';
    details.style.opacity = '0.8';

    const summary = document.createElement('summary');
    summary.textContent = 'Error details';
    summary.style.cursor = 'pointer';

    const errorText = document.createElement('pre');
    errorText.style.whiteSpace = 'pre-wrap';
    errorText.style.fontSize = '0.8em';
    errorText.style.marginTop = '10px';
    errorText.textContent = `${error.message}\n\n${error.stack || ''}`;

    details.appendChild(summary);
    details.appendChild(errorText);

    // Add retry button if applicable
    if (this.options.enableRetry && context.retryAction) {
      const retryButton = document.createElement('button');
      retryButton.textContent = 'Try Again';
      retryButton.style.cssText = `
        margin-top: 10px;
        padding: 6px 12px;
        background-color: #007cba;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
      `;
      retryButton.onclick = () => {
        errorDiv.remove();
        context.retryAction();
      };
      
      errorDiv.appendChild(retryButton);
    }

    errorDiv.appendChild(message);
    errorDiv.appendChild(details);

    return errorDiv;
  }

  /**
   * Clear error history for an operation
   */
  clearError(operationId) {
    this.errors.delete(operationId);
    this.retryAttempts.delete(operationId);
  }

  /**
   * Add error listener
   */
  addErrorListener(callback) {
    this.errorListeners.add(callback);
  }

  /**
   * Remove error listener
   */
  removeErrorListener(callback) {
    this.errorListeners.delete(callback);
  }

  /**
   * Notify error listeners
   */
  notifyError(errorInfo) {
    // Call custom error handler if provided
    if (this.options.onError) {
      try {
        this.options.onError(errorInfo);
      } catch (error) {
        console.error('[ErrorBoundary] Error in custom error handler:', error);
      }
    }

    // Notify listeners
    this.errorListeners.forEach(callback => {
      try {
        callback(errorInfo);
      } catch (error) {
        console.error('[ErrorBoundary] Error in error listener:', error);
      }
    });
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {
      totalOperations: this.errors.size,
      totalErrors: 0,
      errorsByType: {},
      recentErrors: []
    };

    for (const [operationId, errors] of this.errors) {
      stats.totalErrors += errors.length;
      
      errors.forEach(errorInfo => {
        const errorType = errorInfo.error.constructor.name;
        stats.errorsByType[errorType] = (stats.errorsByType[errorType] || 0) + 1;
        
        // Collect recent errors (last 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        if (errorInfo.timestamp > fiveMinutesAgo) {
          stats.recentErrors.push({
            operationId,
            errorType,
            message: errorInfo.error.message,
            timestamp: errorInfo.timestamp
          });
        }
      });
    }

    return stats;
  }

  /**
   * Create a safe async function wrapper
   */
  createSafeAsync(fn, options = {}) {
    return this.wrap(fn, {
      returnType: 'object',
      ...options
    });
  }

  /**
   * Create a safe DOM operation wrapper
   */
  createSafeDom(fn, options = {}) {
    return this.wrap(fn, {
      isDomOperation: true,
      returnType: 'element',
      ...options
    });
  }

  /**
   * Create a safe fetch wrapper
   */
  createSafeFetch(url, options = {}) {
    const fetchFn = async () => {
      const response = await fetch(url, options);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.response = response;
        throw error;
      }
      return response;
    };

    return this.wrap(fetchFn, {
      id: `fetch_${url}`,
      returnType: 'object',
      url
    });
  }

  /**
   * Utility sleep function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all error data
   */
  clear() {
    this.errors.clear();
    this.retryAttempts.clear();
  }
}

/**
 * Global error boundary for unhandled errors
 */
class GlobalErrorBoundary {
  constructor(options = {}) {
    this.boundary = new ErrorBoundary(options);
    this.setupGlobalHandlers();
  }

  setupGlobalHandlers() {
    // Handle uncaught JavaScript errors
    window.addEventListener('error', (event) => {
      const errorInfo = {
        error: event.error || new Error(event.message),
        operationId: 'global_js_error',
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        },
        timestamp: Date.now()
      };

      this.boundary.notifyError(errorInfo);
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const errorInfo = {
        error: event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
        operationId: 'global_promise_rejection',
        context: {
          reason: event.reason
        },
        timestamp: Date.now()
      };

      this.boundary.notifyError(errorInfo);
      
      // Prevent the error from being logged to console (we'll handle it)
      if (this.boundary.options.enableLogging) {
        event.preventDefault();
      }
    });
  }

  /**
   * Get the underlying error boundary
   */
  getBoundary() {
    return this.boundary;
  }
}

// Create and export instances
export const errorBoundary = new ErrorBoundary();
export const globalErrorBoundary = new GlobalErrorBoundary();
export { ErrorBoundary, GlobalErrorBoundary };