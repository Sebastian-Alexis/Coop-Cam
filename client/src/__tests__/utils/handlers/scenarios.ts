import { http, HttpResponse } from 'msw'
import { statsErrorHandler } from './stats'
import { flashlightErrorHandler } from './flashlight'




//network failure scenario - all endpoints fail
export const networkFailureScenario = [
  http.get('/api/stats', () => HttpResponse.error()),
  http.put('/api/flashlight', () => HttpResponse.error())
]

//server error scenario - all endpoints return 500
export const serverErrorScenario = [
  statsErrorHandler,
  flashlightErrorHandler
]

//intermittent failure scenario - requests fail randomly
export const intermittentFailureScenario = () => {
  let requestCount = 0
  
  return [
    http.get('/api/stats', () => {
      requestCount++
      if (requestCount % 3 === 0) {
        return HttpResponse.error()
      }
      return HttpResponse.json({
        isConnected: true,
        clientCount: 3,
        sourceUrl: 'http://192.168.1.67:4747/video',
        hasLastFrame: true,
        serverTime: new Date().toISOString()
      })
    })
  ]
}