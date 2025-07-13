import { describe, it, expect, vi, beforeEach } from 'vitest';
import MotionDetectionService from '../services/motionDetectionService.js';
import { config } from '../config.js';
import EventEmitter from 'events';

describe('Motion Detection Y-Coordinate Filtering', () => {
  let service;
  let mjpegProxy;
  let eventEmitter;

  beforeEach(() => {
    //save original config
    const originalConfig = { ...config.motionDetection };
    
    //mock mjpegProxy
    mjpegProxy = new EventEmitter();
    mjpegProxy.on = vi.fn(mjpegProxy.on.bind(mjpegProxy));
    
    //mock event emitter
    eventEmitter = new EventEmitter();
    eventEmitter.emit = vi.fn();
    
    //restore config after each test
    return () => {
      config.motionDetection = originalConfig;
    };
  });

  it('should apply Y-coordinate filtering in calculateDifference', () => {
    //configure motion detection with ignored Y ranges
    config.motionDetection.enabled = true;
    config.motionDetection.width = 10;
    config.motionDetection.height = 10;
    config.motionDetection.ignoredYRanges = [
      { start: 0, end: 2 },   // ignore top 3 rows (30 pixels)
      { start: 8, end: 9 }    // ignore bottom 2 rows (20 pixels)
    ];
    
    service = new MotionDetectionService(mjpegProxy, eventEmitter);
    
    //create two buffers with differences only in ignored areas
    const buffer1 = new Uint8Array(100).fill(100);
    const buffer2 = new Uint8Array(100).fill(100);
    
    //add differences in ignored top area (Y=0-2)
    for (let y = 0; y <= 2; y++) {
      for (let x = 0; x < 10; x++) {
        buffer2[y * 10 + x] = 200; // big difference
      }
    }
    
    //add differences in ignored bottom area (Y=8-9)
    for (let y = 8; y <= 9; y++) {
      for (let x = 0; x < 10; x++) {
        buffer2[y * 10 + x] = 200; // big difference
      }
    }
    
    //calculate difference - should return 0 as all changes are in ignored areas
    const changedPixels = service.calculateDifference(buffer1, buffer2);
    expect(changedPixels).toBe(0);
    
    //now add a difference in non-ignored area (Y=5)
    buffer2[50] = 200; // pixel at Y=5, X=0
    const changedPixelsWithValid = service.calculateDifference(buffer1, buffer2);
    expect(changedPixelsWithValid).toBe(1);
  });

  it('should calculate normalized difference correctly with ignored pixels', () => {
    //configure motion detection
    config.motionDetection.enabled = true;
    config.motionDetection.width = 10;
    config.motionDetection.height = 10;
    config.motionDetection.ignoredYRanges = [
      { start: 0, end: 1 }    // ignore top 2 rows (20 pixels)
    ];
    
    service = new MotionDetectionService(mjpegProxy, eventEmitter);
    
    //spy on calculateDifference to verify it's called
    const calculateDiffSpy = vi.spyOn(service, 'calculateDifference');
    
    //create buffers with some differences
    const buffer1 = new Uint8Array(100).fill(100);
    const buffer2 = new Uint8Array(100).fill(100);
    
    //add 10 changed pixels in valid area
    for (let i = 30; i < 40; i++) {
      buffer2[i] = 200;
    }
    
    //simulate frame processing by calling handleFrame
    service.previousFrameBuffer = buffer1;
    
    //we need to mock the processImage method to return our test buffer
    service.processImage = vi.fn().mockResolvedValue(buffer2);
    
    //process frame
    service.handleFrame(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]));
    
    //wait for setImmediate to complete
    return new Promise(resolve => {
      setImmediate(() => {
        expect(calculateDiffSpy).toHaveBeenCalledWith(buffer2, buffer1, false);
        resolve();
      });
    });
  });

  it('should respect empty ignored ranges configuration', () => {
    //configure with no ignored ranges
    config.motionDetection.enabled = true;
    config.motionDetection.width = 10;
    config.motionDetection.height = 10;
    config.motionDetection.ignoredYRanges = [];
    
    service = new MotionDetectionService(mjpegProxy, eventEmitter);
    
    //create buffers with differences
    const buffer1 = new Uint8Array(100).fill(100);
    const buffer2 = new Uint8Array(100).fill(200);
    
    //all pixels should be counted as changed
    const changedPixels = service.calculateDifference(buffer1, buffer2);
    expect(changedPixels).toBe(100);
  });
});