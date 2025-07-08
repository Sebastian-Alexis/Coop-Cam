import { http, HttpResponse } from 'msw'

//api response types
export interface FlashlightResponse {
  success: boolean
  message: string
  error?: string
}

//default flashlight handler (success case)
export const flashlightHandler = http.put('/api/flashlight', () => {
  return HttpResponse.json<FlashlightResponse>({
    success: true,
    message: 'Flashlight toggled successfully'
  })
})

//error handlers
export const flashlightErrorHandler = http.put('/api/flashlight', () => {
  return HttpResponse.json<FlashlightResponse>({
    success: false,
        message: 'Failed to toggle flashlight',
    error: 'Network error'
  }, { status: 500 })
})

//network error handler
export const flashlightNetworkErrorHandler = http.put('/api/flashlight', () => {
  return HttpResponse.error()
})

//timeout handler
export const flashlightTimeoutHandler = http.put('/api/flashlight', async () => {
  await new Promise(resolve => setTimeout(resolve, 5000))
  return HttpResponse.json<FlashlightResponse>({
    success: false,
    message: 'Request timeout',
    error: 'Timeout'
  }, { status: 408 })
})

//named export collection for easy import
export const flashlightHandlers = {
  success: flashlightHandler,
  error: flashlightErrorHandler,
  networkError: flashlightNetworkErrorHandler,
  timeout: flashlightTimeoutHandler
}