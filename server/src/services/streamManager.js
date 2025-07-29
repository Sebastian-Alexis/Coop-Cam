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
    //always use canonical sourceId (resolve 'default' to actual default source id)
    const canonicalSourceId = sourceId === 'default' ? defaultSource.id : sourceId;
    
    //if proxy already exists under canonical id, return it
    if (proxies.has(canonicalSourceId)) {
      console.log(`[StreamManager] Reusing existing proxy for source: ${canonicalSourceId}`);
      return proxies.get(canonicalSourceId);
    }

    //find the source configuration
    const sourceConfig = streamSources.find(s => s.id === canonicalSourceId);
    if (!sourceConfig) {
      return null; // Source ID not found
    }

    //create new proxy instance (persistent connection)
    console.log(`[StreamManager] Creating proxy for source: ${canonicalSourceId} (${sourceConfig.url})`);
    const newProxy = new MjpegProxy(sourceConfig.url, {
      sourceId: sourceConfig.id,
      sourceName: sourceConfig.name,
      disableAutoConnect: false // Enable auto-connect for persistent connections
    });
    
    //store proxy instance under canonical id only
    proxies.set(canonicalSourceId, newProxy);
    
    //only connect when first client connects
    //newProxy.connect(); // Remove auto-connect
    
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

  //get complete stats for all active sources
  function getAllStats() {
    const stats = {};
    proxies.forEach((proxy, sourceId) => {
      stats[sourceId] = proxy.getStats();
    });
    return stats;
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

  //maintain persistent connections (no cleanup of inactive proxies)
  function cleanupInactiveProxies() {
    //proxies now maintain persistent connections regardless of client count
    console.log(`[StreamManager] Maintaining ${proxies.size} persistent proxy connections`);
    
    //health check for debugging - log proxy status without disconnecting
    proxies.forEach((proxy, sourceId) => {
      const stats = proxy.getStats();
      if (stats.clientCount === 0) {
        console.log(`[StreamManager] Proxy ${sourceId}: 0 clients, connected: ${stats.isConnected}, frames: ${stats.frameCount}`);
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
    getAllStats,
    
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