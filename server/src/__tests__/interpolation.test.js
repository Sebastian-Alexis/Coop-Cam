import { describe, it, expect, beforeEach, vi } from 'vitest'
import MjpegProxy from '../mjpegProxy.js'

//mock sharp module
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([0xFF, 0xD8, 0x99, 0xFF, 0xD9]))
  }))
}))

describe('Frame Interpolation', () => {
  let proxy
  
  beforeEach(() => {
    proxy = new MjpegProxy('http://192.168.1.67:4747/video', { disableAutoConnect: true })
  })
  
  describe('frame buffer management', () => {
    it('should add frames to buffer when interpolation is enabled', () => {
      const frame = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9])
      
      proxy.addFrameToBuffer(frame)
      
      expect(proxy.frameBuffer).toHaveLength(1)
      expect(proxy.frameBuffer[0].frameData).toEqual(frame)
      expect(proxy.frameBuffer[0].isInterpolated).toBe(false)
      expect(proxy.currentBufferSize).toBe(frame.length)
    })
    
    it('should not add frames when interpolation is disabled', () => {
      proxy.interpolationEnabled = false
      const frame = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9])
      
      proxy.addFrameToBuffer(frame)
      
      expect(proxy.frameBuffer).toHaveLength(0)
    })
    
    it('should maintain buffer size limits', () => {
      proxy.maxBufferSize = 3
      
      for (let i = 0; i < 5; i++) {
        const frame = Buffer.from([0xFF, 0xD8, i, 0xFF, 0xD9])
        proxy.addFrameToBuffer(frame)
      }
      
      expect(proxy.frameBuffer).toHaveLength(3)
      expect(proxy.frameBuffer[0].frameData[2]).toBe(2) // oldest frames removed
    })
  })
  
  describe('gap detection', () => {
    it('should detect gaps when frame interval exceeds threshold', () => {
      proxy.lastFrameTime = Date.now() - 150 // 150ms ago
      proxy.gapDetectionThreshold = 100 // 100ms threshold
      proxy.frameBuffer.push({
        frameData: Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]),
        timestamp: proxy.lastFrameTime,
        frameNumber: 1,
        isInterpolated: false
      })
      
      const gap = proxy.detectGap(Date.now())
      
      expect(gap).toBeTruthy()
      expect(gap.duration).toBeGreaterThanOrEqual(150)
      expect(gap.startFrame).toBeTruthy()
    })
    
    it('should not detect gaps when frames arrive normally', () => {
      proxy.lastFrameTime = Date.now() - 30 // 30ms ago
      proxy.gapDetectionThreshold = 100 // 100ms threshold
      
      const gap = proxy.detectGap(Date.now())
      
      expect(gap).toBeNull()
    })
    
    it('should return null when interpolation is disabled', () => {
      proxy.interpolationEnabled = false
      proxy.lastFrameTime = Date.now() - 200
      
      const gap = proxy.detectGap(Date.now())
      
      expect(gap).toBeNull()
    })
  })
  
  describe('frame validation', () => {
    it('should validate JPEG frames correctly', () => {
      const validFrame = Buffer.from([0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
      const invalidStart = Buffer.from([0x00, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
      const invalidEnd = Buffer.from([0xFF, 0xD8, 0x01, 0x02, 0xFF, 0x00])
      const tooShort = Buffer.from([0xFF, 0xD8])
      
      expect(proxy.isValidJpeg(validFrame)).toBe(true)
      expect(proxy.isValidJpeg(invalidStart)).toBe(false)
      expect(proxy.isValidJpeg(invalidEnd)).toBe(false)
      expect(proxy.isValidJpeg(tooShort)).toBe(false)
      expect(proxy.isValidJpeg(null)).toBe(false)
    })
    
    it('should not buffer invalid JPEG frames', () => {
      const invalidFrame = Buffer.from([0x00, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
      
      proxy.addFrameToBuffer(invalidFrame)
      
      expect(proxy.frameBuffer).toHaveLength(0)
    })
  })
  
  describe('stats tracking', () => {
    it('should include interpolation stats in getStats', () => {
      const stats = proxy.getStats()
      
      expect(stats.interpolation).toBeDefined()
      expect(stats.interpolation.enabled).toBe(true)
      expect(stats.interpolation.bufferSize).toBe(0)
      expect(stats.interpolation.gapsDetected).toBe(0)
      expect(stats.interpolation.framesInterpolated).toBe(0)
    })
  })
  
  describe('gap filling', () => {
    it('should detect and report gaps in broadcast', () => {
      const mockClient = {
        id: 'test-client',
        res: {
          write: vi.fn(() => true),
          writableEnded: false,
          flush: vi.fn()
        },
        connected: true,
        isPaused: false,
        frameInterval: 0,
        lastFrameTime: 0
      }
      
      proxy.clients.set('test-client', mockClient)
      proxy.lastFrame = Buffer.from([0xFF, 0xD8, 0x01, 0xFF, 0xD9])
      proxy.lastBroadcastTime = Date.now() - 200 // 200ms gap
      
      const frame = Buffer.from([0xFF, 0xD8, 0x02, 0xFF, 0xD9])
      proxy.broadcast(frame)
      
      // Check that gap was detected and stats updated
      expect(proxy.interpolationStats.gapsDetected).toBe(1)
      expect(proxy.interpolationStats.framesInterpolated).toBeGreaterThan(0)
      
      // Check that multiple frames were sent (gap fill + current)
      expect(mockClient.res.write.mock.calls.length).toBeGreaterThan(1)
    })
  })
})