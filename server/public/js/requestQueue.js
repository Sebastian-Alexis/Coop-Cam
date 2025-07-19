//request queue manager for limiting concurrent connections on mobile
//prevents exhausting the browser's 6-connection-per-domain limit

class RequestQueue {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 2; //leave room for stream + SSE
    this.timeout = options.timeout || 30000; //30 second timeout
    this.retryLimit = options.retryLimit || 3;
    this.retryDelay = options.retryDelay || 1000;
    
    this.active = new Map(); //currently active requests
    this.queue = []; //queued requests
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      queued: 0,
      active: 0
    };
  }
  
  //main fetch method with queuing
  async fetch(url, options = {}, config = {}) {
    const priority = config.priority || 0;
    const retries = config.retries !== undefined ? config.retries : this.retryLimit;
    
    this.stats.total++;
    
    //if at capacity, queue the request
    if (this.active.size >= this.maxConcurrent) {
      return this.enqueue(url, options, { ...config, priority, retries });
    }
    
    //execute immediately
    return this.executeFetch(url, options, { ...config, retries });
  }
  
  //enqueue a request
  enqueue(url, options, config) {
    return new Promise((resolve, reject) => {
      const request = {
        url,
        options,
        config,
        resolve,
        reject,
        timestamp: Date.now()
      };
      
      this.queue.push(request);
      this.stats.queued++;
      
      //sort by priority (higher first) and timestamp (older first)
      this.queue.sort((a, b) => {
        if (a.config.priority !== b.config.priority) {
          return b.config.priority - a.config.priority;
        }
        return a.timestamp - b.timestamp;
      });
      
      console.log(`[RequestQueue] Queued request to ${url}. Queue length: ${this.queue.length}`);
    });
  }
  
  //execute a fetch request
  async executeFetch(url, options = {}, config = {}) {
    const requestId = `${url}_${Date.now()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    //track active request
    this.active.set(requestId, {
      url,
      controller,
      startTime: Date.now()
    });
    this.stats.active = this.active.size;
    
    try {
      //merge abort signal
      const fetchOptions = {
        ...options,
        signal: controller.signal
      };
      
      console.log(`[RequestQueue] Executing request to ${url}. Active: ${this.active.size}`);
      const response = await fetch(url, fetchOptions);
      
      clearTimeout(timeoutId);
      
      if (!response.ok && config.retries > 0) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      this.stats.completed++;
      return response;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      //handle retry logic
      if (config.retries > 0 && !error.name?.includes('Abort')) {
        this.stats.retried++;
        console.log(`[RequestQueue] Retrying ${url}. Retries left: ${config.retries - 1}`);
        
        //exponential backoff
        const delay = this.retryDelay * Math.pow(2, this.retryLimit - config.retries);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        //retry with decremented count
        return this.executeFetch(url, options, {
          ...config,
          retries: config.retries - 1
        });
      }
      
      this.stats.failed++;
      throw error;
      
    } finally {
      //cleanup
      this.active.delete(requestId);
      this.stats.active = this.active.size;
      
      //process next queued request
      this.processQueue();
    }
  }
  
  //process queued requests
  processQueue() {
    if (this.queue.length === 0 || this.active.size >= this.maxConcurrent) {
      return;
    }
    
    const request = this.queue.shift();
    this.stats.queued--;
    
    //check if request has timed out in queue
    const queueTime = Date.now() - request.timestamp;
    if (queueTime > this.timeout) {
      console.warn(`[RequestQueue] Request to ${request.url} timed out in queue (${queueTime}ms)`);
      request.reject(new Error('Request timed out in queue'));
      this.stats.failed++;
      this.processQueue(); //try next
      return;
    }
    
    //execute the queued request
    this.executeFetch(request.url, request.options, request.config)
      .then(request.resolve)
      .catch(request.reject);
  }
  
  //abort all active requests
  abortAll() {
    console.log(`[RequestQueue] Aborting ${this.active.size} active requests`);
    
    for (const [id, request] of this.active) {
      request.controller.abort();
    }
    
    this.active.clear();
    this.stats.active = 0;
  }
  
  //clear the queue
  clearQueue() {
    console.log(`[RequestQueue] Clearing ${this.queue.length} queued requests`);
    
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      request.reject(new Error('Request queue cleared'));
    }
    
    this.stats.queued = 0;
  }
  
  //get current stats
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeRequests: Array.from(this.active.values()).map(req => ({
        url: req.url,
        duration: Date.now() - req.startTime
      }))
    };
  }
  
  //adjust concurrency limit dynamically
  setConcurrency(limit) {
    this.maxConcurrent = Math.max(1, limit);
    console.log(`[RequestQueue] Concurrency limit set to ${this.maxConcurrent}`);
    
    //process queue if we increased the limit
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      this.processQueue();
    }
  }
}

//singleton instance for the application
const requestQueue = new RequestQueue({
  maxConcurrent: 2, //conservative default for mobile
  timeout: 30000,
  retryLimit: 3,
  retryDelay: 1000
});

//adjust concurrency based on connection type
if (typeof navigator !== 'undefined' && navigator.connection) {
  const connection = navigator.connection;
  
  //adjust based on connection quality
  if (connection.effectiveType === '4g' && !connection.saveData) {
    requestQueue.setConcurrency(3);
  } else if (connection.effectiveType === '3g' || connection.saveData) {
    requestQueue.setConcurrency(1);
  }
  
  //listen for connection changes
  connection.addEventListener('change', () => {
    if (connection.effectiveType === '4g' && !connection.saveData) {
      requestQueue.setConcurrency(3);
    } else if (connection.effectiveType === '3g' || connection.saveData) {
      requestQueue.setConcurrency(1);
    } else {
      requestQueue.setConcurrency(2);
    }
  });
}

//export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RequestQueue, requestQueue };
} else {
  window.RequestQueue = RequestQueue;
  window.requestQueue = requestQueue;
}