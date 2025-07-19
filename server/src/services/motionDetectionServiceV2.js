import { config } from '../config.js';
import WorkerPoolManager from '../workers/workerPoolManager.js';
import { 
  calculateShadowAwareDifference, 
  getTimeBasedThresholds 
} from '../utils/shadowRemovalUtils.js';
import {
  calculateColorShadowAwareDifference
} from '../utils/colorShadowRemovalUtils.js';
import {
  validateChickenMotion,
  getTimeAdjustedProfiles
} from '../utils/colorDetectionUtils.js';
import { ColorBlobTracker } from '../utils/colorBlobTracker.js';
import { TemporalShadowDetector } from '../utils/temporalShadowDetector.js';
import { RegionAnalyzer } from '../utils/regionAnalyzer.js';
import { 
  isIndexInDetectionRegion, 
  calculateActivePixelCount,
  getDetectionRegionDescription,
  shouldIgnorePixel,
  calculateIgnoredPixelCount
} from '../utils/detectionRegionUtils.js';

//v2 of motion detection service using worker threads
//this version processes frames in separate threads to avoid blocking the event loop
class MotionDetectionServiceV2 {
  constructor(mjpegProxy, eventEmitter) {
    console.log('[MotionV2] Initializing motion detection service with worker threads...');
    console.log('[MotionV2] Config enabled:', config.motionDetection.enabled);
    console.log('[MotionV2] Config threshold:', config.motionDetection.threshold);
    
    if (!config.motionDetection.enabled) {
      console.log('[MotionV2] Motion detection is disabled');
      return;
    }

    this.eventEmitter = eventEmitter;
    this.mjpegProxy = mjpegProxy;
    this.lastCheckTime = 0;
    this.previousFrameBuffer = null;
    this.processing = false;
    this.lastMotionTime = 0;
    this.frameCount = 0;
    this.debugPath = './debug/motion';
    this.isPaused = false;
    this.pauseReason = null;
    
    //shadow removal configuration
    this.shadowRemovalEnabled = config.motionDetection.shadowRemoval?.enabled || false;
    this.shadowRemovalIntensity = config.motionDetection.shadowRemoval?.intensity || 0.7;
    
    //color detection configuration
    this.colorDetectionEnabled = config.motionDetection.colorDetection?.enabled || false;
    this.minChickenRatio = config.motionDetection.colorDetection?.minChickenRatio || 0.1;
    this.minBlobSize = config.motionDetection.colorDetection?.minBlobSize || 50;
    
    //detection mode configuration
    this.detectionMode = config.motionDetection.detectionMode || 'color_filter';
    
    //initialize color blob tracker for color-first mode
    this.colorBlobTracker = null;
    if (this.detectionMode === 'color_first') {
      this.colorBlobTracker = new ColorBlobTracker(
        config.motionDetection.width,
        config.motionDetection.height,
        {
          maxMatchDistance: config.motionDetection.colorFirst.maxBlobMatchDistance,
          minBlobMovement: config.motionDetection.colorFirst.minBlobMovement,
          minBlobLifetime: config.motionDetection.colorFirst.minBlobLifetime
        }
      );
      console.log('[MotionV2] Color-first detection mode enabled');
    }
    
    //initialize temporal shadow detector if advanced features enabled
    this.temporalDetector = null;
    if (config.motionDetection.shadowRemoval?.advanced && 
        config.motionDetection.shadowRemoval?.temporal?.enabled) {
      this.temporalDetector = new TemporalShadowDetector({
        width: config.motionDetection.width,
        height: config.motionDetection.height,
        bufferSize: config.motionDetection.shadowRemoval.temporal.bufferSize,
        minShadowConsistency: config.motionDetection.shadowRemoval.temporal.minConsistency,
        enabled: true
      });
      console.log('[MotionV2] Temporal shadow detector initialized');
    }
    
    //initialize region analyzer if enabled
    this.regionAnalyzer = null;
    if (config.motionDetection.shadowRemoval?.advanced &&
        config.motionDetection.shadowRemoval?.regionAnalysis?.enabled) {
      this.regionAnalyzer = new RegionAnalyzer({
        width: config.motionDetection.width,
        height: config.motionDetection.height,
        gridSize: config.motionDetection.shadowRemoval.regionAnalysis.gridSize,
        enabled: true,
        motionThreshold: config.motionDetection.threshold
      });
      console.log('[MotionV2] Region analyzer initialized');
    }

    //interval for checking frames in milliseconds
    this.checkInterval = 1000 / config.motionDetection.fps;

    //initialize worker pool
    const workerConfig = config.motionDetection.workerPool || {};
    this.workerPool = new WorkerPoolManager({
      poolSize: workerConfig.size,
      maxQueueSize: workerConfig.maxQueueSize || 50,
      taskTimeout: workerConfig.taskTimeout || 5000
    });
    
    //performance metrics
    this.performanceMetrics = {
      framesProcessed: 0,
      framesDropped: 0,
      totalProcessingTime: 0,
      workerProcessingTime: 0,
      mainThreadProcessingTime: 0
    };

    this.init();
    console.log(`[MotionV2] Motion detection enabled with worker threads. Processing at ${config.motionDetection.fps} FPS`);
    if (this.shadowRemovalEnabled) {
      console.log(`[MotionV2] Shadow removal enabled with intensity ${this.shadowRemovalIntensity}`);
    }
    
    //log ignored Y ranges configuration
    if (config.motionDetection.ignoredYRanges && config.motionDetection.ignoredYRanges.length > 0) {
      console.log(`[MotionV2] Ignoring Y ranges:`, config.motionDetection.ignoredYRanges);
    }
  }

  init() {
    //listen for sampled frame events from mjpegProxy for motion detection
    //this reduces overhead by only processing frames at motion detection FPS
    this.mjpegProxy.on('motion-frame', (frame) => this.handleFrame(frame));
    
    console.log('[MotionV2] Listening for motion-frame events');
  }

  //pause motion detection
  pause(reason = 'manual') {
    this.isPaused = true;
    this.pauseReason = reason;
    console.log(`[MotionV2] Motion detection paused (reason: ${reason})`);
  }

  //resume motion detection
  resume() {
    const wasPaused = this.isPaused;
    this.isPaused = false;
    this.pauseReason = null;
    if (wasPaused) {
      console.log('[MotionV2] Motion detection resumed');
      //reset previous frame to avoid false positives when resuming
      this.previousFrameBuffer = null;
    }
  }

  async handleFrame(frame) {
    const now = Date.now();
    const startTime = now;
    
    //skip if paused
    if (this.isPaused) {
      return;
    }
    
    //skip if we're already processing or if it's too soon
    if (this.processing || now - this.lastCheckTime < this.checkInterval) {
      return;
    }

    this.processing = true;
    this.lastCheckTime = now;

    try {
      this.frameCount++;
      
      //log frame processing status every 60 frames (about 1 minute at 1 FPS)
      if (this.frameCount % 60 === 0) {
        console.log(`[MotionV2] Processing frame ${this.frameCount}, last motion: ${this.lastMotionTime ? new Date(this.lastMotionTime).toISOString() : 'never'}`);
        console.log(`[MotionV2] Performance - Frames: ${this.performanceMetrics.framesProcessed}, Dropped: ${this.performanceMetrics.framesDropped}, Avg worker time: ${(this.performanceMetrics.workerProcessingTime / this.performanceMetrics.framesProcessed).toFixed(2)}ms`);
      }
      
      //process the current frame using worker thread
      let currentFrameBuffer;
      try {
        const workerStartTime = Date.now();
        const result = await this.workerPool.processFrame(frame, {
          width: config.motionDetection.width,
          height: config.motionDetection.height,
          isColorMode: this.colorDetectionEnabled,
          shadowRemovalEnabled: this.shadowRemovalEnabled,
          shadowRemovalIntensity: this.shadowRemovalIntensity
        });
        
        currentFrameBuffer = result.processed;
        this.performanceMetrics.workerProcessingTime += (Date.now() - workerStartTime);
        
        //log worker processing time occasionally
        if (this.frameCount % 30 === 0) {
          console.log(`[MotionV2] Worker processing took ${result.processingTime}ms`);
        }
      } catch (error) {
        if (error.message === 'Task queue is full') {
          this.performanceMetrics.framesDropped++;
          console.warn('[MotionV2] Frame dropped - worker queue full');
          return;
        }
        throw error;
      }

      if (this.previousFrameBuffer) {
        //calculate difference between frames (this runs on main thread)
        const mainThreadStartTime = Date.now();
        
        let comparisonResult;
        let finalMotionDecision = false;
        let chickenValidation = null;
        
        //color-first mode: detect chicken blobs first, then check if they moved
        if (this.detectionMode === 'color_first' && this.colorBlobTracker) {
          const colorMotionResult = this.colorBlobTracker.processFrame(
            currentFrameBuffer,
            this.minBlobSize
          );
          
          finalMotionDecision = colorMotionResult.motionDetected;
          
          if (this.frameCount % 10 === 0) {
            if (colorMotionResult.motionDetected) {
              console.log(`[MotionV2] Color-first detection - Motion detected! Moving blobs: ${colorMotionResult.movingBlobs.length}, Total blobs: ${colorMotionResult.totalBlobs}, Tracked: ${colorMotionResult.trackedBlobs}`);
            } else {
              console.log(`[MotionV2] Color-first detection - No motion. Total blobs: ${colorMotionResult.totalBlobs}, Tracked: ${colorMotionResult.trackedBlobs}`);
            }
          }
          
          //skip traditional motion detection in color-first mode
          comparisonResult = {
            changedPixels: 0,
            normalizedDifference: 0,
            shadowPixels: 0,
            shadowRatio: 0
          };
        } else if (this.colorDetectionEnabled) {
          //use color-aware comparison
          if (this.shadowRemovalEnabled && config.motionDetection.shadowRemoval?.adaptiveThreshold) {
            const timeThresholds = getTimeBasedThresholds();
            comparisonResult = calculateColorShadowAwareDifference(
              currentFrameBuffer, 
              this.previousFrameBuffer,
              {
                baseThreshold: timeThresholds.baseThreshold,
                shadowThreshold: config.motionDetection.shadowRemoval.pixelThreshold || timeThresholds.shadowThreshold,
                colorThreshold: 40,
                width: config.motionDetection.width,
                ignoredRanges: config.motionDetection.ignoredYRanges
              }
            );
          } else {
            //simple color comparison
            const changedPixels = this.calculateDifference(currentFrameBuffer, this.previousFrameBuffer, true);
            const ignoredPixelCount = calculateIgnoredPixelCount(
              config.motionDetection.width,
              config.motionDetection.height,
              config.motionDetection.ignoredYRanges
            );
            const effectivePixelCount = (currentFrameBuffer.length / 3) - ignoredPixelCount;
            
            comparisonResult = {
              changedPixels,
              normalizedDifference: effectivePixelCount > 0 ? changedPixels / effectivePixelCount : 0,
              shadowPixels: 0,
              shadowRatio: 0
            };
          }
        } else if (this.shadowRemovalEnabled && config.motionDetection.shadowRemoval?.adaptiveThreshold) {
          //use shadow-aware comparison with time-based thresholds
          const timeThresholds = getTimeBasedThresholds();
          comparisonResult = calculateShadowAwareDifference(
            currentFrameBuffer, 
            this.previousFrameBuffer,
            {
              baseThreshold: timeThresholds.baseThreshold,
              shadowThreshold: config.motionDetection.shadowRemoval.pixelThreshold || timeThresholds.shadowThreshold,
              adaptiveThreshold: true,
              width: config.motionDetection.width,
              ignoredRanges: config.motionDetection.ignoredYRanges
            }
          );
        } else {
          //use original simple comparison
          const changedPixels = this.calculateDifference(currentFrameBuffer, this.previousFrameBuffer, false);
          //calculate effective pixel count (excluding ignored ranges)
          const ignoredPixelCount = calculateIgnoredPixelCount(
            config.motionDetection.width,
            config.motionDetection.height,
            config.motionDetection.ignoredYRanges
          );
          const effectivePixelCount = currentFrameBuffer.length - ignoredPixelCount;
          
          comparisonResult = {
            changedPixels,
            normalizedDifference: effectivePixelCount > 0 ? changedPixels / effectivePixelCount : 0,
            shadowPixels: 0,
            shadowRatio: 0
          };
        }
        
        let normalizedDifference = comparisonResult.normalizedDifference;
        
        //temporal shadow analysis if enabled
        let temporalAnalysis = null;
        if (this.temporalDetector) {
          temporalAnalysis = this.temporalDetector.processFrame(currentFrameBuffer, {
            timestamp: now,
            comparisonResult
          });
          
          //adjust motion detection based on temporal analysis
          if (temporalAnalysis.temporalShadowsDetected && temporalAnalysis.confidence > 0.7) {
            //reduce sensitivity when temporal shadows detected
            const reductionFactor = 1 - (temporalAnalysis.confidence * 0.5);
            normalizedDifference *= reductionFactor;
            
            if (this.frameCount % 10 === 0) {
              console.log(`[MotionV2] Temporal shadows detected - Confidence: ${(temporalAnalysis.confidence * 100).toFixed(2)}%, Adjusted difference: ${(normalizedDifference * 100).toFixed(4)}%`);
            }
          }
        }
        
        //region-based analysis if enabled
        let regionAnalysis = null;
        if (this.detectionMode !== 'color_first') {
          finalMotionDecision = normalizedDifference > config.motionDetection.threshold;
        }
        
        if (this.regionAnalyzer && this.detectionMode !== 'color_first') {
          regionAnalysis = this.regionAnalyzer.analyzeRegions(
            currentFrameBuffer,
            this.previousFrameBuffer,
            comparisonResult
          );
          
          //use regional voting for final decision
          if (regionAnalysis.regionsAnalyzed) {
            finalMotionDecision = regionAnalysis.motionDetected;
            
            if (this.frameCount % 10 === 0) {
              console.log(`[MotionV2] Region analysis - Active regions: ${regionAnalysis.activeRegions}/${regionAnalysis.totalRegions}, Shadow regions: ${regionAnalysis.shadowRegions}, Motion: ${regionAnalysis.motionDetected ? 'Yes' : 'No'}, Confidence: ${(regionAnalysis.confidence * 100).toFixed(2)}%`);
            }
          }
        }
        
        this.performanceMetrics.mainThreadProcessingTime += (Date.now() - mainThreadStartTime);
        
        //enhanced logging for shadow removal (skip in color-first mode)
        if (this.frameCount % 10 === 0 && this.detectionMode !== 'color_first') {
          if (this.shadowRemovalEnabled) {
            let logMsg = `[MotionV2] Frame comparison - Difference: ${(normalizedDifference * 100).toFixed(4)}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(4)}%, Shadow pixels: ${comparisonResult.shadowPixels}, Shadow ratio: ${(comparisonResult.shadowRatio * 100).toFixed(2)}%`;
            if (temporalAnalysis) {
              logMsg += `, Temporal: ${temporalAnalysis.temporalShadowsDetected ? 'Yes' : 'No'}`;
            }
            if (regionAnalysis) {
              logMsg += `, Regions: ${regionAnalysis.activeRegions}/${regionAnalysis.totalRegions}`;
            }
            console.log(logMsg);
          } else {
            console.log(`[MotionV2] Frame comparison - Difference: ${(normalizedDifference * 100).toFixed(4)}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(4)}%`);
          }
        }

        //chicken color validation if enabled (skip in color-first mode)
        if (this.colorDetectionEnabled && finalMotionDecision && this.detectionMode !== 'color_first') {
          chickenValidation = validateChickenMotion(
            currentFrameBuffer,
            config.motionDetection.width,
            config.motionDetection.height,
            {
              minChickenRatio: this.minChickenRatio,
              minBlobSize: this.minBlobSize,
              requireBlob: true
            }
          );
          
          //update final decision based on chicken detection
          if (!chickenValidation.isChicken) {
            finalMotionDecision = false;
            if (this.frameCount % 10 === 0) {
              console.log(`[MotionV2] Chicken validation failed - Reason: ${chickenValidation.reason}, Chicken pixels: ${(chickenValidation.colorAnalysis.chickenRatio * 100).toFixed(2)}%`);
            }
          } else {
            if (this.frameCount % 10 === 0) {
              console.log(`[MotionV2] Chicken detected - Dominant color: ${chickenValidation.colorAnalysis.dominantColor}, Blobs: ${chickenValidation.blobs?.length || 0}, Chicken pixels: ${(chickenValidation.colorAnalysis.chickenRatio * 100).toFixed(2)}%`);
            }
          }
        }
        
        //check if motion detected and cooldown period has passed
        if (finalMotionDecision && 
            now - this.lastMotionTime > config.motionDetection.cooldownMs) {
          
          this.lastMotionTime = now;
          const motionData = {
            id: `motion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            timestampMs: now,
            difference: normalizedDifference,
            threshold: config.motionDetection.threshold,
            intensity: (normalizedDifference * 100).toFixed(2)
          };
          
          console.log(`[MotionV2] DETECTED! Timestamp: ${motionData.timestamp}, Intensity: ${motionData.intensity}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(2)}%`);
          console.log(`[MotionV2] Emitting motion event with ID: ${motionData.id}`);
          
          try {
            this.eventEmitter.emit('motion', motionData);
            this.eventEmitter.emit('motion-start', motionData);
            console.log('[MotionV2] Motion events emitted successfully');
          } catch (emitError) {
            console.error('[MotionV2] Error emitting motion events:', emitError);
          }
        }
      }

      //store current frame for next comparison
      this.previousFrameBuffer = currentFrameBuffer;
      
      //update performance metrics
      this.performanceMetrics.framesProcessed++;
      this.performanceMetrics.totalProcessingTime += (Date.now() - startTime);
      
    } catch (error) {
      console.error('[MotionV2] Error processing frame:', error.message);
      console.error('[MotionV2] Stack trace:', error.stack);
      //don't update previous frame on error to avoid false positives
    } finally {
      this.processing = false;
    }
  }

  calculateDifference(buffer1, buffer2, isColorMode = null) {
    //use instance color detection setting if not explicitly provided
    if (isColorMode === null) {
      isColorMode = this.colorDetectionEnabled || false;
    }
    let changedPixels = 0;
    const length = buffer1.length;
    const pixelThreshold = 25; //minimum pixel difference to count as changed (0-255)
    const colorThreshold = 40; //threshold for color mode
    const width = config.motionDetection.width;
    const ignoredRanges = config.motionDetection.ignoredYRanges;
    
    if (isColorMode) {
      //color mode: process RGB pixels
      for (let i = 0; i < length; i += 3) {
        const pixelIndex = i / 3;
        
        //skip pixels in ignored Y ranges
        if (shouldIgnorePixel(pixelIndex, width, ignoredRanges)) {
          continue;
        }
        
        //calculate color channel differences
        const rDiff = Math.abs(buffer1[i] - buffer2[i]);
        const gDiff = Math.abs(buffer1[i + 1] - buffer2[i + 1]);
        const bDiff = Math.abs(buffer1[i + 2] - buffer2[i + 2]);
        
        //use max channel difference
        const maxDiff = Math.max(rDiff, gDiff, bDiff);
        
        if (maxDiff > colorThreshold) {
          changedPixels++;
        }
      }
    } else {
      //grayscale mode: original logic
      for (let i = 0; i < length; i++) {
        //skip pixels in ignored Y ranges
        if (shouldIgnorePixel(i, width, ignoredRanges)) {
          continue;
        }
        
        const pixelDiff = Math.abs(buffer1[i] - buffer2[i]);
        if (pixelDiff > pixelThreshold) {
          changedPixels++;
        }
      }
    }
    
    //return the number of changed pixels
    return changedPixels;
  }

  //get current motion detection status
  async getStatus() {
    const workerStats = await this.workerPool.getStats();
    
    const status = {
      enabled: config.motionDetection.enabled,
      processing: this.processing,
      lastCheckTime: this.lastCheckTime,
      lastMotionTime: this.lastMotionTime,
      fps: config.motionDetection.fps,
      threshold: config.motionDetection.threshold,
      imageSize: `${config.motionDetection.width}x${config.motionDetection.height}`,
      shadowRemoval: {
        enabled: this.shadowRemovalEnabled,
        advanced: config.motionDetection.shadowRemoval?.advanced || false
      },
      ignoredYRanges: config.motionDetection.ignoredYRanges,
      ignoredPixelCount: calculateIgnoredPixelCount(
        config.motionDetection.width,
        config.motionDetection.height,
        config.motionDetection.ignoredYRanges
      ),
      workerPool: workerStats,
      performance: {
        ...this.performanceMetrics,
        averageProcessingTime: this.performanceMetrics.framesProcessed > 0
          ? this.performanceMetrics.totalProcessingTime / this.performanceMetrics.framesProcessed
          : 0,
        averageWorkerTime: this.performanceMetrics.framesProcessed > 0
          ? this.performanceMetrics.workerProcessingTime / this.performanceMetrics.framesProcessed
          : 0,
        averageMainThreadTime: this.performanceMetrics.framesProcessed > 0
          ? this.performanceMetrics.mainThreadProcessingTime / this.performanceMetrics.framesProcessed
          : 0
      }
    };
    
    //add temporal detector status if available
    if (this.temporalDetector) {
      status.temporalAnalysis = this.temporalDetector.getSummary();
    }
    
    //add region analyzer status if available
    if (this.regionAnalyzer) {
      status.regionAnalysis = this.regionAnalyzer.getSummary();
    }
    
    return status;
  }
  
  //cleanup method
  async shutdown() {
    console.log('[MotionV2] Shutting down motion detection service');
    
    //remove event listeners
    if (this.mjpegProxy) {
      this.mjpegProxy.removeAllListeners('motion-frame');
    }
    
    //shutdown worker pool
    if (this.workerPool) {
      await this.workerPool.shutdown();
    }
    
    console.log('[MotionV2] Motion detection service shut down complete');
  }
}

export default MotionDetectionServiceV2;