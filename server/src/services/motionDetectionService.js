import sharp from 'sharp';
import { config } from '../config.js';

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

    //interval for checking frames in milliseconds
    this.checkInterval = 1000 / config.motionDetection.fps;

    this.init();
    console.log(`[Motion] Motion detection enabled. Processing at ${config.motionDetection.fps} FPS`);
  }

  init() {
    //listen for sampled frame events from mjpegProxy for motion detection
    //this reduces overhead by only processing frames at motion detection FPS
    this.mjpegProxy.on('motion-frame', (frame) => this.handleFrame(frame));
    
    console.log('[Motion] Listening for motion-frame events');
  }

  async handleFrame(frame) {
    const now = Date.now();
    
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
        const changedPixels = this.calculateDifference(currentFrameBuffer, this.previousFrameBuffer);
        const totalPixels = currentFrameBuffer.length;
        const normalizedDifference = changedPixels / totalPixels; //percentage of pixels that changed
        
        //log every 10th comparison for debugging
        if (this.frameCount % 10 === 0) {
          console.log(`[Motion] Frame comparison - Difference: ${(normalizedDifference * 100).toFixed(4)}%, Threshold: ${(config.motionDetection.threshold * 100).toFixed(4)}%`);
        }

        //check if motion detected and cooldown period has passed
        if (normalizedDifference > config.motionDetection.threshold && 
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
    return sharp(frame)
      .resize(config.motionDetection.width, config.motionDetection.height, {
        fit: 'fill',
        kernel: sharp.kernel.nearest //fast resize
      })
      .grayscale()
      .raw()
      .toBuffer();
  }

  calculateDifference(buffer1, buffer2) {
    let changedPixels = 0;
    const length = buffer1.length;
    const pixelThreshold = 25; //minimum pixel difference to count as changed (0-255)
    
    //count pixels that have changed significantly
    for (let i = 0; i < length; i++) {
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
    return {
      enabled: config.motionDetection.enabled,
      processing: this.processing,
      lastCheckTime: this.lastCheckTime,
      lastMotionTime: this.lastMotionTime,
      fps: config.motionDetection.fps,
      threshold: config.motionDetection.threshold,
      imageSize: `${config.motionDetection.width}x${config.motionDetection.height}`
    };
  }
}

export default MotionDetectionService;