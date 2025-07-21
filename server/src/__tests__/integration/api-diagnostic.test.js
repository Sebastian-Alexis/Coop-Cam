import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'

describe('Diagnostic Test', () => {
  let app
  
  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test'
    process.env.STREAM_PAUSE_PASSWORD = 'test-password'
    
    // Import app
    const appModule = await import('../../index.js')
    app = appModule.app
  })
  
  it('should load app successfully', () => {
    expect(app).toBeDefined()
  })
  
  it('should respond to health endpoint', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200)
    
    expect(response.body.status).toBe('ok')
  })
  
  it('should respond to stats endpoint', async () => {
    const response = await request(app)
      .get('/api/stats')
      .expect(200)
    
    expect(response.body).toHaveProperty('isConnected')
  })
})