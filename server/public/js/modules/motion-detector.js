// Motion Detector Module
// Handles Server-Sent Events (SSE) for motion detection, notifications, and motion history

class MotionDetector {
  constructor() {
    this.eventSource = null;
    this.motionEvents = [];
    this.motionNotificationCount = 0;
    this.notificationsEnabled = true;
    this.MAX_MOTION_EVENTS = 50;
    
    // DOM elements
    this.motionPanel = null;
    this.motionIndicator = null;
    this.motionCount = null;
    this.motionHistory = null;
    this.notificationToggle = null;
  }
  
  initialize() {
    // Get DOM elements
    this.motionPanel = document.getElementById('motionPanel');
    this.motionIndicator = document.getElementById('motionIndicator');
    this.motionCount = document.getElementById('motionCount');
    this.motionHistory = document.getElementById('motionHistory');
    this.notificationToggle = document.getElementById('notificationToggle');
    
    if (!this.motionPanel || !this.motionHistory) {
      console.error('Motion detector elements not found');
      return;
    }
    
    // Initialize SSE connection
    this.initializeSSE();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initial UI update
    this.updateMotionHistory();
  }
  
  setupEventListeners() {
    // Motion panel toggle buttons
    const motionToggleBtn = document.getElementById('motionToggleBtn');
    if (motionToggleBtn) {
      motionToggleBtn.addEventListener('click', () => this.toggleMotionPanel());
    }
    
    const motionPanelCloseBtn = document.getElementById('motionPanelCloseBtn');
    if (motionPanelCloseBtn) {
      motionPanelCloseBtn.addEventListener('click', () => this.toggleMotionPanel());
    }
    
    // Notification toggle
    if (this.notificationToggle) {
      this.notificationToggle.addEventListener('change', (e) => {
        this.notificationsEnabled = e.target.checked;
        if (this.notificationsEnabled) {
          this.requestNotificationPermission();
        }
      });
    }
  }
  
  initializeSSE() {
    if (this.eventSource) {
      this.eventSource.close();
    }
    
    this.eventSource = new EventSource('/api/events/motion');
    
    this.eventSource.onopen = () => {
      console.log('[SSE] Connected to motion events');
    };
    
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMotionEvent(data);
      } catch (error) {
        console.error('[SSE] Failed to parse message:', error);
      }
    };
    
    this.eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      // Reconnect after 5 seconds
      setTimeout(() => this.initializeSSE(), 5000);
    };
  }
  
  handleMotionEvent(data) {
    if (data.type === 'motion') {
      console.log('[Motion] Detected:', data);
      
      // Add to history
      this.motionEvents.unshift(data);
      if (this.motionEvents.length > this.MAX_MOTION_EVENTS) {
        this.motionEvents.pop();
      }
      
      // Update UI
      this.motionNotificationCount++;
      this.updateMotionIndicator();
      this.updateMotionHistory();
      
      // Show notification
      if (this.notificationsEnabled && document.hidden) {
        this.showMotionNotification(data);
      }
      
      // Show toast if on page
      if (!document.hidden) {
        this.showMotionToast(data);
      }
    }
  }
  
  updateMotionIndicator() {
    if (!this.motionIndicator || !this.motionCount) return;
    
    if (this.motionNotificationCount > 0) {
      this.motionIndicator.classList.remove('hidden');
      this.motionCount.textContent = this.motionNotificationCount > 9 ? '9+' : this.motionNotificationCount;
    } else {
      this.motionIndicator.classList.add('hidden');
    }
  }
  
  updateMotionHistory() {
    if (!this.motionHistory) return;
    
    if (this.motionEvents.length === 0) {
      this.motionHistory.innerHTML = `
        <div class="text-center text-base-content/60 py-8">
          <p>No motion events yet</p>
        </div>
      `;
      return;
    }
    
    this.motionHistory.innerHTML = this.motionEvents.map(event => {
      const time = new Date(event.timestamp);
      const timeStr = time.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      return `
        <div class="bg-base-200 rounded-lg p-3 hover:bg-base-300 transition-colors">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-primary">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
              <span class="text-sm font-medium">Motion Detected</span>
            </div>
            <span class="text-xs text-base-content/60">${timeStr}</span>
          </div>
          ${event.intensity ? `<div class="text-xs text-base-content/60 mt-1">Intensity: ${Math.round(event.intensity * 100)}%</div>` : ''}
        </div>
      `;
    }).join('');
  }
  
  async showMotionNotification(data) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification('Motion Detected!', {
          body: 'Movement detected in the chicken coop',
          icon: '/icons/chicken-icon.png',
          tag: 'motion-alert',
          renotify: true,
          requireInteraction: false
        });
        
        notification.onclick = () => {
          window.focus();
          notification.close();
          this.toggleMotionPanel();
        };
        
        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
      } catch (error) {
        console.error('[Notification] Failed to show:', error);
      }
    }
  }
  
  showMotionToast(data) {
    const existingToast = document.querySelector('.motion-toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = 'motion-toast';
    toast.innerHTML = `
      <div class="flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary flex-shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
        <div>
          <div class="font-semibold">Motion Detected</div>
          <div class="text-sm text-base-content/70">Movement in the coop</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease-out reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  
  toggleMotionPanel() {
    if (!this.motionPanel) return;
    
    this.motionPanel.classList.toggle('show');
    
    // Reset notification count when panel is opened
    if (this.motionPanel.classList.contains('show')) {
      this.motionNotificationCount = 0;
      this.updateMotionIndicator();
    }
  }
  
  async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        console.log('[Notification] Permission:', permission);
      } catch (error) {
        console.error('[Notification] Permission request failed:', error);
      }
    }
  }
  
  // Cleanup method
  destroy() {
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}

// Export for use in other modules
export default MotionDetector;