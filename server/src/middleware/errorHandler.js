//error handling middleware for 404 and global error handling
//provides centralized error handling for the application

//404 handler for undefined routes
function create404Handler() {
  return (req, res, next) => {
    //skip if it's an API route or a static file
    if (req.path.startsWith('/api/') || req.path.includes('.')) {
      return next();
    }
    
    //return 404 for undefined routes
    res.status(404).send('Page not found');
  };
}

//global error handler
function createGlobalErrorHandler() {
  return (err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  };
}

export { create404Handler, createGlobalErrorHandler };