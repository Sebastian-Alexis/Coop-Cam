import { EventEmitter } from 'events';

//performance monitoring for motion detection and stream processing
class PerformanceMonitor extends EventEmitter {
  constructor() {
    super();
    
    //event loop monitoring
    this.eventLoopLag = 0;
    this.eventLoopInterval = null;
    
    //frame processing metrics
    this.frameMetrics = {
      processed: 0,
      dropped: 0,
      errors: 0,
      totalProcessingTime: 0,
      maxProcessingTime: 0,
      minProcessingTime: Infinity,
      histogram: new Map() //processing time distribution
    };
    
    //motion detection metrics
    this.motionMetrics = {
      detections: 0,
      falsePositives: 0,
      workerQueueDepth: 0,
      workerUtilization: 0
    };
    
    //memory metrics
    this.memoryMetrics = {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      bufferPoolStats: null
    };
    
    //network metrics
    this.networkMetrics = {
      bytesTransmitted: 0,
      activeConnections: 0,
      connectionErrors: 0
    };
    
    //start monitoring
    this.startMonitoring();
  }
  
  startMonitoring() {
    //monitor event loop lag
    this.monitorEventLoop();
    
    //update memory metrics every 10 seconds
    setInterval(() => this.updateMemoryMetrics(), 10000);
    
    //emit metrics every 30 seconds
    setInterval(() => this.emitMetrics(), 30000);
  }
  
  monitorEventLoop() {
    let lastCheck = Date.now();
    
    this.eventLoopInterval = setInterval(() => {
      const now = Date.now();
      const actualDelay = now - lastCheck;
      const expectedDelay = 100; //100ms interval
      
      //calculate lag
      this.eventLoopLag = Math.max(0, actualDelay - expectedDelay);
      
      //warn if lag is high
      if (this.eventLoopLag > 50) {
        console.warn(`[Performance] High event loop lag detected: ${this.eventLoopLag}ms`);
      }
      
      lastCheck = now;
    }, 100);
  }
  
  //record frame processing time
  recordFrameProcessing(processingTime, success = true) {
    this.frameMetrics.processed++;
    
    if (!success) {
      this.frameMetrics.errors++;
      return;
    }
    
    //update statistics
    this.frameMetrics.totalProcessingTime += processingTime;
    this.frameMetrics.maxProcessingTime = Math.max(
      this.frameMetrics.maxProcessingTime, 
      processingTime
    );
    this.frameMetrics.minProcessingTime = Math.min(
      this.frameMetrics.minProcessingTime, 
      processingTime
    );
    
    //update histogram (bucket by 10ms intervals)
    const bucket = Math.floor(processingTime / 10) * 10;
    this.frameMetrics.histogram.set(
      bucket, 
      (this.frameMetrics.histogram.get(bucket) || 0) + 1
    );
  }
  
  //record dropped frame
  recordDroppedFrame() {
    this.frameMetrics.dropped++;
  }
  
  //record motion detection
  recordMotionDetection(data = {}) {
    this.motionMetrics.detections++;
    
    if (data.workerQueueDepth !== undefined) {
      this.motionMetrics.workerQueueDepth = data.workerQueueDepth;
    }
    
    if (data.workerUtilization !== undefined) {
      this.motionMetrics.workerUtilization = data.workerUtilization;
    }
  }
  
  //update memory metrics
  updateMemoryMetrics() {
    const memUsage = process.memoryUsage();
    
    this.memoryMetrics = {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers || 0
    };
  }
  
  //update buffer pool stats
  updateBufferPoolStats(stats) {
    this.memoryMetrics.bufferPoolStats = stats;
  }
  
  //update network metrics
  updateNetworkMetrics(data) {
    if (data.bytesTransmitted !== undefined) {
      this.networkMetrics.bytesTransmitted += data.bytesTransmitted;
    }
    
    if (data.activeConnections !== undefined) {
      this.networkMetrics.activeConnections = data.activeConnections;
    }
    
    if (data.connectionError) {
      this.networkMetrics.connectionErrors++;
    }
  }
  
  //get current metrics summary
  getMetrics() {
    const avgProcessingTime = this.frameMetrics.processed > 0
      ? this.frameMetrics.totalProcessingTime / this.frameMetrics.processed
      : 0;
    
    //convert histogram to percentiles
    const percentiles = this.calculatePercentiles();
    
    return {
      timestamp: new Date().toISOString(),
      eventLoop: {
        lag: this.eventLoopLag
      },
      frames: {
        processed: this.frameMetrics.processed,
        dropped: this.frameMetrics.dropped,
        errors: this.frameMetrics.errors,
        dropRate: this.frameMetrics.processed > 0
          ? (this.frameMetrics.dropped / (this.frameMetrics.processed + this.frameMetrics.dropped)) * 100
          : 0,
        avgProcessingTime,
        maxProcessingTime: this.frameMetrics.maxProcessingTime,
        minProcessingTime: this.frameMetrics.minProcessingTime === Infinity 
          ? 0 
          : this.frameMetrics.minProcessingTime,
        percentiles
      },
      motion: {
        detections: this.motionMetrics.detections,
        detectionsPerMinute: this.calculateRate(this.motionMetrics.detections),
        workerQueueDepth: this.motionMetrics.workerQueueDepth,
        workerUtilization: this.motionMetrics.workerUtilization
      },
      memory: {
        heapUsedMB: (this.memoryMetrics.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMB: (this.memoryMetrics.heapTotal / 1024 / 1024).toFixed(2),
        externalMB: (this.memoryMetrics.external / 1024 / 1024).toFixed(2),
        rssMB: (this.memoryMetrics.rss / 1024 / 1024).toFixed(2),
        bufferPool: this.memoryMetrics.bufferPoolStats
      },
      network: {
        totalMB: (this.networkMetrics.bytesTransmitted / 1024 / 1024).toFixed(2),
        activeConnections: this.networkMetrics.activeConnections,
        connectionErrors: this.networkMetrics.connectionErrors
      }
    };
  }
  
  //calculate percentiles from histogram
  calculatePercentiles() {
    const values = [];
    
    //expand histogram into sorted array
    for (const [bucket, count] of this.frameMetrics.histogram.entries()) {
      for (let i = 0; i < count; i++) {
        values.push(bucket);
      }
    }
    
    values.sort((a, b) => a - b);
    
    if (values.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }
    
    const percentile = (p) => {
      const index = Math.ceil((p / 100) * values.length) - 1;
      return values[Math.max(0, Math.min(index, values.length - 1))];
    };
    
    return {
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99)
    };
  }
  
  //calculate rate per minute
  calculateRate(count) {
    const uptimeMinutes = process.uptime() / 60;
    return uptimeMinutes > 0 ? (count / uptimeMinutes).toFixed(2) : 0;
  }
  
  //emit metrics event
  emitMetrics() {
    const metrics = this.getMetrics();
    this.emit('metrics', metrics);
    
    //log summary
    console.log('[Performance] Metrics:', {
      eventLoopLag: `${metrics.eventLoop.lag}ms`,
      framesProcessed: metrics.frames.processed,
      dropRate: `${metrics.frames.dropRate.toFixed(2)}%`,
      avgProcessingTime: `${metrics.frames.avgProcessingTime.toFixed(2)}ms`,
      heapUsed: `${metrics.memory.heapUsedMB}MB`,
      activeConnections: metrics.network.activeConnections
    });
  }
  
  //reset metrics
  reset() {
    this.frameMetrics = {
      processed: 0,
      dropped: 0,
      errors: 0,
      totalProcessingTime: 0,
      maxProcessingTime: 0,
      minProcessingTime: Infinity,
      histogram: new Map()
    };
    
    this.motionMetrics = {
      detections: 0,
      falsePositives: 0,
      workerQueueDepth: 0,
      workerUtilization: 0
    };
    
    this.networkMetrics.bytesTransmitted = 0;
    this.networkMetrics.connectionErrors = 0;
  }
  
  //cleanup
  stop() {
    if (this.eventLoopInterval) {
      clearInterval(this.eventLoopInterval);
      this.eventLoopInterval = null;
    }
  }
}

//singleton instance
let performanceMonitor = null;

export function getPerformanceMonitor() {
  if (!performanceMonitor) {
    performanceMonitor = new PerformanceMonitor();
  }
  return performanceMonitor;
}

export default PerformanceMonitor;