//droidcam controller - diagnostic information and connectivity status
//factory function receives dependencies for clean testing and modularity

import { DROIDCAM_URL } from '../config.js';

export const createDroidcamController = ({ mjpegProxy, config }) => {
  if (!mjpegProxy) {
    throw new Error('DroidcamController: mjpegProxy dependency is required.');
  }
  if (!config) {
    throw new Error('DroidcamController: config dependency is required.');
  }

  //get comprehensive diagnostic status for DroidCam and proxy
  const getStatus = async (req, res) => {
    try {
      const stats = mjpegProxy.getStats();
      const droidcamUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}`;
      
      //try to check if DroidCam is reachable
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
  };

  return {
    getStatus
  };
};