//centralized frame buffer management service
//manages buffer lifecycle and provides optimized frame handling

import { getFrameBufferPool } from '../utils/bufferPool.js';

class FrameBufferManager {
  constructor() {
    //initialize buffer pool with 30 buffers of 1MB each
    //this should handle most frame sizes efficiently
    this.framePool = getFrameBufferPool(30, 1024 * 1024);
    
    //pre-create boundary buffers for MJPEG streaming
    this.boundaryBuffers = this.initBoundaryBuffers();
    
    //track active buffers for lifecycle management
    this.activeBuffers = new Map();
    
    //stats for monitoring
    this.stats = {
      framesAcquired: 0,
      framesReleased: 0,
      activeFrames: 0,
      peakActiveFrames: 0
    };
  }
  
  initBoundaryBuffers() {
    //pre-create reusable MJPEG boundary buffers
    const boundary = 'mjpegBoundary';
    return {
      start: Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
      end: Buffer.from('\r\n'),
      boundary: boundary
    };
  }
  
  //acquire a buffer for frame data
  acquireFrameBuffer(size) {
    const buffer = this.framePool.acquire(size);
    
    //track buffer acquisition
    const id = `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.activeBuffers.set(id, {
      buffer,
      size,
      acquiredAt: Date.now(),
      released: false
    });
    
    //update stats
    this.stats.framesAcquired++;
    this.stats.activeFrames++;
    if (this.stats.activeFrames > this.stats.peakActiveFrames) {
      this.stats.peakActiveFrames = this.stats.activeFrames;
    }
    
    return { buffer, id, size };
  }
  
  //release a frame buffer back to the pool
  releaseFrameBuffer(id) {
    const bufferInfo = this.activeBuffers.get(id);
    if (!bufferInfo || bufferInfo.released) {
      return false;
    }
    
    //release buffer back to pool
    this.framePool.release(bufferInfo.buffer);
    
    //mark as released
    bufferInfo.released = true;
    bufferInfo.releasedAt = Date.now();
    
    //update stats
    this.stats.framesReleased++;
    this.stats.activeFrames--;
    
    //remove from tracking after a delay (for debugging)
    setTimeout(() => {
      this.activeBuffers.delete(id);
    }, 5000);
    
    return true;
  }
  
  //create a frame object with proper buffer management
  createFrame(sourceBuffer, jpegStart, jpegEnd) {
    const frameSize = jpegEnd + 2 - jpegStart;
    const { buffer, id, size } = this.acquireFrameBuffer(frameSize);
    
    //copy frame data to pool buffer
    sourceBuffer.copy(buffer, 0, jpegStart, jpegEnd + 2);
    
    return {
      buffer: buffer.subarray(0, frameSize), //return exact size view
      size: frameSize,
      pooled: true,
      poolId: id,
      timestamp: Date.now()
    };
  }
  
  //write frame with MJPEG boundaries without concatenation
  writeFrameToClient(client, frame, callback) {
    //write in sequence to avoid concatenation
    let writesPending = 3;
    let hasError = false;
    
    const onWriteComplete = (err) => {
      if (err) hasError = true;
      writesPending--;
      
      if (writesPending === 0) {
        //all writes complete, safe to release buffer if needed
        if (callback) callback(hasError ? new Error('Write failed') : null);
      }
    };
    
    //write boundary start
    client.write(this.boundaryBuffers.start, onWriteComplete);
    
    //write frame data
    if (frame.pooled && frame.buffer) {
      client.write(frame.buffer, onWriteComplete);
    } else {
      //fallback for non-pooled frames
      client.write(frame, onWriteComplete);
    }
    
    //write boundary end
    client.write(this.boundaryBuffers.end, onWriteComplete);
  }
  
  //get buffer pool statistics
  getStats() {
    return {
      ...this.stats,
      poolStats: this.framePool.getStats(),
      activeBufferDetails: Array.from(this.activeBuffers.entries()).map(([id, info]) => ({
        id,
        size: info.size,
        age: Date.now() - info.acquiredAt,
        released: info.released
      }))
    };
  }
  
  //cleanup old unreleased buffers (safety mechanism)
  cleanupStaleBuffers(maxAge = 60000) {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, info] of this.activeBuffers.entries()) {
      if (!info.released && (now - info.acquiredAt) > maxAge) {
        console.warn(`[FrameBufferManager] Cleaning up stale buffer ${id}, age: ${now - info.acquiredAt}ms`);
        this.releaseFrameBuffer(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[FrameBufferManager] Cleaned up ${cleaned} stale buffers`);
    }
    
    return cleaned;
  }
  
  //get MJPEG boundary buffers
  getBoundaryBuffers() {
    return this.boundaryBuffers;
  }
}

//singleton instance
let instance = null;

export function getFrameBufferManager() {
  if (!instance) {
    instance = new FrameBufferManager();
    
    //setup periodic cleanup of stale buffers
    setInterval(() => {
      instance.cleanupStaleBuffers();
    }, 30000); //every 30 seconds
  }
  return instance;
}

export default FrameBufferManager;