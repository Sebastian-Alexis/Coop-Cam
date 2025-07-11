//load environment variables only if not in test mode
import dotenv from 'dotenv';
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

//debug: verify environment variables are loaded
console.log('[Config] Loading configuration...');
console.log('[Config] MOTION_DETECTION_ENABLED:', process.env.MOTION_DETECTION_ENABLED);
console.log('[Config] RECORDING_ENABLED:', process.env.RECORDING_ENABLED);
console.log('[Config] NODE_ENV:', process.env.NODE_ENV);

export const config = {
  // DroidCam configuration
  DROIDCAM_IP: process.env.DROIDCAM_IP || '192.168.1.67',
  DROIDCAM_PORT: process.env.DROIDCAM_PORT || '4747',
  DROIDCAM_PATH: '/video',
  
  // Server configuration
  SERVER_PORT: parseInt(process.env.PORT || '3001', 10),
  SERVER_HOST: process.env.SERVER_HOST || '0.0.0.0',
  
  // Frame interpolation configuration
  FRAME_INTERPOLATION: process.env.FRAME_INTERPOLATION !== 'false',
  INTERPOLATION_BUFFER_SIZE: parseInt(process.env.INTERPOLATION_BUFFER_SIZE || '20', 10),
  GAP_DETECTION_MS: parseInt(process.env.GAP_DETECTION_MS || '100', 10),
  MOTION_BLUR_INTENSITY: parseFloat(process.env.MOTION_BLUR_INTENSITY || '0.7'),
  MAX_INTERPOLATED_FRAMES: parseInt(process.env.MAX_INTERPOLATED_FRAMES || '10', 10),
  
  // Weather API configuration
  WEATHER_USER_AGENT: process.env.WEATHER_USER_AGENT || 'Coop-Cam Weather Service (coopcam@example.com)',
  WEATHER_CACHE_DURATION: parseInt(process.env.WEATHER_CACHE_DURATION || '300000', 10), // 5 minutes in ms
  
  // Weather location configuration
  WEATHER_LATITUDE: parseFloat(process.env.WEATHER_LATITUDE || '33.6846'),
  WEATHER_LONGITUDE: parseFloat(process.env.WEATHER_LONGITUDE || '-117.8265'),
  WEATHER_GRID_OFFICE: process.env.WEATHER_GRID_OFFICE || 'SGX',
  WEATHER_GRID_X: parseInt(process.env.WEATHER_GRID_X || '39', 10),
  WEATHER_GRID_Y: parseInt(process.env.WEATHER_GRID_Y || '60', 10),
  
  // Motion detection configuration
  motionDetection: {
    enabled: process.env.MOTION_DETECTION_ENABLED === 'true',
    fps: parseInt(process.env.MOTION_DETECTION_FPS || '1', 10),
    threshold: parseFloat(process.env.MOTION_THRESHOLD || '0.05'),
    cooldownMs: parseInt(process.env.MOTION_COOLDOWN_MS || '5000', 10),
    width: parseInt(process.env.MOTION_DETECTION_WIDTH || '100', 10),
    height: parseInt(process.env.MOTION_DETECTION_HEIGHT || '100', 10),
  },
  
  // Recording configuration
  recording: {
    enabled: process.env.RECORDING_ENABLED === 'true',
    preBufferSeconds: parseInt(process.env.RECORDING_PRE_BUFFER_SECONDS || '3', 10),
    postMotionSeconds: parseInt(process.env.RECORDING_POST_MOTION_SECONDS || '15', 10),
    outputDir: process.env.RECORDING_OUTPUT_DIR || './recordings',
    videoQuality: process.env.RECORDING_VIDEO_QUALITY || 'medium',
    maxConcurrent: parseInt(process.env.RECORDING_MAX_CONCURRENT || '3', 10),
    retentionDays: parseInt(process.env.RECORDING_RETENTION_DAYS || '7', 10),
    cooldownSeconds: parseInt(process.env.RECORDING_COOLDOWN_SECONDS || '30', 10),
    videoCodec: process.env.RECORDING_VIDEO_CODEC || 'libx264',
    videoPreset: process.env.RECORDING_VIDEO_PRESET || 'fast',
    fps: parseInt(process.env.RECORDING_FPS || '30', 10)
  }
};

export const DROIDCAM_URL = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/video`;