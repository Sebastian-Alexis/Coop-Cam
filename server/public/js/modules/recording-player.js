// Recording Player Module
// Handles recording list display, video playback, and thumbnail generation

import UIComponents from './ui-components.js';

class RecordingPlayer {
  constructor() {
    this.lastRecordingsData = null;
    this.reactionTypes = null;
    
    // DOM elements
    this.recordingsContainer = null;
    this.recordingsEmpty = null;
    this.videoModal = null;
    this.modalVideo = null;
    this.videoTitle = null;
  }
  
  initialize() {
    // Get DOM elements
    this.recordingsContainer = document.getElementById('recordingsContainer');
    this.recordingsEmpty = document.getElementById('recordingsEmpty');
    this.videoModal = document.getElementById('videoModal');
    this.modalVideo = document.getElementById('modalVideo');
    this.videoTitle = document.getElementById('videoTitle');
    
    if (!this.recordingsContainer || !this.videoModal) {
      console.error('Recording player elements not found');
      return;
    }
    
    // Load initial recordings
    this.updateRecordings();
    
    // Set up periodic updates
    setInterval(() => this.updateRecordings(), 60000); // Update every minute
  }
  
  async updateRecordings() {
    try {
      const response = await fetch('/api/recordings/recent');
      const data = await response.json();
      
      // Store reaction types and recordings data globally for use in other functions
      if (data.reactionTypes) {
        this.reactionTypes = data.reactionTypes;
        window.reactionTypes = data.reactionTypes; // For compatibility
      }
      this.lastRecordingsData = data;
      window.lastRecordingsData = data; // For compatibility
      
      if (!data.success || !data.recordings || data.recordings.length === 0) {
        // Show empty state
        this.recordingsContainer.innerHTML = '';
        this.recordingsEmpty.classList.remove('hidden');
        return;
      }
      
      // Hide empty state
      this.recordingsEmpty.classList.add('hidden');
      
      // Render recordings
      this.recordingsContainer.innerHTML = data.recordings.map((recording, index) => {
        const title = UIComponents.formatRecordingTitle(recording.timestamp);
        return this.renderRecordingCard(recording, title, data.reactionTypes);
      }).join('');
      
      // Bind click handlers
      this.bindRecordingHandlers();
      
      // Dispatch event for reaction system to update
      window.dispatchEvent(new CustomEvent('recordingsUpdated', { detail: data }));
      
    } catch (error) {
      console.error('Failed to fetch recordings:', error);
    }
  }
  
  renderRecordingCard(recording, title, reactionTypes) {
    const timestamp = UIComponents.formatTimestamp(recording.timestamp);
    
    return `
      <div class="bg-base-200 rounded-xl p-4 hover-lift cursor-pointer relative recording-card" data-video-url="${recording.videoUrl}" data-filename="${title}">
        <div class="relative">
          ${recording.thumbnailUrl ? `
            <img 
              src="${recording.thumbnailUrl}" 
              alt="Recording thumbnail" 
              class="aspect-video w-full rounded-lg object-cover mb-3"
              onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke-width=%221.5%22 stroke=%22currentColor%22 class=%22w-6 h-6%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z%22 /%3E%3C/svg%3E';"
            />
          ` : `
            <div class="aspect-video w-full rounded-lg bg-base-300 mb-3 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-base-content/30">
                <path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
          `}
          <!-- Play button overlay -->
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="bg-base-100/80 rounded-full p-3 shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8">
                <path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
          ${recording.duration ? `
            <div class="absolute bottom-2 right-2 bg-base-100/80 px-2 py-1 rounded text-xs font-semibold">
              ${UIComponents.formatDuration(recording.duration)}
            </div>
          ` : ''}
        </div>
        <div class="reactions-container" data-filename="${recording.filename}">
          <div class="flex items-start justify-between gap-2">
            <!-- Main content on the left -->
            <div class="flex-1">
              <div class="font-semibold text-sm mb-1">${title}</div>
              <div class="text-xs text-base-content/60">${timestamp.localTime}</div>
              <div class="text-xs text-base-content/60 mt-1">${timestamp.date}</div>
            </div>
          </div>
          
          <!-- Add reaction button positioned at top-right -->
          <button 
            class="reaction-trigger absolute bottom-8 right-2"
            data-filename="${recording.filename}"
            title="Add reaction"
          >
            <img src="/art/reactions/add_reaction.gif" alt="Add reaction" class="reaction-trigger-img" />
          </button>
          
          <!-- Reaction badges positioned at bottom-right -->
          <div class="reaction-badges absolute -bottom-1 right-2 flex items-center gap-1">
            ${this.renderReactionBadges(recording, reactionTypes)}
          </div>
        </div>
      </div>
    `;
  }
  
  renderReactionBadges(recording, reactionTypes) {
    const topReactions = Object.entries(recording.reactions?.summary || {})
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    
    return topReactions.map(([type, count]) => `
      <div class="reaction-item ${recording.reactions?.userReactions?.includes(type) ? 'user-reaction' : ''}" 
           data-filename="${recording.filename}"
           data-reaction-type="${type}"
           title="React with ${type}">
        <img src="${reactionTypes[type]}" alt="${type}" />
        <span class="reaction-count">${count > 99 ? '99+' : count}</span>
      </div>
    `).join('');
  }
  
  bindRecordingHandlers() {
    // Bind play recording handlers
    const recordingCards = this.recordingsContainer.querySelectorAll('.recording-card');
    recordingCards.forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't play if clicking on reaction elements
        if (e.target.closest('.reaction-trigger') || e.target.closest('.reaction-item')) {
          return;
        }
        const videoUrl = card.dataset.videoUrl;
        const filename = card.dataset.filename;
        this.playRecording(videoUrl, filename);
      });
    });
    
    // Bind reaction triggers (handled by reaction system)
    const reactionTriggers = this.recordingsContainer.querySelectorAll('.reaction-trigger');
    reactionTriggers.forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('showReactionPopup', { 
          detail: { filename: trigger.dataset.filename }
        }));
      });
    });
    
    // Bind reaction items
    const reactionItems = this.recordingsContainer.querySelectorAll('.reaction-item');
    reactionItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('selectReaction', { 
          detail: { 
            filename: item.dataset.filename,
            reactionType: item.dataset.reactionType
          }
        }));
      });
    });
  }
  
  playRecording(videoUrl, filename) {
    if (!this.videoModal || !this.modalVideo || !this.videoTitle) return;
    
    // Set video source and title
    this.modalVideo.src = videoUrl;
    this.videoTitle.textContent = filename || 'Recording Playback';
    
    // Show modal
    this.videoModal.showModal();
    
    // Pause video when modal closes
    this.videoModal.addEventListener('close', () => {
      this.modalVideo.pause();
      this.modalVideo.currentTime = 0;
    }, { once: true });
  }
  
  // Get recording data
  getRecordingData(filename) {
    return this.lastRecordingsData?.recordings?.find(r => r.filename === filename);
  }
  
  // Update single recording's reactions (called by reaction system)
  updateRecordingReactions(filename, reactions) {
    const container = this.recordingsContainer.querySelector(`.reactions-container[data-filename="${filename}"]`);
    if (!container) return;
    
    const recording = this.getRecordingData(filename);
    if (!recording) return;
    
    // Update the recording data
    recording.reactions = reactions;
    
    // Re-render reaction badges
    const badgesContainer = container.querySelector('.reaction-badges');
    badgesContainer.innerHTML = this.renderReactionBadges(recording, this.reactionTypes);
    
    // Re-bind handlers for new elements
    const newItems = badgesContainer.querySelectorAll('.reaction-item');
    newItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('selectReaction', { 
          detail: { 
            filename: item.dataset.filename,
            reactionType: item.dataset.reactionType
          }
        }));
      });
    });
  }
}

// Export for use in other modules
export default RecordingPlayer;