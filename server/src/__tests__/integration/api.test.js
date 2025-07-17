import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import { flashlightErrorHandler } from '../utils/handlers/index.js'

describe('API Endpoints Integration Tests', () => {
  let app
  let mjpegProxy
  let flashlightState
  
  beforeAll(async () => {
    //dynamically import to ensure fresh instance
    const appModule = await import('../../index.js')
    app = appModule.app
    mjpegProxy = appModule.mjpegProxy
    flashlightState = appModule.flashlightState
  })
  
  afterAll(() => {
    //cleanup proxy connection
    if (mjpegProxy.reconnectTimeout) {
      clearTimeout(mjpegProxy.reconnectTimeout)
    }
    if (mjpegProxy.request) {
      mjpegProxy.request.abort()
    }
  })
  
  beforeEach(() => {
    //reset proxy state
    mjpegProxy.clients.clear()
    mjpegProxy.lastFrame = null
    
    //reset flashlight state
    if (flashlightState) {
      flashlightState.isOn = false
      flashlightState.turnedOnAt = null
      if (flashlightState.autoOffTimeout) {
        clearTimeout(flashlightState.autoOffTimeout)
        flashlightState.autoOffTimeout = null
      }
    }
  })
  
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
        serverTime: expect.any(String)
      })
    })
    
    it('should reflect actual client count', async () => {
      //add mock clients
      mjpegProxy.clients.set('client1', { id: 'client1' })
      mjpegProxy.clients.set('client2', { id: 'client2' })
      
      const response = await request(app)
        .get('/api/stats')
        .expect(200)
      
      expect(response.body.clientCount).toBe(2)
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
        proxy: {
          isConnected: expect.any(Boolean),
          clientCount: expect.any(Number),
          sourceUrl: expect.any(String),
          hasLastFrame: expect.any(Boolean)
        }
      })
    })
    
    it('should return valid memory metrics', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200)
      
      const { memory } = response.body
      expect(memory.rss).toBeGreaterThan(0)
      expect(memory.heapTotal).toBeGreaterThan(0)
      expect(memory.heapUsed).toBeGreaterThan(0)
      expect(memory.heapUsed).toBeLessThanOrEqual(memory.heapTotal)
    })
  })
  
  describe('PUT /api/flashlight', () => {
    it('should toggle flashlight successfully', async () => {
      const response = await request(app)
        .put('/api/flashlight')
        .expect(200)
        .expect('Content-Type', /json/)
      
      expect(response.body).toMatchObject({
        success: true,
        isOn: true,
        remainingSeconds: expect.any(Number),
        message: expect.any(String)
      })
    })
    
    it('should handle flashlight toggle errors', async () => {
      //override handler to return error
      server.use(flashlightErrorHandler)
      
      const response = await request(app)
        .put('/api/flashlight')
        .expect(500)
      
      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to turn on flashlight'
      })
    })
  })
  
  describe('GET /api/droidcam-status', () => {
    it('should return comprehensive status information', async () => {
      const response = await request(app)
        .get('/api/droidcam-status')
        .expect(200)
        .expect('Content-Type', /json/)
      
      expect(response.body).toHaveProperty('droidcam')
      expect(response.body).toHaveProperty('proxy')
      expect(response.body).toHaveProperty('server')
      
      expect(response.body.droidcam).toMatchObject({
        ip: expect.any(String),
        port: expect.any(String),
        url: expect.any(String),
        videoUrl: expect.any(String),
        reachable: expect.any(Boolean)
      })
      
      expect(response.body.proxy).toMatchObject({
        connected: expect.any(Boolean),
        viewerCount: expect.any(Number),
        clientIds: expect.any(Array)
      })
      
      expect(response.body.server).toMatchObject({
        uptime: expect.any(Number),
        nodeVersion: expect.any(String),
        environment: expect.any(String)
      })
    })
  })
  
  describe('GET /api/stream', () => {
    it('should return MJPEG stream headers', (done) => {
      const req = request(app)
        .get('/api/stream')
        .expect(200)
        .expect('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        .expect('Cache-Control', 'no-cache, no-store, must-revalidate')
        .expect('Connection', 'close')
        .end((err) => {
          if (err) return done(err)
          
          //abort the connection since it's a stream
          req.abort()
          done()
        })
    })
    
    it('should add client to proxy', (done) => {
      const initialCount = mjpegProxy.clients.size
      
      const req = request(app)
        .get('/api/stream')
        .end((err) => {
          if (err && err.code !== 'ECONNABORTED') return done(err)
          
          //check that client was added
          expect(mjpegProxy.clients.size).toBe(initialCount + 1)
          
          //cleanup by removing all clients
          mjpegProxy.clients.clear()
          done()
        })
      
      //give it time to register then abort
      setTimeout(() => {
        req.abort()
      }, 100)
    })
  })
  
  describe('Static file routes', () => {
    it('should serve React app or return 404 if not built', async () => {
      const response = await request(app).get('/')
      
      // Either serves the React app (200) or returns 404 with build message
      if (response.status === 404) {
        expect(response.text).toContain('Client build not found')
      } else {
        expect(response.status).toBe(200)
        expect(response.headers['content-type']).toMatch(/html/)
      }
    })
    
    it('should handle client-side routes', async () => {
      const response = await request(app).get('/coop')
      
      // Should serve the same React app for client-side routing
      if (response.status === 404) {
        expect(response.text).toContain('Client build not found')
      } else {
        expect(response.status).toBe(200)
        expect(response.headers['content-type']).toMatch(/html/)
      }
    })
  })
  
  describe('Error handling', () => {
    it('should handle 404 for unknown routes', async () => {
      await request(app)
        .get('/api/unknown')
        .expect(404)
    })
    
    it('should handle invalid HTTP methods', async () => {
      await request(app)
        .post('/api/stats')
        .expect(404)
    })
  })
})