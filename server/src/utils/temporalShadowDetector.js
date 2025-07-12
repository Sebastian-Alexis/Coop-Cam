/**
 * Temporal Shadow Detector
 * Analyzes frame history to identify consistent shadow patterns
 * and distinguish them from actual motion
 */

/**
 * Circular buffer for efficient frame history management
 */
class CircularFrameBuffer {
  constructor(capacity = 5) {
    this.capacity = capacity;
    this.frames = new Array(capacity);
    this.metadata = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  /**
   * Add a frame to the buffer
   * @param {Buffer} frame - Raw pixel data
   * @param {Object} metadata - Frame metadata (timestamp, brightness, etc.)
   */
  push(frame, metadata) {
    this.frames[this.head] = frame;
    this.metadata[this.head] = metadata;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  /**
   * Get frame by index (0 = newest, capacity-1 = oldest)
   */
  get(index) {
    if (index >= this.size) return null;
    const bufferIndex = (this.head - 1 - index + this.capacity) % this.capacity;
    return {
      frame: this.frames[bufferIndex],
      metadata: this.metadata[bufferIndex]
    };
  }

  /**
   * Get all frames in order (newest to oldest)
   */
  getAll() {
    const result = [];
    for (let i = 0; i < this.size; i++) {
      result.push(this.get(i));
    }
    return result;
  }

  clear() {
    this.frames = new Array(this.capacity);
    this.metadata = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }

  isFull() {
    return this.size === this.capacity;
  }
}

/**
 * Motion vector for tracking movement between frames
 */
class MotionVector {
  constructor(dx, dy, magnitude) {
    this.dx = dx;
    this.dy = dy;
    this.magnitude = magnitude;
  }

  /**
   * Check if this vector represents consistent shadow movement
   * Shadows move uniformly in one direction
   */
  isShadowLike(threshold = 0.8) {
    //shadows have consistent direction
    return this.magnitude > 0 && this.magnitude < threshold;
  }
}

/**
 * Main temporal shadow detection class
 */
export class TemporalShadowDetector {
  constructor(options = {}) {
    this.frameBuffer = new CircularFrameBuffer(options.bufferSize || 5);
    this.frameWidth = options.width || 100;
    this.frameHeight = options.height || 100;
    this.pixelCount = this.frameWidth * this.frameHeight;
    
    //shadow movement patterns
    this.shadowPatterns = [];
    this.motionVectors = [];
    
    //configuration
    this.minShadowConsistency = options.minShadowConsistency || 0.7;
    this.shadowVelocityThreshold = options.shadowVelocityThreshold || 0.3;
    this.enabled = options.enabled !== false;
  }

  /**
   * Process a new frame and update temporal analysis
   * @param {Buffer} frame - Current frame buffer
   * @param {Object} metadata - Frame metadata
   * @returns {Object} Temporal analysis results
   */
  processFrame(frame, metadata = {}) {
    if (!this.enabled) {
      return { temporalShadowsDetected: false };
    }

    //add frame to buffer
    const frameMetadata = {
      ...metadata,
      timestamp: Date.now(),
      avgBrightness: this.calculateAverageBrightness(frame)
    };
    
    this.frameBuffer.push(Buffer.from(frame), frameMetadata);

    //need at least 3 frames for meaningful analysis
    if (this.frameBuffer.size < 3) {
      return { 
        temporalShadowsDetected: false,
        bufferSize: this.frameBuffer.size,
        message: 'Building frame history...'
      };
    }

    //analyze temporal consistency
    const analysis = this.analyzeTemporalConsistency();
    
    return analysis;
  }

  /**
   * Analyze frame history for shadow patterns
   */
  analyzeTemporalConsistency() {
    const frames = this.frameBuffer.getAll();
    const currentFrame = frames[0];
    const previousFrame = frames[1];
    
    if (!currentFrame || !previousFrame) {
      return { temporalShadowsDetected: false };
    }

    //calculate motion vectors between consecutive frames
    const motionVectors = this.calculateMotionVectors(
      currentFrame.frame, 
      previousFrame.frame
    );

    //identify shadow regions based on consistent movement
    const shadowRegions = this.identifyShadowRegions(motionVectors);

    //analyze shadow movement patterns across multiple frames
    const shadowMovement = this.analyzeShadowMovement(frames);

    //calculate confidence in shadow detection
    const confidence = this.calculateShadowConfidence(
      shadowRegions, 
      shadowMovement
    );

    return {
      temporalShadowsDetected: confidence > this.minShadowConsistency,
      confidence,
      shadowRegions: shadowRegions.length,
      consistentMovement: shadowMovement.isConsistent,
      averageVelocity: shadowMovement.avgVelocity,
      bufferSize: this.frameBuffer.size,
      analysis: {
        motionVectors: motionVectors.length,
        shadowPixels: shadowRegions.reduce((sum, r) => sum + r.pixelCount, 0),
        movementAngle: shadowMovement.angle,
        frameTimeDelta: currentFrame.metadata.timestamp - previousFrame.metadata.timestamp
      }
    };
  }

  /**
   * Calculate motion vectors between two frames
   */
  calculateMotionVectors(frame1, frame2) {
    const vectors = [];
    const blockSize = 10; //analyze in 10x10 blocks for efficiency
    
    for (let y = 0; y < this.frameHeight; y += blockSize) {
      for (let x = 0; x < this.frameWidth; x += blockSize) {
        const motion = this.calculateBlockMotion(
          frame1, frame2, x, y, blockSize
        );
        
        if (motion.magnitude > 0.1) { //ignore tiny movements
          vectors.push({
            x, y,
            motion,
            isShadow: motion.isShadowLike()
          });
        }
      }
    }
    
    return vectors;
  }

  /**
   * Calculate motion for a block of pixels
   */
  calculateBlockMotion(frame1, frame2, startX, startY, blockSize) {
    let sumDx = 0;
    let sumDy = 0;
    let count = 0;
    
    //simple block matching (can be optimized with better algorithms)
    const searchRadius = 5;
    let minDiff = Infinity;
    let bestDx = 0;
    let bestDy = 0;
    
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const diff = this.calculateBlockDifference(
          frame1, frame2, 
          startX, startY,
          startX + dx, startY + dy,
          blockSize
        );
        
        if (diff < minDiff) {
          minDiff = diff;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    
    const magnitude = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
    return new MotionVector(bestDx, bestDy, magnitude);
  }

  /**
   * Calculate difference between two blocks
   */
  calculateBlockDifference(frame1, frame2, x1, y1, x2, y2, blockSize) {
    let diff = 0;
    let count = 0;
    
    for (let dy = 0; dy < blockSize; dy++) {
      for (let dx = 0; dx < blockSize; dx++) {
        const px1 = x1 + dx;
        const py1 = y1 + dy;
        const px2 = x2 + dx;
        const py2 = y2 + dy;
        
        //check bounds
        if (px1 >= 0 && px1 < this.frameWidth && 
            py1 >= 0 && py1 < this.frameHeight &&
            px2 >= 0 && px2 < this.frameWidth && 
            py2 >= 0 && py2 < this.frameHeight) {
          
          const idx1 = py1 * this.frameWidth + px1;
          const idx2 = py2 * this.frameWidth + px2;
          
          diff += Math.abs(frame1[idx1] - frame2[idx2]);
          count++;
        }
      }
    }
    
    return count > 0 ? diff / count : Infinity;
  }

  /**
   * Identify regions likely to be shadows based on motion patterns
   */
  identifyShadowRegions(motionVectors) {
    const shadowRegions = [];
    
    //group nearby vectors with similar motion
    const visited = new Set();
    
    for (let i = 0; i < motionVectors.length; i++) {
      if (visited.has(i) || !motionVectors[i].isShadow) continue;
      
      const region = this.expandShadowRegion(motionVectors, i, visited);
      if (region.pixelCount > 100) { //minimum size for shadow region
        shadowRegions.push(region);
      }
    }
    
    return shadowRegions;
  }

  /**
   * Expand shadow region from a seed point
   */
  expandShadowRegion(vectors, seedIndex, visited) {
    const queue = [seedIndex];
    const region = {
      vectors: [],
      pixelCount: 0,
      avgMotion: { dx: 0, dy: 0 }
    };
    
    while (queue.length > 0) {
      const idx = queue.shift();
      if (visited.has(idx)) continue;
      
      visited.add(idx);
      const vector = vectors[idx];
      region.vectors.push(vector);
      region.pixelCount += 100; //10x10 block
      
      //find neighboring vectors with similar motion
      for (let i = 0; i < vectors.length; i++) {
        if (!visited.has(i) && this.isNeighbor(vector, vectors[i]) &&
            this.hasSimilarMotion(vector.motion, vectors[i].motion)) {
          queue.push(i);
        }
      }
    }
    
    //calculate average motion
    if (region.vectors.length > 0) {
      region.avgMotion.dx = region.vectors.reduce((sum, v) => sum + v.motion.dx, 0) / region.vectors.length;
      region.avgMotion.dy = region.vectors.reduce((sum, v) => sum + v.motion.dy, 0) / region.vectors.length;
    }
    
    return region;
  }

  /**
   * Check if two motion vectors are neighbors
   */
  isNeighbor(v1, v2) {
    const dist = Math.sqrt(
      Math.pow(v1.x - v2.x, 2) + 
      Math.pow(v1.y - v2.y, 2)
    );
    return dist <= 15; //within 1.5 blocks
  }

  /**
   * Check if two motions are similar (for shadow grouping)
   */
  hasSimilarMotion(m1, m2, threshold = 2) {
    const dxDiff = Math.abs(m1.dx - m2.dx);
    const dyDiff = Math.abs(m1.dy - m2.dy);
    return dxDiff <= threshold && dyDiff <= threshold;
  }

  /**
   * Analyze shadow movement patterns across multiple frames
   */
  analyzeShadowMovement(frames) {
    if (frames.length < 3) {
      return { isConsistent: false, avgVelocity: 0 };
    }
    
    const movements = [];
    
    //calculate movement between each consecutive pair
    for (let i = 0; i < frames.length - 1; i++) {
      const curr = frames[i];
      const prev = frames[i + 1];
      
      if (!curr || !prev) continue;
      
      const brightnessDiff = curr.metadata.avgBrightness - prev.metadata.avgBrightness;
      const timeDelta = curr.metadata.timestamp - prev.metadata.timestamp;
      
      movements.push({
        brightnessDiff,
        timeDelta,
        velocity: Math.abs(brightnessDiff) / Math.max(timeDelta, 1)
      });
    }
    
    //check consistency
    if (movements.length === 0) {
      return { isConsistent: false, avgVelocity: 0 };
    }
    
    const avgVelocity = movements.reduce((sum, m) => sum + m.velocity, 0) / movements.length;
    const velocityVariance = movements.reduce((sum, m) => 
      sum + Math.pow(m.velocity - avgVelocity, 2), 0
    ) / movements.length;
    
    //shadows have consistent velocity
    const isConsistent = velocityVariance < this.shadowVelocityThreshold;
    
    //calculate movement angle (simplified)
    const avgBrightnessDiff = movements.reduce((sum, m) => sum + m.brightnessDiff, 0) / movements.length;
    const angle = Math.atan2(avgBrightnessDiff, 1) * 180 / Math.PI;
    
    return {
      isConsistent,
      avgVelocity,
      velocityVariance,
      angle
    };
  }

  /**
   * Calculate confidence in shadow detection
   */
  calculateShadowConfidence(shadowRegions, shadowMovement) {
    let confidence = 0;
    
    //factor 1: number of shadow regions detected
    if (shadowRegions.length > 0) {
      confidence += Math.min(shadowRegions.length / 5, 0.3);
    }
    
    //factor 2: consistent movement patterns
    if (shadowMovement.isConsistent) {
      confidence += 0.4;
    }
    
    //factor 3: appropriate velocity (not too fast, not too slow)
    if (shadowMovement.avgVelocity > 0.01 && shadowMovement.avgVelocity < 0.5) {
      confidence += 0.3;
    }
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate average brightness of a frame
   */
  calculateAverageBrightness(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i];
    }
    return sum / frame.length;
  }

  /**
   * Get current analysis summary
   */
  getSummary() {
    return {
      enabled: this.enabled,
      bufferSize: this.frameBuffer.size,
      bufferCapacity: this.frameBuffer.capacity,
      hasSufficientHistory: this.frameBuffer.size >= 3,
      shadowPatternsDetected: this.shadowPatterns.length
    };
  }

  /**
   * Clear frame history and reset analysis
   */
  reset() {
    this.frameBuffer.clear();
    this.shadowPatterns = [];
    this.motionVectors = [];
  }
}

export default TemporalShadowDetector;