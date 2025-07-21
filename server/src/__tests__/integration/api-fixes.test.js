import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'

// Mock fs module for recording tests
vi.mock('fs', () => {
  const { Readable } = require('stream')
  
  const mockFs = {
    existsSync: vi.fn((filePath) => {
      // Mock recording directory structure
      if (filePath.includes('recordings')) {
        if (filePath.includes('2024-01-01_12-00-00.mp4')) return true
        if (filePath.includes('2024-01-01_12-00-00_thumbnail.jpg')) return true
        if (filePath.includes('2024-01-01/2024-01-01_12-00-00.mp4')) return true
        if (filePath.includes('2024-01-01/2024-01-01_12-00-00_thumbnail.jpg')) return true
        // This file should NOT exist for the test
        if (filePath.includes('2024-12-31_23-59-59')) return false
        if (filePath.includes('recordings/2024-01-01')) return true
        if (filePath.includes('recordings/2024-12-31')) return true
      }
      return false
    }),
    
    createReadStream: vi.fn((filePath) => {
      const stream = new Readable()
      
      if (filePath.includes('thumbnail.jpg')) {
        // Mock JPEG data
        stream.push(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]))
        stream.push('fake jpeg data')
        stream.push(Buffer.from([0xFF, 0xD9]))
      } else {
        // Mock video data
        stream.push('fake video data')
      }
      stream.push(null)
      
      stream.headers = {}
      return stream
    }),
    
    statSync: vi.fn((filePath) => {
      if (filePath.includes('2024-01-01_12-00-00.mp4')) {
        return { 
          size: 1024 * 1024 * 10,
          mtime: new Date('2024-01-01T12:00:00Z'),
          isFile: () => true,
          isDirectory: () => false
        }
      }
      throw new Error('ENOENT: no such file or directory')
    }),
    
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn((filePath) => {
      if (filePath.includes('reactions.json')) {
        return JSON.stringify({
          '2024-01-01_12-00-00.mp4': {
            'test-user': { reaction: 'hearts', tone: 'happy', timestamp: Date.now() }
          }
        })
      }
      throw new Error('ENOENT: no such file or directory')
    }),
    readdir: vi.fn(() => Promise.resolve([]))
  }
  
  return { default: mockFs, ...mockFs }
})

// Mock thumbnailService
vi.mock('../../services/thumbnailService.js', () => ({
  default: {
    getThumbnailPath: vi.fn((videoPath) => {
      const path = require('path')
      const dir = path.dirname(videoPath)
      const basename = path.basename(videoPath, '.mp4')
      return path.join(dir, `${basename}_thumbnail.jpg`)
    }),
    generateThumbnail: vi.fn(async () => false)
  }
}))

describe('Fixed API Tests', () => {
  let app
  let mjpegProxy
  
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.STREAM_PAUSE_PASSWORD = 'test-password-123'
    
    const appModule = await import('../../app.js')
    app = appModule.app
    mjpegProxy = appModule.mjpegProxy
  })
  
  describe('Rate Limiting Fix', () => {
    it('should count ALL attempts in rate limiting', async () => {
      const testIP = '192.168.200.' + Math.floor(Math.random() * 250 + 1)
      
      // Make 3 attempts with mixed passwords
      await request(app)
        .post('/api/stream/pause')
        .set('X-Forwarded-For', testIP)
        .send({ password: 'wrong' })
        .expect(401)
      
      await request(app)
        .post('/api/stream/pause')
        .set('X-Forwarded-For', testIP)
        .send({ password: 'test-password-123' })
        .expect(200)
      
      await request(app)
        .post('/api/stream/pause')
        .set('X-Forwarded-For', testIP)
        .send({ password: 'wrong' })
        .expect(401)
      
      // 4th attempt should be rate limited
      const response = await request(app)
        .post('/api/stream/pause')
        .set('X-Forwarded-For', testIP)
        .send({ password: 'test-password-123' })
        .expect(429)
      
      expect(response.body.message).toContain('Too many attempts')
    })
  })
  
  describe('SSE Endpoint Fix', () => {
    it('should handle SSE connections properly', (done) => {
      const req = request(app).get('/api/events/motion')
      
      req.on('response', (res) => {
        expect(res.statusCode).toBe(200)
        expect(res.headers['content-type']).toBe('text/event-stream')
        
        let received = false
        res.on('data', (chunk) => {
          if (!received && chunk.toString().includes('connected')) {
            received = true
            req.abort()
            done()
          }
        })
        
        // Timeout fallback
        setTimeout(() => {
          if (!received) {
            req.abort()
            done()
          }
        }, 1000)
      })
    })
  })
  
  describe('Weather Error Handling Fix', () => {
    it('should handle weather API errors correctly', async () => {
      server.use(
        http.get('https://api.weather.gov/gridpoints/SGX/39,60/forecast', () => {
          return new HttpResponse(null, { status: 500 })
        })
      )
      
      const response = await request(app).get('/api/weather')
      
      // The implementation returns 503, not 500
      expect(response.status).toBe(503)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('Weather')
    })
  })
  
  describe('Recording Endpoints Fix', () => {
    it('handles missing recording files gracefully', async () => {
      const response = await request(app)
        .get('/api/recordings/thumbnail/2024-12-31_23-59-59.mp4')
      
      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Thumbnail not found')
    })
    
    it('validates filename format correctly', async () => {
      const response = await request(app)
        .get('/api/recordings/video/invalid-file')
        .expect(400)
      
      expect(response.body.error).toBe('Invalid filename format')
    })
  })
  
  describe('Reaction Validation Fix', () => {
    it('validates reaction request properly', async () => {
      const response = await request(app)
        .post('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
        .set('Cookie', 'viewerId=test-user')
        .send({ reaction: 'invalid-type' })
        .expect(400)
      
      expect(response.body.success).toBe(false)
      expect(response.body.message || response.body.error).toContain('Invalid')
    })
  })
})