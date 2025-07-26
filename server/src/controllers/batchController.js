//batch controller - orchestrates multiple API calls for mobile optimization with multi-camera support
//factory function receives all services this complex endpoint depends on

export const createBatchController = ({ 
  streamManager, 
  weatherService, 
  flashlightState, 
  recordingServices, 
  thumbnailService, 
  config 
}) => {
  if (!streamManager) {
    throw new Error('BatchController: streamManager dependency is required.');
  }
  if (!weatherService) {
    throw new Error('BatchController: weatherService dependency is required.');
  }
  if (!flashlightState) {
    throw new Error('BatchController: flashlightState dependency is required.');
  }
  // recordingServices can be null if recording is disabled
  // if (!recordingServices) {
  //   throw new Error('BatchController: recordingServices dependency is required.');
  // }
  if (!thumbnailService) {
    throw new Error('BatchController: thumbnailService dependency is required.');
  }
  if (!config) {
    throw new Error('BatchController: config dependency is required.');
  }

  //combines multiple API calls into single request for mobile optimization
  const processBatchRequest = async (req, res) => {
    try {
      const { requests } = req.body;
      
      if (!requests || !Array.isArray(requests)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request format',
          message: 'requests array required'
        });
      }
      
      //process each request in parallel
      const results = await Promise.allSettled(
        requests.map(async (request) => {
          const { endpoint, method = 'GET', body } = request;
          
          //whitelist of allowed endpoints for batching
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
            //handle different endpoints with multi-camera support
            let data;
            const camera = request.camera || 'default'; //camera parameter for multi-camera support
            
            switch (endpoint) {
              case '/api/stats':
                //get stats for specific camera or all cameras
                if (camera && camera !== 'all') {
                  const proxy = streamManager.getProxy(camera);
                  if (proxy) {
                    const stats = proxy.getStats();
                    data = {
                      camera: camera,
                      ...stats
                    };
                  } else {
                    data = { error: `Camera '${camera}' not found` };
                  }
                } else {
                  //aggregate stats from all cameras
                  const allStats = streamManager.getAllStats();
                  data = {
                    cameras: allStats,
                    totalClients: Object.values(allStats).reduce((sum, stats) => sum + (stats.clientCount || 0), 0)
                  };
                }
                break;
                
              case '/api/weather':
                const weatherData = await weatherService.fetchWeatherData(config.WEATHER_USER_AGENT);
                const cacheStatus = weatherService.getCacheStatus();
                
                //check if weather service returned error data
                if (weatherData.error) {
                  data = {
                    success: false,
                    error: 'Weather service unavailable',
                    data: weatherData,
                    cache: cacheStatus
                  };
                } else {
                  data = {
                    success: true,
                    data: weatherData,
                    cache: cacheStatus
                  };
                }
                break;
                
              case '/api/stream/status':
                //get stream status for specific camera or all cameras
                if (camera && camera !== 'all') {
                  const proxy = streamManager.getProxy(camera);
                  if (proxy) {
                    const pauseState = proxy.getPauseState ? proxy.getPauseState() : { isPaused: false, pauseEndTime: null };
                    data = {
                      camera: camera,
                      isPaused: pauseState.isPaused,
                      pauseEndTime: pauseState.pauseEndTime,
                      remainingMs: pauseState.pauseEndTime 
                        ? Math.max(0, pauseState.pauseEndTime - Date.now())
                        : 0
                    };
                  } else {
                    data = { error: `Camera '${camera}' not found` };
                  }
                } else {
                  //get status for all cameras
                  const allStats = streamManager.getAllStats();
                  const cameraStatuses = {};
                  Object.keys(allStats).forEach(sourceId => {
                    const proxy = streamManager.getProxy(sourceId);
                    const pauseState = proxy && proxy.getPauseState ? proxy.getPauseState() : { isPaused: false, pauseEndTime: null };
                    cameraStatuses[sourceId] = {
                      isPaused: pauseState.isPaused,
                      pauseEndTime: pauseState.pauseEndTime,
                      remainingMs: pauseState.pauseEndTime 
                        ? Math.max(0, pauseState.pauseEndTime - Date.now())
                        : 0
                    };
                  });
                  data = { cameras: cameraStatuses };
                }
                break;
                
              case '/api/flashlight/status':
                data = flashlightState.getStatus();
                break;
                
              case '/api/recordings/recent':
                if (!recordingServices || recordingServices.size === 0) {
                  data = {
                    success: false,
                    error: 'Recording service is not enabled'
                  };
                } else {
                  //get recordings for specific camera or all cameras
                  const recordings = await thumbnailService.getRecentRecordings(config.recording.outputDir, 3, camera);
                  data = { 
                    success: true, 
                    recordings: recordings.map(rec => ({
                      ...rec,
                      thumbnailUrl: rec.thumbnailExists ? `/api/recordings/thumbnail/${encodeURIComponent(rec.filename)}` : null,
                      videoUrl: `/api/recordings/video/${encodeURIComponent(rec.filename)}`
                    })),
                    camera: camera
                  };
                }
                break;
                
              case '/api/droidcam-status':
                //get droidcam status for specific camera or all cameras
                if (camera && camera !== 'all') {
                  const proxy = streamManager.getProxy(camera);
                  if (proxy) {
                    const clients = proxy.getClients ? proxy.getClients() : new Map();
                    const clientList = Array.from(clients.entries()).map(([id, client]) => ({
                      id: client.id ? client.id.substring(0, 8) : id.substring(0, 8),
                      connectedAt: new Date(parseInt(id.split('-')[0])).toISOString(),
                      frameCount: client.frameCount || 0,
                      lastFrameTime: client.lastFrameTime ? new Date(client.lastFrameTime).toISOString() : null
                    }));
                    data = {
                      camera: camera,
                      isConnected: proxy.isConnected,
                      sourceUrl: proxy.sourceUrl,
                      clients: clientList,
                      uptime: process.uptime(),
                      memory: process.memoryUsage()
                    };
                  } else {
                    data = { error: `Camera '${camera}' not found` };
                  }
                } else {
                  //aggregate from all cameras
                  const allStats = streamManager.getAllStats();
                  const cameraStatuses = {};
                  Object.keys(allStats).forEach(sourceId => {
                    const proxy = streamManager.getProxy(sourceId);
                    const clients = proxy && proxy.getClients ? proxy.getClients() : new Map();
                    const clientList = Array.from(clients.entries()).map(([id, client]) => ({
                      id: client.id ? client.id.substring(0, 8) : id.substring(0, 8),
                      connectedAt: new Date(parseInt(id.split('-')[0])).toISOString(),
                      frameCount: client.frameCount || 0,
                      lastFrameTime: client.lastFrameTime ? new Date(client.lastFrameTime).toISOString() : null
                    }));
                    cameraStatuses[sourceId] = {
                      isConnected: proxy ? proxy.isConnected : false,
                      sourceUrl: proxy ? proxy.sourceUrl : null,
                      clients: clientList
                    };
                  });
                  data = {
                    cameras: cameraStatuses,
                    uptime: process.uptime(),
                    memory: process.memoryUsage()
                  };
                }
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
      
      //format results
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
      
      //set cache header - longer for mobile since it's batched
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
  };

  return {
    processBatchRequest
  };
};