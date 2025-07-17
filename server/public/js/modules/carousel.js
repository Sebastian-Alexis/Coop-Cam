// Carousel Module
// Handles image carousel functionality with touch support and auto-scroll

class Carousel {
  constructor(container) {
    this.container = container;
    this.inner = container.querySelector('.carousel-inner');
    this.track = container.querySelector('.carousel-track');
    this.items = container.querySelectorAll('.carousel-item');
    this.prevBtn = container.querySelector('.prev');
    this.nextBtn = container.querySelector('.next');
    this.indicatorsContainer = container.querySelector('.carousel-indicators');
    this.currentIndex = 0;
    this.touchStartX = 0;
    this.touchEndX = 0;
    this.autoScrollInterval = null;
    this.autoScrollDelay = 5000; // 5 seconds default
    this.manualInteractionDelay = 30000; // 30 seconds after manual interaction
    this.currentDelay = this.autoScrollDelay; // Track current delay
    
    this.init();
  }
  
  init() {
    // Create indicators
    this.items.forEach((_, index) => {
      const dot = document.createElement('div');
      dot.classList.add('carousel-dot');
      if (index === 0) dot.classList.add('active');
      dot.addEventListener('click', () => this.goToSlide(index));
      this.indicatorsContainer.appendChild(dot);
    });
    
    this.indicators = this.indicatorsContainer.querySelectorAll('.carousel-dot');
    
    // Add event listeners
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
    
    // Touch support
    this.track.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
    this.track.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
    
    // Keyboard support
    this.container.addEventListener('keydown', (e) => this.handleKeydown(e));
    
    // Hover events for auto-scroll
    this.container.addEventListener('mouseenter', () => this.stopAutoScroll());
    this.container.addEventListener('mouseleave', () => this.startAutoScroll());
    
    // Set initial active state
    this.container.classList.add('active');
    
    // Start auto-scroll
    this.startAutoScroll();
  }
  
  prev() {
    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    this.updateCarousel();
    this.handleManualInteraction();
  }
  
  next() {
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.updateCarousel();
    this.handleManualInteraction();
  }
  
  goToSlide(index) {
    this.currentIndex = index;
    this.updateCarousel();
    this.handleManualInteraction();
  }
  
  updateCarousel() {
    const offset = -this.currentIndex * 100;
    this.track.style.transform = `translateX(${offset}%)`;
    
    // Update indicators
    this.indicators.forEach((dot, index) => {
      dot.classList.toggle('active', index === this.currentIndex);
    });
    
    // Update active image for lazy loading
    this.items.forEach((item, index) => {
      const img = item.querySelector('img');
      if (index === this.currentIndex && img.dataset.src && !img.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
      }
    });
  }
  
  handleTouchStart(e) {
    this.touchStartX = e.changedTouches[0].screenX;
  }
  
  handleTouchEnd(e) {
    this.touchEndX = e.changedTouches[0].screenX;
    this.handleSwipe();
  }
  
  handleSwipe() {
    const swipeThreshold = 50;
    const diff = this.touchStartX - this.touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        this.next();
      } else {
        this.prev();
      }
    }
  }
  
  handleKeydown(e) {
    if (e.key === 'ArrowLeft') {
      this.prev();
    } else if (e.key === 'ArrowRight') {
      this.next();
    }
  }
  
  handleManualInteraction() {
    // Set delay to 30 seconds after manual interaction
    this.currentDelay = this.manualInteractionDelay;
    this.stopAutoScroll();
    this.startAutoScroll();
  }
  
  startAutoScroll() {
    this.stopAutoScroll();
    this.autoScrollInterval = setInterval(() => {
      // Check if carousel is visible
      const rect = this.container.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
      
      if (isVisible) {
        this.next();
        // Reset to normal delay after auto-scroll
        this.currentDelay = this.autoScrollDelay;
      }
    }, this.currentDelay);
  }
  
  stopAutoScroll() {
    if (this.autoScrollInterval) {
      clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = null;
    }
  }
  
  destroy() {
    this.stopAutoScroll();
  }
}

// Export for use in other modules
export default Carousel;