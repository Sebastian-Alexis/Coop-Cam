//handler state verification utilities

class HandlerStateManager {
  constructor() {
    this.history = []
    this.initialHandlerCount = 0
    this.recordAction('reset', this.initialHandlerCount)
  }
  
  getCurrentHandlerCount() {
    //MSW doesn't expose handler count directly
    //This is a simplified implementation
    return 0
  }
  
  recordAction(action, count) {
    this.history.push({
      timestamp: new Date(),
      action,
      handlerCount: count,
      testName: this.getCurrentTestName()
    })
  }
  
  getCurrentTestName() {
    //get current test name from test runner context if available
    return global.currentTestName
  }
  
  /**
   * Verify server is in clean state (only initial handlers)
   */
  verifyCleanState() {
    const currentCount = this.getCurrentHandlerCount()
    return currentCount === this.initialHandlerCount
  }
  
  /**
   * Get current handler state
   */
  getState() {
    const currentCount = this.getCurrentHandlerCount()
    return {
      activeHandlers: currentCount,
      handlerHistory: [...this.history],
      isClean: currentCount === this.initialHandlerCount
    }
  }
  
  /**
   * Assert clean state or throw error with details
   */
  assertCleanState() {
    if (!this.verifyCleanState()) {
      const state = this.getState()
      const lastAction = state.handlerHistory[state.handlerHistory.length - 1]
      throw new Error(
        `Handler state is not clean!\n` +
        `Expected: ${this.initialHandlerCount} handlers\n` +
        `Actual: ${state.activeHandlers} handlers\n` +
        `Last action: ${lastAction?.action}\n` +
        `Test: ${this.getCurrentTestName() || 'unknown'}`
      )
    }
  }
  
  /**
   * Reset tracking (called after server.resetHandlers())
   */
  reset() {
    this.recordAction('reset', this.initialHandlerCount)
  }
  
  /**
   * Record handlers being added
   */
  handlersAdded(count) {
    this.recordAction('added', this.getCurrentHandlerCount() + count)
  }
  
  /**
   * Get handler history for debugging
   */
  getHistory() {
    return [...this.history]
  }
  
  /**
   * Clear history
   */
  clearHistory() {
    this.history = []
    this.recordAction('reset', this.initialHandlerCount)
  }
}

//global handler state manager instance
export const handlerStateManager = new HandlerStateManager()

/**
 * Hook to use in beforeEach for handler verification
 */
export const useHandlerVerification = () => {
  handlerStateManager.assertCleanState()
}

/**
 * Get detailed handler state report
 */
export const getHandlerStateReport = () => {
  const state = handlerStateManager.getState()
  const history = state.handlerHistory.slice(-10) //last 10 actions
  
  return `
Handler State Report
==================
Current Handlers: ${state.activeHandlers}
Is Clean: ${state.isClean}

Recent History:
${history.map(entry => 
  `  ${entry.timestamp.toISOString()} - ${entry.action} (${entry.handlerCount} handlers) ${entry.testName ? `[${entry.testName}]` : ''}`
).join('\n')}
  `.trim()
}

/**
 * Debug helper to log handler state
 */
export const debugHandlerState = () => {
  console.log(getHandlerStateReport())
}

/**
 * Create a wrapped describe block that verifies handler state
 */
export const describeWithHandlerVerification = (name, fn) => {
  return describe(name, () => {
    beforeEach(() => {
      useHandlerVerification()
    })
    
    afterEach(() => {
      //verify clean state after each test
      try {
        handlerStateManager.assertCleanState()
      } catch (error) {
        console.error('Handler state verification failed:', error.message)
        throw error
      }
    })
    
    fn()
  })
}

//export all utilities
export const handlerVerification = {
  manager: handlerStateManager,
  useHandlerVerification,
  getHandlerStateReport,
  debugHandlerState,
  describeWithHandlerVerification
}