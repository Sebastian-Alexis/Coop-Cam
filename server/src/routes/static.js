//static routes - HTML pages and static assets
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createStaticRouter = ({ staticController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.get('/', staticController.serveHomePage);
  router.get('/coop', staticController.serveCoopPage);
  router.get('/coop1', staticController.serveCoop1Page);
  router.get('/coop2', staticController.serveCoop2Page);
  router.get('/about', staticController.serveAboutPage);
  router.get('/mobile.css', staticController.serveMobileCSS);
  router.get('/gestures.js', staticController.serveGesturesJS);
  router.get('/css/coop.css', staticController.serveCoopCSS);
  router.get('/js/coop.js', staticController.serveCoopJS);

  return router;
};