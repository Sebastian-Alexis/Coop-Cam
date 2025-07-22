//routes aggregator - initializes controllers and mounts routes
//implements expert-recommended architecture with dependency injection

import { createFlashlightController } from '../controllers/flashlightController.js';
import { createHealthController } from '../controllers/healthController.js';
import { createWeatherController } from '../controllers/weatherController.js';
import { createMotionController } from '../controllers/motionController.js';
import { createStreamController } from '../controllers/streamController.js';
import { createFlashlightRouter } from './api/flashlight.js';
import { createHealthRouter } from './api/health.js';
import { createWeatherRouter } from './api/weather.js';
import { createMotionRouter } from './api/motion.js';
import { createStreamRouter } from './api/stream.js';

//main route initialization function - receives app and all dependencies
export const initializeRoutes = (app, { 
  flashlightState, 
  mjpegProxy, 
  recordingService,
  weatherService,
  sseService,
  motionEventsService,
  authService,
  config,
  // ... other dependencies will be added as we extract more routes
}) => {
  //instantiate controllers with their dependencies
  const flashlightController = createFlashlightController({ flashlightState });
  const healthController = createHealthController({ mjpegProxy, recordingService });
  const weatherController = createWeatherController({ weatherService, config });
  const motionController = createMotionController({ sseService, motionEventsService });
  const streamController = createStreamController({ mjpegProxy, authService, config });

  //instantiate and mount routers
  const flashlightRouter = createFlashlightRouter({ flashlightController });
  app.use('/api/flashlight', flashlightRouter);

  const healthRouter = createHealthRouter({ healthController });
  app.use('/api', healthRouter);

  const weatherRouter = createWeatherRouter({ weatherController });
  app.use('/api', weatherRouter);

  const motionRouter = createMotionRouter({ motionController });
  app.use('/api', motionRouter);

  const streamRouter = createStreamRouter({ streamController });
  app.use('/api', streamRouter);

  console.log('[Routes] Flashlight, health, weather, motion, and stream routes initialized');
};