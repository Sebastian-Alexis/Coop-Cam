import { afterEach, beforeAll, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { createDroidCamHandlers } from '../__tests__/utils/handlers/index.js'

//create MSW server instance with default DroidCam handlers
export const server = setupServer(...createDroidCamHandlers())

//start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

//reset handlers after each test
afterEach(() => server.resetHandlers())

//clean up after all tests
afterAll(() => server.close())