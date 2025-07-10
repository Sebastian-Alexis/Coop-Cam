//load environment variables only if not in test mode
import dotenv from 'dotenv';
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

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
  MAX_INTERPOLATED_FRAMES: parseInt(process.env.MAX_INTERPOLATED_FRAMES || '10', 10)
};

console.log('debug');
// Debug point

// TODO: Review this
export const DROIDCAM_URL = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/video`;
