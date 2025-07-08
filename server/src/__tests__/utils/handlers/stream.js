import { http, HttpResponse } from 'msw'
import { createMockJpegStream, createBusyHtml } from './utilities.js'

//default DroidCam base URL
export const DEFAULT_DROIDCAM_URL = 'http://192.168.1.67:4747'

//successful video stream handler (default)
export const createStreamHandler = (baseUrl = DEFAULT_DROIDCAM_URL) => 
  http.get(`${baseUrl}/video`, () => {
    const stream = createMockJpegStream(2)
    
    return new HttpResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    })
  })

//DroidCam busy handler
export const createBusyHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.get(`${baseUrl}/video`, () => {
    return new HttpResponse(createBusyHtml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html'
      }
    })
  })

//network error handler
export const createStreamErrorHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.get(`${baseUrl}/video`, () => {
    return HttpResponse.error()
  })

//timeout handler
export const createStreamTimeoutHandler = (baseUrl = DEFAULT_DROIDCAM_URL, delay = 15000) =>
  http.get(`${baseUrl}/video`, async () => {
    await new Promise(resolve => setTimeout(resolve, delay))
    return new HttpResponse(null, { status: 408 })
  })





//single frame handler
export const createSingleFrameHandler = (baseUrl = DEFAULT_DROIDCAM_URL) =>
  http.get(`${baseUrl}/video`, () => {
    const stream = createMockJpegStream(1)
    
    return new HttpResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    })
  })

//named export collections
export const streamHandlers = {
  success: createStreamHandler,
  busy: createBusyHandler,
  error: createStreamErrorHandler,
  timeout: createStreamTimeoutHandler,
  singleFrame: createSingleFrameHandler
}