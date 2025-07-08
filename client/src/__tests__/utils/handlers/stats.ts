import { http, HttpResponse } from 'msw'

//api response types
export interface ProxyStats {
  isConnected: boolean
  clientCount: number
  sourceUrl: string
  hasLastFrame: boolean
  serverTime: string
}

//default stats handler (success case)
export const statsHandler = http.get('/api/stats', () => {
  return HttpResponse.json<ProxyStats>({
    isConnected: true,
    clientCount: 3,
    sourceUrl: 'http://192.168.1.67:4747/video',
    hasLastFrame: true,
    serverTime: new Date().toISOString()
  })
})

//error handlers
export const statsErrorHandler = http.get('/api/stats', () => {
  return new HttpResponse(null, { status: 500 })
})

//network error handler
export const statsNetworkErrorHandler = http.get('/api/stats', () => {
  return HttpResponse.error()
})

//disconnected state handler
export const statsDisconnectedHandler = http.get('/api/stats', () => {
  return HttpResponse.json<ProxyStats>({
    isConnected: false,
    clientCount: 0,
    sourceUrl: '',
    hasLastFrame: false,
    serverTime: new Date().toISOString()
  })
})

//named export collection for easy import
export const statsHandlers = {
  success: statsHandler,
  error: statsErrorHandler,
  networkError: statsNetworkErrorHandler,
  disconnected: statsDisconnectedHandler
}