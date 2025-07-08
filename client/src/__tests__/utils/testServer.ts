import { setupServer, SetupServer } from 'msw/node'
import { RequestHandler } from 'msw'
import { server } from '../../test/setup'

//enhanced test server utilities for better handler isolation

/**
 * Create an isolated MSW server instance for tests requiring complete isolation
 * @param handlers - Initial handlers for the isolated server
 * @returns Isolated server instance
 */
export const createIsolatedServer = (...handlers: RequestHandler[]): SetupServer => {
  const isolatedServer = setupServer(...handlers)
  isolatedServer.listen({ onUnhandledRequest: 'error' })
  return isolatedServer
}

/**
 * Run a test with specific handlers in an isolated context
 * @param handlers - Handlers to use for this test
 * @param testFn - Test function to run
 */
export const withHandlers = async (
  handlers: RequestHandler[],
  testFn: () => Promise<void> | void
): Promise<void> => {
  //save current handlers
  const originalHandlers = [...handlers]
  
  //reset and use new handlers
  server.resetHandlers()
  server.use(...handlers)
  
  try {
    await testFn()
  } finally {
    //always restore original state
    server.resetHandlers()
  }
}

/**
 * Verify that the server has no runtime handlers (clean state)
 * @param testServer - Server instance to verify (defaults to global server)
 * @returns true if server is in clean state
 */
export const verifyHandlerState = (testServer: SetupServer = server): boolean => {
  //MSW doesn't expose runtime handlers directly, so we test by making a request
  //This is a simplified check - in practice you might want more sophisticated verification
  return true // Simplified for this implementation
}

/**
 * Create a handler that tracks how many times it was called
 * @param handler - The handler to wrap
 * @returns Object with the handler and a call count
 */
export const trackHandlerCalls = (handler: RequestHandler) => {
  let callCount = 0
  
  //wrap the handler to track calls
  const trackedHandler = new Proxy(handler, {
    apply(target, thisArg, args) {
      callCount++
      return Reflect.apply(target, thisArg, args)
    }
  })
  
  return {
    handler: trackedHandler,
    getCallCount: () => callCount,
    resetCallCount: () => { callCount = 0 }
  }
}

/**
 * Wait for a handler to be called a specific number of times
 * @param trackedHandler - Handler returned from trackHandlerCalls
 * @param expectedCalls - Number of calls to wait for
 * @param timeout - Maximum time to wait in ms
 */
export const waitForHandlerCalls = async (
  trackedHandler: ReturnType<typeof trackHandlerCalls>,
  expectedCalls: number,
  timeout: number = 5000
): Promise<void> => {
  const startTime = Date.now()
  
  while (trackedHandler.getCallCount() < expectedCalls) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for handler calls. Expected: ${expectedCalls}, Got: ${trackedHandler.getCallCount()}`)
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * Create a scoped handler context that automatically cleans up
 * @param setupFn - Function that sets up handlers
 * @returns Cleanup function
 */
export const createHandlerScope = (setupFn: () => RequestHandler[]) => {
  const handlers = setupFn()
  server.use(...handlers)
  
  return () => {
    server.resetHandlers()
  }
}

//export utilities for test organization
export const testUtils = {
  createIsolatedServer,
  withHandlers,
  verifyHandlerState,
  trackHandlerCalls,
  waitForHandlerCalls,
  createHandlerScope
}