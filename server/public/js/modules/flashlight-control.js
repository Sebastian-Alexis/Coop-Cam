// Flashlight Control Module
// Handles flashlight toggle functionality and timer display

class FlashlightControl {
  constructor() {
    this.countdownInterval = null;
    
    // DOM elements
    this.flashlightBtn = null;
    this.flashlightBtnText = null;
    this.timerText = null;
  }
  
  initialize() {
    this.flashlightBtn = document.getElementById('flashlightBtn');
    this.flashlightBtnText = document.getElementById('flashlightBtnText');
    this.timerText = document.getElementById('timerText');
    
    if (!this.flashlightBtn) {
      console.error('Flashlight button not found');
      return;
    }
    
    // Bind click handler
    this.flashlightBtn.addEventListener('click', () => this.toggleFlashlight());
    
    // Check initial status
    this.checkFlashlightStatus();
    
    // Set up periodic status checks
    this.startStatusPolling();
  }
  
  // Start periodic status polling
  startStatusPolling() {
    // Check flashlight status every 30 seconds
    setInterval(() => this.checkFlashlightStatus(), 30000);
  }
  
  // Check flashlight status
  async checkFlashlightStatus() {
    try {
      const response = await fetch('/api/flashlight/status');
      const data = await response.json();
      
      // Only restart countdown if flashlight is on
      // This syncs with server state to prevent drift
      if (data.isOn && this.countdownInterval) {
        // Countdown is already running, just sync the time
        this.startCountdown(data.remainingSeconds);
      } else {
        // Normal UI update
        this.updateFlashlightUI(data.isOn, data.remainingSeconds);
      }
    } catch (error) {
      console.error('Failed to check flashlight status:', error);
    }
  }
  
  // Update UI based on flashlight state
  updateFlashlightUI(isOn, remainingSeconds) {
    if (!this.flashlightBtn || !this.flashlightBtnText || !this.timerText) return;
    
    if (isOn) {
      this.flashlightBtn.classList.add('flashlight-on');
      this.flashlightBtn.disabled = true;
      this.flashlightBtnText.textContent = 'Flashlight On';
      
      // Update timer styling
      this.timerText.classList.remove('opacity-60');
      this.timerText.classList.add('text-success', 'font-bold');
      
      // Start smooth countdown
      this.startCountdown(remainingSeconds);
    } else {
      // Stop countdown if running
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      
      this.flashlightBtn.classList.remove('flashlight-on');
      this.flashlightBtn.disabled = false;
      this.flashlightBtnText.textContent = 'Turn On Flashlight';
      
      // Reset timer styling
      this.timerText.classList.add('opacity-60');
      this.timerText.classList.remove('text-success', 'font-bold');
      this.timerText.textContent = '5:00';
    }
  }
  
  // Update timer display
  updateTimerDisplay(remainingSeconds) {
    if (!this.timerText) return;
    
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    this.timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  // Start countdown timer for smooth display updates
  startCountdown(initialSeconds) {
    // Clear any existing countdown
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    
    let remainingSeconds = initialSeconds;
    
    // Update immediately
    this.updateTimerDisplay(remainingSeconds);
    
    // Update every second
    this.countdownInterval = setInterval(() => {
      remainingSeconds--;
      
      if (remainingSeconds <= 0) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        // Timer expired, UI will update on next server poll
        remainingSeconds = 0;
      }
      
      this.updateTimerDisplay(remainingSeconds);
    }, 1000);
  }
  
  // Toggle flashlight
  async toggleFlashlight() {
    if (!this.flashlightBtn || !this.flashlightBtnText) return;
    
    // Show loading state
    this.flashlightBtn.disabled = true;
    this.flashlightBtnText.textContent = 'Turning on...';
    
    try {
      const response = await fetch('/api/flashlight/on', {
        method: 'PUT',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        // Update UI with server state
        this.updateFlashlightUI(data.isOn, data.remainingSeconds);
        console.log('Flashlight turned on successfully');
      } else {
        // Reset on error
        this.flashlightBtn.disabled = false;
        this.flashlightBtnText.textContent = 'Turn On Flashlight';
        console.error('Failed to turn on flashlight:', data.message || 'Unknown error');
        alert(`Failed to turn on flashlight: ${data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to toggle flashlight:', error);
      this.flashlightBtn.disabled = false;
      this.flashlightBtnText.textContent = 'Turn On Flashlight';
      alert(`Network error: ${error.message}`);
    }
  }
  
  // Cleanup method
  destroy() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }
}

// Export for use in other modules
export default FlashlightControl;