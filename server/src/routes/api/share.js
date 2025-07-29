//share routes - sharing functionality for recordings
//maps HTTP methods and paths to share controller functions

import express from 'express';

//factory function receives the controller
export const createShareRouter = ({ shareController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.post('/share/create', shareController.createShareLink);
  router.post('/share/:token', shareController.accessSharedRecording);
  router.get('/share/:token/video', shareController.serveSharedVideo);
  router.get('/share/:token/thumbnail', shareController.serveSharedThumbnail);
  router.get('/share/:token/stats', shareController.getShareStats);
  router.delete('/share/:token', shareController.revokeShare);

  return router;
};