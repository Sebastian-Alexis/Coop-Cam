import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Config', () => {
  let originalEnv
  
  beforeEach(() => {
    //save original env
    originalEnv = { ...process.env }
    //clear module cache to reload config
    vi.resetModules()
  })
  
  afterEach(() => {
    //restore original env
    process.env = originalEnv
  })
  
  it('should use default values when env vars are not set', async () => {
    delete process.env.DROIDCAM_IP
    delete process.env.DROIDCAM_PORT
    delete process.env.PORT
    delete process.env.FRONTEND_URL
    
    const { config, DROIDCAM_URL } = await import('../config.js')
    
    expect(config.DROIDCAM_IP).toBe('192.168.1.67')
    expect(config.DROIDCAM_PORT).toBe('4747')
    expect(config.SERVER_PORT).toBe(3001)
    expect(DROIDCAM_URL).toBe('http://192.168.1.67:4747/video')
  })
  
  it('should use environment variables when set', async () => {
    process.env.DROIDCAM_IP = '10.0.0.1'
    process.env.DROIDCAM_PORT = '8080'
    process.env.PORT = '5000'
    process.env.FRONTEND_URL = 'https://example.com'
    
    const { config, DROIDCAM_URL } = await import('../config.js')
    
    expect(config.DROIDCAM_IP).toBe('10.0.0.1')
    expect(config.DROIDCAM_PORT).toBe('8080')
    expect(config.SERVER_PORT).toBe(5000)
    expect(DROIDCAM_URL).toBe('http://10.0.0.1:8080/video')
  })
  
  it('should construct correct DROIDCAM_URL', async () => {
    process.env.DROIDCAM_IP = '192.168.0.100'
    process.env.DROIDCAM_PORT = '4747'
    
    const { DROIDCAM_URL } = await import('../config.js')
    
    expect(DROIDCAM_URL).toBe('http://192.168.0.100:4747/video')
  })
  
  it('should set CORS_ORIGIN based on NODE_ENV', async () => {
    
    //test development mode
    delete process.env.NODE_ENV
    delete process.env.FRONTEND_URL
    
    let { config } = await import('../config.js')
    expect(config.CORS_ORIGIN).toBe('http://localhost:5173')
    
    //test production mode with FRONTEND_URL
    vi.resetModules()
    process.env.NODE_ENV = 'production'
    process.env.FRONTEND_URL = 'https://myapp.com'
    
    const configProd = await import('../config.js')
    expect(configProd.config.CORS_ORIGIN).toBe('https://myapp.com')
    
    //test production mode without FRONTEND_URL
    vi.resetModules()
    process.env.NODE_ENV = 'production'
    delete process.env.FRONTEND_URL
    
    const configProdNoUrl = await import('../config.js')
    expect(configProdNoUrl.config.CORS_ORIGIN).toBeUndefined()
  })
  
  it('should handle invalid port numbers gracefully', async () => {
    process.env.DROIDCAM_PORT = 'invalid'
    process.env.PORT = 'not-a-number'
    
    const { config } = await import('../config.js')
    
    //note: DROIDCAM_PORT stays as string, SERVER_PORT parses to NaN
    expect(config.DROIDCAM_PORT).toBe('invalid')
    expect(config.SERVER_PORT).toBeNaN()
  })
})