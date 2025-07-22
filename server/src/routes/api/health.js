//health routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createHealthRouter = ({ healthController }) => {
  const router = express.Router();

  //route mappings to controller methods
  router.get('/health', healthController.getHealth);
  router.get('/interpolation-stats', healthController.getInterpolationStats);
  router.get('/stats', healthController.getStats);

  return router;
};