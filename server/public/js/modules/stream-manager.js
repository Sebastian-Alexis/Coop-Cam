// Stream Manager Module
// Handles MJPEG stream connection, reconnection, error handling, and pause functionality

class StreamManager {
  constructor() {
    this.reconnectTimeout = null;
    this.streamRetryCount = 0;
    this.streamLoadTime = null;
    this.frameCount = 0;
    this.stallTimeout = null;
    this.pauseCountdownInterval = null;
    
    // Configuration
    this.MAX_RETRY_COUNT = 10;
    this.RETRY_DELAY = 2000; // Start with 2 seconds
    this.STALL_TIMEOUT_MS = 3000; // 3 seconds
    
    // DOM elements
    this.streamImg = null;
    this.pauseBtn = null;
    this.pauseBtnText = null;
  }
  
  initialize() {
    this.streamImg = document.getElementById('stream');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.pauseBtnText = document.getElementById('pauseBtnText');
    
    if (!this.streamImg) {
      console.error('Stream image element not found');
      return;
    }
    
    this.setupStreamReconnection();
    this.checkPauseStatus();
    
    // Bind pause button click
    if (this.pauseBtn) {
      this.pauseBtn.addEventListener('click', () => this.pauseStream());
    }
  }
  
  // Check pause status on page load
  async checkPauseStatus() {
    try {
      const response = await fetch('/api/stream/status');
      const data = await response.json();
      this.updatePauseButton(data.isPaused, data.remainingSeconds);
    } catch (error) {
      console.error('Failed to check stream status:', error);
    }
  }
  
  // Update pause button based on status
  updatePauseButton(isPaused, remainingSeconds) {
    if (!this.pauseBtn || !this.pauseBtnText) return;
    
    if (isPaused && remainingSeconds > 0) {
      this.pauseBtn.disabled = true;
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      this.pauseBtnText.textContent = `Paused (${minutes}:${seconds.toString().padStart(2, '0')})`;
    } else {
      this.pauseBtn.disabled = false;
      this.pauseBtnText.textContent = 'Pause Stream';
    }
  }
  
  // Pause stream function
  async pauseStream() {
    const password = prompt('Enter password to pause stream:');
    if (!password) return;
    
    if (!this.pauseBtn || !this.pauseBtnText) return;
    
    // Show loading state
    this.pauseBtn.disabled = true;
    this.pauseBtnText.textContent = 'Pausing...';
    
    try {
      const response = await fetch('/api/stream/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        alert('Stream paused for 5 minutes');
        // Start countdown
        let remainingSeconds = 300;
        this.updatePauseButton(true, remainingSeconds);
        
        this.pauseCountdownInterval = setInterval(() => {
          remainingSeconds--;
          if (remainingSeconds <= 0) {
            clearInterval(this.pauseCountdownInterval);
            this.updatePauseButton(false, 0);
          } else {
            this.updatePauseButton(true, remainingSeconds);
          }
        }, 1000);
      } else {
        alert(data.message || 'Failed to pause stream');
        this.pauseBtn.disabled = false;
        this.pauseBtnText.textContent = 'Pause Stream';
      }
    } catch (error) {
      alert('Network error: Failed to pause stream');
      this.pauseBtn.disabled = false;
      this.pauseBtnText.textContent = 'Pause Stream';
    }
  }
  
  // Handle stream error
  handleStreamError() {
    console.error('Stream error detected');
    this.streamLoadTime = null;
    // Trigger the onerror handler to start reconnection
    if (this.streamImg && this.streamImg.onerror) {
      this.streamImg.onerror();
    }
  }
  
  // Handle stream load
  handleStreamLoad() {
    if (!this.streamLoadTime) {
      this.streamLoadTime = Date.now();
      console.log('Stream started loading');
    }
    this.frameCount++;
    if (this.frameCount % 30 === 0) {
      console.log(`Stream active - ${this.frameCount} frames loaded`);
    }
  }
  
  // Reset stall detection timer
  resetStallDetection() {
    if (this.stallTimeout) {
      clearTimeout(this.stallTimeout);
    }
    this.stallTimeout = setTimeout(() => {
      console.log('[Stream] Stall detected - no frames for 3 seconds, reconnecting...');
      this.handleStreamError();
    }, this.STALL_TIMEOUT_MS);
  }
  
  // Auto-reconnect stream on error
  setupStreamReconnection() {
    this.streamImg.onerror = () => {
      console.log('Stream connection lost, attempting to reconnect...');
      
      // Clear stall detection timer
      if (this.stallTimeout) {
        clearTimeout(this.stallTimeout);
        this.stallTimeout = null;
      }
      
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
      
      if (this.streamRetryCount < this.MAX_RETRY_COUNT) {
        this.streamRetryCount++;
        const delay = this.RETRY_DELAY * Math.min(this.streamRetryCount, 5); // Cap at 10 seconds
        
        this.reconnectTimeout = setTimeout(() => {
          console.log(`Reconnecting stream (attempt ${this.streamRetryCount}/${this.MAX_RETRY_COUNT})...`);
          // Force reload by adding timestamp
          this.streamImg.src = `/api/stream?t=${Date.now()}`;
        }, delay);
      } else {
        console.error('Max reconnection attempts reached');
        // Show reconnect button after max attempts
        this.showReconnectButton();
      }
    };
    
    this.streamImg.onload = () => {
      // Reset stall detection timer on each frame
      this.resetStallDetection();
      
      // Reset retry count on successful load
      if (this.streamRetryCount > 0) {
        console.log('Stream reconnected successfully');
        this.streamRetryCount = 0;
      }
      
      // Call the load handler
      this.handleStreamLoad();
    };
    
    // Start initial stall detection
    this.resetStallDetection();
  }
  
  // Show manual reconnect button
  showReconnectButton() {
    const streamContainer = document.querySelector('.relative.w-full.h-full');
    if (!document.getElementById('reconnectBtn')) {
      const reconnectBtn = document.createElement('button');
      reconnectBtn.id = 'reconnectBtn';
      reconnectBtn.className = 'absolute inset-0 bg-base-300/80 flex items-center justify-center';
      reconnectBtn.innerHTML = `
        <div class="text-center">
          <p class="mb-4">Stream connection lost</p>
          <button class="btn btn-primary reconnect-action">
            Reconnect
          </button>
        </div>
      `;
      streamContainer.appendChild(reconnectBtn);
      
      // Add click handler
      reconnectBtn.querySelector('.reconnect-action').addEventListener('click', () => {
        this.manualReconnect();
      });
    }
  }
  
  // Manual reconnect
  manualReconnect() {
    const reconnectBtn = document.getElementById('reconnectBtn');
    if (reconnectBtn) {
      reconnectBtn.remove();
    }
    this.streamRetryCount = 0;
    this.streamImg.src = `/api/stream?t=${Date.now()}`;
  }
  
  // Cleanup method
  destroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.stallTimeout) {
      clearTimeout(this.stallTimeout);
    }
    if (this.pauseCountdownInterval) {
      clearInterval(this.pauseCountdownInterval);
    }
  }
}

// Export for use in other modules
export default StreamManager;