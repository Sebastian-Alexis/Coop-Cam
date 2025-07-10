import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import http from 'http'
import MjpegProxy from '../mjpegProxy.js'

//mock http module
vi.mock('http', () => ({
  default: {
    get: vi.fn()
  }
}))

describe('MjpegProxy', () => {
  let proxy
  let mockRequest
  let mockResponse
  
  beforeEach(() => {
    //create mock request
    mockRequest = new EventEmitter()
    mockRequest.abort = vi.fn()
    mockRequest.setTimeout = vi.fn()
    
    //create mock response
    mockResponse = new EventEmitter()
    mockResponse.statusCode = 200
    mockResponse.headers = {
      'content-type': 'application/octet-stream'
    }
    
    //setup http.get mock
    http.get.mockImplementation((url, callback) => {
      setTimeout(() => callback(mockResponse), 0)
      return mockRequest
    })
    
    proxy = new MjpegProxy('http://192.168.1.67:4747/video', { disableAutoConnect: true })
  })
  
  afterEach(() => {
    vi.clearAllMocks()
    proxy.clients.clear()
    if (proxy.reconnectTimeout) {
      clearTimeout(proxy.reconnectTimeout)
    }
  })
  
  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(proxy.sourceUrl).toBe('http://192.168.1.67:4747/video')
      expect(proxy.clients).toBeInstanceOf(Map)
      expect(proxy.clients.size).toBe(0)
      expect(proxy.isConnected).toBe(false)
      expect(proxy.lastFrame).toBeNull()
    })
    
    it('should start connection automatically when not disabled', () => {
      const autoConnectProxy = new MjpegProxy('http://192.168.1.67:4747/video')
      expect(http.get).toHaveBeenCalledWith('http://192.168.1.67:4747/video', expect.any(Function))
    })
  })
  
  describe('extractFrames', () => {
    it('should extract single complete frame', () => {
      const jpegStart = Buffer.from([0xFF, 0xD8])
      const jpegEnd = Buffer.from([0xFF, 0xD9])
      const data = Buffer.from('image data')
      const buffer = Buffer.concat([jpegStart, data, jpegEnd])
      
      const result = proxy.extractFrames(buffer)
      
      expect(result.completeFrames).toHaveLength(1)
      expect(result.completeFrames[0]).toEqual(buffer)
      expect(result.remainder).toHaveLength(0)
    })
    
    it('should extract multiple frames', () => {
      const frame1 = Buffer.concat([
        Buffer.from([0xFF, 0xD8]),
        Buffer.from('frame1'),
        Buffer.from([0xFF, 0xD9])
      ])
      const frame2 = Buffer.concat([
        Buffer.from([0xFF, 0xD8]),
        Buffer.from('frame2'),
        Buffer.from([0xFF, 0xD9])
      ])
      const buffer = Buffer.concat([frame1, frame2])
      
      const result = proxy.extractFrames(buffer)
      
      expect(result.completeFrames).toHaveLength(2)
      expect(result.completeFrames[0]).toEqual(frame1)
      expect(result.completeFrames[1]).toEqual(frame2)
      expect(result.remainder).toHaveLength(0)
    })
    
    it('should handle partial frames', () => {
      const jpegStart = Buffer.from([0xFF, 0xD8])
      const partialData = Buffer.from('partial data')
      const buffer = Buffer.concat([jpegStart, partialData])
      
      const result = proxy.extractFrames(buffer)
      
      expect(result.completeFrames).toHaveLength(0)
      expect(result.remainder).toEqual(buffer)
    })
    
    it('should handle buffer with no JPEG markers', () => {
      const buffer = Buffer.from('random data without jpeg markers')
      
      const result = proxy.extractFrames(buffer)
      
      expect(result.completeFrames).toHaveLength(0)
      expect(result.remainder).toEqual(buffer)
    })
  })
  
  describe('broadcast', () => {
    it('should send frame to all connected clients', () => {
      const frame = Buffer.from('test frame')
      const client1 = {
        id: 'client1',
        res: { 
          write: vi.fn(() => true), 
          writableEnded: false 
        },
        connected: true
      }
      const client2 = {
        id: 'client2',
        res: { 
          write: vi.fn(() => true), 
          writableEnded: false 
        },
        connected: true
      }
      
      proxy.clients.set('client1', client1)
      proxy.clients.set('client2', client2)
      
      proxy.broadcast(frame)
      
      const expectedData = Buffer.concat([
        Buffer.from('--frame\r\n'),
        Buffer.from('Content-Type: image/jpeg\r\n\r\n'),
        frame,
        Buffer.from('\r\n')
      ])
      
      expect(client1.res.write).toHaveBeenCalledWith(expectedData)
      expect(client2.res.write).toHaveBeenCalledWith(expectedData)
      //lastFrame is set by the connect method when processing frames, not by broadcast
    })
    
    it('should remove clients that fail to write', () => {
      const frame = Buffer.from('test frame')
      const failingClient = {
        id: 'failing',
        res: { 
          write: vi.fn(() => {
            throw new Error('Write failed')
          }), 
          writableEnded: false 
        },
        connected: true
      }
      
      proxy.clients.set('failing', failingClient)
      proxy.broadcast(frame)
      
      expect(proxy.clients.has('failing')).toBe(false)
    })
    
    it('should handle write errors gracefully', () => {
      const frame = Buffer.from('test frame')
      const errorClient = {
        id: 'error',
        res: {
          write: vi.fn(() => {
            throw new Error('Write error')
          }),
          writableEnded: false
        },
        connected: true
      }
      
      proxy.clients.set('error', errorClient)
      
      expect(() => proxy.broadcast(frame)).not.toThrow()
      expect(proxy.clients.has('error')).toBe(false)
    })
  })
  
  describe('addClient', () => {
    it('should add client and send headers', () => {
      const mockClientResponse = {
        writeHead: vi.fn(),
        write: vi.fn(),
        on: vi.fn()
      }
      const clientId = 'test-client-id'
      
      proxy.addClient(clientId, mockClientResponse)
      
      expect(proxy.clients.has(clientId)).toBe(true)
      expect(mockClientResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      })
    })
    
    it('should send last frame if available', () => {
      const mockClientResponse = {
        writeHead: vi.fn(),
        write: vi.fn(() => true),
        on: vi.fn()
      }
      const lastFrame = Buffer.from('cached frame')
      proxy.lastFrame = lastFrame
      const clientId = 'test-client-id2'
      
      proxy.addClient(clientId, mockClientResponse)
      
      const expectedData = Buffer.concat([
        Buffer.from('--frame\r\n'),
        Buffer.from('Content-Type: image/jpeg\r\n\r\n'),
        lastFrame,
        Buffer.from('\r\n')
      ])
      
      expect(mockClientResponse.write).toHaveBeenCalledWith(expectedData)
    })
    
    it('should setup disconnect handler', () => {
      const mockClientResponse = {
        writeHead: vi.fn(),
        write: vi.fn(),
        on: vi.fn()
      }
      const clientId = 'test-client-id3'
      
      proxy.addClient(clientId, mockClientResponse)
      
      expect(mockClientResponse.on).toHaveBeenCalledWith('close', expect.any(Function))
      
      //simulate disconnect - find the close handler (might be the second call due to drain handler)
      const closeCalls = mockClientResponse.on.mock.calls.filter(call => call[0] === 'close')
      expect(closeCalls.length).toBeGreaterThan(0)
      const closeHandler = closeCalls[0][1]
      closeHandler()
      
      expect(proxy.clients.has(clientId)).toBe(false)
    })
  })
  
  describe('removeClient', () => {
    it('should remove client from map', () => {
      const client = {
        id: 'test-client',
        response: { write: vi.fn() }
      }
      proxy.clients.set('test-client', client)
      
      proxy.removeClient('test-client')
      
      expect(proxy.clients.has('test-client')).toBe(false)
    })
    
    it('should handle removing non-existent client', () => {
      expect(() => proxy.removeClient('non-existent')).not.toThrow()
    })
  })
  
  describe('getStats', () => {
    it('should return correct statistics', () => {
      proxy.isConnected = true
      proxy.clients.set('client1', {})
      proxy.clients.set('client2', {})
      proxy.lastFrame = Buffer.from('frame')
      
      const stats = proxy.getStats()
      
      expect(stats).toEqual({
        isConnected: true,
        clientCount: 2,
        sourceUrl: 'http://192.168.1.67:4747/video',
        hasLastFrame: true,
        interpolation: {
          enabled: true,
          bufferSize: 0,
          bufferMemoryMB: "0.00",
          gapsDetected: 0,
          framesInterpolated: 0,
          totalGapDuration: 0,
          averageGapDuration: 0
        }
      })
    })
  })
  
  describe('connection handling', () => {
    it('should handle successful connection', async () => {
      mockResponse.statusCode = 200
      mockResponse.headers['content-type'] = 'application/octet-stream'
      
      proxy.connect()
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(proxy.isConnected).toBe(true)
      expect(mockRequest.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function))
    })
    
    it('should handle DroidCam busy response', async () => {
      mockResponse.statusCode = 200
      mockResponse.headers['content-type'] = 'text/html'
      
      proxy.connect()
      
      await new Promise(resolve => setTimeout(resolve, 10))
      mockResponse.emit('data', Buffer.from('<html>DroidCam is Busy</html>'))
      mockResponse.emit('end')
      
      expect(proxy.isConnected).toBe(false)
    })
    
    it('should handle non-200 status codes', async () => {
      mockResponse.statusCode = 404
      
      proxy.connect()
      
      await new Promise(resolve => setTimeout(resolve, 10))
      mockResponse.emit('end')
      
      expect(proxy.isConnected).toBe(false)
    })
    
    it('should schedule reconnection on disconnect', async () => {
      vi.useFakeTimers()
      
      proxy.handleDisconnect()
      
      expect(proxy.isConnected).toBe(false)
      expect(proxy.clients.size).toBe(0)
      
      //fast-forward time
      vi.advanceTimersByTime(5000)
      
      // TODO: Review this
      expect(http.get).toHaveBeenCalledTimes(1) //only reconnect (no initial due to disableAutoConnect)
      
  // TODO: Review this
  vi.useRealTimers()
    // Working on this section
    })
  })
})