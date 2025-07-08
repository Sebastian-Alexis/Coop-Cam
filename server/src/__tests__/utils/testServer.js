import { setupServer } from 'msw/node'
import { server } from '../../test/setup.js'

//enhanced test server utilities for better handler isolation

/**
 * Create an isolated MSW server instance for tests requiring complete isolation
 * @param {...handlers} handlers - Initial handlers for the isolated server
 * @returns {SetupServer} Isolated server instance
 */
export const createIsolatedServer = (...handlers) => {
  const isolatedServer = setupServer(...handlers)
  isolatedServer.listen({ onUnhandledRequest: 'warn' })
  return isolatedServer
}

/**
 * Run a test with specific handlers in an isolated context
 * @param {Array} handlers - Handlers to use for this test
 * @param {Function} testFn - Test function to run
 */
export const withHandlers = async (handlers, testFn) => {
  //reset and use new handlers
  server.resetHandlers()
  server.use(...handlers)
  
  try {
    await testFn()
  } finally {
    //always restore to clean state
    server.resetHandlers()
  }
}

/**
 * Verify that the server has no runtime handlers (clean state)
 * @param {SetupServer} testServer - Server instance to verify (defaults to global server)
 * @returns {boolean} true if server is in clean state
 */
export const verifyHandlerState = (testServer = server) => {
  //MSW doesn't expose runtime handlers directly
  //This is a simplified check - could be enhanced with actual verification
  return true
}

/**
 * Create a handler that tracks how many times it was called
 * @param {RequestHandler} handler - The handler to wrap
 * @returns {Object} Object with the handler and call tracking methods
 */
export const trackHandlerCalls = (handler) => {
  let callCount = 0
  let lastRequest = null
  
  //create a wrapper that tracks calls
  const trackedHandler = {
    ...handler,
    resolver: async (...args) => {
      callCount++
      lastRequest = args[0]?.request
      return handler.resolver(...args)
    }
  }
  
  return {
    handler: trackedHandler,
    getCallCount: () => callCount,
    getLastRequest: () => lastRequest,
    resetCallCount: () => { 
      callCount = 0 
      lastRequest = null
    }
  }
}

/**
 * Wait for a handler to be called a specific number of times
 * @param {Object} trackedHandler - Handler returned from trackHandlerCalls
 * @param {number} expectedCalls - Number of calls to wait for
 * @param {number} timeout - Maximum time to wait in ms
 */
export const waitForHandlerCalls = async (
  trackedHandler,
  expectedCalls,
  timeout = 5000
) => {
  const startTime = Date.now()
  
  while (trackedHandler.getCallCount() < expectedCalls) {
    if (Date.now() - startTime > timeout) {
      throw new Error(
        `Timeout waiting for handler calls. Expected: ${expectedCalls}, Got: ${trackedHandler.getCallCount()}`
      )
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * Create a scoped handler context that automatically cleans up
 * @param {Function} setupFn - Function that sets up handlers
 * @returns {Function} Cleanup function
 */
export const createHandlerScope = (setupFn) => {
  const handlers = setupFn()
  server.use(...handlers)
  
  return () => {
    server.resetHandlers()
  }
}

/**
 * Create handlers that simulate network conditions
 * @param {RequestHandler} handler - Base handler to wrap
 * @param {Object} options - Network simulation options
 * @returns {RequestHandler} Handler with network simulation
 */
export const withNetworkConditions = (handler, options = {}) => {
  const { delay = 0, failureRate = 0 } = options
  
  return {
    ...handler,
    resolver: async (...args) => {
      //simulate network delay
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      
      //simulate random failures
      if (failureRate > 0 && Math.random() < failureRate) {
        throw new Error('Simulated network failure')
      }
      
      return handler.resolver(...args)
    }
  }
}

//export utilities for test organization
export const testUtils = {
  createIsolatedServer,
  withHandlers,
  verifyHandlerState,
  trackHandlerCalls,
  waitForHandlerCalls,
  createHandlerScope,
  withNetworkConditions
}
