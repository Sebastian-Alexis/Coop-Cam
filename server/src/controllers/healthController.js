//health controller - business logic for health and status operations
//factory function receives dependencies for clean testing and modularity

export const createHealthController = ({ streamManager, recordingServices }) => {
  if (!streamManager) {
    throw new Error('HealthController: streamManager dependency is required.');
  }

  //basic health check with multi-camera support
  const getHealth = (req, res) => {
    const allProxyStats = streamManager.getAllStats(); //get stats from all camera proxies
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cameras: allProxyStats
    });
  };

  //interpolation statistics aggregated from all cameras
  const getInterpolationStats = (req, res) => {
    const allProxyStats = streamManager.getAllStats();
    const interpolationStats = {};
    
    //aggregate interpolation stats from all cameras
    Object.keys(allProxyStats).forEach(sourceId => {
      interpolationStats[sourceId] = allProxyStats[sourceId].interpolation;
    });
    
    res.json(interpolationStats);
  };

  //comprehensive stats endpoint with multi-camera support
  const getStats = (req, res) => {
    const allProxyStats = streamManager.getAllStats();
    const response = {
      cameras: {},
      serverTime: new Date().toISOString(),
      totalClients: 0
    };
    
    //build per-camera stats
    Object.keys(allProxyStats).forEach(sourceId => {
      const stats = allProxyStats[sourceId];
      response.cameras[sourceId] = {
        isConnected: stats.isConnected,
        clientCount: stats.clientCount,
        sourceUrl: stats.sourceUrl,
        hasLastFrame: stats.hasLastFrame,
        frameCount: stats.frameCount || 0,
        interpolation: stats.interpolation
      };
      response.totalClients += stats.clientCount;
    });
    
    //add recording stats if enabled
    if (recordingServices && recordingServices.size > 0) {
      response.recording = {};
      recordingServices.forEach((service, sourceId) => {
        response.recording[sourceId] = service.getStats();
      });
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