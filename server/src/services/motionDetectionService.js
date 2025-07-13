import sharp from 'sharp';
import { config } from '../config.js';
import { 
  normalizeIllumination, 
  calculateShadowAwareDifference, 
  saveDebugFrame,
  getTimeBasedThresholds 
} from '../utils/shadowRemovalUtils.js';
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

class MotionDetectionService {
  constructor(mjpegProxy, eventEmitter) {
    console.log('[Motion] Initializing motion detection service...');
    console.log('[Motion] Config enabled:', config.motionDetection.enabled);
    console.log('[Motion] Config threshold:', config.motionDetection.threshold);
    
    if (!config.motionDetection.enabled) {
      console.log('[Motion] Motion detection is disabled');
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
        
        if (this.shadowRemovalEnabled && config.motionDetection.shadowRemoval?.adaptiveThreshold) {
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
          const changedPixels = this.calculateDifference(currentFrameBuffer, this.previousFrameBuffer);
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
        let finalMotionDecision = normalizedDifference > config.motionDetection.threshold;
        
        if (this.regionAnalyzer) {
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
        
        //enhanced logging for shadow removal
        if (this.frameCount % 10 === 0) {
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
            this.eventEmitter.emit('motion', motionData);
            this.eventEmitter.emit('motion-start', motionData);
            console.log('[Motion] Motion events emitted successfully');
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
    //resize, convert to grayscale, and get raw pixel data
    let processed = await sharp(frame)
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
    
    return processed;
  }

  calculateDifference(buffer1, buffer2) {
    let changedPixels = 0;
    const length = buffer1.length;
    const pixelThreshold = 25; //minimum pixel difference to count as changed (0-255)
    const width = config.motionDetection.width;
    const ignoredRanges = config.motionDetection.ignoredYRanges;
    
    //count pixels that have changed significantly
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