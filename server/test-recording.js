import { EventEmitter } from 'events';
import RecordingService from './src/services/recordingService.js';
import VideoEncoderService from './src/services/videoEncoderService.js';
import path from 'path';
import fs from 'fs/promises';
import { config } from './src/config.js';

// Create a mock mjpegProxy
class MockMjpegProxy extends EventEmitter {
  constructor() {
    super();
    this.frameCount = 0;
  }
  
  startFrames() {
    // Emit test frames every 33ms (30fps)
    this.frameInterval = setInterval(() => {
      // Create a simple JPEG-like buffer (fake JPEG headers)
      const frameData = Buffer.concat([
        Buffer.from([0xFF, 0xD8]), // JPEG start marker
        Buffer.from(`Frame ${this.frameCount}`),
        Buffer.from([0xFF, 0xD9])  // JPEG end marker
      ]);
      this.emit('frame', frameData, this.frameCount);
      this.frameCount++;
    }, 33);
  }
  
  stopFrames() {
    clearInterval(this.frameInterval);
  }
}

async function testRecording() {
  console.log('=== Testing Recording Service ===\n');
  
  // 1. Check FFmpeg availability
  console.log('1. Checking FFmpeg availability...');
  const videoEncoder = new VideoEncoderService(config);
  const ffmpegAvailable = await videoEncoder.checkFFmpegAvailable();
  console.log(`   FFmpeg available: ${ffmpegAvailable}\n`);
  
  if (!ffmpegAvailable) {
    console.error('ERROR: FFmpeg is not available. Cannot proceed with test.');
    return;
  }
  
  // 2. Create test instances
  console.log('2. Creating test instances...');
  const eventEmitter = new EventEmitter();
  const mjpegProxy = new MockMjpegProxy();
  const recordingService = new RecordingService(mjpegProxy, eventEmitter);
  
  // Listen to events
  eventEmitter.on('motion', (data) => {
    console.log('   [Event] Motion detected:', data);
  });
  
  eventEmitter.on('recording-complete', (data) => {
    console.log('   [Event] Recording complete:', data);
  });
  
  eventEmitter.on('recording-failed', (data) => {
    console.log('   [Event] Recording failed:', data);
  });
  
  // 3. Start recording service
  console.log('\n3. Starting recording service...');
  await recordingService.start();
  
  // 4. Start emitting frames
  console.log('\n4. Starting frame emission...');
  mjpegProxy.startFrames();
  
  // Wait for buffer to fill
  await new Promise(resolve => setTimeout(resolve, 3500));
  
  // 5. Simulate motion event
  console.log('\n5. Simulating motion event...');
  const motionData = {
    id: 'test_motion_001',
    timestamp: new Date().toISOString(),
    timestampMs: Date.now(),
    difference: 0.15,
    threshold: 0.05,
    intensity: '15.00'
  };
  
  eventEmitter.emit('motion', motionData);
  
  // 6. Wait for recording to complete
  console.log('\n6. Waiting for recording to complete (15 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 16000));
  
  // 7. Stop frame emission
  console.log('\n7. Stopping frame emission...');
  mjpegProxy.stopFrames();
  
  // 8. Check output directory
  console.log('\n8. Checking output directory...');
  try {
    const files = await fs.readdir('./recordings', { recursive: true });
    console.log('   Files in recordings directory:', files);
  } catch (error) {
    console.log('   Error reading recordings directory:', error.message);
  }
  
  // 9. Get recording stats
  console.log('\n9. Recording service stats:');
  const stats = recordingService.getStats();
  console.log('   ', JSON.stringify(stats, null, 2));
  
  // 10. Stop recording service
  console.log('\n10. Stopping recording service...');
  await recordingService.stop();
  
  console.log('\n=== Test Complete ===');
  process.exit(0);
}

// Run test
testRecording().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});