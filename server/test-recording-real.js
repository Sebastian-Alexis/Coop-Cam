import { EventEmitter } from 'events';
import RecordingService from './src/services/recordingService.js';
import VideoEncoderService from './src/services/videoEncoderService.js';
import sharp from 'sharp';
import fs from 'fs/promises';
import { config } from './src/config.js';

// Create a mock mjpegProxy that emits real JPEG frames
class MockMjpegProxy extends EventEmitter {
  constructor() {
    super();
    this.frameCount = 0;
  }
  
  async startFrames() {
    // Create a real JPEG frame using sharp
    const baseImage = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
    .jpeg()
    .toBuffer();
    
    // Emit test frames every 33ms (30fps)
    this.frameInterval = setInterval(async () => {
      // Create a slightly different image each time
      const color = (this.frameCount % 3 === 0) ? { r: 255, g: 0, b: 0 } :
                    (this.frameCount % 3 === 1) ? { r: 0, g: 255, b: 0 } :
                                                  { r: 0, g: 0, b: 255 };
      
      const frameData = await sharp({
        create: {
          width: 640,
          height: 480,
          channels: 3,
          background: color
        }
      })
      .jpeg()
      .toBuffer();
      
      this.emit('frame', frameData, this.frameCount);
      this.frameCount++;
    }, 33);
  }
  
  stopFrames() {
    clearInterval(this.frameInterval);
  }
}

async function testRecording() {
  console.log('=== Testing Recording Service with Real JPEG Frames ===\n');
  
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
  
  let recordingCompleted = false;
  let recordingFailed = false;
  
  // Listen to events
  eventEmitter.on('motion', (data) => {
    console.log('   [Event] Motion detected:', data);
  });
  
  eventEmitter.on('recording-complete', (data) => {
    console.log('   [Event] Recording complete:', data);
    recordingCompleted = true;
  });
  
  eventEmitter.on('recording-failed', (data) => {
    console.log('   [Event] Recording failed:', data);
    recordingFailed = true;
  });
  
  // 3. Start recording service
  console.log('\n3. Starting recording service...');
  await recordingService.start();
  
  // 4. Start emitting frames
  console.log('\n4. Starting frame emission (real JPEG frames)...');
  await mjpegProxy.startFrames();
  
  // Wait for buffer to fill
  console.log('   Waiting for buffer to fill (3.5 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 3500));
  
  // 5. Simulate motion event
  console.log('\n5. Simulating motion event...');
  const motionData = {
    id: 'test_motion_real_001',
    timestamp: new Date().toISOString(),
    timestampMs: Date.now(),
    difference: 0.15,
    threshold: 0.05,
    intensity: '15.00'
  };
  
  eventEmitter.emit('motion', motionData);
  
  // 6. Wait for recording to complete
  console.log('\n6. Waiting for recording to complete (20 seconds to ensure encoding)...');
  await new Promise(resolve => setTimeout(resolve, 20000));
  
  // 7. Stop frame emission
  console.log('\n7. Stopping frame emission...');
  mjpegProxy.stopFrames();
  
  // 8. Check results
  console.log('\n8. Checking results...');
  console.log(`   Recording completed: ${recordingCompleted}`);
  console.log(`   Recording failed: ${recordingFailed}`);
  
  // 9. Check output directory
  console.log('\n9. Checking output directory...');
  try {
    const todayDir = new Date().toISOString().split('T')[0];
    const files = await fs.readdir(`./recordings/${todayDir}`);
    const testFiles = files.filter(f => f.includes('test_motion_real'));
    console.log(`   Test recording files: ${testFiles.length > 0 ? testFiles.join(', ') : 'None found'}`);
    
    // Check file sizes
    for (const file of testFiles) {
      if (file.endsWith('.mp4')) {
        const stats = await fs.stat(`./recordings/${todayDir}/${file}`);
        console.log(`   ${file}: ${(stats.size / 1024).toFixed(2)} KB`);
      }
    }
  } catch (error) {
    console.log('   Error reading recordings directory:', error.message);
  }
  
  // 10. Get recording stats
  console.log('\n10. Recording service stats:');
  const stats = recordingService.getStats();
  console.log(JSON.stringify(stats, null, 2));
  
  // 11. Stop recording service
  console.log('\n11. Stopping recording service...');
  await recordingService.stop();
  
  console.log('\n=== Test Complete ===');
  process.exit(0);
}

// Run test
testRecording().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});