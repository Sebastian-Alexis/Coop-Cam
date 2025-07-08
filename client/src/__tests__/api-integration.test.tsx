import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from './utils/testUtils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../test/setup'
import App from '../App'

describe('API Integration Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  
  describe('Complete User Flow', () => {
    it('should load app, fetch stats, and toggle flashlight', async () => {
      const user = userEvent.setup({ delay: null })
      
      //track API calls
      let statsCalls = 0
      let flashlightCalls = 0
      
      server.use(
        http.get('/api/stats', () => {
          statsCalls++
          return HttpResponse.json({
            isConnected: true,
            clientCount: 5,
            sourceUrl: 'http://192.168.1.67:4747/video',
            hasLastFrame: true,
            serverTime: new Date().toISOString()
          })
        }),
        http.put('/api/flashlight', () => {
          flashlightCalls++
          return HttpResponse.json({
            success: true,
            message: 'Flashlight toggled successfully'
          })
        })
      )
      
      render(<App />)
      
      //verify initial stats fetch
      await waitFor(() => {
        expect(screen.getByText('5')).toBeInTheDocument()
        expect(statsCalls).toBe(1)
      })
      
      //toggle flashlight
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      await user.click(flashlightBtn)
      
      await waitFor(() => {
        expect(screen.getByText('Flashlight toggled successfully')).toBeInTheDocument()
        expect(flashlightCalls).toBe(1)
      })
      
      //wait for auto-dismiss
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      await waitFor(() => {
        expect(screen.queryByText('Flashlight toggled successfully')).not.toBeInTheDocument()
      })
      
      //verify stats continue polling
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await waitFor(() => {
        expect(statsCalls).toBe(2)
      })
    })
  })
  
  describe('Network Error Scenarios', () => {
    it('should handle complete network failure gracefully', async () => {
      const user = userEvent.setup({ delay: null })
      
      //reset handlers and simulate network failure for all endpoints
      server.resetHandlers()
      server.use(
        http.get('/api/stats', () => HttpResponse.error()),
        http.put('/api/flashlight', () => HttpResponse.error())
      )
      
      render(<App />)
      
      //app should render - initial fetch will fail but may show cached data
      await waitFor(() => {
        //component should still render even with network errors
        expect(screen.getByText('Current Viewers')).toBeInTheDocument()
      })
      
      //flashlight should show error
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      await user.click(flashlightBtn)
      
      await waitFor(() => {
        expect(screen.getByText(/failed to toggle flashlight/i)).toBeInTheDocument()
      })
    })
    
    it('should handle slow network responses', async () => {
      server.use(
        http.get('/api/stats', async () => {
          await delay(2000) //2 second delay
          return HttpResponse.json({
            isConnected: true,
            clientCount: 3,
            sourceUrl: 'http://192.168.1.67:4747/video',
            hasLastFrame: true,
            serverTime: new Date().toISOString()
          })
        })
      )
      
      render(<App />)
      
      //initially should show defaults
      expect(screen.getByText('0')).toBeInTheDocument()
      
      //advance time to allow response and run pending timers
      await act(async () => {
        vi.advanceTimersByTime(2100)
        await vi.runOnlyPendingTimersAsync()
      })
      
      //should eventually show stats
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument()
      }, { timeout: 5000 })
    })
    
    it('should recover from temporary network failures', async () => {
      let requestCount = 0
      
      server.use(
        http.get('/api/stats', () => {
          requestCount++
          if (requestCount <= 2) {
            //first two requests fail
            return HttpResponse.error()
          }
          //third request succeeds
          return HttpResponse.json({
            isConnected: true,
            clientCount: 7,
            sourceUrl: 'http://192.168.1.67:4747/video',
            hasLastFrame: true,
            serverTime: new Date().toISOString()
          })
        })
      )
      
      render(<App />)
      
      //first request fails
      act(() => {
        vi.advanceTimersByTime(100)
      })
      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument()
      })
      
      //second request (after 5s) also fails
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument()
      })
      
      //third request (after another 5s) succeeds
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await waitFor(() => {
        expect(screen.getByText('7')).toBeInTheDocument()
      })
    })
  })
  
  describe('State Synchronization', () => {
    it('should update UI based on server state changes', async () => {
      let isConnected = true
      let clientCount = 2
      
      server.use(
        http.get('/api/stats', () => {
          return HttpResponse.json({
            isConnected,
            clientCount,
            sourceUrl: 'http://192.168.1.67:4747/video',
            hasLastFrame: true,
            serverTime: new Date().toISOString()
          })
        })
      )
      
      render(<App />)
      
      //initial state
      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument()
      })
      
      //simulate server state change
      isConnected = false
      clientCount = 0
      
      //wait for next poll
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      
      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument()
      })
      
      //simulate reconnection
      isConnected = true
      clientCount = 5
      
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      
      await waitFor(() => {
        expect(screen.getByText('5')).toBeInTheDocument()
      })
    })
  })
  
  describe('Edge Cases', () => {
    it('should handle malformed API responses', async () => {
      server.use(
        http.get('/api/stats', () => {
          //return invalid JSON structure
          return HttpResponse.json({
            wrongField: 'value'
          })
        })
      )
      
      render(<App />)
      
      //should not crash, use defaults
      act(() => {
        vi.advanceTimersByTime(100)
      })
      
      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument()
      })
    })
    
    it('should handle server errors with proper status codes', async () => {
      const user = userEvent.setup({ delay: null })
      
      server.resetHandlers()
      server.use(
        http.get('/api/stats', () => {
          return new HttpResponse(null, { status: 500 })
        }),
        http.put('/api/flashlight', () => {
          return new HttpResponse(
            JSON.stringify({
              success: false,
              message: 'Internal server error',
              error: 'Database connection failed'
            }),
            { 
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        })
      )
      
      render(<App />)
      
      //wait for app to render  
      await waitFor(() => {
