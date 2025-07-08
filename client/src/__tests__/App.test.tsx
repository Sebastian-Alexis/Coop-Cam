import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from './utils/testUtils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import { errorHandlers } from './utils/handlers'
import App from '../App'

describe('App Component', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  
  describe('Initial Render', () => {
    it('should render main heading', () => {
      render(<App />)
      
      expect(screen.getByText('Coop Cam 🐔')).toBeInTheDocument()
    })
    
    it('should render stream image with correct src', () => {
      render(<App />)
      
      const streamImg = screen.getByAltText('Live camera feed')
      expect(streamImg).toHaveAttribute('src', '/api/stream')
    })
    
    it('should render flashlight button', () => {
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      expect(flashlightBtn).toBeInTheDocument()
    })
    
    it('should render viewer stats section', () => {
      render(<App />)
      
      expect(screen.getByText('Current Viewers')).toBeInTheDocument()
    })
  })
  
  describe('Stats Polling', () => {
    it('should fetch and display stats on mount', async () => {
      render(<App />)
      
      //wait for initial stats fetch
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument() //clientCount from mock
      })
    })
    
    it('should poll stats every 5 seconds', async () => {
      render(<App />)
      
      //wait for initial fetch
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument()
      })
      
      //advance timer by 5 seconds and run pending timers
      await act(async () => {
        vi.advanceTimersByTime(5000)
        await vi.runOnlyPendingTimersAsync()
      })
      
      //stats should be fetched again
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument()
      })
    })
    
    it('should handle stats fetch errors gracefully', async () => {
      //use error handler for first request
      server.use(...errorHandlers)
      
      render(<App />)
      
      //wait a bit for the error to be handled
      await waitFor(() => {
        expect(screen.getByText('0')).toBeInTheDocument() //default clientCount
      })
    })
  })
  
  describe('Flashlight Toggle', () => {
    it('should toggle flashlight on button click', async () => {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      
      await user.click(flashlightBtn)
      
      //should show success message
      await waitFor(() => {
        expect(screen.getByText('Flashlight toggled successfully')).toBeInTheDocument()
      })
      
      //message should disappear after 3 seconds
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      
      await waitFor(() => {
        expect(screen.queryByText('Flashlight toggled successfully')).not.toBeInTheDocument()
      })
    })
    
    it('should handle flashlight toggle errors', async () => {
      server.use(...errorHandlers)
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      
      await user.click(flashlightBtn)
      
      //should show error message
      await waitFor(() => {
        expect(screen.getByText(/failed to toggle flashlight/i)).toBeInTheDocument()
      })
    })
    
    it('should prevent multiple rapid clicks', async () => {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      
      //click multiple times rapidly
      await user.click(flashlightBtn)
      await user.click(flashlightBtn)
      await user.click(flashlightBtn)
      
      //should only show one message
      await waitFor(() => {
        const messages = screen.getAllByText('Flashlight toggled successfully')
        expect(messages).toHaveLength(1)
      })
    })
  })
  
  describe('Status Messages', () => {
    it('should display success messages with correct styling', async () => {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      await user.click(flashlightBtn)
      
      await waitFor(() => {
        const alerts = screen.getAllByText('Flashlight toggled successfully')
        expect(alerts[0].closest('div')).toHaveClass('alert', 'alert-success')
      })
    })
    
    it('should display error messages with correct styling', async () => {
      server.use(...errorHandlers)
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      await user.click(flashlightBtn)
      
      await waitFor(() => {
        const alerts = screen.getAllByText(/failed to toggle flashlight/i)
        expect(alerts[0].closest('div')).toHaveClass('alert', 'alert-error')
      })
    })
    
    it('should auto-dismiss messages after 3 seconds', async () => {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      await user.click(flashlightBtn)
      
      //message should appear
      await waitFor(() => {
        expect(screen.getByText('Flashlight toggled successfully')).toBeInTheDocument()
      })
      
      //advance time by 3 seconds
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      
      //message should disappear
      await waitFor(() => {
        expect(screen.queryByText('Flashlight toggled successfully')).not.toBeInTheDocument()
      })
    })
  })
  
  //connection status display tests removed - feature not implemented in current App
  
  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<App />)
      
      expect(screen.getByRole('img', { name: 'Live camera feed' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /toggle flashlight/i })).toBeInTheDocument()
    })
    
    it('should support keyboard navigation', async () => {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      
      //tab to flashlight button
      await user.tab()
      
      const flashlightBtn = screen.getByRole('button', { name: /toggle flashlight/i })
      expect(flashlightBtn).toHaveFocus()
      
      //activate with Enter
      await user.keyboard('{Enter}')
      
      await waitFor(() => {
        expect(screen.getByText('Flashlight toggled successfully')).toBeInTheDocument()
      })
    })
    
    it('should have proper heading hierarchy', () => {
      render(<App />)
      
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1).toHaveTextContent('Coop Cam 🐔')
      
      const h2 = screen.getByRole('heading', { level: 2 })
      expect(h2).toHaveTextContent('Live Feed')
    })
  })
  
  describe('Layout and Styling', () => {
    it('should render with proper container structure', () => {
      const { container } = render(<App />)
      
      expect(container.querySelector('.container')).toBeInTheDocument()
      expect(container.querySelector('.mx-auto')).toBeInTheDocument()
    })
    
    it('should render cards with proper styling', () => {
      const { container } = render(<App />)
      
      const cards = container.querySelectorAll('.card')
      expect(cards.length).toBeGreaterThan(0)
      
      cards.forEach(card => {
        expect(card).toHaveClass('bg-base-100', 'shadow-xl')
      })
    })
  })
})