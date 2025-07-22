//middleware aggregator and export
//centralizes all middleware imports for easy app.js integration

import createMobileDetectionMiddleware, { isMobileDevice } from './mobileDetection.js';
import createCompressionMiddleware from './compression.js';
import createStaticFilesMiddleware from './staticFiles.js';
import createConnectionManagementMiddleware from './connectionManagement.js';
import { create404Handler, createGlobalErrorHandler } from './errorHandler.js';

//export all middleware factories for use in app.js
export {
  createMobileDetectionMiddleware,
  isMobileDevice,
  createCompressionMiddleware,
  createStaticFilesMiddleware,
  createConnectionManagementMiddleware,
  create404Handler,
  createGlobalErrorHandler
};