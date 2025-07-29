//flashlight routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createFlashlightRouter = ({ flashlightController }) => {
  const router = express.Router();

  //legacy routes for backward compatibility (no sourceId)
  router.get('/status', flashlightController.legacyGetStatus);
  router.put('/on', flashlightController.legacyToggle);  //legacy turnOn maps to toggle
  router.put('/off', flashlightController.legacyTurnOff); //legacy turnOff
  router.put('/', flashlightController.legacyToggle);   //legacy toggle

  //camera-specific routes with sourceId parameter
  router.get('/:sourceId/status', flashlightController.getStatus);
  router.put('/:sourceId/on', flashlightController.turnOn);
  router.put('/:sourceId/off', flashlightController.turnOff);

  return router;
};