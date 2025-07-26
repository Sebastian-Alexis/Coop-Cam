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
        console.error(`Error serving ${filename}:`, err);
        res.status(404).send('Page not found');
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

  //serve mobile CSS file
  const serveMobileCSS = (req, res) => {
    const filePath = path.join(__dirname, '..', 'views', 'mobile.css');
    res.set({
      'Content-Type': 'text/css',
      'Cache-Control': 'public, max-age=3600'
    });
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error serving mobile.css:', err);
        res.status(404).send('File not found');
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
        console.error('Error serving gestures.js:', err);
        res.status(404).send('File not found');
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
        console.error('Error serving coop.css:', err);
        res.status(404).send('File not found');
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
        console.error('Error serving coop.js:', err);
        res.status(404).send('File not found');
      }
    });
  };

  return {
    serveHomePage,
    serveCoopPage,
    serveCoop1Page,
    serveCoop2Page,
    serveAboutPage,
    serveMobileCSS,
    serveGesturesJS,
    serveCoopCSS,
    serveCoopJS
  };
};