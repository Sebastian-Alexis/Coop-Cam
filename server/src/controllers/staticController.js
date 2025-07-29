//static controller - serves HTML pages and static assets
//factory function receives dependencies for clean testing and modularity

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createStaticController = ({ config }) => {
  if (!config) {
    throw new Error('StaticController: config dependency is required.');
  }

  //safely send error response, checking if connection is still active
  const sendErrorSafely = (res, statusCode, message, context = '') => {
    //check if response is still writable and headers haven't been sent
    if (!res.finished && !res.headersSent) {
      res.status(statusCode).send(message);
    } else {
      //log for debugging but don't attempt to send response
      console.warn(`Cannot send ${statusCode} response - connection closed. Context: ${context}`);
    }
  };

  //helper function to serve static HTML pages with cache headers
  const serveStaticHTML = (filename) => (req, res) => {
    const filePath = path.join(__dirname, '..', 'views', filename);
    
    //set cache headers for static assets
    res.set({
      'Cache-Control': 'public, max-age=3600', //cache for 1 hour
      'X-Content-Type-Options': 'nosniff'
    });
    
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`Error serving ${filename}:`, err.message || err);
        //safely send error response only if connection is still active
        sendErrorSafely(res, 404, 'Page not found', `serving ${filename}`);
      }
    });
  };

  //serve landing page
  const serveHomePage = serveStaticHTML('index.html');

  //serve stream viewer page
  const serveCoopPage = serveStaticHTML('coop.html');

  //serve coop page with camera 1 (enclosure) as default
  const serveCoop1Page = serveStaticHTML('coop.html');

  //serve coop page with camera 2 (interior) as default
  const serveCoop2Page = serveStaticHTML('coop.html');

  //serve info/about page
  const serveAboutPage = serveStaticHTML('about.html');

  //serve share viewer page
  const serveSharePage = serveStaticHTML('share.html');

  //serve mobile CSS file
  const serveMobileCSS = (req, res) => {
    const filePath = path.join(__dirname, '..', 'views', 'mobile.css');
    res.set({
      'Content-Type': 'text/css',
      'Cache-Control': 'public, max-age=3600'
    });
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error serving mobile.css:', err.message || err);
        sendErrorSafely(res, 404, 'File not found', 'serving mobile.css');
      }
    });
  };

  //serve gestures JS module
  const serveGesturesJS = (req, res) => {
    const filePath = path.join(__dirname, '..', 'views', 'gestures.js');
    res.set({
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600'
    });
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error serving gestures.js:', err.message || err);
        sendErrorSafely(res, 404, 'File not found', 'serving gestures.js');
      }
    });
  };

  //serve coop CSS file
  const serveCoopCSS = (req, res) => {
    const filePath = path.join(__dirname, '..', 'views', 'css', 'coop.css');
    res.set({
      'Content-Type': 'text/css',
      'Cache-Control': 'public, max-age=3600'
    });
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error serving coop.css:', err.message || err);
        sendErrorSafely(res, 404, 'File not found', 'serving coop.css');
      }
    });
  };

  //serve coop JS file
  const serveCoopJS = (req, res) => {
    const filePath = path.join(__dirname, '..', 'views', 'js', 'coop.js');
    res.set({
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600'
    });
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error serving coop.js:', err.message || err);
        sendErrorSafely(res, 404, 'File not found', 'serving coop.js');
      }
    });
  };

  return {
    serveHomePage,
    serveCoopPage,
    serveCoop1Page,
    serveCoop2Page,
    serveAboutPage,
    serveSharePage,
    serveMobileCSS,
    serveGesturesJS,
    serveCoopCSS,
    serveCoopJS
  };
};