//buffer pool implementation to reduce memory allocation overhead
//reuses buffers instead of creating new ones for each frame

class BufferPool {
  constructor(poolSize = 10, bufferSize = 1024 * 1024) { //default 1MB buffers
    this.poolSize = poolSize;
    this.bufferSize = bufferSize;
    this.pool = [];
    this.available = [];
    this.inUse = new Set();
    
    //metrics
    this.stats = {
      created: 0,
      reused: 0,
      expanded: 0,
      currentSize: 0
    };
    
    //initialize pool
    this.initializePool();
  }
  
  initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      const buffer = Buffer.allocUnsafe(this.bufferSize);
      this.pool.push(buffer);
      this.available.push(buffer);
      this.stats.created++;
    }
    this.stats.currentSize = this.poolSize;
    
    console.log(`[BufferPool] Initialized with ${this.poolSize} buffers of ${this.bufferSize} bytes each`);
  }
  
  acquire(size = null) {
    //if specific size requested and it's larger than our buffer size, allocate new
    if (size && size > this.bufferSize) {
      console.warn(`[BufferPool] Requested size ${size} exceeds pool buffer size ${this.bufferSize}`);
      return Buffer.allocUnsafe(size);
    }
    
    //get buffer from pool
    let buffer = this.available.pop();
    
    //if no buffers available, expand the pool
    if (!buffer) {
      buffer = Buffer.allocUnsafe(this.bufferSize);
      this.pool.push(buffer);
      this.stats.created++;
      this.stats.expanded++;
      this.stats.currentSize++;
      
      if (this.stats.expanded % 5 === 0) {
        console.warn(`[BufferPool] Pool expanded ${this.stats.expanded} times. Consider increasing initial pool size.`);
      }
    } else {
      this.stats.reused++;
    }
    
    //track buffer in use
    this.inUse.add(buffer);
    
    //if specific size requested, return a slice
    if (size && size < this.bufferSize) {
      return buffer.subarray(0, size);
    }
    
    return buffer;
  }
  
  release(buffer) {
    //find the original buffer if this is a slice
    let originalBuffer = buffer;
    
    //check if this buffer is from our pool
    if (buffer.buffer && buffer.buffer instanceof ArrayBuffer) {
      //this might be a slice, find the original
      for (const poolBuffer of this.pool) {
        if (poolBuffer.buffer === buffer.buffer) {
          originalBuffer = poolBuffer;
          break;
        }
      }
    }
    
    //only release buffers that belong to our pool
    if (this.pool.includes(originalBuffer) && this.inUse.has(originalBuffer)) {
      this.inUse.delete(originalBuffer);
      this.available.push(originalBuffer);
      
      //optionally clear the buffer for security (disabled for performance)
      //originalBuffer.fill(0);
    }
  }
  
  //release all buffers currently in use
  releaseAll() {
    for (const buffer of this.inUse) {
      this.available.push(buffer);
    }
    this.inUse.clear();
  }
  
  getStats() {
    return {
      ...this.stats,
      available: this.available.length,
      inUse: this.inUse.size,
      utilizationPercent: (this.inUse.size / this.stats.currentSize) * 100
    };
  }
  
  //shrink pool if too many unused buffers
  shrink() {
    const targetSize = Math.max(this.poolSize, this.inUse.size + 2);
    
    while (this.stats.currentSize > targetSize && this.available.length > 0) {
      const buffer = this.available.pop();
      const index = this.pool.indexOf(buffer);
      if (index > -1) {
        this.pool.splice(index, 1);
        this.stats.currentSize--;
      }
    }
    
    console.log(`[BufferPool] Shrunk to ${this.stats.currentSize} buffers`);
  }
}

//singleton instance for frame buffers
let frameBufferPool = null;

export function getFrameBufferPool(poolSize = 20, bufferSize = 1024 * 1024) {
  if (!frameBufferPool) {
    frameBufferPool = new BufferPool(poolSize, bufferSize);
  }
  return frameBufferPool;
}

export default BufferPool;