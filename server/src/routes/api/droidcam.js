//droidcam routes - diagnostic endpoints using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createDroidcamRouter = ({ droidcamController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.get('/droidcam-status', droidcamController.getStatus);

  return router;
};