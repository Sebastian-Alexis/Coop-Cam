import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
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
import { config, DROIDCAM_URL } from './config.js';
import { fetchWeatherData, getCacheStatus } from './services/weatherService.js';
import MotionDetectionService from './services/motionDetectionService.js';
import RecordingService from './services/recordingService.js';
import ThumbnailService from './services/thumbnailService.js';
import ReactionService, { REACTION_TYPES, CHICKEN_TONES } from './services/reactionService.js';
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

// Create MJPEG proxy instance
const mjpegProxy = new MjpegProxy(DROIDCAM_URL, {
  disableAutoConnect: process.env.NODE_ENV === 'test'
});

// Create shared event emitter for services
const eventEmitter = new EventEmitter();

// Create motion detection service
const motionDetectionService = new MotionDetectionService(mjpegProxy, eventEmitter);
console.log('[Server] Motion detection service created');

// Connect flashlight state service to motion detection
flashlightState.setMotionDetectionService(motionDetectionService);
console.log('[Server] Flashlight state service connected to motion detection');

// Connect motion events service to motion detection
motionEventsService.startListening(motionDetectionService);
console.log('[Server] Motion events service connected to motion detection');

// Create recording service
let recordingService = null;
if (config.recording.enabled) {
  recordingService = new RecordingService(mjpegProxy, eventEmitter);
  console.log('[Server] Recording service created, starting...');
  recordingService.start().catch(err => {
    console.error('[Recording] Failed to start:', err);
  });
} else {
  console.log('[Server] Recording service not created (disabled in config)');
}

// Create thumbnail service
const thumbnailService = new ThumbnailService();
console.log('[Server] Thumbnail service created');

// Create reaction service
const reactionService = new ReactionService(config);
console.log('[Server] Reaction service created');


// Listen for motion events to broadcast to SSE clients
eventEmitter.on('motion', (data) => {
  console.log('[Motion] Event received:', data);
  
  const motionEvent = {
    type: 'motion',
    timestamp: Date.now(),
    intensity: data.intensity || 0,
    regions: data.regions || [],
    frameNumber: data.frameNumber || 0,
    recordingStarted: false
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
});

eventEmitter.on('recording-failed', (data) => {
  console.log('[Recording] Failed:', data);
});



// Connection management middleware for mobile
app.use(createConnectionManagementMiddleware());

// ======== INITIALIZE ROUTES ===================================================
// Initialize routes using controller/route pattern
const weatherService = { fetchWeatherData, getCacheStatus };
initializeRoutes(app, {
  flashlightState,
  mjpegProxy,
  recordingService,
  weatherService,
  sseService,
  motionEventsService,
  authService,
  reactionService,
  thumbnailService,
  REACTION_TYPES,
  CHICKEN_TONES,
  config
});

// Health, flashlight, weather, motion, and stream routes moved to controllers/routes pattern above



// Health, flashlight, weather, motion, stream, and droidcam routes moved to controllers/routes pattern above

// Recording API endpoints
// Get recent recordings with metadata
app.get('/api/recordings/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 3;
    const userId = req.cookies?.viewerId || req.headers['x-viewer-id'];
    const recordings = await thumbnailService.getRecentRecordings(config.recording.outputDir, limit);
    
    // Get reactions for all recordings
    const filenames = recordings.map(rec => rec.filename);
    const reactionsData = await reactionService.getMultipleReactions(filenames, userId);
    
    // Transform paths to relative URLs and include reactions
    const recordingsWithUrls = recordings.map(rec => ({
      ...rec,
      thumbnailUrl: rec.thumbnailExists ? `/api/recordings/thumbnail/${encodeURIComponent(rec.filename)}` : null,
      videoUrl: `/api/recordings/video/${encodeURIComponent(rec.filename)}`,
      // Calculate duration from metadata if available
      duration: rec.metadata.endTime && rec.metadata.startTime ? 
        Math.round((new Date(rec.metadata.endTime) - new Date(rec.metadata.startTime)) / 1000) : null,
      // Include reaction data
      reactions: reactionsData[rec.filename] || {
        summary: Object.keys(REACTION_TYPES).reduce((acc, type) => {
          acc[type] = {};
          return acc;
        }, {}),
        totalReactions: 0,
        userReaction: null
      }
    }));
    
    res.json({
      success: true,
      recordings: recordingsWithUrls,
      reactionTypes: REACTION_TYPES,
      chickenTones: CHICKEN_TONES
    });
  } catch (error) {
    console.error('[Recordings API] Error getting recent recordings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recent recordings',
      message: error.message
    });
  }
});

// Serve thumbnail image
app.get('/api/recordings/thumbnail/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    
    if (!dateMatch) {
      return res.status(400).json({ error: 'Invalid filename format' });
    }
    
    const dateDir = dateMatch[1];
    const videoPath = path.join(config.recording.outputDir, dateDir, filename);
    const thumbnailPath = thumbnailService.getThumbnailPath(videoPath);
    
    // Check if thumbnail exists
    if (!fs.existsSync(thumbnailPath)) {
      // Try to generate thumbnail if it doesn't exist
      try {
        await thumbnailService.generateThumbnail(videoPath);
      } catch (genError) {
        console.error('[Thumbnail API] Generation failed:', genError);
        return res.status(404).json({ error: 'Thumbnail not found and could not be generated' });
      }
    }
    
    // Serve the thumbnail with cache headers
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    });
    
    // Ensure absolute path for sendFile
    const absoluteThumbnailPath = path.resolve(thumbnailPath);
    res.sendFile(absoluteThumbnailPath);
  } catch (error) {
    console.error('[Thumbnail API] Error serving thumbnail:', error);
    res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
});

// Serve video file
app.get('/api/recordings/video/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    
    if (!dateMatch) {
      return res.status(400).json({ error: 'Invalid filename format' });
    }
    
    const dateDir = dateMatch[1];
    const videoPath = path.join(config.recording.outputDir, dateDir, filename);
    
    // Check if video exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Get video stats
    const stats = await fs.promises.stat(videoPath);
    const fileSize = stats.size;
    
    // Handle range requests for video streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error('[Video API] Error serving video:', error);
    res.status(500).json({ error: 'Failed to serve video' });
  }
});

// Reaction API endpoints moved to controllers/routes pattern above

// Batch API endpoint for mobile optimization
// Combines multiple API calls into a single request to reduce connections
app.post('/api/batch', express.json(), async (req, res) => {
  try {
    const { requests } = req.body;
    
    if (!requests || !Array.isArray(requests)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        message: 'requests array required'
      });
    }
    
    // Process each request in parallel
    const results = await Promise.allSettled(
      requests.map(async (request) => {
        const { endpoint, method = 'GET', body } = request;
        
        // Whitelist of allowed endpoints for batching
        const allowedEndpoints = [
          '/api/stats',
          '/api/weather', 
          '/api/stream/status',
          '/api/flashlight/status',
          '/api/recordings/recent',
          '/api/droidcam-status'
        ];
        
        if (!allowedEndpoints.includes(endpoint)) {
          return {
            endpoint,
            success: false,
            error: 'Endpoint not allowed in batch requests'
          };
        }
        
        try {
          // Handle different endpoints
          let data;
          switch (endpoint) {
            case '/api/stats':
              data = mjpegProxy.getStats();
              break;
              
            case '/api/weather':
              const weatherData = await weatherService.fetchWeatherData(config.WEATHER_USER_AGENT);
              const cacheStatus = weatherService.getCacheStatus();
              
              //check if weather service returned error data
              if (weatherData.error) {
                data = {
                  success: false,
                  error: 'Weather service unavailable',
                  data: weatherData,
                  cache: cacheStatus
                };
              } else {
                data = {
                  success: true,
                  data: weatherData,
                  cache: cacheStatus
                };
              }
              break;
              
            case '/api/stream/status':
              data = {
                isPaused: mjpegProxy.getPauseState().isPaused,
                pauseEndTime: mjpegProxy.getPauseState().pauseEndTime,
                remainingMs: mjpegProxy.getPauseState().pauseEndTime 
                  ? Math.max(0, mjpegProxy.getPauseState().pauseEndTime - Date.now())
                  : 0
              };
              break;
              
            case '/api/flashlight/status':
              data = flashlightState.getStatus();
              break;
              
            case '/api/recordings/recent':
              const dateStr = new Date().toLocaleDateString('en-US', { 
                timeZone: 'America/Los_Angeles' 
              });
              const recordings = await recordingService.getRecordingsByDate(dateStr);
              const recordingsWithThumbnails = await Promise.all(
                recordings.map(async (recording) => {
                  const thumbnailExists = await thumbnailService.thumbnailExists(recording.filename);
                  return {
                    ...recording,
                    thumbnailUrl: thumbnailExists 
                      ? `/api/recordings/thumbnail/${recording.filename}`
                      : null
                  };
                })
              );
              data = { 
                success: true, 
                recordings: recordingsWithThumbnails,
                date: dateStr,
                timezone: 'America/Los_Angeles'
              };
              break;
              
            case '/api/droidcam-status':
              const clients = mjpegProxy.getClients();
              const clientList = Array.from(clients.entries()).map(([id, client]) => ({
                id: client.id.substring(0, 8),
                connectedAt: new Date(parseInt(id.split('-')[0])).toISOString(),
                frameCount: client.frameCount || 0,
                lastFrameTime: client.lastFrameTime ? new Date(client.lastFrameTime).toISOString() : null
              }));
              data = {
                isConnected: mjpegProxy.isConnected,
                sourceUrl: mjpegProxy.sourceUrl,
                clients: clientList,
                uptime: process.uptime(),
                memory: process.memoryUsage()
              };
              break;
              
            default:
              throw new Error('Endpoint handler not implemented');
          }
          
          return {
            endpoint,
            success: true,
            data
          };
          
        } catch (error) {
          console.error(`[Batch API] Error processing ${endpoint}:`, error);
          return {
            endpoint,
            success: false,
            error: error.message
          };
        }
      })
    );
    
    // Format results
    const response = {
      success: true,
      results: results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            endpoint: requests[index].endpoint,
            success: false,
            error: result.reason?.message || 'Unknown error'
          };
        }
      })
    };
    
    // Set cache header - longer for mobile since it's batched
    if (req.isMobile) {
      res.set({
        'Cache-Control': 'private, max-age=10',
        'X-Mobile-Optimized': 'true',
        'X-Batch-Request': 'true'
      });
    } else {
      res.set('Cache-Control', 'private, max-age=5');
    }
    res.json(response);
    
  } catch (error) {
    console.error('[Batch API] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process batch request',
      message: error.message
    });
  }
});

// Health, flashlight, weather, motion, stream, droidcam, static, and reaction routes moved to controllers/routes pattern above

// Catch-all route for undefined paths
app.use(create404Handler());

// Error handling
app.use(createGlobalErrorHandler());

// Export app and other modules needed for testing
import { weatherCache } from './services/weatherService.js';

export { app as default, app, mjpegProxy, flashlightState, weatherCache };