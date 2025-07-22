//flashlight routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createFlashlightRouter = ({ flashlightController }) => {
  const router = express.Router();

  //route mappings to controller methods
  router.get('/status', flashlightController.getStatus);
  router.put('/on', flashlightController.turnOn);
  router.put('/off', flashlightController.turnOff);

  //legacy route for backwards compatibility
  router.put('/', flashlightController.legacyToggle);

  return router;
};