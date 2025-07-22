import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

//mock MotionDetectionService with EventEmitter interface for app.js integration tests
vi.mock('../../services/motionDetectionService.js', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      const mockEventEmitter = {
        //EventEmitter methods
        on: vi.fn(),
        emit: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        removeAllListeners: vi.fn(),
        setMaxListeners: vi.fn(),
        getMaxListeners: vi.fn(),
        listeners: vi.fn(() => []),
        listenerCount: vi.fn(() => 0),
        
        //service-specific methods
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        isRunning: vi.fn(() => false),
        getStats: vi.fn(() => ({
          isEnabled: false,
          processedFrames: 0,
          motionEvents: 0,
          averageProcessingTime: 0
        }))
      }
      
      return mockEventEmitter
    })
  }
})

describe('API Endpoints - Working Tests', () => {
  let app
  let mjpegProxy
  let flashlightState
  let originalEnv
  
  beforeAll(async () => {
    // Save original environment
    originalEnv = { ...process.env }
    
    // Set test environment variables
    process.env.NODE_ENV = 'test'
    process.env.STREAM_PAUSE_PASSWORD = 'test-password-123'
    process.env.DROIDCAM_IP = '192.168.1.67'
    process.env.DROIDCAM_PORT = '4747'
    
    // Dynamically import to ensure fresh instance
    const appModule = await import('../../app.js')
    app = appModule.app
    mjpegProxy = appModule.mjpegProxy
    flashlightState = appModule.flashlightState
  })
  
  afterAll(() => {
    // Cleanup proxy connection
    if (mjpegProxy?.reconnectTimeout) {
      clearTimeout(mjpegProxy.reconnectTimeout)
    }
    if (mjpegProxy?.request) {
      mjpegProxy.request.abort()
    }
    
    // Restore environment
    process.env = originalEnv
  })
  
  beforeEach(() => {
    // Reset proxy state
    mjpegProxy.clients.clear()
    mjpegProxy.lastFrame = null
    mjpegProxy.frameCount = 0
    
    // Reset flashlight state
    if (flashlightState) {
      flashlightState.isOn = false
      flashlightState.turnedOnAt = null
      if (flashlightState.autoOffTimeout) {
        clearTimeout(flashlightState.autoOffTimeout)
        flashlightState.autoOffTimeout = null
      }
    }
    
    // Reset MSW handlers
    server.resetHandlers()
  })
  
  describe('Statistics & Health Endpoints', () => {
    describe('GET /api/stats', () => {
      it('should return proxy statistics', async () => {
        const response = await request(app)
          .get('/api/stats')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          isConnected: expect.any(Boolean),
          clientCount: expect.any(Number),
          sourceUrl: expect.any(String),
          hasLastFrame: expect.any(Boolean),
          serverTime: expect.any(String),
          frameCount: expect.any(Number)
        })
      })
      
      it('should include mobile-specific headers when user agent is mobile', async () => {
        const response = await request(app)
          .get('/api/stats')
          .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)')
          .expect(200)
          .expect('Cache-Control', 'private, max-age=10')
          .expect('X-Mobile-Optimized', 'true')
      })
    })
    
    describe('GET /api/health', () => {
      it('should return health check information', async () => {
        const response = await request(app)
          .get('/api/health')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          status: 'ok',
          uptime: expect.any(Number),
          memory: {
            rss: expect.any(Number),
            heapTotal: expect.any(Number),
            heapUsed: expect.any(Number),
            external: expect.any(Number)
          },
          proxy: expect.any(Object)
        })
      })
    })
    
    describe('GET /api/interpolation-stats', () => {
      it('should return interpolation statistics', async () => {
        const response = await request(app)
          .get('/api/interpolation-stats')
          .expect(200)
          .expect('Content-Type', /json/)
        
        // The response is mjpegProxy.getStats().interpolation
        // Basic properties are always present
        expect(response.body).toHaveProperty('enabled')
        expect(response.body).toHaveProperty('bufferSize')
        expect(response.body).toHaveProperty('bufferMemoryMB')
        expect(typeof response.body.enabled).toBe('boolean')
        expect(typeof response.body.bufferSize).toBe('number')
        expect(typeof response.body.bufferMemoryMB).toBe('string')
        
        // interpolationStats properties may or may not be present
        if (response.body.frameHistory !== undefined) {
          expect(typeof response.body.frameHistory).toBe('number')
        }
      })
    })
    
    describe('GET /api/droidcam-status', () => {
      it('should return DroidCam diagnostic information', async () => {
        const response = await request(app)
          .get('/api/droidcam-status')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          droidcam: {
            ip: '192.168.1.67',
            port: '4747',
            url: expect.any(String),
            videoUrl: expect.any(String),
            reachable: expect.any(Boolean)
          },
          proxy: {
            connected: expect.any(Boolean),
            viewerCount: expect.any(Number),
            clientIds: expect.any(Array)
          },
          server: {
            uptime: expect.any(Number),
            nodeVersion: expect.any(String),
            environment: 'test'
          }
        })
      })
    })
  })
  
  describe('Stream Control Endpoints', () => {
    describe('POST /api/stream/pause', () => {
      it('should pause stream with correct password', async () => {
        const response = await request(app)
          .post('/api/stream/pause')
          .send({ password: 'test-password-123' })
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          message: 'Stream paused for 5 minutes',
          pauseDuration: 300
        })
      })
      
      it('should reject incorrect password', async () => {
        const response = await request(app)
          .post('/api/stream/pause')
          .send({ password: 'wrong-password' })
          .expect(401)
        
        expect(response.body).toMatchObject({
          success: false,
          message: 'Invalid password'
        })
      })
    })
    
    describe('GET /api/stream/status', () => {
      it('should return stream status', async () => {
        const response = await request(app)
          .get('/api/stream/status')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          isPaused: expect.any(Boolean),
          clientCount: expect.any(Number),
          isConnected: expect.any(Boolean)
        })
      })
    })
  })
  
  describe('Flashlight Control Endpoints', () => {
    describe('GET /api/flashlight/status', () => {
      it('should return flashlight status', async () => {
        const response = await request(app)
          .get('/api/flashlight/status')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          isOn: false,
          remainingSeconds: 0,
          droidcamUrl: expect.any(String)
        })
      })
    })
    
    describe('PUT /api/flashlight/on', () => {
      it('should turn flashlight on', async () => {
        // Mock DroidCam flashlight response
        server.use(
          http.put('http://192.168.1.67:4747/v1/camera/torch_toggle', () => {
            return new HttpResponse(null, { status: 200 })
          })
        )
        
        const response = await request(app)
          .put('/api/flashlight/on')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          isOn: true,
          remainingSeconds: 300,
          message: 'Flashlight turned on successfully'
        })
        
        expect(flashlightState.isOn).toBe(true)
      })
      
      it('should handle DroidCam API errors', async () => {
        server.use(
          http.put('http://192.168.1.67:4747/v1/camera/torch_toggle', () => {
            return new HttpResponse(null, { status: 500 })
          })
        )
        
        const response = await request(app)
          .put('/api/flashlight/on')
          .expect(500)
        
        expect(response.body).toMatchObject({
          success: false,
          message: 'Failed to turn on flashlight'
        })
      })
    })
  })
  
  describe('Weather Endpoint', () => {
    describe('GET /api/weather', () => {
      it('should return weather data', async () => {
        // Mock weather API response
        server.use(
          http.get('https://api.weather.gov/gridpoints/SGX/39,60/forecast', () => {
            return HttpResponse.json({
              properties: {
                periods: [
                  {
                    name: 'Today',
                    temperature: 75,
                    temperatureUnit: 'F',
                    shortForecast: 'Sunny'
                  }
                ]
              }
            })
          })
        )
        
        const response = await request(app)
          .get('/api/weather')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          data: expect.any(Object),
          cache: expect.any(Object)
        })
      })
    })
  })
  
  describe('Motion Event Endpoints', () => {
    describe('GET /api/motion/history', () => {
      it('should return motion event history with pagination', async () => {
        const response = await request(app)
          .get('/api/motion/history?limit=10&offset=0')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          events: expect.any(Array),
          total: expect.any(Number),
          offset: 0,
          limit: 10
        })
      })
      
      it('should filter by timestamp', async () => {
        const since = Date.now() - 3600000 // 1 hour ago
        const response = await request(app)
          .get(`/api/motion/history?since=${since}`)
          .expect(200)
        
        expect(response.body.success).toBe(true)
        response.body.events.forEach(event => {
          expect(event.timestamp).toBeGreaterThan(since)
        })
      })
    })
  })
  
  describe('Recording Endpoints', () => {
    describe('GET /api/recordings/recent', () => {
      it('should return recent recordings with metadata', async () => {
        const response = await request(app)
          .get('/api/recordings/recent?limit=3')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          recordings: expect.any(Array),
          reactionTypes: expect.any(Object),
          chickenTones: expect.any(Object)
        })
      })
    })
  })
  
  describe('Static Pages', () => {
    describe('GET / (landing page)', () => {
      it('should serve landing page', async () => {
        const response = await request(app)
          .get('/')
          .expect(200)
          .expect('Content-Type', /html/)
          .expect('Cache-Control', 'public, max-age=3600')
      })
    })
    
    describe('GET /coop (stream page)', () => {
      it('should serve stream viewer page', async () => {
        const response = await request(app)
          .get('/coop')
          .expect(200)
          .expect('Content-Type', /html/)
      })
    })
    
    describe('GET /about', () => {
      it('should serve about page', async () => {
        const response = await request(app)
          .get('/about')
          .expect(200)
          .expect('Content-Type', /html/)
      })
    })
  })
  
  describe('Batch API Endpoint', () => {
    describe('POST /api/batch', () => {
      it('should process multiple requests in batch', async () => {
        const response = await request(app)
          .post('/api/batch')
          .send({
            requests: [
              { endpoint: '/api/stats', method: 'GET' },
              { endpoint: '/api/flashlight/status', method: 'GET' }
            ]
          })
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          results: expect.arrayContaining([
            expect.objectContaining({
              endpoint: '/api/stats',
              success: true,
              data: expect.any(Object)
            }),
            expect.objectContaining({
              endpoint: '/api/flashlight/status',
              success: true,
              data: expect.any(Object)
            })
          ])
        })
      })
      
      it('should reject non-whitelisted endpoints', async () => {
        const response = await request(app)
          .post('/api/batch')
          .send({
            requests: [
              { endpoint: '/api/some-random-endpoint', method: 'GET' }
            ]
          })
          .expect(200)
        
        expect(response.body.results[0]).toMatchObject({
          endpoint: '/api/some-random-endpoint',
          success: false,
          error: 'Endpoint not allowed in batch requests'
        })
      })
    })
  })
  
  describe('Error Handling', () => {
    it('should return 500 for internal server errors', async () => {
      // Force an internal error by breaking mjpegProxy
      mjpegProxy.getStats = () => { throw new Error('Internal error') }
      
      const response = await request(app)
        .get('/api/stats')
        .expect(500)
        .expect('Content-Type', /json/)
      
      expect(response.body).toMatchObject({
        error: 'Internal server error'
      })
      
      // Restore the function
      mjpegProxy.getStats = mjpegProxy.constructor.prototype.getStats
    })
  })
})

// Test suite for Security
describe('Security Tests', () => {
  let app
  
  beforeAll(async () => {
    process.env.STREAM_PAUSE_PASSWORD = 'secure-test-password'
    const appModule = await import('../../app.js')
    app = appModule.app
  })
  
  describe('XSS Prevention', () => {
    it('should reject malicious recording filenames', async () => {
      const maliciousFilename = '<script>alert("XSS")</script>'
      const response = await request(app)
        .get(`/api/recordings/thumbnail/${encodeURIComponent(maliciousFilename)}`)
        .expect(400)
      
      expect(response.body.error).toBe('Invalid filename format')
    })
  })
  
  describe('Path Traversal Prevention', () => {
    it('should prevent path traversal in video endpoint', async () => {
      // These don't have date patterns - should return 400
      const invalidFormatAttempts = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam'
      ]
      
      for (const attempt of invalidFormatAttempts) {
        const response = await request(app)
          .get(`/api/recordings/video/${encodeURIComponent(attempt)}`)
          .expect(400)
        
        expect(response.body.error).toBe('Invalid filename format')
      }
      
      // This has a date pattern but file doesn't exist - should return 404
      const datePathTraversal = await request(app)
        .get('/api/recordings/video/2024-01-01%2F..%2F..%2F..%2Fetc%2Fpasswd')
        .expect(404)
      
      expect(datePathTraversal.body.error).toBe('Video not found')
    })
  })
  
  describe('Input Validation', () => {
    it('should validate password is required', async () => {
      const response = await request(app)
        .post('/api/stream/pause')
        .send({})
        .expect(400)
      
      expect(response.body).toMatchObject({
        success: false,
        message: 'Password is required'
      })
    })
    
    it('should validate batch request format', async () => {
      const response = await request(app)
        .post('/api/batch')
        .send({ notRequests: [] })
        .expect(400)
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid request format',
        message: 'requests array required'
      })
    })
  })
})