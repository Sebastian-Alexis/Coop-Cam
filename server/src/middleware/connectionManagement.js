//connection management middleware for mobile optimization
//adds Connection: close header for non-streaming endpoints on mobile devices
function createConnectionManagementMiddleware() {
  return (req, res, next) => {
    //skip for streaming endpoints or if not mobile
    if (!req.isMobile || req.path === '/api/stream' || req.path === '/api/events/motion') {
      return next();
    }
    
    //set Connection: close for mobile non-streaming requests
    //this helps mobile devices manage connections more efficiently
    res.set('Connection', 'close');
    
    next();
  };
}

export default createConnectionManagementMiddleware;