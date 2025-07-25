import os from 'os';
import { config, DROIDCAM_URL } from './config.js';
import app, { mjpegProxy, flashlightState } from './app.js';

// Server configuration
const PORT = config.SERVER_PORT;
const HOST = config.SERVER_HOST;

console.log('[Server] Checking startup conditions...');
console.log('[Server] NODE_ENV:', process.env.NODE_ENV);
console.log('[Server] Configured to run on:', `http://${HOST}:${PORT}`);

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  // Add error handler for uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught Exception:', error);
    console.error(error.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  const server = app.listen(PORT, HOST, (err) => {
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

  // Handle server errors with enhanced debugging
  server.on('error', (error) => {
    console.error('[Server] Server startup error occurred');
    console.error('[Server] Error code:', error.code);
    console.error('[Server] Error message:', error.message);
    console.error('[Server] Attempted binding:', `${HOST}:${PORT}`);
    console.error('[Server] Process PID:', process.pid);
    console.error('[Server] Platform:', process.platform);
    console.error('[Server] Full error object:', error);
    
    if (error.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} is already in use. Please check for other running instances.`);
      
      // Additional Windows-specific diagnostics
      if (process.platform === 'win32') {
        console.error('[Server] Windows detected - this may be a port reservation issue');
        console.error('[Server] Try running: netsh int ipv4 show excludedportrange protocol=tcp');
        console.error('[Server] Or try a different port by changing SERVER_PORT in .env');
      }
    }
    process.exit(1);
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