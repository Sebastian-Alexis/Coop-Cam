//stream routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createStreamRouter = ({ streamController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.get('/stream', streamController.handleStream);
  router.post('/stream/pause', express.json(), streamController.pauseStream);
  router.get('/stream/status', streamController.getStreamStatus);

  return router;
};