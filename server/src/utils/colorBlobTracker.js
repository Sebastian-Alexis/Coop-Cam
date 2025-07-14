//tracks chicken color blobs across frames for motion detection
import { ColorBlobDetector } from './colorDetectionUtils.js';

export class ColorBlobTracker {
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    
    //configuration
    this.maxMatchDistance = options.maxMatchDistance || 30; //max pixels between frames to match blobs
    this.minBlobMovement = options.minBlobMovement || 5; //min pixels moved to count as motion
    this.minBlobLifetime = options.minBlobLifetime || 2; //min frames blob must exist
    this.maxBlobAge = options.maxBlobAge || 10; //frames before removing stale blobs
    
    //state
    this.blobDetector = new ColorBlobDetector(width, height);
    this.trackedBlobs = new Map(); //blobId -> TrackedBlob
    this.nextBlobId = 1;
    this.frameCount = 0;
  }
  
  //process a new frame and detect motion
  processFrame(rgbBuffer, minBlobSize = 50) {
    this.frameCount++;
    
    //detect blobs in current frame
    const currentBlobs = this.blobDetector.detectChickenBlobs(rgbBuffer, minBlobSize);
    
    //match with tracked blobs
    const matches = this.matchBlobs(currentBlobs);
    
    //update tracked blobs
    const movingBlobs = this.updateTrackedBlobs(matches, currentBlobs);
    
    //cleanup old blobs
    this.cleanupStaleBlobs();
    
    //return motion detection result
    return {
      motionDetected: movingBlobs.length > 0,
      movingBlobs,
      totalBlobs: currentBlobs.length,
      trackedBlobs: this.trackedBlobs.size
    };
  }
  
  //match current frame blobs with tracked blobs
  matchBlobs(currentBlobs) {
    const matches = [];
    const unmatchedCurrent = new Set(currentBlobs);
    const unmatchedTracked = new Set(this.trackedBlobs.values());
    
    //greedy matching by closest centroid distance
    for (const tracked of unmatchedTracked) {
      let bestMatch = null;
      let bestDistance = this.maxMatchDistance;
      
      for (const current of unmatchedCurrent) {
        const distance = this.calculateDistance(
          tracked.lastCentroid,
          { x: current.centroidX, y: current.centroidY }
        );
        
        if (distance < bestDistance) {
          bestMatch = current;
          bestDistance = distance;
        }
      }
      
      if (bestMatch) {
        matches.push({
          tracked,
          current: bestMatch,
          distance: bestDistance
        });
        unmatchedCurrent.delete(bestMatch);
        unmatchedTracked.delete(tracked);
      }
    }
    
    return {
      matches,
      unmatchedCurrent: Array.from(unmatchedCurrent),
      unmatchedTracked: Array.from(unmatchedTracked)
    };
  }
  
  //update tracked blobs based on matches
  updateTrackedBlobs(matchResult, currentBlobs) {
    const movingBlobs = [];
    
    //update matched blobs
    for (const match of matchResult.matches) {
      const tracked = match.tracked;
      const current = match.current;
      
      //calculate movement
      const movement = this.calculateDistance(
        tracked.lastCentroid,
        { x: current.centroidX, y: current.centroidY }
      );
      
      //update tracked blob
      tracked.lastCentroid = { x: current.centroidX, y: current.centroidY };
      tracked.lastArea = current.area;
      tracked.lastColor = current.dominantColor;
      tracked.lifetime++;
      tracked.totalMovement += movement;
      tracked.lastSeen = this.frameCount;
      tracked.history.push({
        frame: this.frameCount,
        centroid: { x: current.centroidX, y: current.centroidY },
        movement
      });
      
      //keep history limited
      if (tracked.history.length > 10) {
        tracked.history.shift();
      }
      
      //check if this blob is moving significantly
      if (movement >= this.minBlobMovement && tracked.lifetime >= this.minBlobLifetime) {
        movingBlobs.push({
          id: tracked.id,
          movement,
          totalMovement: tracked.totalMovement,
          lifetime: tracked.lifetime,
          color: tracked.lastColor,
          centroid: tracked.lastCentroid,
          area: tracked.lastArea
        });
      }
    }
    
    //add new blobs for unmatched current blobs
    for (const blob of matchResult.unmatchedCurrent) {
      const id = this.nextBlobId++;
      const tracked = {
        id,
        firstSeen: this.frameCount,
        lastSeen: this.frameCount,
        lifetime: 1,
        lastCentroid: { x: blob.centroidX, y: blob.centroidY },
        lastArea: blob.area,
        lastColor: blob.dominantColor,
        totalMovement: 0,
        history: [{
          frame: this.frameCount,
          centroid: { x: blob.centroidX, y: blob.centroidY },
          movement: 0
        }]
      };
      this.trackedBlobs.set(id, tracked);
    }
    
    return movingBlobs;
  }
  
  //remove blobs that haven't been seen recently
  cleanupStaleBlobs() {
    const staleIds = [];
    
    for (const [id, blob] of this.trackedBlobs) {
      if (this.frameCount - blob.lastSeen > this.maxBlobAge) {
        staleIds.push(id);
      }
    }
    
    for (const id of staleIds) {
      this.trackedBlobs.delete(id);
    }
  }
  
  //calculate Euclidean distance between two points
  calculateDistance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  //get current state summary
  getSummary() {
    const blobs = Array.from(this.trackedBlobs.values());
    return {
      frameCount: this.frameCount,
      trackedBlobs: blobs.length,
      activeBlobs: blobs.filter(b => this.frameCount - b.lastSeen <= 1).length,
      averageLifetime: blobs.length > 0 
        ? blobs.reduce((sum, b) => sum + b.lifetime, 0) / blobs.length 
        : 0
    };
  }
  
  //reset tracker state
  reset() {
    this.trackedBlobs.clear();
    this.nextBlobId = 1;
    this.frameCount = 0;
  }
}