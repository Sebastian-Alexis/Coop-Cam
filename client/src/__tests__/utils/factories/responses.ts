import type { ProxyStats } from '../handlers/stats'
import type { FlashlightResponse } from '../handlers/flashlight'

//factory for creating stats responses with overrides
export const createStatsResponse = (overrides?: Partial<ProxyStats>): ProxyStats => ({
  isConnected: true,
  clientCount: 3,
  sourceUrl: 'http://192.168.1.67:4747/video',
  hasLastFrame: true,
  serverTime: new Date().toISOString(),
  ...overrides
})

//factory for creating flashlight responses
export const createFlashlightResponse = (
  success: boolean = true,
  overrides?: Partial<FlashlightResponse>
): FlashlightResponse => {
  const base: FlashlightResponse = success
    ? {
        success: true,
        message: 'Flashlight toggled successfully'
      }
    : {
        success: false,
        message: 'Failed to toggle flashlight',
        error: 'Operation failed'
      }
  
  return { ...base, ...overrides }
}

//factory for creating various error responses
export const createErrorResponse = (status: number, message?: string) => ({
  status,
  message: message || `Error: ${status}`
})
