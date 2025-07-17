// About Page Entry Point
// Initializes carousel functionality for chicken profile pages

import Carousel from './modules/carousel.js';

class AboutApp {
  constructor() {
    this.carousels = [];
  }
  
  initialize() {
    console.log('Initializing About Page...');
    
    // Initialize all carousels on the page
    const carouselContainers = document.querySelectorAll('.carousel-container');
    carouselContainers.forEach(container => {
      const carousel = new Carousel(container);
      this.carousels.push(carousel);
    });
    
    console.log(`Initialized ${this.carousels.length} carousels`);
  }
  
  // Cleanup method
  destroy() {
    this.carousels.forEach(carousel => {
      if (typeof carousel.destroy === 'function') {
        carousel.destroy();
      }
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.aboutApp = new AboutApp();
    window.aboutApp.initialize();
  });
} else {
  // DOM is already ready
  window.aboutApp = new AboutApp();
  window.aboutApp.initialize();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (window.aboutApp) {
    window.aboutApp.destroy();
  }
});