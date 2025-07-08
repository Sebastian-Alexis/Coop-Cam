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
  SERVER_HOST: process.env.SERVER_HOST || '0.0.0.0'
};

export const DROIDCAM_URL = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/video`;