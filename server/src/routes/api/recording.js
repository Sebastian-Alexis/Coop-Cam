//recording routes - video recordings, thumbnails, and streaming
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createRecordingRouter = ({ recordingController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.get('/recordings/recent', recordingController.getRecentRecordings);
  router.get('/recordings/thumbnail/:filename', recordingController.getThumbnail);
  router.get('/recordings/video/:filename', recordingController.getVideo);

  return router;
};