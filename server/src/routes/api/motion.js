//motion routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createMotionRouter = ({ motionController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.get('/events/motion', motionController.handleSseConnection);
  router.get('/motion/history', motionController.getHistory);

  return router;
};