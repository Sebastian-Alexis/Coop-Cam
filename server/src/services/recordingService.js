import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import CircularBufferService from './circularBufferService.js';
import VideoEncoderService from './videoEncoderService.js';
import { config } from '../config.js';
import ReactionService from './reactionService.js';

//recording service state machine states
const RecordingState = {
  IDLE: 'IDLE',
  TRIGGERED: 'TRIGGERED',
  RECORDING: 'RECORDING',
  FINALIZING: 'FINALIZING',
  COOLDOWN: 'COOLDOWN'
};

//main recording service
class RecordingService {
  constructor(mjpegProxy, eventEmitter) {
    console.log('[Recording] Initializing recording service...');
    console.log('[Recording] Config enabled:', config.recording.enabled);
    console.log('[Recording] Pre-buffer seconds:', config.recording.preBufferSeconds);
    console.log('[Recording] Post-motion seconds:', config.recording.postMotionSeconds);
    
    this.config = config.recording;
    this.mjpegProxy = mjpegProxy;
    this.eventEmitter = eventEmitter;
    
    //state management
    this.state = RecordingState.IDLE;
    this.activeRecordings = new Map();
    this.recordingCount = 0;
    
    //services
    this.circularBuffer = new CircularBufferService(
      this.config.preBufferSeconds,
      this.config.fps
    );
    this.videoEncoder = new VideoEncoderService(config);
    this.reactionService = new ReactionService(config);
    
    //frame listener reference for cleanup
    this.frameListener = null;
    
    console.log('[Recording] Service initialized');
  }

  async start() {
    if (!this.config.enabled) {
      console.log('[Recording] Recording is disabled');
      return;
    }

    //check ffmpeg availability
    const ffmpegAvailable = await this.videoEncoder.checkFFmpegAvailable();
    console.log('[Recording] FFmpeg available:', ffmpegAvailable);
    console.log('[Recording] Output directory:', this.config.outputDir);
    
    if (!ffmpegAvailable) {
      console.error('[Recording] FFmpeg is not available. Recording disabled.');
      return;
    }

    //ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });

    //subscribe to frame events for circular buffer
    this.frameListener = (frame, frameCount) => {
      this.circularBuffer.addFrame(frame);
    };
    this.mjpegProxy.on('frame', this.frameListener);

    //subscribe to motion events
    console.log('[Recording] Setting up motion event listener...');
    this.eventEmitter.on('motion', (data) => {
      console.log('[Recording] Motion event listener triggered!');
      this.handleMotionEvent(data);
    });
    console.log('[Recording] Motion event listener registered successfully');
    console.log('[Recording] EventEmitter has', this.eventEmitter.listenerCount('motion'), 'motion listeners');

    //start cleanup timer for old recordings
    this.startCleanupTimer();

    console.log('[Recording] Service started successfully');
  }

  async stop() {
    console.log('[Recording] Stopping service...');
    
    //remove frame listener
    if (this.frameListener) {
      this.mjpegProxy.off('frame', this.frameListener);
    }

    //cancel all active recordings
    for (const [id, recording] of this.activeRecordings) {
      this.videoEncoder.cancelEncoding(id);
    }
    
    this.activeRecordings.clear();
    this.state = RecordingState.IDLE;
    
    console.log('[Recording] Service stopped');
  }

  async handleMotionEvent(motionData) {
    console.log('[Recording] ========== MOTION EVENT RECEIVED ==========');
    console.log('[Recording] Motion data:', JSON.stringify(motionData));
    console.log('[Recording] Current state:', this.state);
    console.log('[Recording] Active recordings:', this.activeRecordings.size);
    console.log('[Recording] Recording enabled:', this.config.enabled);

    //check if we can start a new recording
    if (this.state !== RecordingState.IDLE) {
      console.log(`[Recording] BLOCKED: Cannot start recording - current state: ${this.state}`);
      return;
    }

    //check concurrent recording limit
    if (this.activeRecordings.size >= this.config.maxConcurrent) {
      console.log(`[Recording] BLOCKED: Max concurrent recordings (${this.config.maxConcurrent}) reached`);
      return;
    }

    console.log('[Recording] All checks passed, starting recording...');
    
    //start recording
    try {
      await this.startRecording(motionData);
    } catch (error) {
      console.error('[Recording] ERROR in startRecording:', error);
      console.error('[Recording] Stack trace:', error.stack);
    }
  }

  async startRecording(motionData) {
    const recordingId = this.generateRecordingId();
    const startTime = Date.now();

    console.log(`[Recording] Starting recording ${recordingId}`);
    this.state = RecordingState.TRIGGERED;

    //get pre-buffer frames
    const preBufferFrames = this.circularBuffer.getFrames();
    console.log(`[Recording] Retrieved ${preBufferFrames.length} pre-buffer frames`);

    //create recording object
    const recording = {
      id: recordingId,
      startTime: startTime,
      motionData: motionData,
      frames: [...preBufferFrames],
      frameCollector: null,
      timeout: null
    };

    this.activeRecordings.set(recordingId, recording);
    this.state = RecordingState.RECORDING;

    //collect frames for post-motion duration
    recording.frameCollector = (frame) => {
      if (recording.frames.length < 1000) { //safety limit
        recording.frames.push({
          data: Buffer.from(frame), //create deep copy to prevent corruption
          timestamp: Date.now(),
          index: recording.frames.length
        });
      }
    };

    this.mjpegProxy.on('frame', recording.frameCollector);

    //set timeout to stop recording
    recording.timeout = setTimeout(() => {
      this.stopRecording(recordingId);
    }, this.config.postMotionSeconds * 1000);

    console.log(`[Recording] ${recordingId} will record for ${this.config.postMotionSeconds} seconds`);
  }

  async stopRecording(recordingId) {
    console.log(`[Recording] ========== STOP RECORDING CALLED ==========`);
    console.log(`[Recording] Recording ID: ${recordingId}`);
    
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      console.error(`[Recording] ERROR: Recording ${recordingId} not found in activeRecordings`);
      console.error(`[Recording] Active recordings:`, Array.from(this.activeRecordings.keys()));
      return;
    }

    console.log(`[Recording] Stopping recording ${recordingId}`);
    console.log(`[Recording] Frames collected: ${recording.frames.length}`);
    this.state = RecordingState.FINALIZING;

    //stop collecting frames
    if (recording.frameCollector) {
      this.mjpegProxy.off('frame', recording.frameCollector);
    }

    //clear timeout
    if (recording.timeout) {
      clearTimeout(recording.timeout);
    }

    console.log(`[Recording] ${recordingId} collected ${recording.frames.length} total frames`);

    //generate output path
    const outputPath = this.generateOutputPath(recordingId);
    console.log(`[Recording] Output path: ${outputPath}`);
    console.log(`[Recording] Output directory exists:`, existsSync(path.dirname(outputPath)));

    try {
      console.log(`[Recording] Starting video encoding...`);
      console.log(`[Recording] Frame count: ${recording.frames.length}`);
      console.log(`[Recording] First frame size: ${recording.frames[0]?.data?.length || 0} bytes`);
      
      //encode video
      await this.videoEncoder.encodeFramesToVideo(
        recording.frames,
        outputPath,
        recordingId
      );
      
      console.log(`[Recording] Video encoding completed`);

      //save metadata
      console.log(`[Recording] Saving metadata...`);
      await this.saveMetadata(recordingId, recording, outputPath);

      console.log(`[Recording] ${recordingId} saved successfully to ${outputPath}`);
      console.log(`[Recording] File exists:`, existsSync(outputPath));
      
      //emit completion event
      this.eventEmitter.emit('recording-complete', {
        id: recordingId,
        path: outputPath,
        frames: recording.frames.length,
        duration: (Date.now() - recording.startTime) / 1000
      });
      
      //enforce top 3 recordings for today
      await this.enforceTop3RecordingsForToday();

    } catch (error) {
      console.error(`[Recording] ${recordingId} encoding failed:`, error);
      this.eventEmitter.emit('recording-failed', {
        id: recordingId,
        error: error.message
      });
    }

    //cleanup
    this.activeRecordings.delete(recordingId);

    //enter cooldown if no other recordings
    if (this.activeRecordings.size === 0) {
      this.enterCooldown();
    }
  }

  enterCooldown() {
    console.log(`[Recording] Entering ${this.config.cooldownSeconds}s cooldown`);
    this.state = RecordingState.COOLDOWN;

    setTimeout(() => {
      if (this.state === RecordingState.COOLDOWN) {
        this.state = RecordingState.IDLE;
        console.log('[Recording] Cooldown complete, ready for recording');
      }
    }, this.config.cooldownSeconds * 1000);
  }

  generateRecordingId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }

  generateOutputPath(recordingId) {
    const date = new Date();
    const dateFolder = date.toISOString().split('T')[0]; //YYYY-MM-DD
    const filename = `motion_${recordingId}.mp4`;
    return path.join(this.config.outputDir, dateFolder, filename);
  }

  async saveMetadata(recordingId, recording, videoPath) {
    const metadata = {
      id: recordingId,
      videoPath: videoPath,
      startTime: new Date(recording.startTime).toISOString(),
      endTime: new Date().toISOString(),
      frameCount: recording.frames.length,
      motion: recording.motionData,
      preBufferFrames: recording.frames.filter(f => f.timestamp < recording.startTime).length,
      postMotionFrames: recording.frames.filter(f => f.timestamp >= recording.startTime).length
    };

    const metadataPath = videoPath.replace('.mp4', '.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`[Recording] Metadata saved to ${metadataPath}`);
  }

  //delete a single recording and all its associated files
  async deleteRecording(videoPath) {
    console.log(`[Recording] Deleting recording: ${videoPath}`);
    
    const metadataPath = videoPath.replace('.mp4', '.json');
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath, '.mp4');
    const thumbnailPath = path.join(videoDir, `${videoBasename}_thumb.jpg`);
    
    const filesToDelete = [
      { path: videoPath, type: 'video' },
      { path: thumbnailPath, type: 'thumbnail' },
      { path: metadataPath, type: 'metadata' }
    ];
    
    const deletionResults = [];
    
    for (const file of filesToDelete) {
      try {
        if (existsSync(file.path)) {
          await fs.unlink(file.path);
          console.log(`[Recording] Deleted ${file.type}: ${file.path}`);
          deletionResults.push({ file: file.path, success: true });
        } else {
          console.log(`[Recording] ${file.type} not found: ${file.path}`);
          deletionResults.push({ file: file.path, success: true, notFound: true });
        }
      } catch (error) {
        console.error(`[Recording] Failed to delete ${file.type}: ${file.path}`, error);
        deletionResults.push({ file: file.path, success: false, error: error.message });
      }
    }
    
    //delete reactions for this recording
    try {
      const videoFilename = path.basename(videoPath);
      const reactionsDeleted = await this.reactionService.deleteReactions(videoFilename);
      if (reactionsDeleted) {
        console.log(`[Recording] Deleted reactions for ${videoFilename}`);
        deletionResults.push({ file: 'reactions', success: true });
      }
    } catch (error) {
      console.error(`[Recording] Failed to delete reactions:`, error);
      deletionResults.push({ file: 'reactions', success: false, error: error.message });
    }
    
    return deletionResults;
  }

  //enforce top 3 recordings per day based on movement intensity
  async enforceTop3RecordingsForToday() {
    console.log('[Recording] Enforcing top 3 recordings for today based on movement');
    
    try {
      //get today's date folder
      const today = new Date().toISOString().split('T')[0]; //YYYY-MM-DD
      const todayDir = path.join(this.config.outputDir, today);
      
      //check if today's directory exists
      if (!existsSync(todayDir)) {
        console.log('[Recording] No recordings directory for today');
        return;
      }
      
      //get all video files from today
      const files = await fs.readdir(todayDir);
      const videoFiles = files.filter(file => file.endsWith('.mp4'));
      
      console.log(`[Recording] Found ${videoFiles.length} recordings for today`);
      
      if (videoFiles.length <= 3) {
        console.log('[Recording] 3 or fewer recordings, no cleanup needed');
        return;
      }
      
      //load metadata for each recording to get movement data
      const recordingsWithMovement = [];
      
      for (const videoFile of videoFiles) {
        const videoPath = path.join(todayDir, videoFile);
        const metadataPath = videoPath.replace('.mp4', '.json');
        
        try {
          if (existsSync(metadataPath)) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);
            
            recordingsWithMovement.push({
              videoPath,
              videoFile,
              metadata,
              movement: metadata.motion?.difference || 0
            });
          } else {
            console.warn(`[Recording] No metadata found for ${videoFile}`);
          }
        } catch (error) {
          console.error(`[Recording] Error reading metadata for ${videoFile}:`, error);
        }
      }
      
      //sort by movement (highest first)
      recordingsWithMovement.sort((a, b) => b.movement - a.movement);
      
      console.log('[Recording] Recordings sorted by movement:');
      recordingsWithMovement.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec.videoFile} - Movement: ${(rec.movement * 100).toFixed(2)}%`);
      });
      
      //keep top 3, delete the rest
      const recordingsToDelete = recordingsWithMovement.slice(3);
      
      for (const recording of recordingsToDelete) {
        console.log(`[Recording] Deleting low-movement recording: ${recording.videoFile} (${(recording.movement * 100).toFixed(2)}%)`);
        await this.deleteRecording(recording.videoPath);
      }
      
      console.log(`[Recording] Enforcement complete. Kept top 3 recordings, deleted ${recordingsToDelete.length}`);
      
    } catch (error) {
      console.error('[Recording] Error enforcing top 3 recordings:', error);
    }
  }

  //cleanup old recordings based on retention policy
  async cleanupOldRecordings() {
    if (this.config.retentionDays <= 0) return;

    const cutoffTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
    console.log(`[Recording] Cleaning up recordings older than ${new Date(cutoffTime).toISOString()}`);

    try {
      const recordingsDir = this.config.outputDir;
      const entries = await fs.readdir(recordingsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(recordingsDir, entry.name);
        const stats = await fs.stat(dirPath);

        if (stats.mtime.getTime() < cutoffTime) {
          console.log(`[Recording] Removing old directory: ${dirPath}`);
          await fs.rm(dirPath, { recursive: true });
        }
      }
    } catch (error) {
      console.error('[Recording] Cleanup error:', error);
    }
  }

  startCleanupTimer() {
    //run cleanup daily
    setInterval(() => {
      this.cleanupOldRecordings();
    }, 24 * 60 * 60 * 1000);

    //run initial cleanup
    this.cleanupOldRecordings();
  }

  //get recording statistics
  getStats() {
    const bufferStats = this.circularBuffer.getStats();
    
    return {
      state: this.state,
      activeRecordings: this.activeRecordings.size,
      totalRecordings: this.recordingCount,
      bufferStats: bufferStats,
      config: {
        preBufferSeconds: this.config.preBufferSeconds,
        postMotionSeconds: this.config.postMotionSeconds,
        maxConcurrent: this.config.maxConcurrent
      }
    };
  }
}

export default RecordingService;