import sharp from 'sharp';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import { 
  normalizeIllumination, 
  calculateShadowAwareDifference, 
  saveDebugFrame,
  getTimeBasedThresholds 
} from '../utils/shadowRemovalUtils.js';
import {
  normalizeColorIllumination,
  calculateColorShadowAwareDifference,
  saveColorDebugFrame
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
  getDetectionRegionDescription 
} from '../utils/detectionRegionUtils.js';
import { 
  shouldIgnorePixel, 
  calculateIgnoredPixelCount 
} from '../utils/motionDetectionUtils.js';

class MotionDetectionService extends EventEmitter {
  constructor(mjpegProxy, eventEmitter) {
    super();
    console.log('[Motion] Initializing motion detection service...');
    console.log('[Motion] Config enabled:', config.motionDetection.enabled);
    console.log('[Motion] Config threshold:', config.motionDetection.threshold);
    
    if (!config.motionDetection.enabled) {
      console.log('[Motion] Motion detection is disabled');
      return;
    }

    this.eventEmitter = eventEmitter;
    this.mjpegProxy = mjpegProxy;
    this.sourceId = mjpegProxy.sourceId; //camera identifier for multi-camera support
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
      console.log('[Motion] Color-first detection mode enabled');
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
      console.log('[Motion] Temporal shadow detector initialized');
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
      console.log('[Motion] Region analyzer initialized');
    }

    //interval for checking frames in milliseconds
    this.checkInterval = 1000 / config.motionDetection.fps;

    this.init();
    console.log(`[Motion] Motion detection enabled. Processing at ${config.motionDetection.fps} FPS`);
    if (this.shadowRemovalEnabled) {
      console.log(`[Motion] Shadow removal enabled with intensity ${this.shadowRemovalIntensity}`);
    }
    
    //log ignored Y ranges configuration
    if (config.motionDetection.ignoredYRanges && config.motionDetection.ignoredYRanges.length > 0) {
      console.log(`[Motion] Ignoring Y ranges:`, config.motionDetection.ignoredYRanges);
    }
  }

  init() {
    //listen for sampled frame events from mjpegProxy for motion detection
    //this reduces overhead by only processing frames at motion detection FPS
    this.mjpegProxy.on('motion-frame', (frame) => this.handleFrame(frame));
    
    console.log('[Motion] Listening for motion-frame events');
  }

  //pause motion detection
  pause(reason = 'manual') {
    this.isPaused = true;
    this.pauseReason = reason;
    console.log(`[Motion] Motion detection paused (reason: ${reason})`);
  }

  //resume motion detection
  resume() {
    const wasPaused = this.isPaused;
    this.isPaused = false;
    this.pauseReason = null;
    if (wasPaused) {
      console.log('[Motion] Motion detection resumed');
      //reset previous frame to avoid false positives when resuming
      this.previousFrameBuffer = null;
    }
  }

  async handleFrame(frame) {
    const now = Date.now();
    
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

    //use setImmediate to prevent blocking the event loop
    setImmediate(async () => {
      try {
        this.frameCount++;
        
        //log frame processing status every 60 frames (about 1 minute at 1 FPS)
        if (this.frameCount % 60 === 0) {
          console.log(`[Motion] Processing frame ${this.frameCount}, last motion: ${this.lastMotionTime ? new Date(this.lastMotionTime).toISOString() : 'never'}`);
        }
        
        //process the current frame
        const currentFrameBuffer = await this.processImage(frame);

      if (this.previousFrameBuffer) {
        //calculate difference between frames
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
              console.log(`[Motion] Color-first detection - Motion detected! Moving blobs: ${colorMotionResult.movingBlobs.length}, Total blobs: ${colorMotionResult.totalBlobs}, Tracked: ${colorMotionResult.trackedBlobs}`);
              colorMotionResult.movingBlobs.forEach(blob => {
                console.log(`[Motion]   Blob ${blob.id}: ${blob.color} chicken moved ${blob.movement.toFixed(1)}px (lifetime: ${blob.lifetime} frames)`);
              });
            } else {
              console.log(`[Motion] Color-first detection - No motion. Total blobs: ${colorMotionResult.totalBlobs}, Tracked: ${colorMotionResult.trackedBlobs}`);
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
              console.log(`[Motion] Temporal shadows detected - Confidence: ${(temporalAnalysis.confidence * 100).toFixed(2)}%, Adjusted difference: ${(normalizedDifference * 100).toFixed(4)}%`);
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
              console.log(`[Motion] Region analysis - Active regions: ${regionAnalysis.activeRegions}/${regionAnalysis.totalRegions}, Shadow regions: ${regionAnalysis.shadowRegions}, Motion: ${regionAnalysis.motionDetected ? 'Yes' : 'No'}, Confidence: ${(regionAnalysis.confidence * 100).toFixed(2)}%`);
            }
          }
        }
        
        //enhanced logging for shadow removal (skip in color-first mode)
        if (this.frameCount % 10 === 0 && this.detectionMode !== 'color_first') {
          if (this.shadowRemovalEnabled) {
            let logMsg = `[Motion] Frame comparison - Difference: ${(normalizedDifference * 100).toFixed(4)}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(4)}%, Shadow pixels: ${comparisonResult.shadowPixels}, Shadow ratio: ${(comparisonResult.shadowRatio * 100).toFixed(2)}%`;
            if (temporalAnalysis) {
              logMsg += `, Temporal: ${temporalAnalysis.temporalShadowsDetected ? 'Yes' : 'No'}`;
            }
            if (regionAnalysis) {
              logMsg += `, Regions: ${regionAnalysis.activeRegions}/${regionAnalysis.totalRegions}`;
            }
            console.log(logMsg);
          } else {
            console.log(`[Motion] Frame comparison - Difference: ${(normalizedDifference * 100).toFixed(4)}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(4)}%`);
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
              console.log(`[Motion] Chicken validation failed - Reason: ${chickenValidation.reason}, Chicken pixels: ${(chickenValidation.colorAnalysis.chickenRatio * 100).toFixed(2)}%`);
            }
          } else {
            if (this.frameCount % 10 === 0) {
              console.log(`[Motion] Chicken detected - Dominant color: ${chickenValidation.colorAnalysis.dominantColor}, Blobs: ${chickenValidation.blobs?.length || 0}, Chicken pixels: ${(chickenValidation.colorAnalysis.chickenRatio * 100).toFixed(2)}%`);
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
          
          console.log(`[Motion] DETECTED! Timestamp: ${motionData.timestamp}, Intensity: ${motionData.intensity}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(2)}%`);
          console.log(`[Motion] Emitting motion event with ID: ${motionData.id}`);
          
          try {
            //add camera source information to motion data
            const motionEventData = {
              ...motionData,
              sourceId: this.sourceId //camera identifier for multi-camera recording
            };
            this.eventEmitter.emit('motion', motionEventData);
            this.eventEmitter.emit('motion-start', motionEventData);
            console.log(`[Motion] Motion events emitted successfully for camera: ${this.sourceId}`);
          } catch (emitError) {
            console.error('[Motion] Error emitting motion events:', emitError);
          }
        }
      }

      //store current frame for next comparison
      this.previousFrameBuffer = currentFrameBuffer;
      } catch (error) {
        console.error('[Motion] Error processing frame:', error.message);
        console.error('[Motion] Stack trace:', error.stack);
        //don't update previous frame on error to avoid false positives
      } finally {
        this.processing = false;
      }
    });
  }

  async processImage(frame) {
    let processed;
    const isColorMode = this.colorDetectionEnabled;
    
    if (isColorMode) {
      //resize and keep RGB color data
      processed = await sharp(frame)
        .resize(config.motionDetection.width, config.motionDetection.height, {
          fit: 'fill',
          kernel: sharp.kernel.nearest //fast resize
        })
        .raw()
        .toBuffer();
      
      //apply color-aware shadow removal if enabled
      if (this.shadowRemovalEnabled) {
        const startTime = Date.now();
        processed = await normalizeColorIllumination(
          processed, 
          config.motionDetection.width, 
          config.motionDetection.height,
          this.shadowRemovalIntensity
        );
        
        //log processing time occasionally
        if (this.frameCount % 30 === 0) {
          console.log(`[Motion] Color shadow removal took ${Date.now() - startTime}ms`);
        }
      }
      
      //save debug frames if enabled
      if (config.motionDetection.shadowRemoval?.debugFrames && this.frameCount % 10 === 0) {
        await saveColorDebugFrame(processed, {
          width: config.motionDetection.width,
          height: config.motionDetection.height,
          type: this.shadowRemovalEnabled ? 'color_shadow_removed' : 'color_original',
          timestamp: Date.now()
        }, this.debugPath);
      }
    } else {
      //original grayscale processing
      processed = await sharp(frame)
        .resize(config.motionDetection.width, config.motionDetection.height, {
          fit: 'fill',
          kernel: sharp.kernel.nearest //fast resize
        })
        .grayscale()
        .raw()
        .toBuffer();
      
      //apply shadow removal if enabled
      if (this.shadowRemovalEnabled) {
        const startTime = Date.now();
        processed = await normalizeIllumination(
          processed, 
          config.motionDetection.width, 
          config.motionDetection.height,
          this.shadowRemovalIntensity
        );
        
        //log processing time occasionally
        if (this.frameCount % 30 === 0) {
          console.log(`[Motion] Shadow removal took ${Date.now() - startTime}ms`);
        }
      }
      
      //save debug frames if enabled
      if (config.motionDetection.shadowRemoval?.debugFrames && this.frameCount % 10 === 0) {
        await saveDebugFrame(processed, {
          width: config.motionDetection.width,
          height: config.motionDetection.height,
          type: this.shadowRemovalEnabled ? 'shadow_removed' : 'original',
          timestamp: Date.now()
        }, this.debugPath);
      }
    }
    
    return processed;
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
  getStatus() {
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
      )
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
}

export default MotionDetectionService;