import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { 
  createMobileDetectionMiddleware,
  createCompressionMiddleware,
  createStaticFilesMiddleware,
  createConnectionManagementMiddleware,
  create404Handler,
  createGlobalErrorHandler
} from './middleware/index.js';
import MjpegProxy from './mjpegProxy.js';
import { createStreamManager } from './services/streamManager.js';
import { config, DROIDCAM_URL } from './config.js';
import { fetchWeatherData, getCacheStatus } from './services/weatherService.js';
import MotionDetectionService from './services/motionDetectionService.js';
import RecordingService from './services/recordingService.js';
import ThumbnailService from './services/thumbnailService.js';
import ReactionService, { REACTION_TYPES, CHICKEN_TONES } from './services/reactionService.js';
import { createShareService } from './services/shareService.js';
import flashlightState from './state/flashlightState.js';
import sseService from './state/sseService.js';
import authService from './state/authState.js';
import motionEventsService from './state/motionEvents.js';
import { initializeRoutes } from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for accurate IP detection in tests and production
app.set('trust proxy', true);

// Mobile detection middleware
app.use(createMobileDetectionMiddleware());

// Middleware
// Only use morgan in development mode for better performance
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Enable compression for all routes except the stream
app.use(createCompressionMiddleware());

app.use(express.json());
app.use(cookieParser());

// Serve static files
createStaticFilesMiddleware(app);

// Create stream manager for multi-stream support
const streamManager = createStreamManager({ config });
console.log('[Server] Stream manager created with', config.streamSources.length, 'sources');

// Create shared event emitter for services
const eventEmitter = new EventEmitter();

// Create per-camera service instances for multi-camera support
const motionDetectionServices = new Map(); // Map<sourceId, MotionDetectionService>
const recordingServices = new Map(); // Map<sourceId, RecordingService>

// Initialize services for each configured stream source
for (const streamSource of config.streamSources) {
  const { id: sourceId, name: sourceName } = streamSource;
  console.log(`[Server] Initializing services for camera: ${sourceId} (${sourceName})`);
  
  // Get the proxy for this specific camera
  const mjpegProxy = streamManager.getProxy(sourceId);
  
  // Create motion detection service for this camera
  const motionDetectionService = new MotionDetectionService(mjpegProxy, eventEmitter);
  motionDetectionServices.set(sourceId, motionDetectionService);
  console.log(`[Server] Motion detection service created for camera: ${sourceId}`);

  // Create recording service for this camera if enabled
  if (config.recording.enabled) {
    const recordingService = new RecordingService(mjpegProxy, eventEmitter, sourceId);
    recordingServices.set(sourceId, recordingService);
    console.log(`[Server] Recording service created for camera: ${sourceId}, starting...`);
    recordingService.start().catch(err => {
      console.error(`[Recording] Failed to start recording service for camera ${sourceId}:`, err);
    });
  }
}

// Connect flashlight state service to DEFAULT camera's motion detection for backward compatibility
const defaultMotionService = motionDetectionServices.get(config.streamSources.find(s => s.isDefault).id);
if (defaultMotionService) {
  flashlightState.setMotionDetectionService(defaultMotionService);
  console.log('[Server] Flashlight state service connected to default camera motion detection');
}

// Connect motion events service to all motion detection services
motionDetectionServices.forEach((service, sourceId) => {
  motionEventsService.startListening(service);
  console.log(`[Server] Motion events service connected to camera: ${sourceId}`);
});

console.log(`[Server] Multi-camera services initialized: ${motionDetectionServices.size} motion detection services, ${recordingServices.size} recording services`);

// Create thumbnail service
const thumbnailService = new ThumbnailService();
console.log('[Server] Thumbnail service created');

// Create reaction service
const reactionService = new ReactionService(config);
console.log('[Server] Reaction service created');

// Create share service
const shareService = createShareService({ config });
console.log('[Server] Share service created');


// Listen for motion events to broadcast to SSE clients
eventEmitter.on('motion', (data) => {
  console.log(`[Motion] Event received from camera ${data.sourceId}:`, data);
  
  const motionEvent = {
    type: 'motion',
    timestamp: Date.now(),
    intensity: data.intensity || 0,
    regions: data.regions || [],
    frameNumber: data.frameNumber || 0,
    recordingStarted: false,
    sourceId: data.sourceId || 'default' //camera identifier for multi-camera support
  };
  
  // Broadcast to all SSE clients
  sseService.broadcast(motionEvent);
});

// Listen for recording events
eventEmitter.on('recording-complete', async (data) => {
  console.log('[Recording] Complete:', data);
  
  // Generate thumbnail for completed recording
  if (data.path) {
    try {
      console.log('[Thumbnail] Generating thumbnail for completed recording:', data.path);
      await thumbnailService.generateThumbnail(data.path);
      console.log('[Thumbnail] Thumbnail generated successfully');
    } catch (error) {
      console.error('[Thumbnail] Failed to generate thumbnail:', error);
    }
  }
  
  // Check if this recording has high motion and send notification
  if (data.motion && data.motion.intensity) {
    await checkAndNotifyHighMotion(data);
  }
});

eventEmitter.on('recording-failed', (data) => {
  console.log('[Recording] Failed:', data);
});

//check if recording has high motion and notify users
async function checkAndNotifyHighMotion(recordingData) {
  try {
    const { path: recordingPath, motion, sourceId = 'default' } = recordingData;
    
    if (!motion || !motion.intensity) {
      console.log('[Notification] No motion data available, skipping notification check');
      return;
    }
    
    const motionIntensity = parseFloat(motion.intensity);
    console.log(`[Notification] Checking motion intensity: ${motionIntensity}% for camera ${sourceId}`);
    
    //get today's recordings to determine if this is top 3 worthy
    const today = new Date().toISOString().split('T')[0];
    const todayDir = path.join(config.recording.outputDir, today);
    
    if (!existsSync(todayDir)) {
      console.log('[Notification] No recordings directory for today, treating as high motion');
      await sendHighMotionNotification(recordingData, motionIntensity, 1);
      return;
    }
    
    //get all recordings for this camera today
    const files = await fs.readdir(todayDir);
    const cameraRecordings = files.filter(file => 
      file.endsWith('.mp4') && file.includes(`motion_${sourceId}_`)
    );
    
    //load motion data for existing recordings
    const recordingsWithMotion = [];
    for (const videoFile of cameraRecordings) {
      const videoPath = path.join(todayDir, videoFile);
      const metadataPath = videoPath.replace('.mp4', '.json');
      
      if (existsSync(metadataPath)) {
        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf8');
          const metadata = JSON.parse(metadataContent);
          
          recordingsWithMotion.push({
            videoFile,
            movement: metadata.motion?.difference || 0,
            intensity: metadata.motion?.intensity || 0
          });
        } catch (error) {
          console.error(`[Notification] Error reading metadata for ${videoFile}:`, error);
        }
      }
    }
    
    //sort by movement intensity (highest first)
    recordingsWithMotion.sort((a, b) => parseFloat(b.intensity) - parseFloat(a.intensity));
    
    //determine rank of current recording
    const currentRank = recordingsWithMotion.findIndex(rec => 
      parseFloat(rec.intensity) <= motionIntensity
    ) + 1; //1-based ranking
    
    console.log(`[Notification] Recording ranks #${currentRank} out of ${recordingsWithMotion.length + 1} recordings today`);
    
    //notify if this is top 3
    if (currentRank <= 3) {
      await sendHighMotionNotification(recordingData, motionIntensity, currentRank);
    } else {
      console.log(`[Notification] Motion intensity ${motionIntensity}% is not in top 3, no notification sent`);
    }
    
  } catch (error) {
    console.error('[Notification] Error checking high motion:', error);
  }
}

//send high motion notification to all connected users
async function sendHighMotionNotification(recordingData, motionIntensity, rank) {
  try {
    const { id, sourceId = 'default', path: recordingPath } = recordingData;
    const filename = path.basename(recordingPath);
    
    const notification = {
      type: 'high-motion-alert',
      timestamp: Date.now(),
      data: {
        recordingId: id,
        filename: filename,
        sourceId: sourceId,
        motionIntensity: `${motionIntensity}%`,
        rank: rank,
        message: `High motion detected! Recording "${filename}" ranks #${rank} for today with ${motionIntensity}% motion intensity.`
      }
    };
    
    console.log(`[Notification] Sending high motion alert: ${notification.data.message}`);
    
    //broadcast to all SSE clients
    sseService.broadcast(notification);
    
    //optionally add to motion events for history
    motionEventsService.addEvent({
      type: 'high-motion-alert',
      recordingId: id,
      filename: filename,
      sourceId: sourceId,
      motionIntensity: motionIntensity,
      rank: rank
    });
    
  } catch (error) {
    console.error('[Notification] Error sending high motion notification:', error);
  }
}

// Connection management middleware for mobile
app.use(createConnectionManagementMiddleware());

// ======== INITIALIZE ROUTES ===================================================
// Initialize routes using controller/route pattern
const weatherService = { fetchWeatherData, getCacheStatus };
initializeRoutes(app, {
  flashlightState,
  streamManager, // Multi-stream manager
  motionDetectionServices, // Map of per-camera motion services
  recordingServices, // Map of per-camera recording services
  weatherService,
  sseService,
  motionEventsService,
  authService,
  reactionService,
  thumbnailService,
  shareService,
  REACTION_TYPES,
  CHICKEN_TONES,
  config
});

// All API routes moved to controllers/routes pattern above

// Catch-all route for undefined paths
app.use(create404Handler());

// Error handling
app.use(createGlobalErrorHandler());

// Export app and other modules needed for testing
import { weatherCache } from './services/weatherService.js';

export { app as default, app, streamManager, flashlightState, weatherCache };