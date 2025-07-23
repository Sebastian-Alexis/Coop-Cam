//stream controller - business logic for MJPEG stream management and control
//factory function receives dependencies for clean testing and modularity

export const createStreamController = ({ streamManager, authService, config }) => {
  if (!streamManager) {
    throw new Error('StreamController: streamManager dependency is required.');
  }
  if (!authService) {
    throw new Error('StreamController: authService dependency is required.');
  }
  if (!config) {
    throw new Error('StreamController: config dependency is required.');
  }

  //handle main MJPEG stream endpoint with client management and source selection
  const handleStream = (req, res) => {
    const { sourceId } = req.params;
    
    //get appropriate proxy (default if no sourceId specified)
    const proxy = sourceId 
      ? streamManager.getProxy(sourceId)
      : streamManager.getDefaultProxy();

    if (!proxy) {
      return res.status(404).json({
        success: false,
        message: `Stream source '${sourceId}' not found`,
        availableSources: streamManager.listAvailableSources()
      });
    }

    //parse FPS from query parameter
    const fps = req.query.fps ? parseInt(req.query.fps) : null;
    const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${fps ? `-fps${fps}` : ''}`;
    
    //set TCP_NODELAY for low-latency streaming
    if (req.socket && req.socket.setNoDelay) {
      req.socket.setNoDelay(true);
    }
    
    //set socket timeout to prevent hanging connections
    if (req.socket && req.socket.setTimeout) {
      req.socket.setTimeout(0); //disable timeout for streaming
    }
    
    proxy.addClient(clientId, res, fps);
  };

  //handle stream pause with authentication and rate limiting
  const pauseStream = async (req, res) => {
    const { sourceId } = req.params;
    const clientIp = req.ip;
    const { password } = req.body;
    
    //get appropriate proxy (default if no sourceId specified)
    const proxy = sourceId 
      ? streamManager.getProxy(sourceId)
      : streamManager.getDefaultProxy();

    if (!proxy) {
      return res.status(404).json({
        success: false,
        message: `Stream source '${sourceId}' not found`,
        availableSources: streamManager.listAvailableSources()
      });
    }
    
    //validate password presence
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    //check rate limit after validating password but before processing
    if (authService.isRateLimited(clientIp)) {
      console.log(`[Stream Pause] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({
        success: false,
        message: 'Too many attempts. Please try again in a minute.'
      });
    }
    
    //record attempt for rate limiting (counts all attempts)
    authService.recordAttempt(clientIp);
    
    //verify password using timing-safe comparison
    if (!authService.verifyPassword(password, config.STREAM_PAUSE_PASSWORD)) {
      console.log(`[Stream Pause] Invalid password attempt from IP: ${clientIp}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }
    
    try {
      //pause the specific stream
      const paused = await proxy.pauseStream();
      const sourceInfo = sourceId ? ` (source: ${sourceId})` : '';
      
      if (paused) {
        console.log(`[Stream Pause] Stream paused by IP: ${clientIp}${sourceInfo} at ${new Date().toISOString()}`);
        res.json({
          success: true,
          message: `Stream paused for 5 minutes${sourceInfo}`,
          pauseDuration: 300, //seconds
          sourceId: sourceId || 'default'
        });
      } else {
        res.status(400).json({
          success: false,
          message: `Stream is already paused${sourceInfo}`
        });
      }
    } catch (error) {
      console.error('[Stream Pause] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to pause stream'
      });
    }
  };

  //get stream status including pause state and client information
  const getStreamStatus = (req, res) => {
    const { sourceId } = req.params;
    
    try {
      //get appropriate proxy (default if no sourceId specified)
      const proxy = sourceId 
        ? streamManager.getProxy(sourceId)
        : streamManager.getDefaultProxy();

      if (!proxy) {
        return res.status(404).json({
          success: false,
          message: `Stream source '${sourceId}' not found`,
          availableSources: streamManager.listAvailableSources()
        });
      }

      const pauseStatus = proxy.getPauseStatus();
      const proxyStats = proxy.getStats();
      
      res.json({
        success: true,
        sourceId: sourceId || 'default',
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
  };

  //list all available stream sources
  const listSources = (req, res) => {
    try {
      const sources = streamManager.listAvailableSources();
      const sourcesWithHealth = sources.map(source => ({
        ...source,
        health: streamManager.getSourceHealth(source.id)
      }));

      res.json({
        success: true,
        sources: sourcesWithHealth,
        totalSources: streamManager.totalSources
      });
    } catch (error) {
      console.error('[Stream Sources] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get stream sources'
      });
    }
  };

  return {
    handleStream,
    pauseStream,
    getStreamStatus,
    listSources
  };
};