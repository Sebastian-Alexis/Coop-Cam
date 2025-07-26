//droidcam controller - diagnostic information and connectivity status with multi-camera support
//factory function receives dependencies for clean testing and modularity

export const createDroidcamController = ({ streamManager, config }) => {
  if (!streamManager) {
    throw new Error('DroidcamController: streamManager dependency is required.');
  }
  if (!config) {
    throw new Error('DroidcamController: config dependency is required.');
  }

  //get comprehensive diagnostic status for all cameras or specific camera
  const getStatus = async (req, res) => {
    try {
      const sourceId = req.query.camera; //optional camera parameter
      
      if (sourceId) {
        //get status for specific camera
        const proxy = streamManager.getProxy(sourceId);
        if (!proxy) {
          return res.status(404).json({ error: `Camera '${sourceId}' not found` });
        }
        
        const sourceConfig = streamManager.getSourceConfig(sourceId);
        const stats = proxy.getStats();
        
        //try to check if camera is reachable
        let cameraReachable = false;
        let cameraError = null;
        
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          
          const baseUrl = sourceConfig.url.replace('/video', '');
          const response = await fetch(`${baseUrl}/`, { 
            signal: controller.signal,
            method: 'GET'
          });
          
          clearTimeout(timeout);
          cameraReachable = response.ok;
          
          if (!response.ok) {
            cameraError = `HTTP ${response.status}`;
          }
        } catch (error) {
          cameraError = error.message;
        }
        
        res.json({
          camera: {
            id: sourceId,
            name: sourceConfig.name,
            url: sourceConfig.url,
            baseUrl: sourceConfig.url.replace('/video', ''),
            reachable: cameraReachable,
            error: cameraError
          },
          proxy: {
            connected: stats.isConnected,
            viewerCount: stats.clientCount,
            clientIds: Array.from(proxy.clients?.keys() || []),
            lastFrameTime: proxy.lastFrameTime || null,
            frameCount: stats.frameCount || 0
          },
          server: {
            uptime: process.uptime(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV || 'development'
          }
        });
      } else {
        //get status for all cameras
        const allStats = streamManager.getAllStats();
        const availableSources = streamManager.listAvailableSources();
        const cameraStatuses = {};
        
        //check reachability for each camera
        for (const source of availableSources) {
          let cameraReachable = false;
          let cameraError = null;
          
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            
            const baseUrl = source.url;
            const response = await fetch(`${baseUrl}/`, { 
              signal: controller.signal,
              method: 'GET'
            });
            
            clearTimeout(timeout);
            cameraReachable = response.ok;
            
            if (!response.ok) {
              cameraError = `HTTP ${response.status}`;
            }
          } catch (error) {
            cameraError = error.message;
          }
          
          const stats = allStats[source.id] || {};
          cameraStatuses[source.id] = {
            camera: {
              id: source.id,
              name: source.name,
              url: `${source.url}/video`,
              baseUrl: source.url,
              isDefault: source.isDefault,
              reachable: cameraReachable,
              error: cameraError
            },
            proxy: {
              connected: stats.isConnected || false,
              viewerCount: stats.clientCount || 0,
              frameCount: stats.frameCount || 0,
              lastFrameTime: stats.lastFrameTime || null
            }
          };
        }
        
        res.json({
          cameras: cameraStatuses,
          server: {
            uptime: process.uptime(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV || 'development',
            totalCameras: availableSources.length
          }
        });
      }
    } catch (error) {
      console.error('[DroidCam Status] Error:', error);
      res.status(500).json({ 
        error: 'Failed to get status',
        message: error.message 
      });
    }
  };

  return {
    getStatus
  };
};