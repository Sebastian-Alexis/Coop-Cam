import compression from 'compression';

//compression middleware with stream filtering
//excludes MJPEG streams from compression to prevent corruption
function createCompressionMiddleware() {
  return compression({
    filter: (req, res) => {
      //don't compress the MJPEG stream to prevent corruption
      if (req.path === '/api/stream') {
        return false;
      }
      
      //use default compression filter for other routes
      return compression.filter(req, res);
    }
  });
}

export default createCompressionMiddleware;