//batch controller - orchestrates multiple API calls for mobile optimization
//factory function receives all services this complex endpoint depends on

export const createBatchController = ({ 
  mjpegProxy, 
  weatherService, 
  flashlightState, 
  recordingService, 
  thumbnailService, 
  config 
}) => {
  if (!mjpegProxy) {
    throw new Error('BatchController: mjpegProxy dependency is required.');
  }
  if (!weatherService) {
    throw new Error('BatchController: weatherService dependency is required.');
  }
  if (!flashlightState) {
    throw new Error('BatchController: flashlightState dependency is required.');
  }
  // recordingService can be null if recording is disabled
  // if (!recordingService) {
  //   throw new Error('BatchController: recordingService dependency is required.');
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
            //handle different endpoints
            let data;
            switch (endpoint) {
              case '/api/stats':
                data = mjpegProxy.getStats();
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
                data = {
                  isPaused: mjpegProxy.getPauseState().isPaused,
                  pauseEndTime: mjpegProxy.getPauseState().pauseEndTime,
                  remainingMs: mjpegProxy.getPauseState().pauseEndTime 
                    ? Math.max(0, mjpegProxy.getPauseState().pauseEndTime - Date.now())
                    : 0
                };
                break;
                
              case '/api/flashlight/status':
                data = flashlightState.getStatus();
                break;
                
              case '/api/recordings/recent':
                if (!recordingService) {
                  data = {
                    success: false,
                    error: 'Recording service is not enabled'
                  };
                } else {
                  const dateStr = new Date().toLocaleDateString('en-US', { 
                    timeZone: 'America/Los_Angeles' 
                  });
                  const recordings = await recordingService.getRecordingsByDate(dateStr);
                  const recordingsWithThumbnails = await Promise.all(
                    recordings.map(async (recording) => {
                      const thumbnailExists = await thumbnailService.thumbnailExists(recording.filename);
                      return {
                        ...recording,
                        thumbnailUrl: thumbnailExists 
                          ? `/api/recordings/thumbnail/${recording.filename}`
                          : null
                      };
                    })
                  );
                  data = { 
                    success: true, 
                    recordings: recordingsWithThumbnails,
                    date: dateStr,
                    timezone: 'America/Los_Angeles'
                  };
                }
                break;
                
              case '/api/droidcam-status':
                const clients = mjpegProxy.getClients();
                const clientList = Array.from(clients.entries()).map(([id, client]) => ({
                  id: client.id.substring(0, 8),
                  connectedAt: new Date(parseInt(id.split('-')[0])).toISOString(),
                  frameCount: client.frameCount || 0,
                  lastFrameTime: client.lastFrameTime ? new Date(client.lastFrameTime).toISOString() : null
                }));
                data = {
                  isConnected: mjpegProxy.isConnected,
                  sourceUrl: mjpegProxy.sourceUrl,
                  clients: clientList,
                  uptime: process.uptime(),
                  memory: process.memoryUsage()
                };
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