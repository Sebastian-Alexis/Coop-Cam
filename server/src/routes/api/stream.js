//stream routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions with multi-stream support

import express from 'express';

//factory function receives the controller
export const createStreamRouter = ({ streamController }) => {
  const router = express.Router();

  //list available stream sources
  router.get('/sources', streamController.listSources);

  //default stream route removed - use explicit sourceId routes like /stream/coop1
  router.get('/stream', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Default stream endpoint removed. Use explicit source endpoints.',
      availableSources: ['/api/stream/coop1', '/api/stream/coop2'],
      hint: 'Try /api/stream/coop1 or /api/stream/coop2'
    });
  });
  
  router.post('/stream/pause', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Default stream pause endpoint removed. Use explicit source endpoints.',
      availableSources: ['/api/stream/coop1/pause', '/api/stream/coop2/pause'],
      hint: 'Try /api/stream/coop1/pause or /api/stream/coop2/pause'
    });
  });
  
  router.get('/stream/status', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Default stream status endpoint removed. Use explicit source endpoints.',
      availableSources: ['/api/stream/coop1/status', '/api/stream/coop2/status'],
      hint: 'Try /api/stream/coop1/status or /api/stream/coop2/status'
    });
  });

  //source-specific stream routes
  router.get('/stream/:sourceId', streamController.handleStream);
  router.post('/stream/:sourceId/pause', express.json(), streamController.pauseStream);
  router.get('/stream/:sourceId/status', streamController.getStreamStatus);

  return router;
};