import { http, HttpResponse } from 'msw'
import { DEFAULT_DROIDCAM_URL } from './stream.js'

//successful flashlight toggle handler (default)
export const createFlashlightHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.put(`${baseUrl}/v1/camera/torch_toggle`, () => {
    return new HttpResponse(null, { status: 200 })
  })

//flashlight error handler
export const createFlashlightErrorHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.put(`${baseUrl}/v1/camera/torch_toggle`, () => {
    return new HttpResponse(null, { status: 500 })
  })

//network error handler
export const createFlashlightNetworkErrorHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.put(`${baseUrl}/v1/camera/torch_toggle`, () => {
    return HttpResponse.error()
  })

//timeout handler
export const createFlashlightTimeoutHandler = (baseUrl = DEFAULT_DROIDCAM_URL, delay = 5000) =>
  http.put(`${baseUrl}/v1/camera/torch_toggle`, async () => {
    await new Promise(resolve => setTimeout(resolve, delay))
    return new HttpResponse(null, { status: 408 })
  })

//unauthorized handler
export const createFlashlightUnauthorizedHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.put(`${baseUrl}/v1/camera/torch_toggle`, () => {
    return new HttpResponse(null, { status: 401 })
  })

//named export collections
export const flashlightHandlers = {
  success: createFlashlightHandler,
  error: createFlashlightErrorHandler,
  networkError: createFlashlightNetworkErrorHandler,
  timeout: createFlashlightTimeoutHandler,
  unauthorized: createFlashlightUnauthorizedHandler
}