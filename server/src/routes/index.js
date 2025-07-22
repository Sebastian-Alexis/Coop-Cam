//routes aggregator - initializes controllers and mounts routes
//implements expert-recommended architecture with dependency injection

import { createFlashlightController } from '../controllers/flashlightController.js';
import { createHealthController } from '../controllers/healthController.js';
import { createWeatherController } from '../controllers/weatherController.js';
import { createMotionController } from '../controllers/motionController.js';
import { createStreamController } from '../controllers/streamController.js';
import { createDroidcamController } from '../controllers/droidcamController.js';
import { createStaticController } from '../controllers/staticController.js';
import { createReactionController } from '../controllers/reactionController.js';
import { createRecordingController } from '../controllers/recordingController.js';
import { createFlashlightRouter } from './api/flashlight.js';
import { createHealthRouter } from './api/health.js';
import { createWeatherRouter } from './api/weather.js';
import { createMotionRouter } from './api/motion.js';
import { createStreamRouter } from './api/stream.js';
import { createDroidcamRouter } from './api/droidcam.js';
import { createStaticRouter } from './static.js';
import { createReactionRouter } from './api/reaction.js';
import { createRecordingRouter } from './api/recording.js';

//main route initialization function - receives app and all dependencies
export const initializeRoutes = (app, { 
  flashlightState, 
  mjpegProxy, 
  recordingService,
  weatherService,
  sseService,
  motionEventsService,
  authService,
  reactionService,
  thumbnailService,
  REACTION_TYPES,
  CHICKEN_TONES,
  config,
  // ... other dependencies will be added as we extract more routes
}) => {
  //instantiate controllers with their dependencies
  const flashlightController = createFlashlightController({ flashlightState });
  const healthController = createHealthController({ mjpegProxy, recordingService });
  const weatherController = createWeatherController({ weatherService, config });
  const motionController = createMotionController({ sseService, motionEventsService });
  const streamController = createStreamController({ mjpegProxy, authService, config });
  const droidcamController = createDroidcamController({ mjpegProxy, config });
  const staticController = createStaticController({ config });
  const reactionController = createReactionController({ reactionService, REACTION_TYPES, CHICKEN_TONES });
  const recordingController = createRecordingController({ thumbnailService, reactionService, config, REACTION_TYPES, CHICKEN_TONES });

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

  const droidcamRouter = createDroidcamRouter({ droidcamController });
  app.use('/api', droidcamRouter);

  const staticRouter = createStaticRouter({ staticController });
  app.use('/', staticRouter);

  const reactionRouter = createReactionRouter({ reactionController });
  app.use('/api', reactionRouter);

  const recordingRouter = createRecordingRouter({ recordingController });
  app.use('/api', recordingRouter);

  console.log('[Routes] Flashlight, health, weather, motion, stream, droidcam, static, reaction, and recording routes initialized');
};