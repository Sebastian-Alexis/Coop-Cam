import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import ThumbnailService from './src/services/thumbnailService.js';

//create test recordings for development
async function createTestRecordings() {
  const recordingsDir = './recordings';
  const today = new Date().toISOString().split('T')[0];
  const todayDir = path.join(recordingsDir, today);
  
  console.log('Creating test recordings directory:', todayDir);
  await fs.mkdir(todayDir, { recursive: true });
  
  //create test metadata files
  const testRecordings = [
    {
      id: `2025-07-12T10-30-00-000Z_test1`,
      startTime: new Date(Date.now() - 3600000).toISOString(), //1 hour ago
      endTime: new Date(Date.now() - 3540000).toISOString(), //59 minutes ago
      duration: 60,
      frameCount: 1800,
      motion: { confidence: 0.85, area: 0.15 }
    },
    {
      id: `2025-07-12T11-00-00-000Z_test2`,
      startTime: new Date(Date.now() - 1800000).toISOString(), //30 mins ago
      endTime: new Date(Date.now() - 1770000).toISOString(), //29.5 mins ago
      duration: 30,
      frameCount: 900,
      motion: { confidence: 0.92, area: 0.22 }
    },
    {
      id: `2025-07-12T11-15-00-000Z_test3`,
      startTime: new Date(Date.now() - 900000).toISOString(), //15 mins ago
      endTime: new Date(Date.now() - 855000).toISOString(), //14.25 mins ago
      duration: 45,
      frameCount: 1350,
      motion: { confidence: 0.78, area: 0.18 }
    }
  ];
  
  console.log('Creating test metadata files...');
  for (const recording of testRecordings) {
    const videoPath = path.join(todayDir, `motion_${recording.id}.mp4`);
    const metadataPath = path.join(todayDir, `motion_${recording.id}.json`);
    
    //create metadata
    await fs.writeFile(metadataPath, JSON.stringify({
      id: recording.id,
      videoPath: videoPath,
      startTime: recording.startTime,
      endTime: recording.endTime,
      frameCount: recording.frameCount,
      motion: recording.motion,
      preBufferFrames: Math.floor(recording.frameCount * 0.1),
      postMotionFrames: Math.floor(recording.frameCount * 0.9)
    }, null, 2));
    
    console.log(`Created metadata: ${metadataPath}`);
    
    //note: actual video files would need to be created with ffmpeg
    //for testing, you'll need to manually place some MP4 files or use existing ones
  }
  
  console.log('\nTest recordings metadata created!');
  console.log('Note: You need to manually add MP4 video files with matching names to test fully.');
  console.log('\nExpected video files:');
  testRecordings.forEach(rec => {
    console.log(`  - ${todayDir}/motion_${rec.id}.mp4`);
  });
}

//run the generator
createTestRecordings().catch(console.error);