import express from 'express';
import cors from 'cors';
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
app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true
}));
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
  res.json({
    ...mjpegProxy.getStats(),
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

// Serve the HTML interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/coop', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'coop.html'));
});

app.get('/chickens', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'chickens.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server only if not in test environment
const PORT = config.SERVER_PORT;
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
    console.log(`[Server] DroidCam URL: ${DROIDCAM_URL}`);
    console.log(`[Server] CORS origin: ${config.CORS_ORIGIN}`);
  });
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  process.exit(0);
});

// Export for testing
export { app, mjpegProxy };