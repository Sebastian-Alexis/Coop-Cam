//factory functions for creating test responses

//proxy stats response factory
export const createStatsResponse = (overrides = {}) => ({
  isConnected: true,
  clientCount: 0,
  sourceUrl: 'http://192.168.1.67:4747/video',
  hasLastFrame: false,
  serverTime: new Date().toISOString(),
  ...overrides
})

//health check response factory
export const createHealthResponse = (overrides = {}) => ({
  status: 'healthy',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  memory: {
    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    percentage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
  },
  cpu: {
    usage: process.cpuUsage()
  },
  proxy: {
    connected: true,
    clientCount: 0,
    sourceUrl: 'http://192.168.1.67:4747/video'
  },
  ...overrides
})

//flashlight response factory
export const createFlashlightResponse = (success = true, overrides = {}) => {
  const base = success
    ? {
        success: true,
        message: 'Flashlight toggled successfully'
      }
    : {
        success: false,
        message: 'Failed to toggle flashlight',
        error: 'DroidCam API error'
      }
  
  return { ...base, ...overrides }
}

//error response factory
export const createErrorResponse = (status, message, error) => ({
  status,
  error: error || `Error ${status}`,
  message: message || `Request failed with status ${status}`,
  timestamp: new Date().toISOString()
})

//common response scenarios
export const responses = {
  stats: {
    connected: (clientCount = 3) => createStatsResponse({ 
      isConnected: true, 
      clientCount, 
      hasLastFrame: true 
    }),
    disconnected: () => createStatsResponse({ 
      isConnected: false, 
      clientCount: 0, 
      sourceUrl: '',
      hasLastFrame: false 
    }),
    noClients: () => createStatsResponse({ 
      isConnected: true,
      clientCount: 0,
      hasLastFrame: true
    })
  },
  health: {
    healthy: () => createHealthResponse(),
    disconnected: () => createHealthResponse({
      proxy: {
        connected: false,
        clientCount: 0,
        sourceUrl: ''
      }
    })
  },
  flashlight: {
    success: () => createFlashlightResponse(true),
    error: (error) => createFlashlightResponse(false, { error })
  },
  errors: {
    notFound: () => createErrorResponse(404, 'Not Found'),
    serverError: () => createErrorResponse(500, 'Internal Server Error'),
    badRequest: () => createErrorResponse(400, 'Bad Request')
  }
}