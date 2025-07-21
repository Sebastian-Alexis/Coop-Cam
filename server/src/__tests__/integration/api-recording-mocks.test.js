import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import path from 'path'
import { Readable } from 'stream'

// Mock fs module before any imports that use it
vi.mock('fs', () => {
  const mockFs = {
    existsSync: vi.fn((filePath) => {
      // Mock recording directory structure
      if (filePath.includes('recordings')) {
        if (filePath.includes('2024-01-01_12-00-00.mp4')) return true
        if (filePath.includes('2024-01-01_12-00-00_thumbnail.jpg')) return true
        if (filePath.includes('2024-01-01/2024-01-01_12-00-00.mp4')) return true
        if (filePath.includes('2024-01-01/2024-01-01_12-00-00_thumbnail.jpg')) return true
        if (filePath.includes('2024-01-01_99-99-99.mp4')) return false
        if (filePath.includes('recordings/2024-01-01')) return true
      }
      return false
    }),
    
    createReadStream: vi.fn((filePath) => {
      const stream = new Readable()
      
      if (filePath.includes('thumbnail.jpg')) {
        // Mock JPEG data (minimal JPEG header)
        stream.push(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]))
        stream.push('fake jpeg data')
        stream.push(Buffer.from([0xFF, 0xD9]))
      } else {
        // Mock video data
        stream.push('fake video data')
      }
      stream.push(null)
      
      // Add stream methods that might be used
      stream.headers = {}
      return stream
    }),
    
    statSync: vi.fn((filePath) => {
      if (filePath.includes('2024-01-01_12-00-00.mp4')) {
        return { 
          size: 1024 * 1024 * 10, // 10MB
          mtime: new Date('2024-01-01T12:00:00Z'),
          isFile: () => true,
          isDirectory: () => false
        }
      }
      throw new Error('ENOENT: no such file or directory')
    }),
    
    promises: {
      readdir: vi.fn(async (dirPath) => {
        if (dirPath.includes('2024-01-01')) {
          return ['2024-01-01_12-00-00.mp4', '2024-01-01_12-00-00_metadata.json']
        }
        return []
      }),
      
      readFile: vi.fn(async (filePath) => {
        if (filePath.includes('metadata.json')) {
          return JSON.stringify({
            startTime: '2024-01-01T12:00:00Z',
            endTime: '2024-01-01T12:05:00Z',
            events: []
          })
        }
        if (filePath.includes('reactions.json')) {
          return JSON.stringify({})
        }
        throw new Error('ENOENT: no such file or directory')
      }),
      
      stat: vi.fn(async (filePath) => {
        if (filePath.includes('2024-01-01_12-00-00.mp4')) {
          return {
            size: 1024 * 1024 * 10,
            mtime: new Date('2024-01-01T12:00:00Z'),
            isFile: () => true,
            isDirectory: () => false
          }
        }
        throw new Error('ENOENT: no such file or directory')
      })
    },
    
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn((filePath) => {
      if (filePath.includes('reactions.json')) {
        return JSON.stringify({})
      }
      throw new Error('ENOENT: no such file or directory')
    })
  }
  
  return { default: mockFs, ...mockFs }
})

// Mock recordingService  
vi.mock('../../services/recordingService.js', () => ({
  recordingService: {
    getRecentRecordings: vi.fn(async () => ({
      recordings: [{
        filename: '2024-01-01_12-00-00.mp4',
        size: 1024 * 1024 * 10,
        date: '2024-01-01',
        time: '12:00:00',
        timestamp: new Date('2024-01-01T12:00:00Z').toISOString(),
        thumbnailExists: true,
        metadata: {
          startTime: '2024-01-01T12:00:00Z',
          endTime: '2024-01-01T12:05:00Z',
          events: []
        }
      }],
      totalSize: 1024 * 1024 * 10,
      totalCount: 1
    }))
  }
}))

// Mock thumbnailService
vi.mock('../../services/thumbnailService.js', () => ({
  default: {
    getThumbnailPath: vi.fn((videoPath) => {
      const dir = path.dirname(videoPath)
      const basename = path.basename(videoPath, '.mp4')
      return path.join(dir, `${basename}_thumbnail.jpg`)
    }),
    generateThumbnail: vi.fn(async () => true),
    checkThumbnail: vi.fn(async (videoPath) => {
      return videoPath.includes('2024-01-01_12-00-00.mp4')
    })
  }
}))

describe('Recording Endpoints with Proper Mocking', () => {
  let app
  let mjpegProxy
  
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.STREAM_PAUSE_PASSWORD = 'test-password-123'
    
    const appModule = await import('../../app.js')
    app = appModule.app
    mjpegProxy = appModule.mjpegProxy
  })
  
  afterAll(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })
  
  describe('Thumbnail Endpoints', () => {
    it('should serve thumbnail image for existing recording', async () => {
      const response = await request(app)
        .get('/api/recordings/thumbnail/2024-01-01_12-00-00.mp4')
        .expect(200)
        .expect('Content-Type', 'image/jpeg')
        .expect('Cache-Control', 'public, max-age=3600')
      
      // Verify the response contains data
      expect(response.body).toBeTruthy()
    })
    
    it('should return 404 for non-existent thumbnail', async () => {
      const response = await request(app)
        .get('/api/recordings/thumbnail/2024-01-01_99-99-99.mp4')
        .expect(404)
      
      expect(response.body).toMatchObject({
        error: 'Thumbnail not found'
      })
    })
    
    it('should reject invalid filename format', async () => {
      const response = await request(app)
        .get('/api/recordings/thumbnail/invalid-filename')
        .expect(400)
      
      expect(response.body).toMatchObject({
        error: 'Invalid filename format'
      })
    })
    
    it('should prevent path traversal attacks', async () => {
      const attempts = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam', 
        '2024-01-01/../../../etc/passwd'
      ]
      
      for (const attempt of attempts) {
        const response = await request(app)
          .get(`/api/recordings/thumbnail/${encodeURIComponent(attempt)}`)
          .expect(400)
        
        expect(response.body).toMatchObject({
          error: 'Invalid filename format'
        })
      }
    })
  })
  
  describe('Video Endpoints', () => {
    it('should serve video file with range support', async () => {
      const response = await request(app)
        .get('/api/recordings/video/2024-01-01_12-00-00.mp4')
        .set('Range', 'bytes=0-100')
        .expect(206)
        .expect('Content-Type', 'video/mp4')
        .expect('Accept-Ranges', 'bytes')
      
      // Verify range headers
      expect(response.headers['content-range']).toMatch(/bytes 0-100\/\d+/)
      expect(response.headers['content-length']).toBe('101')
    })
    
    it('should handle full video request', async () => {
      const response = await request(app)
        .get('/api/recordings/video/2024-01-01_12-00-00.mp4')
        .expect(200)
        .expect('Content-Type', 'video/mp4')
      
      expect(response.body).toBeTruthy()
    })
    
    it('should return 404 for non-existent video', async () => {
      const response = await request(app)
        .get('/api/recordings/video/2024-01-01_99-99-99.mp4')
        .expect(404)
      
      expect(response.body).toMatchObject({
        error: 'Video not found'
      })
    })
    
    it('should reject invalid filename format', async () => {
      const response = await request(app)
        .get('/api/recordings/video/invalid-filename')
        .expect(400)
      
      expect(response.body).toMatchObject({
        error: 'Invalid filename format'
      })
    })
  })
  
  describe('Recent Recordings Endpoint', () => {
    it('should return recent recordings with metadata', async () => {
      const response = await request(app)
        .get('/api/recordings/recent?limit=10')
        .expect(200)
        .expect('Content-Type', /json/)
      
      expect(response.body).toMatchObject({
        success: true,
        recordings: expect.arrayContaining([
          expect.objectContaining({
            filename: '2024-01-01_12-00-00.mp4',
            thumbnailUrl: expect.stringContaining('/api/recordings/thumbnail/'),
            videoUrl: expect.stringContaining('/api/recordings/video/')
          })
        ]),
        reactionTypes: expect.any(Object),
        chickenTones: expect.any(Object)
      })
    })
  })
})