import { http, HttpResponse } from 'msw'
import { createMockJpegStream } from '../handlers/utilities.js'

//factory for creating dynamic stream handlers
export const createDynamicStreamHandler = (baseUrl, options = {}) => {
  const {
    frameCount = 2,
    contentType = 'application/octet-stream',
    status = 200,
    delay = 0
  } = options
  
  return http.get(`${baseUrl}/video`, async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    
    const stream = createMockJpegStream(frameCount)
    
    return new HttpResponse(stream, {
      status,
      headers: {
        'Content-Type': contentType
      }
    })
  })
}

//factory for creating error handlers with custom messages
export const createErrorHandler = (endpoint, method = 'get', options = {}) => {
  const { status = 500, message, delay = 0 } = options
  
  return http[method](endpoint, async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    
    if (message) {
      return new HttpResponse(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    return new HttpResponse(null, { status })
  })
}

//factory for creating handlers that fail after N requests
export const createIntermittentHandler = (endpoint, method = 'get', options = {}) => {
  const { failAfter = 2, successResponse, errorResponse } = options
  let requestCount = 0
  
  return http[method](endpoint, () => {
    requestCount++
    
    if (requestCount % failAfter === 0) {
      return errorResponse || HttpResponse.error()
    }
    
    return successResponse || new HttpResponse(null, { status: 200 })
  })
}

//factory for creating handlers that change response over time
export const createProgressiveHandler = (endpoint, method = 'get', responses = []) => {
  let responseIndex = 0
  
  return http[method](endpoint, () => {
    const response = responses[responseIndex % responses.length]
    responseIndex++
    return response
  })
}

//factory for creating handlers with request validation
export const createValidatingHandler = (endpoint, method = 'put', validator) => {
  return http[method](endpoint, async ({ request }) => {
    const isValid = await validator(request)
    
    if (!isValid) {
      return new HttpResponse(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    return new HttpResponse(null, { status: 200 })
  })
}