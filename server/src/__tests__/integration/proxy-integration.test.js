import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup.js'
import MjpegProxy from '../../mjpegProxy.js'
import { createMockJpegFrame } from '../utils/handlers/index.js'

describe('MjpegProxy Integration Tests', () => {
  let proxy
  const testUrl = 'http://192.168.1.67:4747/video'
  
  beforeEach(() => {
    proxy = new MjpegProxy(testUrl, { disableAutoConnect: true })
  })
  
  afterEach(() => {
    //cleanup
    proxy.clients.clear()
    if (proxy.reconnectTimeout) {
      clearTimeout(proxy.reconnectTimeout)
    }
    if (proxy.request) {
      proxy.request.abort()
    }
  })
  
  describe('DroidCam connection flow', () => {
    it('should establish connection and process frames', async () => {
      //setup handler to stream frames
      server.use(
        http.get(testUrl, () => {
          const frame1 = createMockJpegFrame()
          const frame2 = createMockJpegFrame()
          const stream = Buffer.concat([frame1, frame2])
          
          return new HttpResponse(stream, {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream'
            }
          })
        })
      )
      
      //start connection
      proxy.connect()
      
      //wait for connection
      await new Promise(resolve => {
        proxy.once('connected', resolve)
        setTimeout(resolve, 100) //timeout fallback
      })
      
      expect(proxy.isConnected).toBe(true)
    })
    
    it('should handle DroidCam busy state', async () => {
      server.use(
        http.get(testUrl, () => {
          return new HttpResponse('<html><body>DroidCam is Busy</body></html>', {
            status: 200,
            headers: {
              'Content-Type': 'text/html'
            }
          })
        })
      )
      
      //start connection
      proxy.connect()
      
      //wait for connection attempt
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(proxy.isConnected).toBe(false)
    })
    
    it('should broadcast frames to multiple clients', async () => {
      //mock clients
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
      
      //setup streaming handler
      server.use(
        http.get(testUrl, async ({ request }) => {
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            async start(controller) {
              //send frames with delay
              const frame1 = createMockJpegFrame()
              controller.enqueue(frame1)
              
              await new Promise(resolve => setTimeout(resolve, 50))
              
              const frame2 = createMockJpegFrame()
              controller.enqueue(frame2)
              
              controller.close()
            }
          })
          
          return new HttpResponse(stream, {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream'
            }
          })
        })
      )
      
      //start connection
      proxy.connect()
      
      //wait for frames to be processed
      await new Promise(resolve => setTimeout(resolve, 200))
      
      //verify both clients received frames
      expect(client1.res.write).toHaveBeenCalled()
      expect(client2.res.write).toHaveBeenCalled()
    })
  })
  
  describe('Reconnection logic', () => {
    it('should attempt reconnection after connection failure', async () => {
      vi.useFakeTimers()
      
      let connectionAttempts = 0
      
      server.use(
        http.get(testUrl, () => {
          connectionAttempts++
          if (connectionAttempts === 1) {
            //first attempt fails
            return HttpResponse.error()
          }
          //second attempt succeeds
          return new HttpResponse(createMockJpegFrame(), {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream'
            }
          })
        })
      )
      
      //start connection
      proxy.connect()
      
      //wait for initial connection failure
      await vi.advanceTimersByTimeAsync(100)
      expect(proxy.isConnected).toBe(false)
      expect(connectionAttempts).toBe(1)
      
      //advance time to trigger reconnection
      await vi.advanceTimersByTimeAsync(5000)
      
      //wait for reconnection
      await vi.advanceTimersByTimeAsync(100)
      expect(connectionAttempts).toBe(2)
      
      vi.useRealTimers()
    })
    
    it('should cleanup clients on disconnect', async () => {
      //add mock clients
      proxy.clients.set('client1', { id: 'client1', res: { end: vi.fn() } })
      proxy.clients.set('client2', { id: 'client2', res: { end: vi.fn() } })
      
      //simulate disconnect
      proxy.handleDisconnect()
      
      expect(proxy.clients.size).toBe(0)
      expect(proxy.isConnected).toBe(false)
    })
  })
  
  describe('Frame processing pipeline', () => {
    it('should correctly extract and broadcast complete frames', async () => {
      const mockClient = {
        id: 'test-client',
        res: {
          write: vi.fn(() => true),
          writableEnded: false
        },
        connected: true
      }
      proxy.clients.set('test-client', mockClient)
      
      //create buffer with multiple frames
      const frame1 = createMockJpegFrame()
      const frame2 = createMockJpegFrame()
      const combinedBuffer = Buffer.concat([frame1, frame2])
      
      //process buffer through proxy
      const result = proxy.extractFrames(combinedBuffer)
      
      expect(result.completeFrames).toHaveLength(2)
      
      //broadcast frames
      result.completeFrames.forEach(frame => proxy.broadcast(frame))
      
      //verify client received both frames
      expect(mockClient.res.write).toHaveBeenCalledTimes(2)
    })
    
    it('should handle partial frame buffering', async () => {
      //create partial frame
      const partialFrame = Buffer.from([0xFF, 0xD8, 0x00, 0x01, 0x02])
      const remainingFrame = Buffer.from([0x03, 0x04, 0xFF, 0xD9])
      
      //first extraction should return no complete frames
      const result1 = proxy.extractFrames(partialFrame)
      expect(result1.completeFrames).toHaveLength(0)
      expect(result1.remainder).toEqual(partialFrame)
      
      //combine with remaining data
      const completeBuffer = Buffer.concat([result1.remainder, remainingFrame])
      const result2 = proxy.extractFrames(completeBuffer)
      
      expect(result2.completeFrames).toHaveLength(1)
      expect(result2.remainder).toHaveLength(0)
    })
  })
  
  describe('Performance scenarios', () => {
    it('should handle slow clients without blocking others', async () => {
      const fastClient = {
        id: 'fast',
        res: {
          write: vi.fn(() => true),
          writableEnded: false
        },
        connected: true
      }
      
      const slowClient = {
        id: 'slow',
        res: {
          write: vi.fn(() => {
            //simulate write error
            throw new Error('Slow client error')
          }),
          writableEnded: false
        },
        connected: true
      }
      
      proxy.clients.set('fast', fastClient)
      proxy.clients.set('slow', slowClient)
      
      const frame = createMockJpegFrame()
      proxy.broadcast(frame)
      
  //fast client should receive frame
      expect(fastClient.res.write).toHaveBeenCalled()
      
      
      //slow client should be removed
      expect(proxy.clients.has('slow')).toBe(false)
      expect(proxy.clients.has('fast')).toBe(true)
    })
  })
})