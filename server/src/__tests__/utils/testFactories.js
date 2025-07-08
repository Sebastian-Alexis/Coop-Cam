//factory functions for creating test data

export const createMockProxyStats = (overrides = {}) => ({
  isConnected: true,
  clientCount: 0,
  sourceUrl: 'http://192.168.1.67:4747/video',
  hasLastFrame: false,
  ...overrides
})

export const createMockHealthResponse = (overrides = {}) => ({
  status: 'ok',
  uptime: process.uptime(),
  memory: process.memoryUsage(),
  proxy: createMockProxyStats(),
  ...overrides
})

export const createMockClient = (id = null) => ({
  id: id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  response: {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn()
  }
})

export const createMockRequest = (overrides = {}) => ({
  method: 'GET',
  url: '/',
  headers: {},
  on: vi.fn(),
  ...overrides
})

export const createMockResponse = () => {
  const res = {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
    headersSent: false
  }
  
  return res
}