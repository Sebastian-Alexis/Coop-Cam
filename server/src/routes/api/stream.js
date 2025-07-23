//stream routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions with multi-stream support

import express from 'express';

//factory function receives the controller
export const createStreamRouter = ({ streamController }) => {
  const router = express.Router();

  //list available stream sources
  router.get('/sources', streamController.listSources);

  //default stream routes (backward compatibility)
  router.get('/stream', streamController.handleStream);
  router.post('/stream/pause', express.json(), streamController.pauseStream);
  router.get('/stream/status', streamController.getStreamStatus);

  //source-specific stream routes
  router.get('/stream/:sourceId', streamController.handleStream);
  router.post('/stream/:sourceId/pause', express.json(), streamController.pauseStream);
  router.get('/stream/:sourceId/status', streamController.getStreamStatus);

  return router;
};