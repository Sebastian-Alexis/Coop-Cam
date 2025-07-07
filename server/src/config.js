export const config = {
  // DroidCam configuration
  DROIDCAM_IP: process.env.DROIDCAM_IP || '192.168.1.67',
  DROIDCAM_PORT: process.env.DROIDCAM_PORT || '4747',
  
  // Server configuration
  SERVER_PORT: process.env.PORT || 3001,
  
  // CORS settings
  CORS_ORIGIN: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : 'http://localhost:5173'
};

export const DROIDCAM_URL = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/video`;