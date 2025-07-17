// Reaction System Module
// Handles reaction selection, toggling, popup management, and UI updates

class ReactionSystem {
  constructor() {
    this.viewerId = null;
    this.reactionTypes = null;
    
    // DOM elements
    this.globalReactionPopup = null;
    this.popupContent = null;
    this.clickHandler = null;
  }
  
  initialize() {
    // Get DOM elements
    this.globalReactionPopup = document.getElementById('globalReactionPopup');
    
    if (!this.globalReactionPopup) {
      console.error('Global reaction popup not found');
      return;
    }
    
    // Get or create viewer ID
    this.viewerId = this.getOrCreateViewerId();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Listen for escape key
    window.addEventListener('escapePressed', () => this.hideAllPopups());
  }
  
  setupEventListeners() {
    // Listen for custom events from recording player
    window.addEventListener('showReactionPopup', (e) => {
      this.showReactionPopup(e.detail.filename);
    });
    
    window.addEventListener('selectReaction', (e) => {
      this.toggleReaction(e.detail.filename, e.detail.reactionType);
    });
    
    // Listen for recordings update to get reaction types
    window.addEventListener('recordingsUpdated', (e) => {
      if (e.detail.reactionTypes) {
        this.reactionTypes = e.detail.reactionTypes;
      }
    });
  }
  
  showReactionPopup(filename) {
    // Get the button that was clicked
    const container = document.querySelector(`.reactions-container[data-filename="${filename}"]`);
    const button = container?.querySelector('.reaction-trigger');
    if (!button) return;
    
    const buttonRect = button.getBoundingClientRect();
    
    // Get current recording data and user reactions
    const recording = window.lastRecordingsData?.recordings?.find(r => r.filename === filename);
    if (!recording || !this.reactionTypes) return;
    
    // Store current filename
    this.globalReactionPopup.dataset.currentFilename = filename;
    
    // Populate popup content
    const content = this.globalReactionPopup.querySelector('.reaction-popup-content');
    content.innerHTML = Object.entries(this.reactionTypes).map(([type, imageSrc]) => {
      const isActive = recording.reactions?.userReactions?.includes(type) || false;
      return `
        <button
          class="reaction-option ${isActive ? 'active' : ''}"
          data-reaction="${type}"
          title="${type}"
        >
          <img src="${imageSrc}" alt="${type}" />
        </button>
      `;
    }).join('');
    
    // Bind click handlers to reaction options
    content.querySelectorAll('.reaction-option').forEach(option => {
      option.addEventListener('click', () => {
        const reactionType = option.dataset.reaction;
        this.selectReaction(filename, reactionType);
      });
    });
    
    // Calculate popup position
    let left = buttonRect.left - 128; // Center popup (256px wide / 2)
    let top = buttonRect.top - 100; // Position above button
    
    // Mobile positioning
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // Center popup on mobile
      const popupWidth = 256;
      const popupHeight = 100;
      left = (window.innerWidth - popupWidth) / 2;
      top = (window.innerHeight - popupHeight) / 2;
    } else {
      // Desktop: ensure popup stays within viewport
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Adjust horizontal position
      if (left < 10) left = 10;
      if (left + 256 > viewportWidth - 10) {
        left = viewportWidth - 266;
      }
      
      // Adjust vertical position
      if (top < 10) {
        // Position below button if too close to top
        top = buttonRect.bottom + 10;
      }
      if (top + 100 > viewportHeight - 10) {
        top = viewportHeight - 110;
      }
    }
    
    // Position and show popup
    this.globalReactionPopup.style.left = `${left}px`;
    this.globalReactionPopup.style.top = `${top}px`;
    this.globalReactionPopup.classList.remove('hidden');
    
    // Trigger animation
    setTimeout(() => {
      this.globalReactionPopup.classList.add('show');
    }, 10);
    
    // Clean up previous click handler
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
    }
    
    // Close on outside click (with delay to prevent immediate closing)
    this.clickHandler = (e) => {
      if (!e.target.closest('.reaction-popup-global') && !e.target.closest('.reaction-trigger')) {
        this.hideAllPopups();
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', this.clickHandler);
    }, 100);
  }
  
  hideAllPopups(e) {
    // Don't hide if clicking inside a popup
    if (e && e.target.closest('.reaction-popup-global')) return;
    
    this.globalReactionPopup.classList.remove('show');
    
    // Wait for animation to complete before hiding
    setTimeout(() => {
      this.globalReactionPopup.classList.add('hidden');
      this.globalReactionPopup.dataset.currentFilename = '';
    }, 200);
    
    // Clean up click handler
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
  }
  
  async selectReaction(filename, reactionType) {
    // Hide popup
    this.hideAllPopups();
    
    // Toggle the reaction
    await this.toggleReaction(filename, reactionType);
  }
  
  async toggleReaction(filename, reactionType) {
    const option = this.globalReactionPopup.querySelector(`.reaction-option[data-reaction="${reactionType}"]`);
    const isActive = option?.classList.contains('active') || false;
    
    // Check if user already has this reaction from the actual UI
    const container = document.querySelector(`.reactions-container[data-filename="${filename}"]`);
    const reactionItem = container?.querySelector(`.reaction-item img[alt="${reactionType}"]`)?.closest('.reaction-item');
    const hasReaction = reactionItem?.classList.contains('user-reaction') || false;
    
    // Add animation to the trigger button
    const trigger = container?.querySelector('.reaction-trigger');
    if (trigger) {
      trigger.style.animation = 'none';
      setTimeout(() => trigger.style.animation = '', 10);
    }
    
    try {
      let response;
      if (hasReaction) {
        // Remove specific reaction
        response = await fetch(`/api/recordings/${filename}/reactions`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-viewer-id': this.viewerId
          },
          body: JSON.stringify({ reactionType })
        });
      } else {
        // Add reaction
        response = await fetch(`/api/recordings/${filename}/reactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-viewer-id': this.viewerId
          },
          body: JSON.stringify({ reaction: reactionType })
        });
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Update UI with new reaction data
        this.updateReactionUI(filename, data.summary, data.userReactions);
        
        // Notify recording player to update its data
        if (window.recordingPlayer) {
          window.recordingPlayer.updateRecordingReactions(filename, {
            summary: data.summary,
            userReactions: data.userReactions
          });
        }
      }
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
    }
  }
  
  updateReactionUI(filename, summary, userReactions) {
    // Update global popup if it's showing this recording's reactions
    if (this.globalReactionPopup.dataset.currentFilename === filename) {
      this.globalReactionPopup.querySelectorAll('.reaction-option').forEach(option => {
        const reactionType = option.dataset.reaction;
        if (userReactions?.includes(reactionType)) {
          option.classList.add('active');
        } else {
          option.classList.remove('active');
        }
      });
    }
  }
  
  getOrCreateViewerId() {
    let viewerId = localStorage.getItem('viewerId');
    if (!viewerId) {
      // Generate unique viewer ID
      viewerId = 'viewer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('viewerId', viewerId);
    }
    return viewerId;
  }
  
  // Update reactions for all recordings (called periodically)
  async updateReactionsOnly() {
    if (!window.lastRecordingsData?.recordings) return;
    
    try {
      const response = await fetch('/api/recordings/recent');
      const data = await response.json();
      
      if (data.success && data.recordings) {
        data.recordings.forEach(recording => {
          if (recording.reactions) {
            // Check if UI needs updating
            const oldRecording = window.lastRecordingsData.recordings.find(r => r.filename === recording.filename);
            if (oldRecording && JSON.stringify(oldRecording.reactions) !== JSON.stringify(recording.reactions)) {
              this.updateReactionUI(recording.filename, recording.reactions.summary, recording.reactions.userReactions);
              
              // Update recording player data
              if (window.recordingPlayer) {
                window.recordingPlayer.updateRecordingReactions(recording.filename, recording.reactions);
              }
            }
          }
        });
        
        // Update global data
        window.lastRecordingsData = data;
      }
    } catch (error) {
      console.error('Failed to update reactions:', error);
    }
  }
}

// Export for use in other modules
export default ReactionSystem;