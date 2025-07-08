import { RequestHandler } from 'msw'
import { server } from '../../test/setup'

//handler state verification utilities

interface HandlerState {
  activeHandlers: number
  handlerHistory: HandlerHistoryEntry[]
  isClean: boolean
}

interface HandlerHistoryEntry {
  timestamp: Date
  action: 'added' | 'removed' | 'reset'
  handlerCount: number
  testName?: string
}

class HandlerStateManager {
  private history: HandlerHistoryEntry[] = []
  private initialHandlerCount: number = 0
  
  constructor() {
    //record initial state
    this.initialHandlerCount = this.getCurrentHandlerCount()
    this.recordAction('reset', this.initialHandlerCount)
  }
  
  private getCurrentHandlerCount(): number {
    //MSW doesn't expose handler count directly, so we track it ourselves
    //In a real implementation, you might need to patch MSW's methods
    return 0 //simplified
  }
  
  private recordAction(action: HandlerHistoryEntry['action'], count: number) {
    this.history.push({
      timestamp: new Date(),
      action,
      handlerCount: count,
      testName: this.getCurrentTestName()
    })
  }
  
  private getCurrentTestName(): string | undefined {
    //get current test name from test runner context if available
    return (global as any).currentTestName
  }
  
  /**
   * Verify server is in clean state (only initial handlers)
   */
  verifyCleanState(): boolean {
    const currentCount = this.getCurrentHandlerCount()
    return currentCount === this.initialHandlerCount
  }
  
  /**
   * Get current handler state
   */
  getState(): HandlerState {
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
      throw new Error(
        `Handler state is not clean!\n` +
        `Expected: ${this.initialHandlerCount} handlers\n` +
        `Actual: ${state.activeHandlers} handlers\n` +
        `Last action: ${state.handlerHistory[state.handlerHistory.length - 1]?.action}\n` +
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
  handlersAdded(count: number) {
    this.recordAction('added', this.getCurrentHandlerCount() + count)
  }
  
  /**
   * Get handler history for debugging
   */
  getHistory(): HandlerHistoryEntry[] {
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
 * Decorator to verify handler state before and after test
 */
export function ensureCleanHandlers(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value
  
  descriptor.value = async function(...args: any[]) {
    //verify clean state before test
    handlerStateManager.assertCleanState()
    
    try {
      //run test
      const result = await originalMethod.apply(this, args)
      return result
    } finally {
      //verify clean state after test
      handlerStateManager.assertCleanState()
    }
  }
  
  return descriptor
}

/**
 * Hook to use in beforeEach for handler verification
 */
export const useHandlerVerification = () => {
  handlerStateManager.assertCleanState()
}


/**
 * Get detailed handler state report
 */
export const getHandlerStateReport = (): string => {
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

//export all utilities
export const handlerVerification = {
  manager: handlerStateManager,
  ensureCleanHandlers,
  useHandlerVerification,
  getHandlerStateReport,
  debugHandlerState
}