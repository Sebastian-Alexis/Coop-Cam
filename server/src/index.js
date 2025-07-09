import express from 'express';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import MjpegProxy from './mjpegProxy.js';
import { config, DROIDCAM_URL } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(morgan('dev'));

app.use(express.json());

// Create MJPEG proxy instance
const mjpegProxy = new MjpegProxy(DROIDCAM_URL, {
  disableAutoConnect: process.env.NODE_ENV === 'test'
});

// API Routes
app.get('/api/stream', (req, res) => {
  const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  mjpegProxy.addClient(clientId, res);
});

app.get('/api/stats', (req, res) => {
  const stats = mjpegProxy.getStats();
  res.json({
    isConnected: stats.isConnected,
    clientCount: stats.clientCount,
    sourceUrl: stats.sourceUrl,
    hasLastFrame: stats.hasLastFrame,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    proxy: mjpegProxy.getStats()
  });
});

// Flashlight control endpoint
app.put('/api/flashlight', async (req, res) => {
  try {
    //toggle flashlight via DroidCam API
    const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
    console.log('[Flashlight] Attempting to toggle at:', flashlightUrl);
    
    const response = await fetch(flashlightUrl, { method: 'PUT' });
    
    console.log('[Flashlight] Response status:', response.status);
    console.log('[Flashlight] Response ok:', response.ok);
    
    if (!response.ok) {
      throw new Error(`DroidCam API error: ${response.status}`);
    }
    
    res.json({ 
      success: true, 
      message: 'Flashlight toggled successfully' 
    });
  } catch (error) {
    console.error('[Flashlight] Toggle error:', error.message);
    console.error('[Flashlight] Full error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to toggle flashlight',
      error: error.message 
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

// Serve static HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/coop', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'coop.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'about.html'));
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
    console.log(`[Server] DroidCam URL: ${DROIDCAM_URL}`);
    console.log('[Server] Static pages available at:');
    console.log(`  - http://${HOST}:${PORT}/         (Landing page)`);
    console.log(`  - http://${HOST}:${PORT}/coop     (Live stream)`);
    console.log(`  - http://${HOST}:${PORT}/about    (About & Chickens)`);
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
export { app, mjpegProxy };