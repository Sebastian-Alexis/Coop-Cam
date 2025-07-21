//circular buffer implementation for pre-recording frames
class CircularBufferService {
  constructor(duration = 3, fps = 30, copyFrames = false) {
    this.duration = duration;
    this.fps = fps;
    this.bufferSize = duration * fps; //total frames to store
    this.buffer = new Array(this.bufferSize);
    this.writeIndex = 0;
    this.wrapped = false;
    this.totalFramesWritten = 0;
    this.copyFrames = copyFrames; //whether to copy frames or store references
    
    console.log(`[CircularBuffer] Initialized with size ${this.bufferSize} (${duration}s @ ${fps}fps), copyFrames: ${copyFrames}`);
  }

  //add a frame to the buffer
  addFrame(frame, timestamp = Date.now()) {
    if (!frame || !Buffer.isBuffer(frame)) {
      console.error('[CircularBuffer] Invalid frame provided');
      return;
    }

    //store reference or copy based on configuration
    const frameData = this.copyFrames ? Buffer.from(frame) : frame;
    
    //store frame with metadata
    this.buffer[this.writeIndex] = {
      data: frameData,
      timestamp: timestamp,
      index: this.totalFramesWritten,
      isReference: !this.copyFrames
    };

    //advance write pointer
    this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    this.totalFramesWritten++;

    //mark as wrapped once we've filled the buffer
    if (this.writeIndex === 0 && !this.wrapped) {
      this.wrapped = true;
      console.log('[CircularBuffer] Buffer wrapped - now maintaining rolling window');
    }
  }

  //get all frames in chronological order
  getFrames() {
    if (!this.wrapped) {
      //buffer not full yet, return only written frames
      return this.buffer.slice(0, this.writeIndex).filter(f => f !== undefined);
    }

    //buffer is full, return frames in chronological order
    const frames = [];
    
    //start from oldest frame (next write position)
    for (let i = 0; i < this.bufferSize; i++) {
      const index = (this.writeIndex + i) % this.bufferSize;
      if (this.buffer[index]) {
        frames.push(this.buffer[index]);
      }
    }

    return frames;
  }

  //get frames from a specific timestamp range
  getFramesInRange(startTime, endTime) {
    const allFrames = this.getFrames();
    return allFrames.filter(frame => 
      frame.timestamp >= startTime && frame.timestamp <= endTime
    );
  }

  //clear the buffer
  clear() {
    this.buffer = new Array(this.bufferSize);
    this.writeIndex = 0;
    this.wrapped = false;
    this.totalFramesWritten = 0;
    console.log('[CircularBuffer] Buffer cleared');
  }

  //convert reference frames to copies (useful before saving to disk)
  convertToCopies() {
    const frames = this.getFrames();
    const copiedFrames = [];
    
    for (const frame of frames) {
      if (frame.isReference) {
        //create a deep copy of reference frame
        copiedFrames.push({
          ...frame,
          data: Buffer.from(frame.data),
          isReference: false
        });
      } else {
        //already a copy
        copiedFrames.push(frame);
      }
    }
    
    return copiedFrames;
  }
  
  //get buffer statistics
  getStats() {
    const frames = this.getFrames();
    const oldestFrame = frames[0];
    const newestFrame = frames[frames.length - 1];

    return {
      bufferSize: this.bufferSize,
      currentFrames: frames.length,
      wrapped: this.wrapped,
      totalFramesWritten: this.totalFramesWritten,
      oldestTimestamp: oldestFrame ? oldestFrame.timestamp : null,
      newestTimestamp: newestFrame ? newestFrame.timestamp : null,
      durationMs: oldestFrame && newestFrame ? 
        newestFrame.timestamp - oldestFrame.timestamp : 0,
      memoryUsageBytes: frames.reduce((sum, frame) => sum + frame.data.length, 0),
      usingReferences: !this.copyFrames,
      memoryMode: this.copyFrames ? 'copy' : 'reference'
    };
  }
}

export default CircularBufferService;