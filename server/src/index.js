import express from 'express';
import morgan from 'morgan';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import MjpegProxy from './mjpegProxy.js';
import { config, DROIDCAM_URL } from './config.js';
import { fetchWeatherData, getCacheStatus } from './services/weatherService.js';
import MotionDetectionService from './services/motionDetectionService.js';
import RecordingService from './services/recordingService.js';
import ThumbnailService from './services/thumbnailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// Listen for motion events
eventEmitter.on('motion', (data) => {
  console.log('[Motion] Event received:', data);
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

// Get flashlight status
app.get('/api/flashlight/status', (req, res) => {
  let remainingSeconds = 0;
  
  if (flashlightState.isOn && flashlightState.turnedOnAt) {
    const elapsed = Date.now() - flashlightState.turnedOnAt.getTime();
    const remaining = Math.max(0, FLASHLIGHT_AUTO_OFF_DURATION - elapsed);
    remainingSeconds = Math.floor(remaining / 1000);
  }
  
  res.json({
    isOn: flashlightState.isOn,
    remainingSeconds
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
    
    // Turn on flashlight via DroidCam API
    const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
    console.log('[Flashlight] Turning on flashlight at:', flashlightUrl);
    
    const response = await fetch(flashlightUrl, { method: 'PUT' });
    
    console.log('[Flashlight] Response status:', response.status);
    console.log('[Flashlight] Response ok:', response.ok);
    
    if (!response.ok) {
      throw new Error(`DroidCam API error: ${response.status}`);
    }
    
    // Update state
    flashlightState.isOn = true;
    flashlightState.turnedOnAt = new Date();
    
    // Clear any existing timeout
    if (flashlightState.autoOffTimeout) {
      clearTimeout(flashlightState.autoOffTimeout);
    }
    
    // Set auto-off timer
    flashlightState.autoOffTimeout = setTimeout(async () => {
      console.log('[Flashlight] Auto-off timer triggered');
      try {
        // Turn off via DroidCam API
        const offResponse = await fetch(flashlightUrl, { method: 'PUT' });
        if (offResponse.ok) {
          flashlightState.isOn = false;
          flashlightState.turnedOnAt = null;
          flashlightState.autoOffTimeout = null;
          console.log('[Flashlight] Successfully turned off');
        } else {
          console.error('[Flashlight] Failed to turn off:', offResponse.status);
        }
      } catch (error) {
        console.error('[Flashlight] Auto-off error:', error);
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
    const recordings = await thumbnailService.getRecentRecordings(config.recording.outputDir, limit);
    
    // Transform paths to relative URLs
    const recordingsWithUrls = recordings.map(rec => ({
      ...rec,
      thumbnailUrl: rec.thumbnailExists ? `/api/recordings/thumbnail/${encodeURIComponent(rec.filename)}` : null,
      videoUrl: `/api/recordings/video/${encodeURIComponent(rec.filename)}`,
      // Calculate duration from metadata if available
      duration: rec.metadata.endTime && rec.metadata.startTime ? 
        Math.round((new Date(rec.metadata.endTime) - new Date(rec.metadata.startTime)) / 1000) : null
    }));
    
    res.json({
      success: true,
      recordings: recordingsWithUrls
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
    
    res.sendFile(thumbnailPath);
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

// Start server only if not in test environment
const PORT = config.SERVER_PORT;
const HOST = config.SERVER_HOST;

console.log('[Server] Checking startup conditions...');
console.log('[Server] NODE_ENV:', process.env.NODE_ENV);
console.log('[Server] Configured to run on:', `http://${HOST}:${PORT}`);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, (err) => {
    if (err) {
      console.error('[Server] Failed to start:', err);
      process.exit(1);
    }
    console.log(`[Server] Successfully listening on http://${HOST}:${PORT}`);
    
    // Show network access info when binding to all interfaces
    if (HOST === '0.0.0.0') {
      console.log('[Server] Network access enabled! Access from:');
      const networkInterfaces = os.networkInterfaces();
      Object.values(networkInterfaces).forEach(interfaces => {
        interfaces.forEach(iface => {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`  - http://${iface.address}:${PORT}`);
          }
        });
      });
      console.log(`  - http://localhost:${PORT}`);
    }
    
    console.log(`[Server] DroidCam URL: ${DROIDCAM_URL}`);
    console.log('[Server] Static pages available at:');
    console.log(`  - /         (Landing page)`);
    console.log(`  - /coop     (Live stream)`);
    console.log(`  - /about    (About & Chickens)`);
  });
} else {
  console.log('[Server] Skipping server startup in test environment');
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  process.exit(0);
});

// Export for testing
export { app, mjpegProxy, flashlightState };