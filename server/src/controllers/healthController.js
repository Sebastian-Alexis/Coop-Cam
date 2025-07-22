//health controller - business logic for health and status operations
//factory function receives dependencies for clean testing and modularity

export const createHealthController = ({ mjpegProxy, recordingService }) => {
  if (!mjpegProxy) {
    throw new Error('HealthController: mjpegProxy dependency is required.');
  }

  //basic health check
  const getHealth = (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      proxy: mjpegProxy.getStats()
    });
  };

  //interpolation statistics
  const getInterpolationStats = (req, res) => {
    const stats = mjpegProxy.getStats();
    res.json(stats.interpolation);
  };

  //comprehensive stats endpoint
  const getStats = (req, res) => {
    const stats = mjpegProxy.getStats();
    const response = {
      isConnected: stats.isConnected,
      clientCount: stats.clientCount,
      sourceUrl: stats.sourceUrl,
      hasLastFrame: stats.hasLastFrame,
      serverTime: new Date().toISOString(),
      frameCount: mjpegProxy.frameCount || 0,
      interpolation: stats.interpolation
    };
    
    //add recording stats if enabled
    if (recordingService) {
      response.recording = recordingService.getStats();
    }
    
    //mobile-specific headers
    if (req.isMobile) {
      res.set({
        'Cache-Control': 'private, max-age=10', //cache for 10 seconds on mobile
        'X-Mobile-Optimized': 'true'
      });
    }
    
    res.json(response);
  };

  return {
    getHealth,
    getInterpolationStats,
    getStats
  };
};