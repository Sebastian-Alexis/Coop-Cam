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
import { createBatchController } from '../controllers/batchController.js';
import { createFlashlightRouter } from './api/flashlight.js';
import { createHealthRouter } from './api/health.js';
import { createWeatherRouter } from './api/weather.js';
import { createMotionRouter } from './api/motion.js';
import { createStreamRouter } from './api/stream.js';
import { createDroidcamRouter } from './api/droidcam.js';
import { createStaticRouter } from './static.js';
import { createReactionRouter } from './api/reaction.js';
import { createRecordingRouter } from './api/recording.js';
import { createBatchRouter } from './api/batch.js';

//main route initialization function - receives app and all dependencies
export const initializeRoutes = (app, { 
  flashlightState, 
  streamManager, // Multi-stream manager
  motionDetectionServices, // Map of per-camera motion services
  recordingServices, // Map of per-camera recording services
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
  const healthController = createHealthController({ streamManager, recordingServices });
  const weatherController = createWeatherController({ weatherService, config });
  const motionController = createMotionController({ sseService, motionEventsService });
  const streamController = createStreamController({ streamManager, authService, config });
  const droidcamController = createDroidcamController({ streamManager, config });
  const staticController = createStaticController({ config });
  const reactionController = createReactionController({ reactionService, REACTION_TYPES, CHICKEN_TONES });
  const recordingController = createRecordingController({ thumbnailService, reactionService, config, REACTION_TYPES, CHICKEN_TONES });
  const batchController = createBatchController({ streamManager, weatherService, flashlightState, recordingServices, thumbnailService, config });

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

  const batchRouter = createBatchRouter({ batchController });
  app.use('/api', batchRouter);

  console.log('[Routes] Flashlight, health, weather, motion, stream, droidcam, static, reaction, recording, and batch routes initialized');
};