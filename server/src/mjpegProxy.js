import http from 'http';
import { EventEmitter } from 'events';
import sharp from 'sharp';
import { config } from './config.js';

class MjpegProxy extends EventEmitter {
  constructor(sourceUrl, options = {}) {
    super();
    this.sourceUrl = sourceUrl;
    this.clients = new Map();
    this.sourceConnection = null;
    this.boundary = null;
    this.isConnected = false;
    this.reconnectTimeout = null;
    this.lastFrame = null; // Cache last frame for new clients
    this.frameCount = 0;
    this.lastFrameTime = Date.now();
    this.frameRateLimiter = new Map(); // Track per-client frame rate limits
    this.lastBroadcastTime = 0;
    this.serverFpsLimit = 30; // Server-side FPS limit
    this.serverFrameInterval = 1000 / this.serverFpsLimit; // 33ms for 30 FPS
    
    //frame interpolation configuration
    this.interpolationEnabled = config.FRAME_INTERPOLATION;
    this.frameBuffer = [];
    this.maxBufferSize = config.INTERPOLATION_BUFFER_SIZE;
    this.frameBufferSizeLimit = this.maxBufferSize * 1024 * 1024; // MB to bytes
    this.currentBufferSize = 0;
    this.gapDetectionThreshold = config.GAP_DETECTION_MS;
    this.motionBlurIntensity = config.MOTION_BLUR_INTENSITY;
    this.maxInterpolatedFrames = config.MAX_INTERPOLATED_FRAMES;
    this.interpolationStats = {
      gapsDetected: 0,
      framesInterpolated: 0,
      totalGapDuration: 0,
      averageGapDuration: 0
    };
    
    //start connection unless disabled
    if (!options.disableAutoConnect) {
      this.connect();
    }
  }

  connect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    console.log(`[Proxy] Connecting to MJPEG source: ${this.sourceUrl}`);
    
    const request = http.get(this.sourceUrl, (response) => {
      // Set TCP_NODELAY for low latency
      if (response.socket && response.socket.setNoDelay) {
        response.socket.setNoDelay(true);
      }
      if (response.statusCode !== 200) {
        console.error(`[Proxy] Source returned status ${response.statusCode}`);
        this.scheduleReconnect();
        return;
      }

      // Check if we got an HTML response (DroidCam busy)
      const contentType = response.headers['content-type'];
      if (contentType && contentType.includes('text/html')) {
        console.error('[Proxy] DroidCam returned HTML - it might be busy or not streaming');
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          if (body.includes('DroidCam is Busy')) {
            console.error('[Proxy] DroidCam is busy - another client is connected!');
          } else {
            console.error('[Proxy] Unexpected HTML response from DroidCam');
          }
          this.scheduleReconnect();
        });
        return;
      }
      
      this.sourceConnection = response;
      this.isConnected = true;
      
      // Extract boundary from content-type if present
      if (contentType && contentType.includes('boundary=')) {
        this.boundary = contentType.split('boundary=')[1];
      }
      
      console.log(`[Proxy] Connected to source. Content-Type: ${contentType}`);
      this.emit('connected');

      // Handle incoming data with optimized buffer management
      const BUFFER_SIZE = 1024 * 1024; // 1MB pre-allocated buffer
      const MAX_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB max to prevent memory issues
      
      let buffer = Buffer.allocUnsafe(BUFFER_SIZE);
      let bufferOffset = 0;
      let totalBytes = 0;
      let frameCount = 0;
      
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        
        // If chunk won't fit in current buffer, process what we have first
        if (bufferOffset + chunk.length > buffer.length) {
          // Process existing buffer content
          const frames = this.extractFrames(buffer.slice(0, bufferOffset));
          
          if (frames.completeFrames.length > 0) {
            frameCount += frames.completeFrames.length;
            console.log(`[Proxy] Extracted ${frames.completeFrames.length} frames (total: ${frameCount}, bytes: ${totalBytes})`);
          }
          
          frames.completeFrames.forEach(frame => {
            this.lastFrame = frame; // Cache frame
            this.frameCount++;
            
            // Server-side frame rate limiting to 30 FPS
            const now = Date.now();
            const timeSinceLastBroadcast = now - this.lastBroadcastTime;
            
            if (timeSinceLastBroadcast >= this.serverFrameInterval) {
              this.lastBroadcastTime = now;
              this.lastFrameTime = now;
              
              // Add frame to buffer
              this.addFrameToBuffer(frame);
              
              // Broadcast the frame
              this.broadcast(frame);
            }
          });
          
          // Handle remainder
          if (frames.remainder.length > 0) {
            // Check for oversized buffer
            if (frames.remainder.length > MAX_BUFFER_SIZE) {
              console.warn(`[Proxy] Buffer overflow protection: dropping ${frames.remainder.length} bytes`);
              bufferOffset = 0;
            } else {
              // Copy remainder to start of buffer
              frames.remainder.copy(buffer, 0);
              bufferOffset = frames.remainder.length;
            }
          } else {
            bufferOffset = 0;
          }
        }
        
        // Add new chunk to buffer
        if (bufferOffset + chunk.length <= buffer.length) {
          chunk.copy(buffer, bufferOffset);
          bufferOffset += chunk.length;
          
          // Try to extract frames from current buffer
          const frames = this.extractFrames(buffer.slice(0, bufferOffset));
          
          if (frames.completeFrames.length > 0) {
            frameCount += frames.completeFrames.length;
            console.log(`[Proxy] Extracted ${frames.completeFrames.length} frames (total: ${frameCount}, bytes: ${totalBytes})`);
          }
          
          frames.completeFrames.forEach(frame => {
            this.lastFrame = frame; // Cache frame
            this.frameCount++;
            
            // Server-side frame rate limiting to 30 FPS
            const now = Date.now();
            const timeSinceLastBroadcast = now - this.lastBroadcastTime;
            
            if (timeSinceLastBroadcast >= this.serverFrameInterval) {
              this.lastBroadcastTime = now;
              this.lastFrameTime = now;
              
              // Add frame to buffer
              this.addFrameToBuffer(frame);
              
              // Broadcast the frame
              this.broadcast(frame);
            }
          });
          
          // Update buffer with remainder
          if (frames.remainder.length > 0) {
            frames.remainder.copy(buffer, 0);
            bufferOffset = frames.remainder.length;
          } else {
            bufferOffset = 0;
          }
        }
      });

      response.on('end', () => {
        console.log('[Proxy] Source stream ended');
        this.handleDisconnect();
      });

      response.on('error', (error) => {
        console.error('[Proxy] Source stream error:', error);
        this.handleDisconnect();
      });
    });

    request.on('error', (error) => {
      console.error('[Proxy] Connection error:', error.message);
      this.handleDisconnect();
    });

    // Increase timeout for slower connections/networks
    request.setTimeout(30000, () => {
      console.error('[Proxy] Connection timeout');
      request.destroy();
      this.handleDisconnect();
    });
  }

  extractFrames(buffer) {
    const frames = [];
    let offset = 0;
    const bufferLength = buffer.length;
    
    // Optimized frame extraction using manual search for better performance
    while (offset < bufferLength - 1) {
      // Look for JPEG start marker (0xFF 0xD8)
      let jpegStart = -1;
      for (let i = offset; i < bufferLength - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
          jpegStart = i;
          break;
        }
      }
      
      if (jpegStart === -1) break;
      
      // Look for JPEG end marker (0xFF 0xD9) starting after the header
      let jpegEnd = -1;
      for (let i = jpegStart + 2; i < bufferLength - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
          jpegEnd = i;
          break;
        }
      }
      
      if (jpegEnd === -1) {
        // No end marker found, return remainder from jpegStart
        return { completeFrames: frames, remainder: buffer.slice(jpegStart) };
      }
      
      // Extract complete JPEG including end marker
      const frame = buffer.slice(jpegStart, jpegEnd + 2);
      frames.push(frame);
      offset = jpegEnd + 2;
    }
    
    // Return any remaining data
    const remainder = offset < bufferLength ? buffer.slice(offset) : Buffer.alloc(0);
    return { completeFrames: frames, remainder };
  }

  handleDisconnect() {
    this.isConnected = false;
    this.sourceConnection = null;
    this.emit('disconnected');
    
    // Notify all clients
    this.clients.forEach(client => {
      try {
        client.res.end();
      } catch (e) {
        // Client may already be disconnected
      }
    });
    this.clients.clear();
    
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    
    console.log('[Proxy] Scheduling reconnection in 5 seconds...');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 5000);
  }

  addClient(clientId, res, fps = null) {
    // Parse FPS from client ID if provided (format: timestamp-random-fps15)
    let targetFps = fps;
    if (!targetFps && clientId.includes('-fps')) {
      const match = clientId.match(/-fps(\d+)$/);
      if (match) {
        targetFps = parseInt(match[1]);
      }
    }
    
    const client = { 
      id: clientId, 
      res, 
      connected: true,
      fps: targetFps,
      lastFrameTime: 0,
      frameInterval: targetFps ? 1000 / targetFps : 0,
      isPaused: false
    };
    this.clients.set(clientId, client);
    
    // Handle backpressure - resume when buffer drains
    res.on('drain', () => {
      if (client.isPaused) {
        client.isPaused = false;
        // Only log every 10th resume to match pause logging
        if (client.pauseCount && client.pauseCount % 10 === 1) {
          console.log(`[Proxy] Client ${clientId} resumed after backpressure`);
        }
      }
    });
    
    console.log(`[Proxy] Client ${clientId} connected. Total clients: ${this.clients.size}${targetFps ? ` (FPS: ${targetFps})` : ''}`);
    
    // Send headers
    const boundary = 'frame';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });
    
    // Force flush headers if available
    if (res.flushHeaders) {
      res.flushHeaders();
    }
    
    // Send last frame if available (reduces initial loading time)
    if (this.lastFrame && this.lastFrame.length > 0) {
      try {
        const frameData = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
          this.lastFrame,
          Buffer.from('\r\n')
        ]);
        res.write(frameData);
      } catch (e) {
        console.error(`[Proxy] Error sending last frame to client ${clientId}:`, e.message);
      }
    }
    
    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });
  }

  removeClient(clientId) {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      console.log(`[Proxy] Client ${clientId} disconnected. Total clients: ${this.clients.size}`);
    }
  }

  getStats() {
    return {
      isConnected: this.isConnected,
      clientCount: this.clients.size,
      sourceUrl: this.sourceUrl,
      hasLastFrame: !!this.lastFrame,
      interpolation: {
        enabled: this.interpolationEnabled,
        bufferSize: this.frameBuffer.length,
        bufferMemoryMB: (this.currentBufferSize / 1024 / 1024).toFixed(2),
        ...this.interpolationStats
      }
    };
  }

  //validate JPEG frame
  isValidJpeg(frameData) {
    if (!frameData || frameData.length < 4) return false;
    
    // Check for JPEG start marker (0xFF 0xD8)
    if (frameData[0] !== 0xFF || frameData[1] !== 0xD8) return false;
    
    // Check for JPEG end marker (0xFF 0xD9)
    const len = frameData.length;
    if (frameData[len - 2] !== 0xFF || frameData[len - 1] !== 0xD9) return false;
    
    return true;
  }

  //frame buffer management
  addFrameToBuffer(frameData) {
    if (!this.interpolationEnabled) return;
    
    // Only buffer valid JPEG frames
    if (!this.isValidJpeg(frameData)) {
      console.warn('[Proxy] Skipping invalid JPEG frame for buffer');
      return;
    }
    
    const now = Date.now();
    const frameEntry = {
      frameData: frameData,
      timestamp: now,
      frameNumber: this.frameCount,
      isInterpolated: false
    };
    
    //add frame to buffer
    this.frameBuffer.push(frameEntry);
    this.currentBufferSize += frameData.length;
    
    //maintain buffer size limits
    while (this.frameBuffer.length > this.maxBufferSize || 
           this.currentBufferSize > this.frameBufferSizeLimit) {
      const removed = this.frameBuffer.shift();
      if (removed) {
        this.currentBufferSize -= removed.frameData.length;
      }
    }
  }

  //detect gaps in frame stream
  detectGap(currentTime) {
    if (!this.interpolationEnabled || this.frameBuffer.length < 1) {
      return null;
    }
    
    const timeSinceLastFrame = currentTime - this.lastFrameTime;
    
    if (timeSinceLastFrame > this.gapDetectionThreshold) {
      //gap detected
      const lastBufferedFrame = this.frameBuffer[this.frameBuffer.length - 1];
      return {
        startTime: this.lastFrameTime,
        endTime: currentTime,
        duration: timeSinceLastFrame,
        startFrame: lastBufferedFrame || null
      };
    }
    
    return null;
  }

  //simplified broadcast with gap filling
  broadcast(frame) {
    const boundary = 'frame';
    const now = Date.now();
    
    // Check for gaps and fill them by repeating last frame
    if (this.interpolationEnabled && this.lastFrame) {
      const timeSinceLastBroadcast = now - this.lastBroadcastTime;
      
      // If we have a gap, repeat the last frame to fill it
      if (timeSinceLastBroadcast > this.gapDetectionThreshold) {
        const missedFrames = Math.min(
          Math.floor(timeSinceLastBroadcast / this.serverFrameInterval) - 1,
          this.maxInterpolatedFrames
        );
        
        if (missedFrames > 0) {
          console.log(`[Proxy] Gap detected (${timeSinceLastBroadcast}ms), filling with ${missedFrames} repeated frames`);
          
          // Update stats
          this.interpolationStats.gapsDetected++;
          this.interpolationStats.framesInterpolated += missedFrames;
          this.interpolationStats.totalGapDuration += timeSinceLastBroadcast;
          this.interpolationStats.averageGapDuration = 
            this.interpolationStats.totalGapDuration / this.interpolationStats.gapsDetected;
          
          // Broadcast repeated frames to fill the gap
          const frameData = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
            this.lastFrame,
            Buffer.from('\r\n')
          ]);
          
          for (let i = 0; i < missedFrames; i++) {
            this.broadcastToClients(frameData);
          }
        }
      }
    }
    
    // Format and broadcast current frame
    const frameData = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
      frame,
      Buffer.from('\r\n')
    ]);
    
    this.broadcastToClients(frameData);
  }
  
  //broadcast frame data to all clients
  broadcastToClients(frameData) {
    const now = Date.now();
    const deadClients = [];
    
    this.clients.forEach((client, clientId) => {
      if (!client.connected || client.res.writableEnded) {
        deadClients.push(clientId);
        return;
      }
      
      // Skip if client is paused due to backpressure
      if (client.isPaused) {
        return;
      }
      
      // Check frame rate limit for this client
      if (client.frameInterval > 0) {
        const timeSinceLastFrame = now - client.lastFrameTime;
        if (timeSinceLastFrame < client.frameInterval) {
          // Skip this frame for this client
          return;
        }
      }
      
      // Update last frame time for this client
      client.lastFrameTime = now;
      
      try {
        // Write with non-blocking check
        const canWrite = client.res.write(frameData);
        
        if (!canWrite) {
          // Backpressure detected - pause this client
          client.isPaused = true;
          client.pauseCount = (client.pauseCount || 0) + 1;
          
          // Only log every 10th pause to reduce spam
          if (client.pauseCount % 10 === 1) {
            console.log(`[Proxy] Client ${clientId} experiencing backpressure (${client.pauseCount} times)`);
          }
        }
        
        // Force flush if available to prevent buffering
        if (client.res.flush && typeof client.res.flush === 'function') {
          client.res.flush();
        }
      } catch (error) {
        console.error(`[Proxy] Error writing to client ${clientId}:`, error.message);
        deadClients.push(clientId);
      }
    });
    
    // Clean up dead clients
    deadClients.forEach(id => this.removeClient(id));
  // Debug point
  // TODO: Implement 468
  console.log('debug');
  // Working on this section  // tmp535
  }
}

export default MjpegProxy;