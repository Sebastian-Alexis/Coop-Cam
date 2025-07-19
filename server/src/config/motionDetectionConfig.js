//motion detection configuration with worker pool settings
//this file shows how to configure the new worker-based motion detection

export const motionDetectionConfig = {
  //enable motion detection
  enabled: process.env.MOTION_DETECTION_ENABLED !== 'false',
  
  //use v2 with worker threads (set to false to use original version)
  useWorkerThreads: process.env.MOTION_USE_WORKERS !== 'false',
  
  //detection settings
  fps: parseInt(process.env.MOTION_FPS) || 1,
  threshold: parseFloat(process.env.MOTION_THRESHOLD) || 0.05,
  cooldownMs: parseInt(process.env.MOTION_COOLDOWN_MS) || 5000,
  width: parseInt(process.env.MOTION_WIDTH) || 320,
  height: parseInt(process.env.MOTION_HEIGHT) || 240,
  
  //worker pool configuration
  workerPool: {
    //number of worker threads (default: CPU cores - 1)
    size: process.env.MOTION_WORKER_POOL_SIZE 
      ? parseInt(process.env.MOTION_WORKER_POOL_SIZE)
      : undefined, //will use default in WorkerPoolManager
    
    //maximum queued frames before dropping
    maxQueueSize: parseInt(process.env.MOTION_MAX_QUEUE_SIZE) || 50,
    
    //timeout for frame processing (ms)
    taskTimeout: parseInt(process.env.MOTION_TASK_TIMEOUT) || 5000
  },
  
  //buffer pool configuration
  bufferPool: {
    //initial pool size
    size: parseInt(process.env.BUFFER_POOL_SIZE) || 20,
    
    //buffer size in bytes (1MB default)
    bufferSize: parseInt(process.env.BUFFER_SIZE) || 1024 * 1024
  },
  
  //shadow removal settings (unchanged)
  shadowRemoval: {
    enabled: process.env.SHADOW_REMOVAL_ENABLED === 'true',
    intensity: parseFloat(process.env.SHADOW_REMOVAL_INTENSITY) || 0.7,
    pixelThreshold: parseInt(process.env.SHADOW_PIXEL_THRESHOLD) || 30,
    adaptiveThreshold: process.env.SHADOW_ADAPTIVE_THRESHOLD === 'true',
    advanced: process.env.SHADOW_REMOVAL_ADVANCED === 'true',
    debugFrames: process.env.SHADOW_DEBUG_FRAMES === 'true',
    temporal: {
      enabled: process.env.TEMPORAL_SHADOW_DETECTION === 'true',
      bufferSize: parseInt(process.env.TEMPORAL_BUFFER_SIZE) || 10,
      minConsistency: parseFloat(process.env.TEMPORAL_MIN_CONSISTENCY) || 0.7
    },
    regionAnalysis: {
      enabled: process.env.REGION_ANALYSIS_ENABLED === 'true',
      gridSize: parseInt(process.env.REGION_GRID_SIZE) || 8
    }
  },
  
  //color detection settings (unchanged)
  colorDetection: {
    enabled: process.env.COLOR_DETECTION_ENABLED === 'true',
    minChickenRatio: parseFloat(process.env.MIN_CHICKEN_RATIO) || 0.1,
    minBlobSize: parseInt(process.env.MIN_BLOB_SIZE) || 50
  },
  
  //detection mode
  detectionMode: process.env.DETECTION_MODE || 'color_filter',
  
  //color-first mode settings
  colorFirst: {
    maxBlobMatchDistance: parseInt(process.env.MAX_BLOB_MATCH_DISTANCE) || 50,
    minBlobMovement: parseInt(process.env.MIN_BLOB_MOVEMENT) || 10,
    minBlobLifetime: parseInt(process.env.MIN_BLOB_LIFETIME) || 2
  },
  
  //ignored Y ranges
  ignoredYRanges: process.env.MOTION_IGNORED_Y_RANGES 
    ? JSON.parse(process.env.MOTION_IGNORED_Y_RANGES)
    : []
};