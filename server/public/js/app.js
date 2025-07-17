// Main Application Entry Point
// Initializes and coordinates all modules

import StreamManager from './modules/stream-manager.js';
import FlashlightControl from './modules/flashlight-control.js';
import UIComponents from './modules/ui-components.js';
import WeatherWidget from './modules/weather-widget.js';
import ViewerStats from './modules/viewer-stats.js';
import MotionDetector from './modules/motion-detector.js';
import RecordingPlayer from './modules/recording-player.js';
import ReactionSystem from './modules/reaction-system.js';

class CoopCamApp {
  constructor() {
    this.modules = {};
  }
  
  async initialize() {
    console.log('Initializing Coop Cam Application...');
    
    try {
      // Initialize core modules
      this.modules.streamManager = new StreamManager();
      this.modules.streamManager.initialize();
      
      this.modules.flashlightControl = new FlashlightControl();
      this.modules.flashlightControl.initialize();
      
      this.modules.uiComponents = new UIComponents();
      this.modules.uiComponents.initialize();
      
      this.modules.weatherWidget = new WeatherWidget();
      this.modules.weatherWidget.initialize();
      
      this.modules.viewerStats = new ViewerStats();
      this.modules.viewerStats.initialize();
      
      this.modules.motionDetector = new MotionDetector();
      this.modules.motionDetector.initialize();
      
      this.modules.recordingPlayer = new RecordingPlayer();
      this.modules.recordingPlayer.initialize();
      
      this.modules.reactionSystem = new ReactionSystem();
      this.modules.reactionSystem.initialize();
      
      // Make recording player available globally for reaction system
      window.recordingPlayer = this.modules.recordingPlayer;
      
      // Set up periodic updates
      this.setupPeriodicUpdates();
      
      // Set up global event handlers
      this.setupGlobalHandlers();
      
      // Check if stream should autoplay
      this.checkAutoplay();
      
      console.log('Coop Cam Application initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize application:', error);
    }
  }
  
  setupPeriodicUpdates() {
    // Update reactions every 10 seconds
    setInterval(() => {
      if (this.modules.reactionSystem?.updateReactionsOnly) {
        this.modules.reactionSystem.updateReactionsOnly();
      }
    }, 10000);
  }
  
  setupGlobalHandlers() {
    // Global click handler for closing popups
    document.addEventListener('click', (e) => {
      // Handle popup closing (delegated to reaction system)
      if (!e.target.closest('.reaction-popup-global') && 
          !e.target.closest('.reaction-trigger') &&
          !e.target.closest('.reaction-item')) {
        this.modules.reactionSystem?.hideAllPopups();
      }
    });
    
    // Handle page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('Page hidden - reducing update frequency');
      } else {
        console.log('Page visible - resuming normal updates');
        // Refresh data when page becomes visible
        this.modules.viewerStats?.updateStats();
        this.modules.weatherWidget?.updateWeather();
        this.modules.recordingPlayer?.updateRecordings();
      }
    });
  }
  
  checkAutoplay() {
    // Check if stream is already set to autoplay
    const streamImg = document.getElementById('stream');
    if (streamImg && !streamImg.src) {
      // Set initial stream source
      streamImg.src = `/api/stream?t=${Date.now()}`;
    }
  }
  
  // Cleanup method for when page unloads
  destroy() {
    console.log('Cleaning up Coop Cam Application...');
    
    Object.values(this.modules).forEach(module => {
      if (typeof module.destroy === 'function') {
        module.destroy();
      }
    });
  }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.coopCamApp = new CoopCamApp();
    window.coopCamApp.initialize();
  });
} else {
  // DOM is already ready
  window.coopCamApp = new CoopCamApp();
  window.coopCamApp.initialize();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (window.coopCamApp) {
    window.coopCamApp.destroy();
  }
});