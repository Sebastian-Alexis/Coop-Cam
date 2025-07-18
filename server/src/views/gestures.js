/**
 * Lightweight gesture handler using native Pointer Events
 * Designed for mobile-first interactions without external dependencies
 */

export class GestureManager {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      minSwipeDistance: 50,
      maxSwipeTime: 500,
      longPressTime: 500,
      doubleTapTime: 300,
      pinchThreshold: 0.1,
      ...options
    };
    
    this.pointers = new Map();
    this.startX = 0;
    this.startY = 0;
    this.startTime = 0;
    this.lastTapTime = 0;
    this.longPressTimer = null;
    this.isPinching = false;
    this.initialPinchDistance = 0;
    
    this.init();
  }
  
  init() {
    // Use passive listeners for better scroll performance
    this.element.addEventListener('pointerdown', this.onPointerDown.bind(this), { passive: false });
    this.element.addEventListener('pointermove', this.onPointerMove.bind(this), { passive: false });
    this.element.addEventListener('pointerup', this.onPointerUp.bind(this), { passive: true });
    this.element.addEventListener('pointercancel', this.onPointerCancel.bind(this), { passive: true });
  }
  
  onPointerDown(e) {
    // Store pointer info
    this.pointers.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    });
    
    // Handle different gesture types based on pointer count
    if (this.pointers.size === 1) {
      // Single touch - potential swipe, tap, or long press
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.startTime = Date.now();
      
      // Check for double tap
      const timeSinceLastTap = Date.now() - this.lastTapTime;
      if (timeSinceLastTap < this.options.doubleTapTime) {
        this.options.onDoubleTap?.({ x: e.clientX, y: e.clientY });
        this.lastTapTime = 0;
      }
      
      // Start long press timer
      this.longPressTimer = setTimeout(() => {
        if (this.pointers.size === 1) {
          this.options.onLongPress?.({ x: e.clientX, y: e.clientY });
          this.longPressTimer = null;
        }
      }, this.options.longPressTime);
      
    } else if (this.pointers.size === 2) {
      // Two fingers - potential pinch
      this.clearLongPressTimer();
      const pointerArray = Array.from(this.pointers.values());
      this.initialPinchDistance = this.getDistance(
        pointerArray[0].startX, pointerArray[0].startY,
        pointerArray[1].startX, pointerArray[1].startY
      );
      this.isPinching = true;
    }
  }
  
  onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    
    const pointer = this.pointers.get(e.pointerId);
    pointer.currentX = e.clientX;
    pointer.currentY = e.clientY;
    
    // Clear long press if moved too much
    if (this.longPressTimer && this.pointers.size === 1) {
      const deltaX = Math.abs(e.clientX - pointer.startX);
      const deltaY = Math.abs(e.clientY - pointer.startY);
      if (deltaX > 10 || deltaY > 10) {
        this.clearLongPressTimer();
      }
    }
    
    // Handle pinch
    if (this.isPinching && this.pointers.size === 2) {
      const pointerArray = Array.from(this.pointers.values());
      const currentDistance = this.getDistance(
        pointerArray[0].currentX, pointerArray[0].currentY,
        pointerArray[1].currentX, pointerArray[1].currentY
      );
      
      const scale = currentDistance / this.initialPinchDistance;
      const centerX = (pointerArray[0].currentX + pointerArray[1].currentX) / 2;
      const centerY = (pointerArray[0].currentY + pointerArray[1].currentY) / 2;
      
      this.options.onPinch?.({ scale, centerX, centerY });
      
      // Prevent default to avoid browser zoom
      e.preventDefault();
    }
  }
  
  onPointerUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    
    const pointer = this.pointers.get(e.pointerId);
    const deltaTime = Date.now() - this.startTime;
    
    // Handle swipe for single pointer
    if (this.pointers.size === 1 && deltaTime < this.options.maxSwipeTime) {
      const deltaX = e.clientX - pointer.startX;
      const deltaY = e.clientY - pointer.startY;
      
      if (Math.abs(deltaX) > this.options.minSwipeDistance || 
          Math.abs(deltaY) > this.options.minSwipeDistance) {
        // Determine swipe direction
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          // Horizontal swipe
          if (deltaX > 0) {
            this.options.onSwipeRight?.({ distance: deltaX, velocity: deltaX / deltaTime });
          } else {
            this.options.onSwipeLeft?.({ distance: Math.abs(deltaX), velocity: Math.abs(deltaX) / deltaTime });
          }
        } else {
          // Vertical swipe
          if (deltaY > 0) {
            this.options.onSwipeDown?.({ distance: deltaY, velocity: deltaY / deltaTime });
          } else {
            this.options.onSwipeUp?.({ distance: Math.abs(deltaY), velocity: Math.abs(deltaY) / deltaTime });
          }
        }
      } else if (deltaTime < 200) {
        // Quick tap
        this.lastTapTime = Date.now();
        this.options.onTap?.({ x: e.clientX, y: e.clientY });
      }
    }
    
    // End pinch if it was the second pointer
    if (this.isPinching && this.pointers.size === 2) {
      this.options.onPinchEnd?.();
      this.isPinching = false;
    }
    
    // Clean up
    this.pointers.delete(e.pointerId);
    this.clearLongPressTimer();
  }
  
  onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    this.clearLongPressTimer();
    if (this.isPinching) {
      this.options.onPinchEnd?.();
      this.isPinching = false;
    }
  }
  
  clearLongPressTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
  
  getDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  destroy() {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.clearLongPressTimer();
    this.pointers.clear();
  }
}

// Swipe navigation helper
export class SwipeNavigator {
  constructor(options = {}) {
    this.options = {
      pages: [],
      currentIndex: 0,
      ...options
    };
    
    this.init();
  }
  
  init() {
    // Get current page from URL
    const currentPath = window.location.pathname;
    this.options.currentIndex = this.options.pages.findIndex(page => page.path === currentPath);
    
    // Initialize gesture manager on body
    this.gestureManager = new GestureManager(document.body, {
      minSwipeDistance: 75,
      onSwipeLeft: () => this.navigateNext(),
      onSwipeRight: () => this.navigatePrev()
    });
  }
  
  navigateNext() {
    if (this.options.currentIndex < this.options.pages.length - 1) {
      const nextPage = this.options.pages[this.options.currentIndex + 1];
      this.navigate(nextPage);
    }
  }
  
  navigatePrev() {
    if (this.options.currentIndex > 0) {
      const prevPage = this.options.pages[this.options.currentIndex - 1];
      this.navigate(prevPage);
    }
  }
  
  navigate(page) {
    // Add transition effect
    document.body.style.opacity = '0.8';
    setTimeout(() => {
      window.location.href = page.path;
    }, 200);
  }
  
  destroy() {
    this.gestureManager.destroy();
  }
}

// Pull to refresh helper
export class PullToRefresh {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      threshold: 80,
      onRefresh: () => {},
      ...options
    };
    
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.isRefreshing = false;
    
    this.init();
  }
  
  init() {
    // Create pull indicator
    this.createIndicator();
    
    // Add touch listeners
    this.element.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true });
    this.element.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.element.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
  }
  
  createIndicator() {
    this.indicator = document.createElement('div');
    this.indicator.className = 'pull-to-refresh-indicator';
    this.indicator.innerHTML = `
      <div class="pull-to-refresh-content">
        <svg class="pull-to-refresh-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 12C4 7.58172 7.58172 4 12 4C14.4817 4 16.6932 5.20883 18.0615 7.05766L16.5 7C16.2239 7 16 7.22386 16 7.5C16 7.77614 16.2239 8 16.5 8H19.5C19.7761 8 20 7.77614 20 7.5V4.5C20 4.22386 19.7761 4 19.5 4C19.2239 4 19 4.22386 19 4.5V6.08296C17.5227 3.57006 14.9505 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 11.7239 21.7761 11.5 21.5 11.5C21.2239 11.5 21 11.7239 21 12C21 16.4183 17.4183 20 12 20C7.58172 20 4 16.4183 4 12Z" fill="currentColor"/>
        </svg>
      </div>
    `;
    
    // Insert before element
    this.element.parentNode.insertBefore(this.indicator, this.element);
  }
  
  onTouchStart(e) {
    if (this.element.scrollTop === 0 && !this.isRefreshing) {
      this.startY = e.touches[0].clientY;
      this.isDragging = true;
    }
  }
  
  onTouchMove(e) {
    if (!this.isDragging || this.isRefreshing) return;
    
    this.currentY = e.touches[0].clientY;
    const deltaY = this.currentY - this.startY;
    
    if (deltaY > 0) {
      e.preventDefault();
      const progress = Math.min(deltaY / this.options.threshold, 1);
      this.updateIndicator(deltaY, progress);
    }
  }
  
  onTouchEnd() {
    if (!this.isDragging) return;
    
    const deltaY = this.currentY - this.startY;
    
    if (deltaY >= this.options.threshold && !this.isRefreshing) {
      this.refresh();
    } else {
      this.reset();
    }
    
    this.isDragging = false;
  }
  
  updateIndicator(distance, progress) {
    this.indicator.style.height = `${Math.min(distance, this.options.threshold * 1.5)}px`;
    this.indicator.style.opacity = progress;
    
    const icon = this.indicator.querySelector('.pull-to-refresh-icon');
    icon.style.transform = `rotate(${progress * 360}deg)`;
  }
  
  refresh() {
    this.isRefreshing = true;
    this.indicator.classList.add('refreshing');
    
    this.options.onRefresh(() => {
      this.reset();
    });
  }
  
  reset() {
    this.isRefreshing = false;
    this.indicator.classList.remove('refreshing');
    this.indicator.style.height = '0';
    this.indicator.style.opacity = '0';
  }
  
  destroy() {
    this.element.removeEventListener('touchstart', this.onTouchStart);
    this.element.removeEventListener('touchmove', this.onTouchMove);
    this.element.removeEventListener('touchend', this.onTouchEnd);
    this.indicator.remove();
  }
}