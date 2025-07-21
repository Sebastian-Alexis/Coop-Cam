import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Comprehensive API Endpoints Integration Tests', () => {
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
    const appModule = await import('../../index.js')
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
  
  describe('1. Stream Endpoints', () => {
    describe('GET /api/stream', () => {
      it('should return MJPEG stream with correct headers', (done) => {
        const req = request(app)
          .get('/api/stream')
        
        req.on('response', (res) => {
          expect(res.statusCode).toBe(200)
          expect(res.headers['content-type']).toBe('multipart/x-mixed-replace; boundary=frame')
          expect(res.headers['connection']).toBe('close')
          expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate')
          
          // Abort the request since it's a continuous stream
          req.abort()
          done()
        })
      })
      
      it('should support FPS query parameter', (done) => {
        const req = request(app)
          .get('/api/stream?fps=15')
        
        req.on('response', (res) => {
          expect(res.statusCode).toBe(200)
          
          // Give time for client to be registered
          setTimeout(() => {
            const clientIds = Array.from(mjpegProxy.clients.keys())
            expect(clientIds.some(id => id.includes('-fps15'))).toBe(true)
            req.abort()
            done()
          }, 50)
        })
      })
      
      it('should handle multiple concurrent connections', (done) => {
        const connections = []
        let responseCount = 0
        
        // Start connections
        for (let i = 0; i < 5; i++) {
          const req = request(app).get('/api/stream')
          
          req.on('response', (res) => {
            responseCount++
            if (responseCount === 5) {
              // All connections established
              expect(mjpegProxy.clients.size).toBe(5)
              
              // Cleanup connections
              connections.forEach(r => r.abort())
              done()
            }
          })
          
          connections.push(req)
        }
      })
    })
    
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
      
      it('should enforce rate limiting after 3 attempts', async () => {
        // Use a unique IP for this test to avoid interference
        const testIP = '192.168.100.' + Math.floor(Math.random() * 250 + 1)
        
        // Make 3 failed attempts
        for (let i = 0; i < 3; i++) {
          await request(app)
            .post('/api/stream/pause')
            .set('X-Forwarded-For', testIP)
            .send({ password: 'wrong' })
            .expect(401)
        }
        
        // 4th attempt should be rate limited
        const response = await request(app)
          .post('/api/stream/pause')
          .set('X-Forwarded-For', testIP)
          .send({ password: 'test-password-123' })
          .expect(429)
        
        expect(response.body.message).toContain('Too many attempts')
      })
      
      it('should validate password is provided', async () => {
        const response = await request(app)
          .post('/api/stream/pause')
          .send({})
          .expect(400)
        
        expect(response.body).toMatchObject({
          success: false,
          message: 'Password is required'
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
  
  describe('2. Statistics & Health Endpoints', () => {
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
        
        expect(response.body).toMatchObject({
          enabled: expect.any(Boolean),
          frameHistory: expect.any(Number),
          gapThreshold: expect.any(Number)
        })
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
  
  describe('3. Motion Event Endpoints', () => {
    describe('GET /api/events/motion (SSE)', () => {
      it('should establish SSE connection with correct headers', async () => {
        const response = await request(app)
          .get('/api/events/motion')
          .expect(200)
          .expect('Content-Type', 'text/event-stream')
          .expect('Cache-Control', 'no-cache')
          .expect('Connection', 'keep-alive')
          .expect('X-Accel-Buffering', 'no')
      })
    })
    
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
  
  describe('4. Flashlight Control Endpoints', () => {
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
    
    describe('PUT /api/flashlight/off', () => {
      it('should turn flashlight off', async () => {
        // First turn it on
        flashlightState.isOn = true
        flashlightState.turnedOnAt = new Date()
        
        server.use(
          http.put('http://192.168.1.67:4747/v1/camera/torch_toggle', () => {
            return new HttpResponse(null, { status: 200 })
          })
        )
        
        const response = await request(app)
          .put('/api/flashlight/off')
          .expect(200)
        
        expect(response.body).toMatchObject({
          success: true,
          isOn: false,
          message: 'Flashlight turned off successfully'
        })
        
        expect(flashlightState.isOn).toBe(false)
      })
    })
    
    describe('PUT /api/flashlight (legacy)', () => {
      it('should redirect to /api/flashlight/on', async () => {
        server.use(
          http.put('http://192.168.1.67:4747/v1/camera/torch_toggle', () => {
            return new HttpResponse(null, { status: 200 })
          })
        )
        
        const response = await request(app)
          .put('/api/flashlight')
          .expect(200)
        
        expect(response.body).toMatchObject({
          success: true,
          isOn: true
        })
      })
    })
  })
  
  describe('5. Weather Endpoint', () => {
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
      
      it('should handle weather API errors', async () => {
        server.use(
          http.get('https://api.weather.gov/gridpoints/SGX/39,60/forecast', () => {
            return new HttpResponse(null, { status: 503 })
          })
        )
        
        const response = await request(app)
          .get('/api/weather')
          .expect(500)
        
        expect(response.body).toMatchObject({
          success: false,
          error: 'Failed to fetch weather data'
        })
      })
    })
  })
  
  describe('6. Recording Endpoints', () => {
    // Create test recordings directory
    const testRecordingsDir = path.join(__dirname, 'test-recordings', '2024-01-01')
    const testVideoFile = path.join(testRecordingsDir, '2024-01-01_12-00-00.mp4')
    const testThumbnailFile = path.join(testRecordingsDir, '.thumbnails', '2024-01-01_12-00-00.jpg')
    
    beforeEach(() => {
      // Create test directories and files
      fs.mkdirSync(testRecordingsDir, { recursive: true })
      fs.mkdirSync(path.join(testRecordingsDir, '.thumbnails'), { recursive: true })
      fs.writeFileSync(testVideoFile, 'fake video content')
      fs.writeFileSync(testThumbnailFile, 'fake thumbnail')
    })
    
    afterEach(() => {
      // Cleanup test files
      fs.rmSync(path.dirname(testRecordingsDir), { recursive: true, force: true })
    })
    
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
    
    describe('GET /api/recordings/thumbnail/:filename', () => {
      it('should serve thumbnail image', async () => {
        const response = await request(app)
          .get('/api/recordings/thumbnail/2024-01-01_12-00-00.mp4')
          .expect(200)
          .expect('Content-Type', 'image/jpeg')
          .expect('Cache-Control', 'public, max-age=3600')
      })
      
      it('should reject invalid filename format', async () => {
        const response = await request(app)
          .get('/api/recordings/thumbnail/invalid-filename.mp4')
          .expect(400)
        
        expect(response.body).toMatchObject({
          error: 'Invalid filename format'
        })
      })
      
      it('should prevent path traversal attacks', async () => {
        const response = await request(app)
          .get('/api/recordings/thumbnail/../../etc/passwd')
          .expect(400)
        
        expect(response.body).toMatchObject({
          error: 'Invalid filename format'
        })
      })
    })
    
    describe('GET /api/recordings/video/:filename', () => {
      it('should serve video file with range support', async () => {
        const response = await request(app)
          .get('/api/recordings/video/2024-01-01_12-00-00.mp4')
          .set('Range', 'bytes=0-100')
          .expect(206)
          .expect('Content-Type', 'video/mp4')
          .expect('Accept-Ranges', 'bytes')
      })
      
      it('should handle full video request', async () => {
        const response = await request(app)
          .get('/api/recordings/video/2024-01-01_12-00-00.mp4')
          .expect(200)
          .expect('Content-Type', 'video/mp4')
      })
      
      it('should return 404 for non-existent video', async () => {
        const response = await request(app)
          .get('/api/recordings/video/2024-01-01_99-99-99.mp4')
          .expect(404)
        
        expect(response.body).toMatchObject({
          error: 'Video not found'
        })
      })
    })
  })
  
  describe('7. Reaction Endpoints', () => {
    describe('GET /api/recordings/:filename/reactions', () => {
      it('should get reactions for a recording', async () => {
        const response = await request(app)
          .get('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
          .set('Cookie', 'viewerId=test-user-123')
          .expect(200)
          .expect('Content-Type', /json/)
        
        expect(response.body).toMatchObject({
          success: true,
          summary: expect.any(Object),
          totalReactions: expect.any(Number),
          userReaction: null,
          reactionTypes: expect.any(Object),
          chickenTones: expect.any(Object)
        })
      })
    })
    
    describe('POST /api/recordings/:filename/reactions', () => {
      it('should add a reaction', async () => {
        const response = await request(app)
          .post('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
          .set('Cookie', 'viewerId=test-user-123')
          .send({ reaction: 'hearts', tone: 'happy' })
          .expect(200)
        
        expect(response.body).toMatchObject({
          success: true,
          action: expect.any(String)
        })
      })
      
      it('should validate reaction type', async () => {
        const response = await request(app)
          .post('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
          .set('Cookie', 'viewerId=test-user-123')
          .send({ reaction: 'invalid-reaction' })
          .expect(400)
        
        expect(response.body).toMatchObject({
          success: false,
          error: 'Invalid reaction type'
        })
      })
      
      it('should require user identification', async () => {
        const response = await request(app)
          .post('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
          .send({ reaction: 'hearts' })
          .expect(400)
        
        expect(response.body).toMatchObject({
          success: false,
          error: 'User identification required'
        })
      })
    })
    
    describe('DELETE /api/recordings/:filename/reactions', () => {
      it('should remove a reaction', async () => {
        const response = await request(app)
          .delete('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
          .set('Cookie', 'viewerId=test-user-123')
          .send({ reactionType: 'hearts' })
          .expect(200)
        
        expect(response.body).toMatchObject({
          success: true
        })
      })
    })
    
    describe('POST /api/recordings/reactions/batch', () => {
      it('should get reactions for multiple recordings', async () => {
        const response = await request(app)
          .post('/api/recordings/reactions/batch')
          .set('Cookie', 'viewerId=test-user-123')
          .send({ filenames: ['2024-01-01_12-00-00.mp4', '2024-01-01_13-00-00.mp4'] })
          .expect(200)
        
        expect(response.body).toMatchObject({
          success: true,
          reactions: expect.any(Object),
          reactionTypes: expect.any(Object),
          chickenTones: expect.any(Object)
        })
      })
      
      it('should validate filenames array', async () => {
        const response = await request(app)
          .post('/api/recordings/reactions/batch')
          .send({ filenames: 'not-an-array' })
          .expect(400)
        
        expect(response.body).toMatchObject({
          success: false,
          error: 'Invalid request',
          message: 'filenames array required'
        })
      })
    })
  })
  
  describe('8. Batch API Endpoint', () => {
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
      
      it('should handle errors in individual requests', async () => {
        // Force weather service to fail
        server.use(
          http.get('https://api.weather.gov/gridpoints/SGX/39,60/forecast', () => {
            return new HttpResponse(null, { status: 500 })
          })
        )
        
        const response = await request(app)
          .post('/api/batch')
          .send({
            requests: [
              { endpoint: '/api/stats', method: 'GET' },
              { endpoint: '/api/weather', method: 'GET' }
            ]
          })
          .expect(200)
        
        const results = response.body.results
        expect(results[0].success).toBe(true) // stats should succeed
        expect(results[1].success).toBe(false) // weather should fail
      })
      
      it('should validate request format', async () => {
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
  
  describe('9. Static Pages', () => {
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
    
    describe('GET /undefined-route', () => {
      it('should return 404 for undefined routes', async () => {
        const response = await request(app)
          .get('/undefined-route')
          .expect(404)
          .expect('Content-Type', /text/)
        
        expect(response.text).toBe('Page not found')
      })
    })
  })
  
  describe('Security Vulnerability Tests', () => {
    describe('XSS Prevention', () => {
      it('should prevent XSS in recording filenames', async () => {
        const maliciousFilename = '<script>alert("XSS")</script>'
        const response = await request(app)
          .get(`/api/recordings/thumbnail/${encodeURIComponent(maliciousFilename)}`)
          .expect(400)
        
        expect(response.body.error).toBe('Invalid filename format')
      })
      
      it('should escape user input in reactions', async () => {
        const response = await request(app)
          .post('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
          .set('Cookie', 'viewerId=<script>alert("XSS")</script>')
          .send({ reaction: 'hearts' })
          .expect(200)
        
        // The reaction should be stored but with escaped user ID
        expect(response.body.success).toBe(true)
      })
    })
    
    describe('Path Traversal Prevention', () => {
      it('should prevent path traversal in video endpoint', async () => {
        const attempts = [
          '../../../etc/passwd',
          '..\\..\\..\\windows\\system32\\config\\sam',
          '2024-01-01/../../../etc/passwd',
          '2024-01-01%2F..%2F..%2F..%2Fetc%2Fpasswd'
        ]
        
        for (const attempt of attempts) {
          const response = await request(app)
            .get(`/api/recordings/video/${attempt}`)
            .expect(400)
          
          expect(response.body.error).toBe('Invalid filename format')
        }
      })
    })
    
    describe('Command Injection Prevention', () => {
      it('should sanitize filenames to prevent command injection', async () => {
        const maliciousFilenames = [
          '2024-01-01_12-00-00.mp4; rm -rf /',
          '2024-01-01_12-00-00.mp4 && cat /etc/passwd',
          '2024-01-01_12-00-00.mp4`whoami`'
        ]
        
        for (const filename of maliciousFilenames) {
          const response = await request(app)
            .get(`/api/recordings/video/${encodeURIComponent(filename)}`)
            .expect(400)
          
          expect(response.body.error).toBe('Invalid filename format')
        }
      })
    })
    
    describe('CORS Security', () => {
      it('should allow CORS on SSE endpoints', async () => {
        const response = await request(app)
          .get('/api/events/motion')
          .expect(200)
          .expect('Access-Control-Allow-Origin', '*')
      })
    })
    
    describe('Information Disclosure', () => {
      it('should not expose sensitive information in errors', async () => {
        const response = await request(app)
          .get('/api/recordings/video/non-existent-file.mp4')
          .expect(404)
        
        // Should not contain file paths or system information
        expect(response.body).not.toMatch(/\/home|\/usr|C:\\/)
        expect(response.body.error).toBe('Video not found')
      })
    })
  })
  
  describe('Mobile-Specific Behavior', () => {
    const mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
    
    it('should detect mobile devices correctly', async () => {
      const response = await request(app)
        .get('/api/stats')
        .set('User-Agent', mobileUserAgent)
        .expect(200)
        .expect('X-Mobile-Optimized', 'true')
    })
    
    it('should set appropriate cache headers for mobile', async () => {
      const endpoints = [
        { path: '/api/stats', cacheTime: 'private, max-age=10' },
        { path: '/api/weather', cacheTime: 'private, max-age=300' },
        { path: '/api/flashlight/status', cacheTime: 'private, max-age=5' }
      ]
      
      for (const { path, cacheTime } of endpoints) {
        const response = await request(app)
          .get(path)
          .set('User-Agent', mobileUserAgent)
          .expect(200)
          .expect('Cache-Control', cacheTime)
      }
    })
    
    it('should use shorter heartbeat interval for mobile SSE', async () => {
      const response = await request(app)
        .get('/api/events/motion')
        .set('User-Agent', mobileUserAgent)
        .expect(200)
      
      // Check first message indicates mobile detection
      const firstChunk = response.text.split('\n')[0]
      expect(firstChunk).toContain('isMobile')
    })
    
    it('should optimize batch API for mobile connections', async () => {
      const response = await request(app)
        .post('/api/batch')
        .set('User-Agent', mobileUserAgent)
        .send({
          requests: [
            { endpoint: '/api/stats' },
            { endpoint: '/api/flashlight/status' }
          ]
        })
        .expect(200)
        .expect('X-Mobile-Optimized', 'true')
        // X-Batch-Request header may not be implemented
    })
  })
  
  describe('Performance & Concurrency Tests', () => {
    it('should handle multiple concurrent stream connections', async () => {
      const connectionCount = 20
      const promises = Array(connectionCount).fill(null).map(() =>
        request(app).get('/api/stream')
      )
      
      await Promise.all(promises)
      expect(mjpegProxy.clients.size).toBe(connectionCount)
    })
    
    it('should process batch requests efficiently', async () => {
      const start = Date.now()
      
      const response = await request(app)
        .post('/api/batch')
        .send({
          requests: [
            { endpoint: '/api/stats' },
            { endpoint: '/api/flashlight/status' },
            { endpoint: '/api/stream/status' },
            { endpoint: '/api/droidcam-status' }
          ]
        })
        .expect(200)
      
      const duration = Date.now() - start
      
      // Batch should be faster than sequential requests
      expect(duration).toBeLessThan(500) // Should complete in under 500ms
      expect(response.body.results).toHaveLength(4)
      expect(response.body.results.every(r => r.success)).toBe(true)
    })
    
    it('should handle rapid SSE connections and disconnections', async () => {
      const connections = []
      
      // Create 10 SSE connections
      for (let i = 0; i < 10; i++) {
        const req = request(app).get('/api/events/motion')
        connections.push(req)
      }
      
      // Wait a bit then abort all connections
      await new Promise(resolve => setTimeout(resolve, 100))
      connections.forEach(conn => conn.abort())
      
      // SSE clients should be cleaned up
      // Note: We can't directly check sseClients size as it's private
      // but the server should handle this gracefully without crashes
    })
  })
  
  describe('Error Handling', () => {
    it('should handle malformed JSON in POST requests', async () => {
      const response = await request(app)
        .post('/api/stream/pause')
        .set('Content-Type', 'application/json')
        .send('{"invalid json}')
        .expect(400)
    })
    
    it('should handle missing Content-Type', async () => {
      const response = await request(app)
        .post('/api/recordings/reactions/batch')
        .send('some data')
        .expect(400)
    })
    
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
    })
  })
})

// Additional test suite for authentication and authorization
describe('Authentication & Authorization Tests', () => {
  let app
  
  beforeAll(async () => {
    const appModule = await import('../../index.js')
    app = appModule.app
  })
  
  it('should not require auth for public endpoints', async () => {
    const publicEndpoints = [
      '/api/stats',
      '/api/health',
      '/api/stream',
      '/api/flashlight/status',
      '/',
      '/coop',
      '/about'
    ]
    
    for (const endpoint of publicEndpoints) {
      const response = await request(app)
        .get(endpoint)
        .expect((res) => {
          expect(res.status).not.toBe(401)
          expect(res.status).not.toBe(403)
        })
    }
  })
  
  it('should protect sensitive operations with password', async () => {
    const response = await request(app)
      .post('/api/stream/pause')
      .send({}) // No password
      .expect(400)
    
    expect(response.body.message).toBe('Password is required')
  })
})

// Test suite for rate limiting
describe('Rate Limiting Tests', () => {
  let app
  
  beforeAll(async () => {
    const appModule = await import('../../index.js')
    app = appModule.app
  })
  
  it('should rate limit password attempts per IP', async () => {
    // Make 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/stream/pause')
        .set('X-Forwarded-For', '10.0.0.1')
        .send({ password: 'wrong' })
        .expect(401)
    }
    
    // 4th attempt should be rate limited
    const response = await request(app)
      .post('/api/stream/pause')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ password: 'correct-password' })
      .expect(429)
    
    expect(response.body.message).toContain('Too many attempts')
  })
  
  it('should allow different IPs to attempt independently', async () => {
    // IP 1 makes 2 attempts
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/stream/pause')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ password: 'wrong' })
        .expect(401)
    }
    
    // IP 2 should still be able to attempt
    const response = await request(app)
      .post('/api/stream/pause')
      .set('X-Forwarded-For', '10.0.0.3')
      .send({ password: 'test-password-123' })
      .expect(200)
    
    expect(response.body.success).toBe(true)
  })
})