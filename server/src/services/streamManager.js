//manages multiple MJPEG proxy instances for multi-stream support
//factory function receives config for clean dependency injection

import MjpegProxy from '../mjpegProxy.js';

export const createStreamManager = ({ config }) => {
  if (!config || !config.streamSources) {
    throw new Error('StreamManager: config.streamSources is required.');
  }

  const streamSources = config.streamSources;
  const proxies = new Map(); // Store active proxy instances: Map<string, MjpegProxy>

  //find the default source
  const defaultSource = streamSources.find(s => s.isDefault);
  if (!defaultSource) {
    throw new Error('StreamManager: No default stream source found in configuration.');
  }

  console.log(`[StreamManager] Initialized with ${streamSources.length} stream sources, default: ${defaultSource.id}`);

  //get proxy for specific source (lazy initialization)
  function getProxy(sourceId) {
    //if proxy already exists, return it
    if (proxies.has(sourceId)) {
      return proxies.get(sourceId);
    }

    //if requesting the default source and default proxy exists, return it
    if (sourceId === defaultSource.id && proxies.has('default')) {
      const defaultProxy = proxies.get('default');
      //also store it under the sourceId for future lookups
      proxies.set(sourceId, defaultProxy);
      console.log(`[StreamManager] Reusing default proxy for source: ${sourceId}`);
      return defaultProxy;
    }

    //find the source configuration
    const sourceConfig = streamSources.find(s => s.id === sourceId);
    if (!sourceConfig) {
      return null; // Source ID not found
    }

    //create new proxy instance (lazy initialization)
    console.log(`[StreamManager] Creating proxy for source: ${sourceId} (${sourceConfig.url})`);
    const newProxy = new MjpegProxy(sourceConfig.url, {
      sourceId: sourceConfig.id,
      sourceName: sourceConfig.name
    });
    
    //store proxy instance
    proxies.set(sourceId, newProxy);
    
    //start connection
    newProxy.connect();
    
    return newProxy;
  }

  //get default proxy instance
  function getDefaultProxy() {
    return getProxy(defaultSource.id);
  }

  //list available sources for client-side selection
  function listAvailableSources() {
    return streamSources.map(({ id, name, url }) => ({ 
      id, 
      name,
      url: url.replace(/\/video$/, ''), // Remove /video path for display
      isDefault: id === defaultSource.id
    }));
  }

  //get source configuration by ID
  function getSourceConfig(sourceId) {
    return streamSources.find(s => s.id === sourceId) || null;
  }

  //get health status for specific source
  function getSourceHealth(sourceId) {
    const proxy = proxies.get(sourceId);
    if (!proxy) {
      return { status: 'inactive', connected: false };
    }
    
    const stats = proxy.getStats();
    return {
      status: proxy.isConnected ? 'active' : 'disconnected',
      connected: proxy.isConnected,
      clients: stats.clientCount,
      frameCount: stats.frameCount,
      lastFrameTime: stats.lastFrameTime
    };
  }

  //get health status for all sources
  function getAllSourcesHealth() {
    const health = {};
    streamSources.forEach(source => {
      health[source.id] = getSourceHealth(source.id);
    });
    return health;
  }

  //gracefully shut down all active proxy connections
  function shutdown() {
    console.log('[StreamManager] Shutting down all proxies...');
    proxies.forEach((proxy, sourceId) => {
      console.log(`[StreamManager] Shutting down proxy for source: ${sourceId}`);
      try {
        //disconnect all clients and close connection
        proxy.removeAllClients?.() || proxy.clients?.clear();
        proxy.disconnect?.();
      } catch (error) {
        console.error(`[StreamManager] Error shutting down proxy ${sourceId}:`, error);
      }
    });
    proxies.clear();
  }

  //cleanup inactive proxies (optional optimization)
  function cleanupInactiveProxies() {
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    
    proxies.forEach((proxy, sourceId) => {
      const stats = proxy.getStats();
      if (stats.clientCount === 0 && now - stats.lastFrameTime > inactiveThreshold) {
        console.log(`[StreamManager] Cleaning up inactive proxy for source: ${sourceId}`);
        try {
          proxy.disconnect?.();
        } catch (error) {
          console.error(`[StreamManager] Error cleaning up proxy ${sourceId}:`, error);
        }
        proxies.delete(sourceId);
      }
    });
  }

  return {
    //core proxy management
    getProxy,
    getDefaultProxy,
    
    //source information
    listAvailableSources,
    getSourceConfig,
    
    //health monitoring
    getSourceHealth,
    getAllSourcesHealth,
    
    //lifecycle management
    shutdown,
    cleanupInactiveProxies,
    
    //internal access for advanced usage
    get activeSources() {
      return Array.from(proxies.keys());
    },
    
    get totalSources() {
      return streamSources.length;
    }
  };
};