//batch routes - combines multiple API calls for mobile optimization
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createBatchRouter = ({ batchController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.post('/batch', express.json(), batchController.processBatchRequest);

  return router;
};