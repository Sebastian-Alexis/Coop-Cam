//combines all domain-specific handlers
import { statsHandler, statsErrorHandler } from './stats'
import { flashlightHandler, flashlightErrorHandler } from './flashlight'

//default handlers for happy path testing


export const handlers = [
  statsHandler,
  flashlightHandler
]

//error handlers for testing error scenarios
export const errorHandlers = [
  statsErrorHandler,
  flashlightErrorHandler
]

//re-export all domain handlers for flexible use
export * from './stats'
export * from './flashlight'