import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import { Readable } from 'stream'
import path from 'path'

// Mock fs module for recording endpoints
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
    })
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

describe('Final Test Fixes', () => {
  let app
  let mjpegProxy
  let weatherCache
  
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.STREAM_PAUSE_PASSWORD = 'test-password-123'
    
    // Clear module cache to ensure fresh imports
    vi.resetModules()
    
    const appModule = await import('../../app.js')
    app = appModule.app
    mjpegProxy = appModule.mjpegProxy
    weatherCache = appModule.weatherCache
  })
  
  beforeEach(() => {
    // Clear weather cache before each test
    if (weatherCache) {
      weatherCache.data = null
      weatherCache.timestamp = null
    }
    
    // Reset MSW handlers
    server.resetHandlers()
  })
  
  describe('Weather API Error Handling', () => {
    it('should handle weather API errors correctly with empty cache', async () => {
      // Ensure cache is empty
      if (weatherCache) {
        weatherCache.data = null
        weatherCache.timestamp = null
      }
      
      server.use(
        http.get('https://api.weather.gov/gridpoints/SGX/39,60/forecast', () => {
          return new HttpResponse(null, { status: 500 })
        })
      )
      
      const response = await request(app).get('/api/weather')
      
      // Weather service returns 200 with error flag in data
      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.error).toBe(true)
      expect(response.body.data.conditions).toBe('Weather Unavailable')
    })
  })
  
  describe('Recording Endpoints', () => {
    it('handles missing recording files gracefully', async () => {
      const response = await request(app)
        .get('/api/recordings/thumbnail/2024-12-31_23-59-59.mp4')
      
      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Thumbnail not found')
    })
  })
  
  describe('Reaction Validation', () => {
    it('validates reaction request properly', async () => {
      const response = await request(app)
        .post('/api/recordings/2024-01-01_12-00-00.mp4/reactions')
        .set('Cookie', 'viewerId=test-user')
        .send({ reaction: 'invalid-type' })
      
      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      // Check for error in either error or message property
      const errorMessage = response.body.error || response.body.message
      expect(errorMessage).toContain('Invalid')
    })
  })
  
  describe('Interpolation Stats', () => {
    it('should return correct interpolation statistics structure', async () => {
      const response = await request(app)
        .get('/api/interpolation-stats')
        .expect(200)
        .expect('Content-Type', /json/)
      
      // Match the actual structure from mjpegProxy.getStats().interpolation
      expect(response.body).toHaveProperty('enabled')
      expect(response.body).toHaveProperty('bufferSize')
      expect(response.body).toHaveProperty('bufferMemoryMB')
      expect(typeof response.body.enabled).toBe('boolean')
      expect(typeof response.body.bufferSize).toBe('number')
      expect(typeof response.body.bufferMemoryMB).toBe('string')
      
      // These properties come from interpolationStats spread
      if (response.body.frameHistory !== undefined) {
        expect(typeof response.body.frameHistory).toBe('number')
      }
    })
  })
  
  describe('Path Traversal Security', () => {
    it('should prevent all forms of path traversal in video endpoint', async () => {
      // These don't match date pattern
      const invalidFormatAttempts = [
        '../../../etc/passwd',
        '..\\\\..\\\\..\\\\windows\\\\system32\\\\config\\\\sam',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'
      ]
      
      for (const attempt of invalidFormatAttempts) {
        const response = await request(app)
          .get(`/api/recordings/video/${encodeURIComponent(attempt)}`)
        
        expect(response.status).toBe(400)
        expect(response.body.error).toBe('Invalid filename format')
      }
      
      // This has date pattern but is still path traversal
      const datePathTraversal = await request(app)
        .get('/api/recordings/video/2024-01-01%2F..%2F..%2F..%2Fetc%2Fpasswd')
      
      expect(datePathTraversal.status).toBe(404)
      expect(datePathTraversal.body.error).toBe('Video not found')
    })
  })
})