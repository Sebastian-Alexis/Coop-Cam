import express from 'express';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import os from 'os';
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