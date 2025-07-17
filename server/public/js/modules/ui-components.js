// UI Components Module
// Handles time display, fullscreen, keyboard shortcuts, and other UI utilities

class UIComponents {
  constructor() {
    this.isFullscreen = false;
    
    // DOM elements
    this.currentTimeEl = null;
    this.localTimeEl = null;
    this.fullscreenBtn = null;
    this.fullscreenIcon = null;
  }
  
  initialize() {
    this.currentTimeEl = document.getElementById('currentTime');
    this.localTimeEl = document.getElementById('localTime');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.fullscreenIcon = document.getElementById('fullscreenIcon');
    
    // Set up time update
    this.updateTime();
    setInterval(() => this.updateTime(), 1000);
    
    // Set up fullscreen
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }
    
    // Set up fullscreen change listener
    document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('mozfullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('MSFullscreenChange', () => this.handleFullscreenChange());
    
    // Set up keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }
  
  // Update time display
  updateTime() {
    const now = new Date();
    
    // Get PST time
    const pstStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false,
      timeZone: 'America/Los_Angeles'
    });
    
    if (this.currentTimeEl) {
      this.currentTimeEl.textContent = pstStr;
    }
    
    // Get user's local time
    const localStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false
    });
    
    // Get user's timezone abbreviation
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzAbbr = now.toLocaleTimeString('en-US', { 
      timeZoneName: 'short'
    }).split(' ').pop();
    
    if (this.localTimeEl) {
      this.localTimeEl.textContent = `${localStr} ${tzAbbr}`;
    }
  }
  
  // Toggle fullscreen mode
  async toggleFullscreen() {
    const videoContainer = document.getElementById('videoContainer');
    if (!videoContainer) return;
    
    if (!this.isFullscreen) {
      if (videoContainer.requestFullscreen) {
        await videoContainer.requestFullscreen();
      } else if (videoContainer.mozRequestFullScreen) {
        await videoContainer.mozRequestFullScreen();
      } else if (videoContainer.webkitRequestFullscreen) {
        await videoContainer.webkitRequestFullscreen();
      } else if (videoContainer.msRequestFullscreen) {
        await videoContainer.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.mozCancelFullScreen) {
        await document.mozCancelFullScreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        await document.msExitFullscreen();
      }
    }
  }
  
  // Update fullscreen button icon
  updateFullscreenButton() {
    if (!this.fullscreenIcon) return;
    
    if (this.isFullscreen) {
      this.fullscreenIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />';
    } else {
      this.fullscreenIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />';
    }
  }
  
  // Handle fullscreen change event
  handleFullscreenChange() {
    this.isFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
    this.updateFullscreenButton();
  }
  
  // Handle keyboard shortcuts
  handleKeyDown(event) {
    // F key for fullscreen
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      this.toggleFullscreen();
    }
    
    // Escape key to close popups (handled by reaction system)
    if (event.key === 'Escape') {
      // Dispatch custom event that other modules can listen to
      window.dispatchEvent(new CustomEvent('escapePressed'));
    }
  }
  
  // Utility method to format duration
  static formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  // Utility method to format timestamp
  static formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    
    // Get local time components
    const localHours = date.getHours();
    const localMinutes = date.getMinutes();
    const localSeconds = date.getSeconds();
    const localAmPm = localHours >= 12 ? 'PM' : 'AM';
    const localHours12 = localHours % 12 || 12;
    
    // Get PST time
    const pstTime = date.toLocaleTimeString('en-US', { 
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'America/Los_Angeles'
    });
    
    // Format local time
    const localTime = `${localHours12}:${localMinutes.toString().padStart(2, '0')}:${localSeconds.toString().padStart(2, '0')} ${localAmPm}`;
    
    return {
      date: date.toLocaleDateString(),
      localTime: localTime,
      pstTime: pstTime
    };
  }
  
  // Utility method to format recording title
  static formatRecordingTitle(timestamp) {
    const date = new Date(timestamp);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = dayNames[date.getDay()];
    const monthName = monthNames[date.getMonth()];
    const dayOfMonth = date.getDate();
    
    // PST time
    const pstHours = new Date(date.toLocaleString("en-US", {timeZone: "America/Los_Angeles"})).getHours();
    const hour12 = pstHours % 12 || 12;
    const ampm = pstHours >= 12 ? 'PM' : 'AM';
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${dayName}, ${monthName} ${dayOfMonth} at ${hour12}:${minutes}:${seconds} ${ampm} PST`;
  }
}

// Export for use in other modules
export default UIComponents;