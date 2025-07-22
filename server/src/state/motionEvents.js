//motion events history management service with circular buffer
const MAX_HISTORY_LENGTH = 100;

class MotionEventsService {
  constructor() {
    this.events = [];
    this.head = 0;
    this.isFull = false;
  }

  //add a motion event to the circular buffer
  addEvent(eventData) {
    const eventWithTimestamp = {
      type: 'motion',
      timestamp: Date.now(),
      data: eventData,
      ...eventData
    };

    //add to circular buffer
    this.events[this.head] = eventWithTimestamp;
    this.head = (this.head + 1) % MAX_HISTORY_LENGTH;
    
    //mark as full when we've wrapped around
    if (this.head === 0 && this.events.length > 0) {
      this.isFull = true;
    }
    
    console.log(`[Motion Events] Event added. Buffer size: ${this.getCurrentSize()}/${MAX_HISTORY_LENGTH}`);
    return eventWithTimestamp;
  }

  //get recent events (newest first)
  getRecentEvents(limit = 50, offset = 0) {
    const currentSize = this.getCurrentSize();
    const maxAvailable = Math.max(0, currentSize - offset);
    const actualLimit = Math.min(limit, maxAvailable);
    
    const result = [];
    
    for (let i = 0; i < actualLimit; i++) {
      //calculate index going backwards from most recent
      const index = this.getRecentIndex(i + offset);
      if (this.events[index]) {
        result.push(this.events[index]);
      }
    }
    
    return result;
  }

  //get events since a specific timestamp
  getEventsSince(timestamp) {
    const allEvents = this.getAllEvents();
    return allEvents.filter(event => event.timestamp > timestamp);
  }

  //get events within a time range  
  getEventsByTimeRange(startTime, endTime) {
    const allEvents = this.getAllEvents();
    return allEvents.filter(event => 
      event.timestamp >= startTime && event.timestamp <= endTime
    );
  }

  //get all events (newest first)
  getAllEvents() {
    const currentSize = this.getCurrentSize();
    const result = [];
    
    for (let i = 0; i < currentSize; i++) {
      const index = this.getRecentIndex(i);
      if (this.events[index]) {
        result.push(this.events[index]);
      }
    }
    
    return result;
  }

  //get current buffer size
  getCurrentSize() {
    return this.isFull ? MAX_HISTORY_LENGTH : this.head;
  }

  //get buffer statistics
  getStats() {
    const currentSize = this.getCurrentSize();
    
    return {
      totalEvents: currentSize,
      maxCapacity: MAX_HISTORY_LENGTH,
      bufferUtilization: (currentSize / MAX_HISTORY_LENGTH) * 100,
      oldestEvent: currentSize > 0 ? this.getOldestEvent() : null,
      newestEvent: currentSize > 0 ? this.getNewestEvent() : null
    };
  }

  //get the oldest event in the buffer
  getOldestEvent() {
    const currentSize = this.getCurrentSize();
    if (currentSize === 0) return null;
    
    const oldestIndex = this.isFull ? this.head : 0;
    return this.events[oldestIndex];
  }

  //get the newest event in the buffer
  getNewestEvent() {
    const currentSize = this.getCurrentSize();
    if (currentSize === 0) return null;
    
    const newestIndex = this.getRecentIndex(0);
    return this.events[newestIndex];
  }

  //helper to calculate index for recent events (0 = most recent)
  getRecentIndex(offset) {
    const currentSize = this.getCurrentSize();
    
    if (this.isFull) {
      //when buffer is full, most recent is at (head - 1)
      return (this.head - 1 - offset + MAX_HISTORY_LENGTH) % MAX_HISTORY_LENGTH;
    } else {
      //when buffer is not full, most recent is at (head - 1)
      return Math.max(0, this.head - 1 - offset);
    }
  }

  //clear all events
  clear() {
    this.events = [];
    this.head = 0;
    this.isFull = false;
    console.log('[Motion Events] Buffer cleared');
  }

  //setup motion detection service listener
  startListening(motionDetectionService) {
    if (!motionDetectionService) {
      console.error('[Motion Events] No motion detection service provided');
      return;
    }

    //listen for motion events from the motion detection service
    motionDetectionService.on('motion', (data) => {
      this.addEvent(data);
    });
    
    console.log('[Motion Events] Started listening to motion detection service');
  }

  //cleanup method for shutdown
  cleanup() {
    this.clear();
    console.log('[Motion Events] Service cleanup completed');
  }

  //test isolation method
  _resetForTests() {
    this.clear();
  }

  //backwards compatibility - get motion history in old format
  getMotionHistory() {
    return this.getAllEvents();
  }
}

//create and export singleton instance
const motionEventsService = new MotionEventsService();
export default motionEventsService;