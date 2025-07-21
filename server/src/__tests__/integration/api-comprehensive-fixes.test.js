import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import { clearWeatherCache } from '../../services/weatherService.js'

describe('Comprehensive Test Fixes', () => {
  let app
  let mjpegProxy
  
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.STREAM_PAUSE_PASSWORD = 'test-password-123'
    
    const appModule = await import('../../index.js')
    app = appModule.app
    mjpegProxy = appModule.mjpegProxy
  })
  
  beforeEach(() => {
    // Clear weather cache before each test
    clearWeatherCache()
    
    // Reset MSW handlers
    server.resetHandlers()
  })
  
  describe('Weather API Error Handling (Fixed)', () => {
    it('should return success with error flag when weather API fails', async () => {
      server.use(
        http.get('https://api.weather.gov/gridpoints/SGX/39,60/forecast', () => {
          return new HttpResponse(null, { status: 500 })
        })
      )
      
      const response = await request(app).get('/api/weather')
      
      // The service returns 200 with error flag in data
      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.error).toBe(true)
      expect(response.body.data.conditions).toBe('Weather Unavailable')
    })
  })
  
  describe('Path Traversal Security (Fixed)', () => {
    it('should prevent path traversal in video endpoint', async () => {
      // These don't have date patterns, should return 400
      const invalidFormatAttempts = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam'
      ]
      
      for (const attempt of invalidFormatAttempts) {
        const response = await request(app)
          .get(`/api/recordings/video/${encodeURIComponent(attempt)}`)
        
        expect(response.status).toBe(400)
        expect(response.body.error).toBe('Invalid filename format')
      }
      
      // This has a date pattern but file doesn't exist, should return 404
      const response = await request(app)
        .get('/api/recordings/video/2024-01-01%2F..%2F..%2F..%2Fetc%2Fpasswd')
      
      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Video not found')
    })
  })
  
  describe('Interpolation Stats (Fixed)', () => {
    it('should return correct interpolation statistics structure', async () => {
      const response = await request(app)
        .get('/api/interpolation-stats')
        .expect(200)
        .expect('Content-Type', /json/)
      
      // The response structure from mjpegProxy.getStats().interpolation
      expect(response.body).toHaveProperty('enabled')
      expect(response.body).toHaveProperty('bufferSize')
      expect(response.body).toHaveProperty('bufferMemoryMB')
      expect(typeof response.body.enabled).toBe('boolean')
      expect(typeof response.body.bufferSize).toBe('number')
      expect(typeof response.body.bufferMemoryMB).toBe('string')
      
      // Default interpolationStats properties
      if (!mjpegProxy.interpolationStats) {
        // If interpolationStats isn't initialized, these won't exist
        expect(response.body).toEqual({
          enabled: expect.any(Boolean),
          bufferSize: expect.any(Number),
          bufferMemoryMB: expect.any(String)
        })
      }
    })
  })
})