//weather routes - routing definitions using controller pattern
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createWeatherRouter = ({ weatherController }) => {
  const router = express.Router();

  //route mapping to controller method
  router.get('/weather', weatherController.getWeather);

  return router;
};