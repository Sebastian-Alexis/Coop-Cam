//sse client management service
const SSE_CLIENT_CLEANUP_INTERVAL = 60000; //60 seconds
const SSE_CLIENT_MAX_INACTIVITY = 120000; //2 minutes

class SseService {
  constructor() {
    this.clients = new Map();
    
    //setup cleanup interval for inactive clients
    setInterval(
      this.cleanupInactiveClients.bind(this),
      SSE_CLIENT_CLEANUP_INTERVAL
    );
  }

  addClient(req, res) {
    const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    //setup SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      //nginx compatibility
      'X-Accel-Buffering': 'no'
    });
    
    //send initial connection message
    res.write(`data: ${JSON.stringify({ 
      type: 'connected', 
      timestamp: Date.now(), 
      isMobile: req.isMobile || false 
    })}\n\n`);

    //create client object with metadata
    const newClient = { 
      res, 
      req,
      lastActivity: Date.now(),
      isMobile: req.isMobile || false,
      heartbeatInterval: null
    };
    
    this.clients.set(clientId, newClient);
    console.log(`[SSE] ${newClient.isMobile ? 'Mobile' : 'Desktop'} client connected. Total clients: ${this.clients.size}`);

    //setup heartbeat - shorter interval for mobile to detect disconnections faster
    const heartbeatInterval = newClient.isMobile ? 15000 : 30000; //15s for mobile, 30s for desktop
    newClient.heartbeatInterval = setInterval(() => {
      if (this.clients.has(clientId)) {
        try {
          res.write(`data: ${JSON.stringify({ 
            type: 'heartbeat', 
            timestamp: Date.now() 
          })}\n\n`);
          newClient.lastActivity = Date.now();
        } catch (error) {
          console.error(`[SSE] Heartbeat error for client ${clientId}:`, error);
          this._removeClient(clientId);
        }
      }
    }, heartbeatInterval);

    //handle client disconnect
    req.on('close', () => {
      this._removeClient(clientId);
    });

    req.on('error', (error) => {
      console.error(`[SSE] Client error for ${clientId}:`, error);
      this._removeClient(clientId);
    });

    return clientId;
  }

  //broadcast message to all connected clients
  broadcast(eventData) {
    if (this.clients.size === 0) return;

    const formattedEvent = `data: ${JSON.stringify(eventData)}\n\n`;
    const disconnectedClients = [];
    
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.res.write(formattedEvent);
        client.lastActivity = Date.now();
      } catch (error) {
        console.error(`[SSE] Broadcast error for client ${clientId}:`, error);
        disconnectedClients.push(clientId);
      }
    }

    //cleanup failed clients
    disconnectedClients.forEach(clientId => this._removeClient(clientId));
  }

  //private method to remove a client
  _removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      //clear heartbeat interval
      if (client.heartbeatInterval) {
        clearInterval(client.heartbeatInterval);
      }
      
      //close response if still open
      try {
        if (!client.res.destroyed) {
          client.res.end();
        }
      } catch (error) {
        //connection already closed
      }
      
      this.clients.delete(clientId);
      console.log(`[SSE] ${client.isMobile ? 'Mobile' : 'Desktop'} client disconnected. Total clients: ${this.clients.size}`);
    }
  }

  //cleanup inactive clients to prevent memory leaks
  cleanupInactiveClients() {
    const now = Date.now();
    const inactiveClients = [];
    
    for (const [clientId, client] of this.clients.entries()) {
      if (now - client.lastActivity > SSE_CLIENT_MAX_INACTIVITY) {
        inactiveClients.push(clientId);
      }
    }
    
    inactiveClients.forEach(clientId => {
      console.log(`[SSE] Cleaning up inactive client ${clientId}`);
      this._removeClient(clientId);
    });
  }

  //get current client count
  getClientCount() {
    return this.clients.size;
  }

  //get detailed client statistics
  getClientStats() {
    const stats = {
      total: this.clients.size,
      mobile: 0,
      desktop: 0,
      connections: []
    };

    for (const [clientId, client] of this.clients.entries()) {
      if (client.isMobile) {
        stats.mobile++;
      } else {
        stats.desktop++;
      }

      stats.connections.push({
        id: clientId,
        isMobile: client.isMobile,
        connectedAt: new Date(client.lastActivity).toISOString(),
        lastActivity: new Date(client.lastActivity).toISOString()
      });
    }

    return stats;
  }

  //cleanup method for shutdown
  cleanup() {
    //clear all client connections
    for (const [clientId] of this.clients.entries()) {
      this._removeClient(clientId);
    }
    console.log('[SSE] Service cleanup completed');
  }

  //test isolation method
  _resetForTests() {
    this.cleanup();
  }
}

//create and export singleton instance
const sseService = new SseService();
export default sseService;