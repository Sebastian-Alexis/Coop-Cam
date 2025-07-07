import http from 'http';
import { EventEmitter } from 'events';

class MjpegProxy extends EventEmitter {
  constructor(sourceUrl) {
    super();
    this.sourceUrl = sourceUrl;
    this.clients = new Map();
    this.sourceConnection = null;
    this.boundary = null;
    this.isConnected = false;
    this.reconnectTimeout = null;
    this.lastFrame = null; // Cache last frame for new clients
    
    this.connect();
  }

  connect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    console.log(`[Proxy] Connecting to MJPEG source: ${this.sourceUrl}`);
    
    const request = http.get(this.sourceUrl, (response) => {
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

      // Handle incoming data
      let buffer = Buffer.alloc(0);
      
      let totalBytes = 0;
      let frameCount = 0;
      
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        buffer = Buffer.concat([buffer, chunk]);
        
        // Try to extract complete frames
        const frames = this.extractFrames(buffer);
        buffer = frames.remainder;
        
        if (frames.completeFrames.length > 0) {
          frameCount += frames.completeFrames.length;
          console.log(`[Proxy] Extracted ${frames.completeFrames.length} frames (total: ${frameCount}, bytes: ${totalBytes})`);
        }
        
        frames.completeFrames.forEach(frame => {
          this.lastFrame = frame; // Cache frame
          this.broadcast(frame);
        });
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

    request.setTimeout(10000, () => {
      console.error('[Proxy] Connection timeout');
      request.destroy();
      this.handleDisconnect();
    });
  }

  extractFrames(buffer) {
    const frames = [];
    let remainder = buffer;
    
    // Try to extract JPEG frames directly (DroidCam doesn't use boundary markers)
    while (true) {
      const jpegStart = remainder.indexOf(Buffer.from([0xFF, 0xD8]));
      if (jpegStart === -1) break;
      
      const jpegEnd = remainder.indexOf(Buffer.from([0xFF, 0xD9]), jpegStart + 2);
      if (jpegEnd === -1) break;
      
      // Extract complete JPEG including end marker
      const frame = remainder.slice(jpegStart, jpegEnd + 2);
      frames.push(frame);
      remainder = remainder.slice(jpegEnd + 2);
    }
    
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

  addClient(clientId, res) {
    const client = { id: clientId, res, connected: true };
    this.clients.set(clientId, client);
    
    console.log(`[Proxy] Client ${clientId} connected. Total clients: ${this.clients.size}`);
    
    // Send headers
    const boundary = 'frame';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'close',
      'Access-Control-Allow-Origin': '*'
    });
    
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

  broadcast(frame) {
    const deadClients = [];
    const boundary = 'frame';
    
    // Format frame with boundary for MJPEG
    const frameData = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
      frame,
      Buffer.from('\r\n')
    ]);
    
    this.clients.forEach((client) => {
      try {
        if (client.connected && !client.res.writableEnded) {
          client.res.write(frameData);
        } else {
          deadClients.push(client.id);
        }
      } catch (error) {
        console.error(`[Proxy] Error writing to client ${client.id}:`, error.message);
        deadClients.push(client.id);
      }
    });
    
    // Clean up dead clients
    deadClients.forEach(id => this.removeClient(id));
  }

  getStats() {
    return {
      isConnected: this.isConnected,
      clientCount: this.clients.size,
      sourceUrl: this.sourceUrl,
      hasLastFrame: !!this.lastFrame
    };
  }
}

export default MjpegProxy;