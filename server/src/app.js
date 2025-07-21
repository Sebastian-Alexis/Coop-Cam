import express from 'express';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import MjpegProxy from './mjpegProxy.js';
import { config, DROIDCAM_URL } from './config.js';
import { fetchWeatherData, getCacheStatus } from './services/weatherService.js';
import MotionDetectionService from './services/motionDetectionService.js';
import RecordingService from './services/recordingService.js';
import ThumbnailService from './services/thumbnailService.js';
import ReactionService, { REACTION_TYPES, CHICKEN_TONES } from './services/reactionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Mobile detection helper
function isMobileDevice(userAgent) {
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  return mobileRegex.test(userAgent || '');
}

// Mobile detection middleware
app.use((req, res, next) => {
  req.isMobile = isMobileDevice(req.headers['user-agent']);
  
  // Log mobile detection for debugging
  if (req.isMobile && !req.path.startsWith('/api/stream')) {
    console.log(`[Mobile] Request from mobile device: ${req.method} ${req.path}`);
  }
  
  next();
});

// Middleware
// Only use morgan in development mode for better performance
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Enable compression for all routes except the stream
app.use(compression({
  filter: (req, res) => {
    // Don't compress the MJPEG stream
    if (req.path === '/api/stream') {
      return false;
    }
    // Use default compression filter for other routes
    return compression.filter(req, res);
  }
}));

app.use(express.json());
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve art assets
app.use('/art', express.static(path.join(__dirname, '..', '..', 'art')));
// Serve reactions assets
app.use('/art/reactions', express.static(path.join(__dirname, '..', '..', 'reactions')));

// Create MJPEG proxy instance
const mjpegProxy = new MjpegProxy(DROIDCAM_URL, {
  disableAutoConnect: process.env.NODE_ENV === 'test'
});

// Create shared event emitter for services
const eventEmitter = new EventEmitter();

// Create motion detection service
const motionDetectionService = new MotionDetectionService(mjpegProxy, eventEmitter);
console.log('[Server] Motion detection service created');

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

// SSE client management
const sseClients = new Set();
let motionEventHistory = [];
const MAX_MOTION_HISTORY = 100;

// Listen for motion events
eventEmitter.on('motion', (data) => {
  console.log('[Motion] Event received:', data);
  
  // Add to history (circular buffer)
  const motionEvent = {
    type: 'motion',
    timestamp: Date.now(),
    intensity: data.intensity || 0,
    regions: data.regions || [],
    frameNumber: data.frameNumber || 0,
    recordingStarted: false
  };
  
  motionEventHistory.push(motionEvent);
  if (motionEventHistory.length > MAX_MOTION_HISTORY) {
    motionEventHistory.shift();
  }
  
  // Broadcast to all SSE clients
  const sseMessage = `data: ${JSON.stringify(motionEvent)}\n\n`;
  sseClients.forEach(client => {
    client.write(sseMessage);
  });
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

// Flashlight state management
const flashlightState = {
  isOn: false,
  turnedOnAt: null,
  autoOffTimeout: null
};

// Auto-off duration (5 minutes)
const FLASHLIGHT_AUTO_OFF_DURATION = 5 * 60 * 1000;

// Rate limiting for password attempts
const passwordAttempts = new Map();
const MAX_PASSWORD_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Timing-safe password comparison
function verifyPassword(inputPassword) {
  const storedPassword = config.STREAM_PAUSE_PASSWORD;
  
  if (!inputPassword || !storedPassword) {
    return false;
  }
  
  const inputBuffer = Buffer.from(inputPassword);
  const storedBuffer = Buffer.from(storedPassword);
  
  // Length must match for timing-safe comparison
  if (inputBuffer.length !== storedBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(inputBuffer, storedBuffer);
}

// Check rate limit for IP
function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = passwordAttempts.get(ip) || [];
  
  // Remove old attempts outside window
  const recentAttempts = attempts.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentAttempts.length >= MAX_PASSWORD_ATTEMPTS) {
    return false;
  }
  
  // Update attempts
  recentAttempts.push(now);
  passwordAttempts.set(ip, recentAttempts);
  
  return true;
}

// Connection management middleware for mobile
// Add Connection: close header for non-streaming endpoints on mobile
app.use((req, res, next) => {
  // Skip for streaming endpoints or if not mobile
  if (!req.isMobile || req.path === '/api/stream' || req.path === '/api/events/motion') {
    return next();
  }
  
  // Set Connection: close for mobile non-streaming requests
  res.set('Connection', 'close');
  
  next();
});

// API Routes
app.get('/api/stream', (req, res) => {
  // Parse FPS from query parameter
  const fps = req.query.fps ? parseInt(req.query.fps) : null;
  const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${fps ? `-fps${fps}` : ''}`;
  
  // Set TCP_NODELAY for low-latency streaming
  if (req.socket && req.socket.setNoDelay) {
    req.socket.setNoDelay(true);
  }
  
  // Set socket timeout to prevent hanging connections
  if (req.socket && req.socket.setTimeout) {
    req.socket.setTimeout(0); // Disable timeout for streaming
  }
  
  mjpegProxy.addClient(clientId, res, fps);
});

app.get('/api/stats', (req, res) => {
  const stats = mjpegProxy.getStats();
  const response = {
    isConnected: stats.isConnected,
    clientCount: stats.clientCount,
    sourceUrl: stats.sourceUrl,
    hasLastFrame: stats.hasLastFrame,
    serverTime: new Date().toISOString(),
    frameCount: mjpegProxy.frameCount || 0,
    interpolation: stats.interpolation
  };
  
  // Add recording stats if enabled
  if (recordingService) {
    response.recording = recordingService.getStats();
  }
  
  // Mobile-specific headers
  if (req.isMobile) {
    res.set({
      'Cache-Control': 'private, max-age=10', // Cache for 10 seconds on mobile
      'X-Mobile-Optimized': 'true'
    });
  }
  
  res.json(response);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    proxy: mjpegProxy.getStats()
  });
});

app.get('/api/interpolation-stats', (req, res) => {
  const stats = mjpegProxy.getStats();
  res.json(stats.interpolation);
});

// SSE endpoint for motion events
app.get('/api/events/motion', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    // Add X-Accel-Buffering for nginx compatibility
    'X-Accel-Buffering': 'no'
  });
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now(), isMobile: req.isMobile })}\n\n`);
  
  // Add client to set
  sseClients.add(res);
  console.log(`[SSE] ${req.isMobile ? 'Mobile' : 'Desktop'} client connected. Total clients: ${sseClients.size}`);
  
  // Send heartbeat - shorter interval for mobile to detect disconnections faster
  const heartbeatInterval = req.isMobile ? 15000 : 30000; // 15s for mobile, 30s for desktop
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
  }, heartbeatInterval);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[SSE] ${req.isMobile ? 'Mobile' : 'Desktop'} client disconnected. Total clients: ${sseClients.size}`);
  });
});

// Get motion event history
app.get('/api/motion/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const since = req.query.since ? parseInt(req.query.since) : null;
  
  let filteredEvents = motionEventHistory;
  
  // Filter by timestamp if provided
  if (since) {
    filteredEvents = filteredEvents.filter(event => event.timestamp > since);
  }
  
  // Apply pagination
  const paginatedEvents = filteredEvents.slice(offset, offset + limit);
  
  res.json({
    success: true,
    events: paginatedEvents,
    total: filteredEvents.length,
    offset: offset,
    limit: limit
  });
});

// Get flashlight status
app.get('/api/flashlight/status', (req, res) => {
  let remainingSeconds = 0;
  
  if (flashlightState.isOn && flashlightState.turnedOnAt) {
    const elapsed = Date.now() - flashlightState.turnedOnAt.getTime();
    const remaining = Math.max(0, FLASHLIGHT_AUTO_OFF_DURATION - elapsed);
    remainingSeconds = Math.floor(remaining / 1000);
    
    // Auto-reset if timer has expired
    if (remainingSeconds <= 0) {
      flashlightState.isOn = false;
      flashlightState.turnedOnAt = null;
      if (flashlightState.autoOffTimeout) {
        clearTimeout(flashlightState.autoOffTimeout);
        flashlightState.autoOffTimeout = null;
      }
      console.log('[Flashlight] Auto-reset state due to expired timer');
    }
  }
  
  // Mobile-specific caching
  if (req.isMobile) {
    res.set({
      'Cache-Control': 'private, max-age=5', // Short cache for mobile
      'X-Mobile-Optimized': 'true'
    });
  }
  
  res.json({
    isOn: flashlightState.isOn,
    remainingSeconds,
    droidcamUrl: `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}`
  });
});

// Flashlight control endpoint - now only turns on
app.put('/api/flashlight/on', async (req, res) => {
  try {
    // If already on, just return current state without resetting timer
    if (flashlightState.isOn) {
      const elapsed = Date.now() - flashlightState.turnedOnAt.getTime();
      const remaining = Math.max(0, FLASHLIGHT_AUTO_OFF_DURATION - elapsed);
      const remainingSeconds = Math.floor(remaining / 1000);
      
      console.log('[Flashlight] Already on, returning current state');
      return res.json({
        success: true,
        isOn: true,
        remainingSeconds,
        message: 'Flashlight is already on'
      });
    }
    
    // Clear any existing timeout before toggling
    if (flashlightState.autoOffTimeout) {
      clearTimeout(flashlightState.autoOffTimeout);
      flashlightState.autoOffTimeout = null;
    }
    
    // Turn on flashlight via DroidCam API (toggle endpoint)
    const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
    console.log('[Flashlight] Toggling flashlight ON at:', flashlightUrl);
    
    const response = await fetch(flashlightUrl, { 
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    
    console.log('[Flashlight] Response status:', response.status);
    console.log('[Flashlight] Response ok:', response.ok);
    
    if (!response.ok) {
      throw new Error(`DroidCam API error: ${response.status}`);
    }
    
    // Update state - flashlight is now ON
    flashlightState.isOn = true;
    flashlightState.turnedOnAt = new Date();
    
    // Pause motion detection when flashlight is on
    if (motionDetectionService) {
      motionDetectionService.pause('flashlight');
      console.log('[Flashlight] Motion detection paused');
    }
    
    // Set auto-off timer
    flashlightState.autoOffTimeout = setTimeout(async () => {
      console.log('[Flashlight] Auto-off timer triggered');
      
      // Only toggle if flashlight is still on
      if (flashlightState.isOn) {
        try {
          // Turn off via DroidCam API (toggle endpoint)
          console.log('[Flashlight] Toggling flashlight OFF');
          const offResponse = await fetch(flashlightUrl, { 
            method: 'PUT',
            headers: {
              'Content-Type': 'text/plain'
            }
          });
          
          if (offResponse.ok) {
            flashlightState.isOn = false;
            flashlightState.turnedOnAt = null;
            flashlightState.autoOffTimeout = null;
            console.log('[Flashlight] Successfully turned off');
            
            // Resume motion detection when flashlight turns off
            if (motionDetectionService) {
              motionDetectionService.resume();
              console.log('[Flashlight] Motion detection resumed');
            }
          } else {
            console.error('[Flashlight] Failed to turn off:', offResponse.status);
          }
        } catch (error) {
          console.error('[Flashlight] Auto-off error:', error);
        }
      }
    }, FLASHLIGHT_AUTO_OFF_DURATION);
    
    res.json({ 
      success: true,
      isOn: true,
      remainingSeconds: 300, // 5 minutes
      message: 'Flashlight turned on successfully'
    });
  } catch (error) {
    console.error('[Flashlight] Toggle error:', error.message);
    console.error('[Flashlight] Full error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to turn on flashlight',
      error: error.message 
    });
  }
});

// Flashlight control endpoint - turn off
app.put('/api/flashlight/off', async (req, res) => {
  try {
    // If already off, just return current state
    if (!flashlightState.isOn) {
      console.log('[Flashlight] Already off');
      return res.json({
        success: true,
        isOn: false,
        message: 'Flashlight is already off'
      });
    }
    
    // Clear any existing timeout
    if (flashlightState.autoOffTimeout) {
      clearTimeout(flashlightState.autoOffTimeout);
      flashlightState.autoOffTimeout = null;
    }
    
    // Turn off flashlight via DroidCam API (toggle endpoint)
    const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
    console.log('[Flashlight] Toggling flashlight OFF at:', flashlightUrl);
    
    const response = await fetch(flashlightUrl, { 
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    
    if (response.ok) {
      flashlightState.isOn = false;
      flashlightState.turnedOnAt = null;
      console.log('[Flashlight] Successfully turned off');
      
      // Resume motion detection when flashlight turns off
      if (motionDetectionService) {
        motionDetectionService.resume();
        console.log('[Flashlight] Motion detection resumed');
      }
      
      res.json({ 
        success: true,
        isOn: false,
        message: 'Flashlight turned off successfully'
      });
    } else {
      throw new Error(`DroidCam API error: ${response.status}`);
    }
  } catch (error) {
    console.error('[Flashlight] Turn off error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to turn off flashlight',
      error: error.message 
    });
  }
});

// Keep old endpoint for backwards compatibility (redirects to new endpoint)
app.put('/api/flashlight', async (req, res) => {
  // Redirect to the new endpoint
  req.url = '/api/flashlight/on';
  app.handle(req, res);
});

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
  try {
    const weatherData = await fetchWeatherData(config.WEATHER_USER_AGENT);
    const cacheStatus = getCacheStatus();
    
    // Mobile-specific caching
    if (req.isMobile) {
      res.set({
        'Cache-Control': 'private, max-age=300', // Cache for 5 minutes on mobile
        'X-Mobile-Optimized': 'true'
      });
    }
    
    res.json({
      success: true,
      data: weatherData,
      cache: cacheStatus
    });
  } catch (error) {
    console.error('[Weather] API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weather data',
      message: error.message
    });
  }
});

// Stream pause endpoint
app.post('/api/stream/pause', express.json(), async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Check rate limit
  if (!checkRateLimit(clientIp)) {
    console.log(`[Stream Pause] Rate limit exceeded for IP: ${clientIp}`);
    return res.status(429).json({
      success: false,
      message: 'Too many attempts. Please try again in a minute.'
    });
  }
  
  const { password } = req.body;
  
  // Validate password
  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Password is required'
    });
  }
  
  // Verify password using timing-safe comparison
  if (!verifyPassword(password)) {
    console.log(`[Stream Pause] Invalid password attempt from IP: ${clientIp}`);
    return res.status(401).json({
      success: false,
      message: 'Invalid password'
    });
  }
  
  try {
    // Pause the stream
    const paused = await mjpegProxy.pauseStream();
    
    if (paused) {
      console.log(`[Stream Pause] Stream paused by IP: ${clientIp} at ${new Date().toISOString()}`);
      res.json({
        success: true,
        message: 'Stream paused for 5 minutes',
        pauseDuration: 300 // seconds
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Stream is already paused'
      });
    }
  } catch (error) {
    console.error('[Stream Pause] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause stream'
    });
  }
});

// Stream status endpoint
app.get('/api/stream/status', (req, res) => {
  try {
    const pauseStatus = mjpegProxy.getPauseStatus();
    const proxyStats = mjpegProxy.getStats();
    
    res.json({
      success: true,
      ...pauseStatus,
      clientCount: proxyStats.clientCount,
      isConnected: proxyStats.isConnected
    });
  } catch (error) {
    console.error('[Stream Status] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stream status'
    });
  }
});

// DroidCam status endpoint for diagnostics
app.get('/api/droidcam-status', async (req, res) => {
  try {
    const stats = mjpegProxy.getStats();
    const droidcamUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}`;
    
    // Try to check if DroidCam is reachable
    let droidcamReachable = false;
    let droidcamError = null;
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${droidcamUrl}/`, { 
        signal: controller.signal,
        method: 'GET'
      });
      
      clearTimeout(timeout);
      droidcamReachable = response.ok;
      
      if (!response.ok) {
        droidcamError = `HTTP ${response.status}`;
      }
    } catch (error) {
      droidcamError = error.message;
    }
    
    res.json({
      droidcam: {
        ip: config.DROIDCAM_IP,
        port: config.DROIDCAM_PORT,
        url: droidcamUrl,
        videoUrl: DROIDCAM_URL,
        reachable: droidcamReachable,
        error: droidcamError
      },
      proxy: {
        connected: stats.isConnected,
        viewerCount: stats.clientCount,
        clientIds: Array.from(mjpegProxy.clients.keys()),
        lastFrameTime: mjpegProxy.lastFrameTime || null
      },
      server: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development'
      }
    });
  } catch (error) {
    console.error('[DroidCam Status] Error:', error);
    res.status(500).json({ 
      error: 'Failed to get status',
      message: error.message 
    });
  }
});

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

// Reaction API endpoints
// Get reactions for a recording
app.get('/api/recordings/:filename/reactions', async (req, res) => {
  try {
    const filename = req.params.filename;
    const userId = req.cookies?.viewerId || req.headers['x-viewer-id'];
    
    const reactions = await reactionService.getReactions(filename, userId);
    
    res.json({
      success: true,
      ...reactions,
      reactionTypes: REACTION_TYPES,
      chickenTones: CHICKEN_TONES,
      chickenTones: CHICKEN_TONES
    });
  } catch (error) {
    console.error('[Reactions API] Error getting reactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get reactions',
      message: error.message
    });
  }
});

// Add or update a reaction
app.post('/api/recordings/:filename/reactions', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { reaction, tone } = req.body;
    const userId = req.cookies?.viewerId || req.headers['x-viewer-id'];
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User identification required',
        message: 'Please enable cookies or provide viewer ID'
      });
    }
    
    if (!reaction || !REACTION_TYPES[reaction]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reaction type',
        validTypes: Object.keys(REACTION_TYPES)
      });
    }
    
    const result = await reactionService.addReaction(filename, userId, reaction, tone);
    res.json(result);
  } catch (error) {
    console.error('[Reactions API] Error adding reaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reaction',
      message: error.message
    });
  }
});

// Remove a reaction
app.delete('/api/recordings/:filename/reactions', async (req, res) => {
  try {
    const filename = req.params.filename;
    const userId = req.cookies?.viewerId || req.headers['x-viewer-id'];
    const { reactionType, tone } = req.body; // Optional: specific reaction and/or tone to remove
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User identification required'
      });
    }
    
    const result = await reactionService.removeReaction(filename, userId, reactionType, tone);
    res.json(result);
  } catch (error) {
    console.error('[Reactions API] Error removing reaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove reaction',
      message: error.message
    });
  }
});

// Get reactions for multiple recordings (batch)
app.post('/api/recordings/reactions/batch', async (req, res) => {
  try {
    const { filenames } = req.body;
    const userId = req.cookies?.viewerId || req.headers['x-viewer-id'];
    
    if (!filenames || !Array.isArray(filenames)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'filenames array required'
      });
    }
    
    const reactions = await reactionService.getMultipleReactions(filenames, userId);
    
    res.json({
      success: true,
      reactions,
      reactionTypes: REACTION_TYPES,
      chickenTones: CHICKEN_TONES
    });
  } catch (error) {
    console.error('[Reactions API] Error getting batch reactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get reactions',
      message: error.message
    });
  }
});

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
              data = await weatherService.getWeather();
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
              data = flashlightState;
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

// Serve static HTML pages with cache headers
const serveStaticHTML = (filename) => (req, res) => {
  const filePath = path.join(__dirname, 'views', filename);
  
  // Set cache headers for static assets
  res.set({
    'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    'X-Content-Type-Options': 'nosniff'
  });
  
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`Error serving ${filename}:`, err);
      res.status(404).send('Page not found');
    }
  });
};

app.get('/', serveStaticHTML('index.html'));
app.get('/coop', serveStaticHTML('coop.html'));
app.get('/about', serveStaticHTML('about.html'));

// Serve mobile CSS
app.get('/mobile.css', (req, res) => {
  const filePath = path.join(__dirname, 'views', 'mobile.css');
  res.set({
    'Content-Type': 'text/css',
    'Cache-Control': 'public, max-age=3600'
  });
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving mobile.css:', err);
      res.status(404).send('File not found');
    }
  });
});

// Serve gestures JS module
app.get('/gestures.js', (req, res) => {
  const filePath = path.join(__dirname, 'views', 'gestures.js');
  res.set({
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=3600'
  });
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving gestures.js:', err);
      res.status(404).send('File not found');
    }
  });
});

// Catch-all route for undefined paths
app.get('*', (req, res, next) => {
  // Skip if it's an API route or a static file
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return next();
  }
  
  // Return 404 for undefined routes
  res.status(404).send('Page not found');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Export app and other modules needed for testing
import { weatherCache } from './services/weatherService.js';

export { app as default, app, mjpegProxy, flashlightState, weatherCache };