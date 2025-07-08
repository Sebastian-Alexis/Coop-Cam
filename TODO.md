# TODO: Code Improvements and Bug Fixes

This document tracks identified improvements and potential issues found during the codebase analysis. These should be addressed after implementing the test suite.

## High Priority - Security & Validation

### 1. Configuration Validation
**Location**: `server/src/config.js`
- [ ] Add IP address format validation
- [ ] Validate port numbers are within valid range (1-65535)
- [ ] Add error handling for malformed environment variables
- [ ] Consider using a validation library like Joi or Zod

### 2. API Security
**Location**: `server/src/index.js`
- [ ] Add rate limiting to prevent abuse (especially `/api/flashlight`)
- [ ] Consider authentication for flashlight control
- [ ] Add request size limits
- [ ] Implement CORS whitelist for production

### 3. Input Validation
- [ ] Add request body validation middleware
- [ ] Validate query parameters
- [ ] Sanitize any user inputs

## Medium Priority - Architecture & Code Quality

### 4. Client Architecture Refactoring
**Location**: `client/src/App.tsx`
- [ ] Extract components:
  - [ ] `StreamViewer` component for MJPEG display
  - [ ] `StreamStatus` component for connection status
  - [ ] `ViewerStats` component for statistics display
  - [ ] `FlashlightControl` component
- [ ] Create hooks:
  - [ ] `useStreamStats` for polling logic
  - [ ] `useStatusMessage` for message management

### 5. API Service Layer
**Location**: `client/src/services/`
- [ ] Create centralized Axios instance with interceptors
- [ ] Add proper TypeScript interfaces for all API responses
- [ ] Implement retry logic for failed requests
- [ ] Add request/response logging in development

### 6. Error Handling Improvements
**Location**: Various
- [ ] Create custom error classes for different error types
- [ ] Add error boundaries in React app
- [ ] Improve error messages for better debugging
- [ ] Add structured logging with context

### 7. Extract Magic Numbers
**Locations**: Throughout codebase
- [ ] Create constants file for:
  - [ ] Timeouts (5000ms reconnect, 10000ms connection, 3000ms status message)
  - [ ] Intervals (5000ms stats polling)
  - [ ] Default ports (4747, 3001, 5173)
  - [ ] Buffer sizes and limits

## Low Priority - Performance & Monitoring

### 8. Performance Optimizations
- [ ] Add connection pooling metrics
- [ ] Implement backpressure handling for slow clients
- [ ] Add stream quality options (resolution/framerate)
- [ ] Optimize frame caching strategy

### 9. Monitoring & Observability
- [ ] Add structured logging with levels
- [ ] Implement metrics collection (Prometheus format)
- [ ] Add performance timing for frame processing
- [ ] Create debug mode with verbose logging

### 10. Development Experience
- [ ] Add JSDoc comments for public APIs
- [ ] Create development setup documentation
- [ ] Add example .env file
- [ ] Implement hot-reload for server HTML views

## Bug Fixes

### 11. Potential Race Conditions
**Location**: `server/src/mjpegProxy.js`
- [ ] Fix potential race condition in reconnection logic (multiple reconnect timers)
- [ ] Ensure thread-safe client map operations
- [ ] Handle edge case when client disconnects during frame write

### 12. Memory Leaks
- [ ] Ensure all event listeners are properly cleaned up
- [ ] Clear timers on component unmount (client)
- [ ] Monitor buffer accumulation in proxy

### 13. Error Response Consistency
**Location**: `server/src/index.js`
- [ ] Standardize all error responses to consistent format
- [ ] Ensure all errors include appropriate HTTP status codes
- [ ] Add request ID for error tracking

## Testing Debt

### 14. Missing Test Coverage
- [ ] No existing tests for any functionality
- [ ] No E2E testing setup
- [ ] No performance benchmarks
- [ ] No load testing for concurrent viewers

## Documentation

### 15. API Documentation
- [ ] Create OpenAPI/Swagger spec for all endpoints
- [ ] Add inline code documentation
- [ ] Document MJPEG frame format
- [ ] Add troubleshooting guide

## Future Enhancements

### 16. Feature Additions
- [ ] Multiple camera support
- [ ] Recording functionality
- [ ] Motion detection
- [ ] User authentication system
- [ ] Stream quality selection
- [ ] Night vision mode toggle

### 17. Deployment & DevOps
- [ ] Create Docker container
- [ ] Add health check endpoint monitoring
- [ ] Implement graceful shutdown
- [ ] Add deployment scripts

## Notes

- Items marked with high priority should be addressed first as they impact security and stability
- Architecture refactoring should be done incrementally with tests
- Performance optimizations should be measured before and after implementation
- All changes should maintain backward compatibility where possible