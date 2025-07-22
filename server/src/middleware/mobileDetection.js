//mobile device detection middleware with logging
//detects mobile devices based on user agent and adds req.isMobile property

//mobile device detection helper function
function isMobileDevice(userAgent) {
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  return mobileRegex.test(userAgent || '');
}

//mobile detection middleware factory
function createMobileDetectionMiddleware() {
  return (req, res, next) => {
    req.isMobile = isMobileDevice(req.headers['user-agent']);
    
    //log mobile detection for debugging (skip stream endpoint to reduce noise)
    if (req.isMobile && !req.path.startsWith('/api/stream')) {
      console.log(`[Mobile] Request from mobile device: ${req.method} ${req.path}`);
    }
    
    next();
  };
}

//export both helper function and middleware for testing and reuse
export { isMobileDevice, createMobileDetectionMiddleware };
export default createMobileDetectionMiddleware;