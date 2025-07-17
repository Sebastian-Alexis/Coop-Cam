// Viewer Stats Module
// Handles viewer count display and updates

class ViewerStats {
  constructor() {
    this.viewerCountEl = null;
    this.viewerTextEl = null;
    this.updateInterval = null;
  }
  
  initialize() {
    this.viewerCountEl = document.getElementById('viewerCount');
    this.viewerTextEl = document.getElementById('viewerText');
    
    if (!this.viewerCountEl || !this.viewerTextEl) {
      console.error('Viewer stats elements not found');
      return;
    }
    
    // Initial stats update
    this.updateStats();
    
    // Update stats every 5 seconds
    this.updateInterval = setInterval(() => this.updateStats(), 5000);
  }
  
  async updateStats() {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();
      const count = data.clientCount || 0;
      
      this.viewerCountEl.textContent = count;
      this.viewerTextEl.textContent = count === 1 ? 'viewer' : 'viewers';
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }
  
  // Cleanup method
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Export for use in other modules
export default ViewerStats;