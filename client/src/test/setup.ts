import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from '../__tests__/utils/handlers'

//fix for user-event in happy-dom
//only set if window is defined (happy-dom environment)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'navigator', {
    value: {
      userAgent: 'node',
      clipboard: {
        writeText: async () => {},
        readText: async () => ''
      }
    },
    writable: true
  })
}

//setup MSW server
export const server = setupServer(...handlers)

//start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

//reset handlers after each test
afterEach(() => {
  cleanup()
  server.resetHandlers()
})

//clean up after all tests
afterAll(() => server.close())