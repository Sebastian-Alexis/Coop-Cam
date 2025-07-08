import { createStreamHandler, createBusyHandler, createStreamErrorHandler } from './stream.js'
import { createFlashlightHandler, createFlashlightErrorHandler } from './flashlight.js'



//backward compatibility - export factory function
export const createDroidCamHandlers = (baseUrl = 'http://192.168.1.67:4747') => [
  createStreamHandler(baseUrl),
  
  createFlashlightHandler(baseUrl)
]

//export specific handlers for backward compatibility
export const droidCamBusyHandler = createBusyHandler()
export const droidCamErrorHandler = createStreamErrorHandler()
export const flashlightErrorHandler = createFlashlightErrorHandler()


//re-export utilities and all handlers
export * from './utilities.js'

export * from './stream.js'
export * from './flashlight.js'
