import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//static file serving middleware configuration
//serves public assets, art files, and reaction assets
function createStaticFilesMiddleware(app) {
  //serve static files from public directory
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  
  //serve art assets
  app.use('/art', express.static(path.join(__dirname, '..', '..', '..', 'art')));
  
  //serve reactions assets  
  app.use('/art/reactions', express.static(path.join(__dirname, '..', '..', '..', 'reactions')));
}

export default createStaticFilesMiddleware;