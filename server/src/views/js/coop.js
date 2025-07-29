    //centralized timer management system to prevent memory leaks
    const TimerManager = {
      timers: new Map(),
      
      //create a managed timer that gets automatically tracked
      setTimeout(callback, delay, name = null) {
        const id = window.setTimeout(callback, delay);
        this.timers.set(id, { type: 'timeout', name, id });
        return id;
      },
      
      setInterval(callback, delay, name = null) {
        const id = window.setInterval(callback, delay);
        this.timers.set(id, { type: 'interval', name, id });
        return id;
      },
      
      //clear specific timer
      clearTimeout(id) {
        if (id) {
          window.clearTimeout(id);
          this.timers.delete(id);
        }
      },
      
      clearInterval(id) {
        if (id) {
          window.clearInterval(id);
          this.timers.delete(id);
        }
      },
      
      //clear all timers (for cleanup)
      clearAll() {
        console.log(`[TimerManager] Cleaning up ${this.timers.size} active timers`);
        for (const [id, timer] of this.timers) {
          if (timer.type === 'timeout') {
            window.clearTimeout(id);
          } else {
            window.clearInterval(id);
          }
        }
        this.timers.clear();
      },
      
      //get active timer count for debugging
      getActiveCount() {
        return this.timers.size;
      },
      
      //list active timers for debugging
      listActive() {
        console.log('[TimerManager] Active timers:', Array.from(this.timers.values()));
      },
      
      //helper for auto-removing UI elements after delay
      autoRemove(element, delay = 3000, name = 'autoRemove') {
        return this.setTimeout(() => {
          if (element && element.parentNode) {
            element.remove();
          }
        }, delay, name);
      },
      
      //helper for error message timeouts
      scheduleErrorCleanup(element, delay = 3000) {
        return this.autoRemove(element, delay, 'errorCleanup');
      }
    };

    //stream management variables
    let streamReconnectTimeout = null;
    let streamRetryCount = 0;
    let streamLoadTime = null;
    let frameCount = 0;
    let streamSustainedSuccessTimeout = null; //timer for sustained stream success
    let streamStallTimeout = null;
    
    //frame preservation variables
    let frameCapture = {
      canvas: null,
      context: null,
      captureTimer: null,
      hasLastFrame: false,
      isUsingCanvas: false
    };
    
    //flashlight variables
    let flashlightCountdownInterval = null;
    let flashlightLastAction = 0; //timestamp of last flashlight action
    
    //password modal variables  
    let passwordCountdownInterval = null;
    
    //SSE variables
    let sseReconnectTimer = null;
    
    //general app variables
    let isFullscreen = false;
    let eventSource = null;
    let motionEvents = [];
    let motionNotificationCount = 0;
    let notificationsEnabled = true;
    let currentCamera = 'coop1'; //track current camera source
    const MAX_RETRY_COUNT = 10;
    const RETRY_DELAY = 2000; // Start with 2 seconds
    const MAX_MOTION_EVENTS = 50;
    
    //secure DOM utility functions to prevent XSS attacks
    const DOMUtils = {
      //safely escape HTML text content
      escapeHtml: function(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      },
      
      //safely set text content
      setText: function(element, text) {
        if (!element) return;
        element.textContent = text || '';
      },
      
      //safely create element with text content
      createElement: function(tag, textContent, className) {
        const element = document.createElement(tag);
        if (textContent) element.textContent = textContent;
        if (className) element.className = className;
        return element;
      },
      
      //safely set innerHTML with known safe static content only
      setSafeHTML: function(element, html) {
        if (!element) return;
        //only allow if html contains no user data placeholders
        if (html.includes('${') || html.includes('{{')) {
          console.error('DOMUtils.setSafeHTML: Template literals detected - use safe alternatives');
          return;
        }
        element.innerHTML = html;
      },
      
      //safely create structured content with escaped user data
      createSafeElement: function(config) {
        const { tag = 'div', className, children = [], textContent, attributes = {} } = config;
        const element = document.createElement(tag);
        
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        
        //set safe attributes (escape values)
        Object.entries(attributes).forEach(([key, value]) => {
          if (key.startsWith('on')) {
            console.error('DOMUtils: Event handlers in attributes not allowed');
            return;
          }
          element.setAttribute(key, String(value));
        });
        
        //append children safely
        children.forEach(child => {
          if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
          } else if (child instanceof HTMLElement) {
            element.appendChild(child);
          }
        });
        
        return element;
      },
      
      //safely replace element content with new elements
      replaceContent: function(container, elements) {
        if (!container) return;
        //clear existing content
        container.innerHTML = '';
        //append safe elements
        elements.forEach(element => {
          if (element instanceof HTMLElement) {
            container.appendChild(element);
          }
        });
      }
    };
    
    //frame preservation system for keeping last frame during stream issues
    const FramePreservation = {
      //initialize canvas for frame capture
      init() {
        frameCapture.canvas = document.getElementById('streamCanvas');
        if (frameCapture.canvas) {
          frameCapture.context = frameCapture.canvas.getContext('2d');
          console.log('[FramePreservation] Canvas initialized for frame capture');
        }
      },
      
      //capture current frame from stream image to canvas
      captureFrame() {
        const streamImg = document.getElementById('stream');
        if (!streamImg || !frameCapture.canvas || !frameCapture.context) return false;
        
        //only capture if stream is visible and loaded
        if (streamImg.style.display === 'none' || !streamImg.complete || streamImg.naturalWidth === 0) {
          return false;
        }
        
        try {
          //set canvas size to match image
          frameCapture.canvas.width = streamImg.naturalWidth;
          frameCapture.canvas.height = streamImg.naturalHeight;
          
          //draw current frame to canvas
          frameCapture.context.drawImage(streamImg, 0, 0);
          frameCapture.hasLastFrame = true;
          
          console.log('[FramePreservation] Frame captured to canvas');
          return true;
        } catch (error) {
          console.error('[FramePreservation] Failed to capture frame:', error);
          return false;
        }
      },
      
      //start periodic frame capture when stream is working
      startCapture() {
        this.stopCapture(); //clear any existing timer
        
        frameCapture.captureTimer = TimerManager.setInterval(() => {
          this.captureFrame();
        }, 2000, 'frameCapture'); //capture every 2 seconds
        
        console.log('[FramePreservation] Started periodic frame capture');
      },
      
      //stop frame capture
      stopCapture() {
        if (frameCapture.captureTimer) {
          TimerManager.clearInterval(frameCapture.captureTimer);
          frameCapture.captureTimer = null;
          console.log('[FramePreservation] Stopped frame capture');
        }
      },
      
      //show preserved frame when stream fails
      showPreservedFrame() {
        const streamImg = document.getElementById('stream');
        
        if (!frameCapture.hasLastFrame || !frameCapture.canvas) {
          console.log('[FramePreservation] No preserved frame available');
          return false;
        }
        
        //hide stream image and show canvas
        if (streamImg) streamImg.style.display = 'none';
        frameCapture.canvas.style.display = 'block';
        frameCapture.isUsingCanvas = true;
        
        console.log('[FramePreservation] Showing preserved frame on canvas');
        return true;
      },
      
      //restore stream image when connection recovered
      restoreStream() {
        const streamImg = document.getElementById('stream');
        
        //show stream image and hide canvas
        if (streamImg) streamImg.style.display = 'block';
        if (frameCapture.canvas) frameCapture.canvas.style.display = 'none';
        frameCapture.isUsingCanvas = false;
        
        console.log('[FramePreservation] Restored stream image');
      },
      
      //cleanup frame preservation
      cleanup() {
        this.stopCapture();
        frameCapture.hasLastFrame = false;
        frameCapture.isUsingCanvas = false;
      }
    };
    
    //FAB toggle function
    function toggleFAB() {
      const fabMenu = document.getElementById('fabMenu');
      const fabOverlay = document.querySelector('.fab-overlay');
      const fabButton = document.getElementById('fabButton');
      
      if (fabMenu && fabMenu.classList.contains('show')) {
        fabMenu.classList.remove('show');
        if (fabOverlay) fabOverlay.classList.remove('show');
        if (fabButton) {
          const plusSvg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>';
          DOMUtils.setSafeHTML(fabButton, plusSvg);
        }
      } else if (fabMenu) {
        fabMenu.classList.add('show');
        if (fabOverlay) fabOverlay.classList.add('show');
        if (fabButton) {
          const closeSvg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';
          DOMUtils.setSafeHTML(fabButton, closeSvg);
        }
      }
    }
    
    //camera switching function
    function switchCamera(cameraId) {
      if (currentCamera === cameraId) return; //already on this camera
      
      //stop frame capture for old camera
      FramePreservation.stopCapture();
      
      //show loading state during camera switch
      showSwitchingLoader(cameraId);
      
      currentCamera = cameraId;
      
      //update stream source
      const streamImg = document.getElementById('stream');
      if (streamImg) {
        const streamUrl = `/api/stream/${cameraId}`;
        streamImg.src = `${streamUrl}?t=${Date.now()}`;
      }
      
      //update button active states
      updateActiveButton(cameraId);
      
      //reset retry count for new stream and clear sustained success timer
      streamRetryCount = 0;
      if (streamSustainedSuccessTimeout) {
        TimerManager.clearTimeout(streamSustainedSuccessTimeout);
        streamSustainedSuccessTimeout = null;
      }
      
      //clear old frame data - new camera will have different content
      frameCapture.hasLastFrame = false;
    }
    
    //update active button styling
    function updateActiveButton(activeCameraId) {
      //remove active class from all camera buttons
      document.querySelectorAll('.retro-section-interactive').forEach(btn => {
        btn.classList.remove('retro-section-active');
      });
      
      //add active class to current button (shadow bar only)
      const activeBtn = document.getElementById(
        activeCameraId === 'coop1' ? 'cameraBtn1' : 'cameraBtn2'
      );
      if (activeBtn) {
        activeBtn.classList.add('retro-section-active');
      }
    }
    
    //context menu functions
    function shareStream() {
      hideContextMenu();
      if (navigator.share) {
        navigator.share({
          title: 'Alexis Family Coop Live Stream',
          text: 'Check out our chicken coop live stream!',
          url: window.location.href
        }).catch(err => console.log('Share cancelled'));
      } else {
        navigator.clipboard.writeText(window.location.href);
        alert('Link copied to clipboard!');
      }
    }
    
    function saveSnapshot() {
      hideContextMenu();
      const stream = document.getElementById('stream');
      const canvas = document.createElement('canvas');
      canvas.width = stream.naturalWidth || stream.width;
      canvas.height = stream.naturalHeight || stream.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(stream, 0, 0);
      
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `coop-snapshot-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.9);
    }
    
    function reportIssue() {
      hideContextMenu();
      window.location.href = 'https://github.com/Sebastian-Alexis/Coop-Cam/issues/new';
    }
    
    function showContextMenu(x, y) {
      const menu = document.getElementById('contextMenu');
      if (!menu) return;
      
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 10}px`;
      }
      
      menu.classList.add('show');
    }
    
    function hideContextMenu() {
      const menu = document.getElementById('contextMenu');
      if (menu) menu.classList.remove('show');
    }
    
    //mobile navigation toggle
    function toggleMobileNav() {
      const drawer = document.getElementById('mobileNavDrawer');
      const backdrop = document.getElementById('mobileNavBackdrop');
      
      if (drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        backdrop.classList.remove('show');
      } else {
        drawer.classList.add('open');
        backdrop.classList.add('show');
      }
    }
    
    //control panel toggle for mobile
    function toggleControlPanel() {
      const content = document.getElementById('controlPanelContent');
      const header = document.querySelector('.collapsible-header');
      
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        header.classList.remove('collapsed');
      } else {
        content.classList.add('collapsed');
        header.classList.add('collapsed');
      }
    }
    
    //check pause status on page load
    async function checkPauseStatus() {
      try {
        const response = await fetch(`/api/stream/${currentCamera}/status`);
        const data = await response.json();
        updatePauseButton(data.isPaused, data.remainingSeconds);
      } catch (error) {
        console.error('Failed to check stream status:', error);
      }
    }
    
    //update pause button based on status
    function updatePauseButton(isPaused, remainingSeconds) {
      const btn = document.getElementById('pauseBtn');
      const btnText = document.getElementById('pauseBtnText');
      
      if (isPaused && remainingSeconds > 0) {
        btn.disabled = true;
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        btnText.textContent = `Paused (${minutes}:${seconds.toString().padStart(2, '0')})`;
      } else {
        btn.disabled = false;
        btnText.textContent = 'Pause Stream';
      }
    }
    
    //secure pause stream function
    function pauseStream() {
      //show password modal instead of prompt
      const modal = document.getElementById('passwordModal');
      const passwordInput = document.getElementById('passwordInput');
      
      //clear previous input and show modal
      passwordInput.value = '';
      modal.showModal();
      
      //focus password input for better UX
      TimerManager.setTimeout(() => passwordInput.focus(), 100, 'passwordInputFocus');
    }
    
    //handle password modal close
    function closePasswordModal() {
      const modal = document.getElementById('passwordModal');
      const passwordInput = document.getElementById('passwordInput');
      const submitBtn = document.getElementById('passwordSubmitBtn');
      const submitText = document.getElementById('passwordSubmitText');
      
      //reset modal state
      passwordInput.value = '';
      submitBtn.disabled = false;
      submitText.textContent = 'Pause Stream';
      
      modal.close();
    }
    
    //handle secure password submission
    async function handlePasswordSubmit(password) {
      const submitBtn = document.getElementById('passwordSubmitBtn');
      const submitText = document.getElementById('passwordSubmitText');
      const btn = document.getElementById('pauseBtn');
      const btnText = document.getElementById('pauseBtnText');
      
      //show loading state
      submitBtn.disabled = true;
      submitText.textContent = 'Authenticating...';
      
      try {
        const response = await fetch(`/api/stream/${currentCamera}/pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          //close modal and show success
          closePasswordModal();
          
          //show success message
          const successToast = DOMUtils.createElement('div', null, 'toast toast-top toast-center');
          const alert = DOMUtils.createElement('div', null, 'alert alert-success');
          const message = DOMUtils.createElement('span', 'Stream paused for 5 minutes');
          
          alert.appendChild(message);
          successToast.appendChild(alert);
          document.body.appendChild(successToast);
          TimerManager.scheduleErrorCleanup(successToast, 3000);
          
          //start countdown for pause button
          let remainingSeconds = 300;
          updatePauseButton(true, remainingSeconds);
          
          //clear any existing password countdown
          if (passwordCountdownInterval) {
            TimerManager.clearInterval(passwordCountdownInterval);
          }
          
          passwordCountdownInterval = TimerManager.setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds <= 0) {
              TimerManager.clearInterval(passwordCountdownInterval);
              passwordCountdownInterval = null;
              updatePauseButton(false, 0);
            } else {
              updatePauseButton(true, remainingSeconds);
            }
          }, 1000, 'passwordCountdown');
        } else {
          //show error in modal
          submitBtn.disabled = false;
          submitText.textContent = 'Try Again';
          
          //show error message
          const errorDiv = document.createElement('div');
          errorDiv.className = 'text-error text-sm mt-2';
          errorDiv.textContent = data.message || 'Invalid password';
          
          const form = document.getElementById('passwordForm');
          const existingError = form.querySelector('.text-error');
          if (existingError) existingError.remove();
          form.appendChild(errorDiv);
          
          //clear error after 3 seconds
          TimerManager.scheduleErrorCleanup(errorDiv, 3000);
        }
      } catch (error) {
        //show network error
        submitBtn.disabled = false;
        submitText.textContent = 'Try Again';
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'text-error text-sm mt-2';
        errorDiv.textContent = 'Network error: Please try again';
        
        const form = document.getElementById('passwordForm');
        const existingError = form.querySelector('.text-error');
        if (existingError) existingError.remove();
        form.appendChild(errorDiv);
        
        TimerManager.scheduleErrorCleanup(errorDiv, 3000);
      }
    }
    
    //debug stream status
    function handleStreamError() {
      console.error('Stream error detected');
      const hadFrames = streamLoadTime !== null; //check if we had frames before
      streamLoadTime = null;
      
      //if we had frames before, keep last frame visible during reconnection
      if (hadFrames) {
        showUnifiedLoader('Connection lost...', false, true);
      } else {
        //initial connection failure - no last frame to show
        showUnifiedLoader('Connection lost...');
      }
    }
    
    function handleStreamLoad() {
      const isFirstLoad = !streamLoadTime;
      
      if (isFirstLoad) {
        streamLoadTime = Date.now();
        console.log('Stream started loading');
        //start frame capture now that stream is working
        FramePreservation.startCapture();
      }
      
      //ALWAYS hide loading overlays on every successful frame load (fixes buffering overlay persistence)
      hideAllLoaders();
      const stream = document.getElementById('stream');
      const container = document.getElementById('videoContainer');
      
      if (stream) stream.style.display = 'block';
      if (container) container.classList.remove('stream-loading');
      
      frameCount++;
      if (frameCount % 30 === 0) {
        console.log(`Stream active - ${frameCount} frames loaded`);
      }
      
      //don't immediately reset retry count - wait for sustained success
    }
    
    //expose handleStreamLoad globally for HTML onload handler
    window.handleStreamLoad = handleStreamLoad;

    //stall detection variables - using the centrally managed variable
    const STALL_TIMEOUT_MS = 3000; //3 seconds

    //reset stall detection timer
    function resetStallDetection() {
      if (streamStallTimeout) {
        TimerManager.clearTimeout(streamStallTimeout);
      }
      streamStallTimeout = TimerManager.setTimeout(() => {
        console.log('[Stream] Stall detected - no frames for 3 seconds, reconnecting...');
        //show buffering overlay while keeping last frame during stall
        showUnifiedLoader('Stream stalled, reconnecting...', false, true);
        //trigger reconnection by forcing onerror
        const streamImg = document.getElementById('stream');
        if (streamImg && streamImg.onerror) {
          streamImg.onerror();
        }
      }, STALL_TIMEOUT_MS, 'streamStall');
    }

    //unified loading system - consolidates streamLoader and backpressureOverlay
    function showUnifiedLoader(message = 'Connecting to stream...', isBackpressure = false, keepLastFrame = false) {
      const loader = document.getElementById('streamLoader');
      const backpressureOverlay = document.getElementById('backpressureOverlay');
      const stream = document.getElementById('stream');
      const container = document.getElementById('videoContainer');
      
      //hide backpressure overlay always
      if (backpressureOverlay) {
        backpressureOverlay.classList.remove('show');
      }
      
      if (isBackpressure || keepLastFrame) {
        //for backpressure or buffering: show overlay but keep last frame visible
        if (backpressureOverlay) {
          //update overlay message
          const overlayText = backpressureOverlay.querySelector('.backpressure-text');
          if (overlayText) {
            DOMUtils.setText(overlayText, message);
          }
          backpressureOverlay.classList.add('show');
          console.log('[Stream] Showing buffering overlay while keeping last frame:', message);
        }
        
        //try to show preserved frame if stream is broken, otherwise keep current stream
        if (keepLastFrame && frameCapture.hasLastFrame) {
          //if stream is working, keep it; if broken, show preserved frame
          const streamWorking = stream && stream.complete && stream.naturalWidth > 0;
          if (!streamWorking) {
            FramePreservation.showPreservedFrame();
          } else {
            //stream is working, keep it visible
            if (stream) stream.style.display = 'block';
            if (frameCapture.canvas) frameCapture.canvas.style.display = 'none';
          }
        } else {
          //no preserved frame available, keep current stream visible
          if (stream) stream.style.display = 'block';
        }
        
        if (container) container.classList.remove('stream-loading');
        //hide the full loader since we're using overlay
        if (loader) loader.style.display = 'none';
      } else {
        //for initial connection or genuine failure: show full loader and hide stream
        if (stream) stream.style.display = 'none';
        if (container) container.classList.add('stream-loading');
        
        if (loader) {
          const loaderContainer = DOMUtils.createElement('div', null, 'flex flex-col items-center gap-4');
          const spinner = DOMUtils.createElement('span', null, 'loading loading-spinner loading-lg');
          const messageEl = DOMUtils.createElement('p', message, 'text-sm text-base-content/60');
          
          loaderContainer.appendChild(spinner);
          loaderContainer.appendChild(messageEl);
          DOMUtils.replaceContent(loader, [loaderContainer]);
          loader.style.display = 'flex';
          console.log('[Stream] Showing unified loader:', message);
        }
      }
    }
    
    function hideAllLoaders() {
      const loader = document.getElementById('streamLoader');
      const backpressureOverlay = document.getElementById('backpressureOverlay');
      
      if (loader) loader.style.display = 'none';
      if (backpressureOverlay) {
        const wasShowing = backpressureOverlay.classList.contains('show');
        backpressureOverlay.classList.remove('show');
        if (wasShowing) {
          console.log('[Stream] Cleared buffering overlay');
        }
      }
      
      //restore stream image if we were using canvas
      if (frameCapture.isUsingCanvas) {
        FramePreservation.restoreStream();
      }
      
      console.log('[Stream] Hiding all loading overlays');
    }
    
    function showSwitchingLoader(newCameraId) {
      const cameraNames = { 'coop1': 'Coop Enclosure', 'coop2': 'Inside Coop' };
      const cameraName = cameraNames[newCameraId] || newCameraId;
      //keep last frame during camera switch to avoid jarring transition
      showUnifiedLoader(`Switching to ${cameraName}...`, false, true);
    }
    
    //legacy functions for backward compatibility
    function showBackpressureOverlay() {
      showUnifiedLoader('Buffering stream...', true, true);
    }
    
    function hideBackpressureOverlay() {
      const overlay = document.getElementById('backpressureOverlay');
      if (overlay) {
        overlay.classList.remove('show');
      }
    }

    //detect if error is likely backpressure vs genuine connection failure
    function isLikelyBackpressure() {
      //improved heuristics for backpressure detection:
      //1. more lenient retry threshold (< 15 retries suggests temporary issues)
      //2. longer recent frames window (had been working in last 5 minutes)
      //3. not in sustained error state
      //4. consider frame count as health indicator
      
      const hasRecentFrames = streamLoadTime && (Date.now() - streamLoadTime) < 300000; //had frames in last 5 minutes (was 60s)
      const reasonableRetries = streamRetryCount < 15; //more lenient (was 5)
      const notMaxedOut = streamRetryCount < MAX_RETRY_COUNT;
      const hadSomeFrames = frameCount > 10; //had received some frames indicating working connection
      
      //if we've had recent frames OR reasonable retry count, likely temporary issue
      return (hasRecentFrames || hadSomeFrames) && reasonableRetries && notMaxedOut;
    }

    //auto-reconnect stream on error
    function setupStreamReconnection() {
      const streamImg = document.getElementById('stream');
      
      streamImg.onerror = function() {
        console.log('Stream connection lost, attempting to reconnect...');
        
        //clear stall detection timer
        if (streamStallTimeout) {
          TimerManager.clearTimeout(streamStallTimeout);
          streamStallTimeout = null;
        }
        
        if (streamReconnectTimeout) {
          TimerManager.clearTimeout(streamReconnectTimeout);
        }
        
        //determine if this is likely backpressure or a genuine connection failure
        const likelyBackpressure = isLikelyBackpressure();
        
        if (streamRetryCount < MAX_RETRY_COUNT) {
          streamRetryCount++;
          const delay = RETRY_DELAY * Math.min(streamRetryCount, 5); // Cap at 10 seconds
          
          if (likelyBackpressure) {
            //for backpressure: show overlay but keep stream visible with last frame
            console.log('[Stream] Detected likely backpressure - showing buffering overlay with last frame');
            showUnifiedLoader('Buffering stream...', true, true);
          } else {
            //for genuine connection issues: show full loader
            console.log('[Stream] Detected connection failure - showing full loader');
            showUnifiedLoader(`Reconnecting... (${streamRetryCount}/${MAX_RETRY_COUNT})`);
          }
          
          streamReconnectTimeout = TimerManager.setTimeout(() => {
            console.log(`Reconnecting stream (attempt ${streamRetryCount}/${MAX_RETRY_COUNT})...`);
            // Force reload by adding timestamp
            streamImg.src = `/api/stream/${currentCamera}?t=${Date.now()}`;
          }, delay, 'streamReconnect');
        } else {
          console.error('Max reconnection attempts reached');
          // Show reconnect button after max attempts
          showReconnectButton();
        }
      };
      
      streamImg.onload = function() {
        // Call the original handler to show the stream
        handleStreamLoad();
        
        // Reset stall detection timer on each frame
        resetStallDetection();
        
        // Only reset retry count after sustained success (30 seconds)
        if (streamRetryCount > 0) {
          console.log('Stream reconnecting - waiting for sustained success...');
          
          //clear any existing sustained success timer
          if (streamSustainedSuccessTimeout) {
            TimerManager.clearTimeout(streamSustainedSuccessTimeout);
          }
          
          //set timer to reset retry count after 30 seconds of stable streaming
          streamSustainedSuccessTimeout = TimerManager.setTimeout(() => {
            console.log('Stream stable for 30 seconds - resetting retry count');
            streamRetryCount = 0;
            streamSustainedSuccessTimeout = null;
          }, 30000, 'streamSustainedSuccess'); //30 seconds
        }
      };
      
      // Start initial stall detection
      resetStallDetection();
    }

    //show manual reconnect button
    function showReconnectButton() {
      const loader = document.getElementById('streamLoader');
      
      if (loader) {
        //create safe reconnect button elements
        const container = DOMUtils.createElement('div', null, 'flex flex-col items-center gap-4 p-8');
        
        const errorIcon = DOMUtils.createElement('div');
        const errorSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-16 h-16 text-error">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>`;
        DOMUtils.setSafeHTML(errorIcon, errorSvg);
        
        const errorText = DOMUtils.createElement('p', 'Stream connection lost', 'text-error text-center');
        const reconnectBtn = DOMUtils.createElement('button', null, 'btn btn-primary touch-target');
        reconnectBtn.addEventListener('click', manualReconnect);
        
        const btnIcon = DOMUtils.createElement('span');
        const btnSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>`;
        DOMUtils.setSafeHTML(btnIcon, btnSvg);
        
        const btnText = document.createTextNode('Reconnect');
        reconnectBtn.appendChild(btnIcon);
        reconnectBtn.appendChild(btnText);
        
        container.appendChild(errorIcon);
        container.appendChild(errorText);
        container.appendChild(reconnectBtn);
        
        DOMUtils.replaceContent(loader, [container]);
        loader.style.display = 'flex';
      }
    }

    //manual reconnect
    function manualReconnect() {
      const loader = document.getElementById('streamLoader');
      if (loader) {
        //create safe manual reconnect loader
        const container = DOMUtils.createElement('div', null, 'flex flex-col items-center gap-4');
        const spinner = DOMUtils.createElement('span', null, 'loading loading-spinner loading-lg');
        const message = DOMUtils.createElement('p', 'Reconnecting...', 'text-sm text-base-content/60');
        
        container.appendChild(spinner);
        container.appendChild(message);
        DOMUtils.replaceContent(loader, [container]);
      }
      streamRetryCount = 0;
      //clear sustained success timer on manual reconnect
      if (streamSustainedSuccessTimeout) {
        TimerManager.clearTimeout(streamSustainedSuccessTimeout);
        streamSustainedSuccessTimeout = null;
      }
      const streamImg = document.getElementById('stream');
      streamImg.src = `/api/stream/${currentCamera}?t=${Date.now()}`;
    }

    //check flashlight status from server
    async function checkFlashlightStatus() {
      try {
        //smart polling: reduce checks when no recent flashlight actions (performance optimization)
        const timeSinceAction = Date.now() - flashlightLastAction;
        if (timeSinceAction > 10 * 60 * 1000) {
          //only check every 4th cycle when no recent activity (reduce API calls by 75%)
          const checkCycle = Math.floor(Date.now() / intervals.flashlight);
          if (checkCycle % 4 !== 0) {
            return; // Skip this check - no recent flashlight activity
          }
        }
        
        //use request queue on mobile
        const response = isMobile 
          ? await requestQueue.fetch('/api/flashlight/status', {}, { priority: 0 })
          : await fetch('/api/flashlight/status');
          
        const data = await response.json();
        
        //only restart countdown if flashlight is on
        //this syncs with server state to prevent drift
        if (data.isOn && flashlightCountdownInterval) {
          //countdown is already running, just sync the time
          startCountdown(data.remainingSeconds);
        } else {
          //normal UI update
          updateFlashlightUI(data.isOn, data.remainingSeconds);
        }
      } catch (error) {
        console.error('Failed to check flashlight status:', error);
      }
    }

    //update UI based on flashlight state
    function updateFlashlightUI(isOn, remainingSeconds) {
      //flashlight UI elements no longer exist (Inside Coop is now static text)
      //preserve timer functionality for potential future use
      const timerText = document.getElementById('timerText');
      
      //update overlay UI
      updateOverlayFlashlightUI(isOn, remainingSeconds);
      
      if (isOn) {        
        //update timer for screen readers (if timer element exists)
        if (timerText) {
          timerText.classList.remove('opacity-60');
          timerText.classList.add('text-success', 'font-bold');
        }
        
        //start smooth countdown
        startCountdown(remainingSeconds);
      } else {
        //stop countdown if running
        if (flashlightCountdownInterval) {
          TimerManager.clearInterval(flashlightCountdownInterval);
          flashlightCountdownInterval = null;
        }
        
        //reset timer for screen readers (if timer element exists)
        if (timerText) {
          timerText.classList.add('opacity-60');
          timerText.classList.remove('text-success', 'font-bold');
          timerText.textContent = '5:00';
        }
      }
    }

    //update timer display
    function updateTimerDisplay(remainingSeconds) {
      const timerText = document.getElementById('timerText');
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = Math.floor(remainingSeconds % 60);
      
      //update legacy timer if it exists
      if (timerText) {
        timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      
      //update overlay timer
      updateOverlayTimerDisplay(remainingSeconds);
    }

    //update overlay flashlight UI
    function updateOverlayFlashlightUI(isOn, remainingSeconds) {
      const button = document.getElementById('streamFlashlightBtn');
      const timerText = document.getElementById('overlayTimerText');
      
      if (!button || !timerText) return;
      
      if (isOn && remainingSeconds > 0) {
        //show timer and activate button
        button.classList.add('timer-active', 'flashlight-on');
        button.title = `Flashlight on (${Math.floor(remainingSeconds / 60)}:${(remainingSeconds % 60).toString().padStart(2, '0')} remaining)`;
        timerText.classList.remove('hidden');
        updateOverlayTimerDisplay(remainingSeconds);
      } else {
        //hide timer and deactivate button
        button.classList.remove('timer-active', 'flashlight-on');
        button.title = 'Turn on flashlight (5 min auto-off)';
        timerText.classList.add('hidden');
      }
    }
    
    //update overlay timer display
    function updateOverlayTimerDisplay(remainingSeconds) {
      const timerText = document.getElementById('overlayTimerText');
      if (!timerText) return;
      
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    //start countdown timer for smooth display updates
    function startCountdown(initialSeconds) {
      //clear any existing countdown
      if (flashlightCountdownInterval) {
        TimerManager.clearInterval(flashlightCountdownInterval);
      }
      
      let remainingSeconds = initialSeconds;
      
      //update immediately
      updateTimerDisplay(remainingSeconds);
      
      //update every second
      flashlightCountdownInterval = TimerManager.setInterval(() => {
        remainingSeconds--;
        
        if (remainingSeconds <= 0) {
          TimerManager.clearInterval(flashlightCountdownInterval);
          flashlightCountdownInterval = null;
          //timer expired, UI will update on next server poll
          remainingSeconds = 0;
        }
        
        updateTimerDisplay(remainingSeconds);
      }, 1000, 'flashlightCountdown');
    }

    //toggle flashlight
    async function toggleFlashlight() {
      //track flashlight action for smart polling optimization
      flashlightLastAction = Date.now();
      
      //flashlight UI elements no longer exist (Inside Coop is now static text)
      //preserve functionality but skip UI updates since button is removed
      console.log('toggleFlashlight called but UI elements no longer exist');
      
      try {
        const response = await fetch('/api/flashlight/on', {
          method: 'PUT',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          //update UI with server state (will handle missing elements gracefully)
          updateFlashlightUI(data.isOn, data.remainingSeconds);
          console.log('Flashlight turned on successfully');
        } else {
          console.error('Failed to turn on flashlight:', data.message || 'Unknown error');
          alert(`Failed to turn on flashlight: ${data.message || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Failed to toggle flashlight:', error);
        alert(`Network error: ${error.message}`);
      }
    }

    //update time
    function updateTime() {
      const now = new Date();
      
      //get PST time - fixed to use proper timezone formatting
      const pstStr = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false,
        timeZone: 'America/Los_Angeles'
      });
      
      //update retro display with "HH:MM:SS pst" format
      document.getElementById('currentTime').textContent = `${pstStr} pst`;
      
      //update legacy localTime element if it exists (for backward compatibility)
      const localTimeElement = document.getElementById('localTime');
      if (localTimeElement) {
        //get user's local time
        const localStr = now.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          hour12: false
        });
        
        //get user's timezone abbreviation
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const tzAbbr = now.toLocaleTimeString('en-US', {
          timeZoneName: 'short',
          timeZone: userTimezone
        }).split(' ').pop();
        
        localTimeElement.textContent = `Your time: ${localStr} ${tzAbbr}`;
      }
    }

    //handle stats update from batch or individual call
    function handleStatsUpdate(data) {
      const count = data.clientCount || 0;
      const viewerCountElement = document.getElementById('viewerCount');
      if (viewerCountElement) {
        viewerCountElement.textContent = count;
      }
    }
    
    //update viewer count
    async function updateStats() {
      try {
        //use request queue on mobile
        const response = isMobile 
          ? await requestQueue.fetch('/api/stats', {}, { priority: 0 })
          : await fetch('/api/stats');
          
        const data = await response.json();
        handleStatsUpdate(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    }

    //handle stream status update
    function handleStreamStatusUpdate(data) {
      if (data.isPaused) {
        //update pause UI if needed
        const remainingMs = data.remainingMs || 0;
        if (remainingMs > 0) {
          //stream is paused, update UI accordingly
          console.log(`[Stream] Paused, ${Math.ceil(remainingMs / 1000)}s remaining`);
        }
      }
    }
    
    //handle flashlight status update
    function handleFlashlightStatusUpdate(data) {
      const btn = document.getElementById('flashlightBtn');
      if (!btn) return;
      
      if (data.isOn) {
        //create safe flashlight on button
        const svgIcon = DOMUtils.createElement('span');
        const onSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>`;
        DOMUtils.setSafeHTML(svgIcon, onSvg);
        
        const desktopText = DOMUtils.createElement('span', 'Flashlight On', 'mobile-hide');
        const mobileText = DOMUtils.createElement('span', 'On', 'mobile-only');
        
        DOMUtils.replaceContent(btn, [svgIcon, desktopText, mobileText]);
        btn.classList.add('btn-warning');
        btn.classList.remove('btn-ghost');
      } else {
        //create safe flashlight off button
        const svgIcon = DOMUtils.createElement('span');
        const offSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>`;
        DOMUtils.setSafeHTML(svgIcon, offSvg);
        
        const desktopText = DOMUtils.createElement('span', 'Turn on Flashlight', 'mobile-hide');
        const mobileText = DOMUtils.createElement('span', 'Flashlight', 'mobile-only');
        
        DOMUtils.replaceContent(btn, [svgIcon, desktopText, mobileText]);
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-ghost');
      }
    }
    
    //handle weather update from batch or individual call
    function handleWeatherUpdate(result) {
        
        if (result.success && result.data) {
          const weather = result.data;
          const weatherIcon = document.getElementById('weatherIcon');
          const weatherTemp = document.getElementById('weatherTemp');
          const weatherDesc = document.getElementById('weatherDesc');
          const weatherContent = document.getElementById('weatherContent');
          
          //update retro display elements
          weatherTemp.textContent = `${weather.temperature}°`;
          weatherDesc.textContent = weather.conditions;
          
          //determine weather icon based on conditions (styled for retro design)
          let iconSvg = '';
          const conditions = weather.conditions.toLowerCase();
          
          if (conditions.includes('sunny') || conditions.includes('clear')) {
            //sun icon with retro styling
            iconSvg = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="24" cy="24" r="8" stroke="#8C3F27" stroke-width="4" fill="none"/>
              <path d="M24 4V8M24 40V44M44 24H40M8 24H4M36.4 11.6L33.6 14.4M14.4 33.6L11.6 36.4M36.4 36.4L33.6 33.6M14.4 14.4L11.6 11.6" stroke="#8C3F27" stroke-width="4" stroke-linecap="round"/>
            </svg>`;
          } else if (conditions.includes('rain') || conditions.includes('shower') || conditions.includes('drizzle')) {
            //rain icon with retro styling
            iconSvg = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M38 18C37.7 12.6 33.2 8 28 8C24.5 8 21.5 10.1 20 13.2C18.9 12.4 17.5 12 16 12C12.7 12 10 14.7 10 18C6.7 18 4 20.7 4 24C4 27.3 6.7 30 10 30H36C39.3 30 42 27.3 42 24C42 21.8 40.9 19.8 39.2 18.6L38 18Z" 
                    stroke="#8C3F27" stroke-width="4" fill="none"/>
              <path d="M16 32V38M20 34V40M24 32V38M28 34V40M32 32V38" stroke="#8C3F27" stroke-width="4" stroke-linecap="round"/>
            </svg>`;
          } else if (conditions.includes('storm')) {
            //storm icon with retro styling
            iconSvg = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M38 18C37.7 12.6 33.2 8 28 8C24.5 8 21.5 10.1 20 13.2C18.9 12.4 17.5 12 16 12C12.7 12 10 14.7 10 18C6.7 18 4 20.7 4 24C4 27.3 6.7 30 10 30H36C39.3 30 42 27.3 42 24C42 21.8 40.9 19.8 39.2 18.6L38 18Z" 
                    stroke="#8C3F27" stroke-width="4" fill="none"/>
              <path d="M20 30L16 42L20 36H28L24 44" stroke="#8C3F27" stroke-width="4" stroke-linejoin="round" fill="none"/>
            </svg>`;
          } else {
            //default cloud icon with retro styling (matches Figma design)
            iconSvg = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M38 18C37.7 12.6 33.2 8 28 8C24.5 8 21.5 10.1 20 13.2C18.9 12.4 17.5 12 16 12C12.7 12 10 14.7 10 18C6.7 18 4 20.7 4 24C4 27.3 6.7 30 10 30H36C39.3 30 42 27.3 42 24C42 21.8 40.9 19.8 39.2 18.6L38 18Z" 
                    stroke="#8C3F27" stroke-width="4" fill="none"/>
            </svg>`;
          }
          
          //update weather icon (safe static SVG)
          DOMUtils.setSafeHTML(weatherIcon, iconSvg);
          
          //update legacy weatherContent for backward compatibility (hidden)
          if (weatherContent) {
            //create safe elements with escaped user data
            const tempElement = DOMUtils.createElement('div', `${DOMUtils.escapeHtml(weather.temperature)}°${DOMUtils.escapeHtml(weather.temperatureUnit)}`, 'font-semibold');
            const conditionsElement = DOMUtils.createElement('div', DOMUtils.escapeHtml(weather.conditions), 'text-sm text-base-content/70');
            const wrapper = DOMUtils.createElement('div');
            wrapper.appendChild(tempElement);
            wrapper.appendChild(conditionsElement);
            
            DOMUtils.replaceContent(weatherContent, [wrapper]);
          }
          
          //add title attribute for detailed forecast on hover
          const weatherSection = weatherIcon.closest('.retro-section');
          if (weatherSection) {
            weatherSection.title = weather.detailedForecast;
          }
        } else {
          //show error state
          const weatherIcon = document.getElementById('weatherIcon');
          const weatherTemp = document.getElementById('weatherTemp');
          const weatherDesc = document.getElementById('weatherDesc');
          const weatherContent = document.getElementById('weatherContent');
          
          //update retro display elements
          weatherTemp.textContent = '--°';
          weatherDesc.textContent = 'Unavailable';
          
          //error icon with retro styling (safe static SVG)
          const errorSvg = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="20" stroke="#8C3F27" stroke-width="4" fill="none"/>
            <path d="M24 16V24M24 32H24.01" stroke="#8C3F27" stroke-width="4" stroke-linecap="round"/>
          </svg>`;
          DOMUtils.setSafeHTML(weatherIcon, errorSvg);
          
          //update legacy weatherContent for backward compatibility
          if (weatherContent) {
            const tempElement = DOMUtils.createElement('div', '--°F', 'font-semibold');
            const statusElement = DOMUtils.createElement('div', 'Unavailable', 'text-sm text-base-content/70');
            const wrapper = DOMUtils.createElement('div');
            wrapper.appendChild(tempElement);
            wrapper.appendChild(statusElement);
            
            DOMUtils.replaceContent(weatherContent, [wrapper]);
          }
        }
    }
    
    //update weather
    async function updateWeather() {
      try {
        //use request queue on mobile
        const response = isMobile 
          ? await requestQueue.fetch('/api/weather', {}, { priority: 0 })
          : await fetch('/api/weather');
          
        const result = await response.json();
        handleWeatherUpdate(result);
      } catch (error) {
        console.error('Failed to fetch weather:', error);
        //show error state
        const weatherContent = document.getElementById('weatherContent');
        
        //create safe error state elements
        const errorSvg = DOMUtils.createElement('div');
        const errorIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-base-content/30">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>`;
        DOMUtils.setSafeHTML(errorSvg, errorIcon);
        
        const tempElement = DOMUtils.createElement('div', '--°F', 'font-semibold');
        const statusElement = DOMUtils.createElement('div', 'Error', 'text-sm text-base-content/70');
        const wrapper = DOMUtils.createElement('div');
        wrapper.appendChild(tempElement);
        wrapper.appendChild(statusElement);
        
        DOMUtils.replaceContent(weatherContent, [errorSvg, wrapper]);
      }
    }

    //format duration in seconds to mm:ss
    function formatDuration(seconds) {
      if (!seconds) return '--:--';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    //format timestamp to readable format
    function formatTimestamp(timestamp) {
      if (!timestamp) return 'Unknown time';
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    //format timestamp to date/time title for recordings
    function formatRecordingTitle(timestamp) {
      if (!timestamp) return { pst: 'Recording', local: '' };
      const date = new Date(timestamp);
      
      //format PST time
      const pstDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
      });
      const pstTime = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles'
      });
      const pstTz = date.toLocaleTimeString('en-US', {
        timeZoneName: 'short',
        timeZone: 'America/Los_Angeles'
      }).split(' ').pop();
      
      //format local time
      const localDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric'
      });
      const localTime = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const localTz = date.toLocaleTimeString('en-US', {
        timeZoneName: 'short',
        timeZone: userTimezone
      }).split(' ').pop();
      
      return {
        pst: `${pstDate} - ${pstTime} ${pstTz}`,
        local: `Your time: ${localDate} - ${localTime} ${localTz}`
      };
    }

    //safely create recording element with escaped user data
    function createSafeRecordingElement(recording) {
      const titles = formatRecordingTitle(recording.timestamp);
      
      //create main container with safe onclick
      const container = DOMUtils.createElement('div', null, 'bg-base-200 rounded-xl p-4 hover-lift cursor-pointer relative');
      container.addEventListener('click', () => {
        playRecording(DOMUtils.escapeHtml(recording.videoUrl), DOMUtils.escapeHtml(titles.pst));
      });
      
      //create video content wrapper
      const videoWrapper = DOMUtils.createElement('div', null, 'relative');
      
      //create thumbnail or placeholder
      if (recording.thumbnailUrl) {
        const thumbnail = DOMUtils.createElement('img', null, 'aspect-video w-full rounded-lg object-cover mb-3');
        thumbnail.src = DOMUtils.escapeHtml(recording.thumbnailUrl);
        thumbnail.alt = 'Recording thumbnail';
        thumbnail.onerror = function() {
          this.onerror = null;
          this.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke-width=%221.5%22 stroke=%22currentColor%22 class=%22w-6 h-6%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z%22 /%3E%3C/svg%3E';
        };
        videoWrapper.appendChild(thumbnail);
      } else {
        const placeholder = DOMUtils.createElement('div', null, 'aspect-video w-full rounded-lg bg-base-300 mb-3 flex items-center justify-center');
        const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-base-content/30">
          <path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>`;
        DOMUtils.setSafeHTML(placeholder, placeholderSvg);
        videoWrapper.appendChild(placeholder);
      }
      
      //add play button overlay
      const playOverlay = DOMUtils.createElement('div', null, 'absolute inset-0 flex items-center justify-center pointer-events-none');
      const playButton = DOMUtils.createElement('div', null, 'bg-base-100/80 rounded-full p-3 shadow-lg');
      const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8">
        <path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd" />
      </svg>`;
      DOMUtils.setSafeHTML(playButton, playIcon);
      playOverlay.appendChild(playButton);
      videoWrapper.appendChild(playOverlay);
      
      //add duration if available
      if (recording.duration) {
        const durationBadge = DOMUtils.createElement('div', formatDuration(recording.duration), 'absolute bottom-2 right-2 bg-base-100/80 px-2 py-1 rounded text-xs font-semibold');
        videoWrapper.appendChild(durationBadge);
      }
      
      container.appendChild(videoWrapper);
      
      //create reactions container
      const reactionsContainer = DOMUtils.createElement('div', null, 'reactions-container');
      reactionsContainer.setAttribute('data-filename', DOMUtils.escapeHtml(recording.filename));
      
      const flexWrapper = DOMUtils.createElement('div', null, 'flex items-start justify-between gap-2');
      const mainContent = DOMUtils.createElement('div', null, 'flex-1');
      
      //add title and time info with escaped content
      const titleElement = DOMUtils.createElement('div', titles.pst, 'font-semibold text-sm mb-1');
      const localElement = DOMUtils.createElement('div', titles.local, 'text-xs text-base-content/60');
      const timestampElement = DOMUtils.createElement('div', formatTimestamp(recording.timestamp), 'text-xs text-base-content/60 mt-1');
      
      mainContent.appendChild(titleElement);
      mainContent.appendChild(localElement);
      mainContent.appendChild(timestampElement);
      flexWrapper.appendChild(mainContent);
      reactionsContainer.appendChild(flexWrapper);
      
      //add reaction trigger button
      const reactionTrigger = DOMUtils.createElement('button', null, 'reaction-trigger absolute bottom-8 right-2');
      reactionTrigger.title = 'Add reaction';
      reactionTrigger.addEventListener('click', (event) => {
        event.stopPropagation();
        showReactionPopup(DOMUtils.escapeHtml(recording.filename));
      });
      
      const reactionImg = DOMUtils.createElement('img', null, 'reaction-trigger-img');
      reactionImg.src = '/art/reactions/add_reaction.gif';
      reactionImg.alt = 'Add reaction';
      reactionTrigger.appendChild(reactionImg);
      reactionsContainer.appendChild(reactionTrigger);
      
      //create reaction badges safely
      const reactionBadges = createSafeReactionBadges(recording);
      reactionsContainer.appendChild(reactionBadges);
      
      container.appendChild(reactionsContainer);
      return container;
    }

    //safely create reaction badges with escaped data
    function createSafeReactionBadges(recording) {
      const badgesContainer = DOMUtils.createElement('div', null, 'reaction-badges absolute -bottom-1 right-2 flex items-center gap-1');
      
      //collect all unique type+tone combinations from the summary
      const allReactionCombos = [];
      Object.entries(recording.reactions?.summary || {}).forEach(([type, toneData]) => {
        if (typeof toneData === 'object') {
          Object.entries(toneData).forEach(([tone, count]) => {
            if (count > 0) {
              allReactionCombos.push({ type, tone, count });
            }
          });
        }
      });
      
      //sort by count descending
      allReactionCombos.sort((a, b) => b.count - a.count);
      
      //check which ones are the user's reactions
      const userReactionMap = new Map();
      if (recording.reactions?.userReactions && recording.reactions.userReactions.length > 0) {
        recording.reactions.userReactions.forEach(reaction => {
          const type = typeof reaction === 'string' ? reaction : reaction.type;
          const tone = typeof reaction === 'object' ? reaction.tone : 'marshmallow';
          userReactionMap.set(`${type}-${tone}`, true);
        });
      }
      
      //create safe reaction elements
      allReactionCombos.forEach(({ type, tone, count }) => {
        const comboKey = `${type}-${tone}`;
        const isUserReaction = userReactionMap.has(comboKey);
        const imagePath = getReactionImagePath(type, tone);
        
        const reactionItem = DOMUtils.createElement('div', null, `reaction-item ${isUserReaction ? 'user-reaction' : ''}`);
        reactionItem.title = `React with ${DOMUtils.escapeHtml(type)} (${DOMUtils.escapeHtml(tone)})`;
        reactionItem.addEventListener('click', (event) => {
          event.stopPropagation();
          selectReaction(DOMUtils.escapeHtml(recording.filename), DOMUtils.escapeHtml(type), DOMUtils.escapeHtml(tone));
        });
        
        const reactionImg = DOMUtils.createElement('img', null, '');
        reactionImg.src = DOMUtils.escapeHtml(imagePath);
        reactionImg.alt = DOMUtils.escapeHtml(type);
        reactionImg.onerror = function() { 
          handleReactionImageError(this, DOMUtils.escapeHtml(type)); 
        };
        
        const countText = count > 99 ? '99+' : String(count);
        const reactionCount = DOMUtils.createElement('span', countText, 'reaction-count');
        
        reactionItem.appendChild(reactionImg);
        reactionItem.appendChild(reactionCount);
        badgesContainer.appendChild(reactionItem);
      });
      
      return badgesContainer;
    }

    //update recordings display for specific camera
    async function updateRecordings(camera = 'default') {
      try {
        const response = await fetch(`/api/recordings/recent?camera=${camera}`);
        const data = await response.json();
        
        //store reaction types and recordings data globally for use in other functions
        if (data.reactionTypes) {
          window.reactionTypes = data.reactionTypes;
        }
        if (data.chickenTones) {
          window.chickenTones = data.chickenTones;
        }
        //store camera-specific recordings data
        if (!window.lastRecordingsData) {
          window.lastRecordingsData = {};
        }
        window.lastRecordingsData[camera] = data;
        
        const container = document.getElementById(`recordingsContainer-${camera}`);
        const emptyState = document.getElementById(`recordingsEmpty-${camera}`);
        
        if (!container || !emptyState) {
          console.error(`[Recordings] Container elements not found for camera: ${camera}`);
          return;
        }
        
        if (!data.success || !data.recordings || data.recordings.length === 0) {
          //show empty state
          container.innerHTML = '';
          emptyState.classList.remove('hidden');
          return;
        }
        
        //hide empty state
        emptyState.classList.add('hidden');
        
        //render recordings safely
        const recordingElements = data.recordings.map((recording, index) => {
          return createSafeRecordingElement(recording);
        });
        DOMUtils.replaceContent(container, recordingElements);
        
      } catch (error) {
        console.error('Failed to fetch recordings:', error);
      }
      
      //after recordings are loaded, update reactions with user-specific data
      TimerManager.setTimeout(() => updateReactionsOnly(), 100, 'delayedReactionUpdate');
    }

    //update recordings for all cameras
    async function updateAllRecordings() {
      try {
        //update both coop1 and coop2 recordings
        await Promise.all([
          updateRecordings('coop1'),
          updateRecordings('coop2')
        ]);
      } catch (error) {
        console.error('Failed to update recordings for all cameras:', error);
      }
    }

    //helper function to find a recording across all cameras
    function findRecordingByFilename(filename) {
      if (!window.lastRecordingsData) return null;
      
      //search through all camera data
      for (const [camera, data] of Object.entries(window.lastRecordingsData)) {
        if (data?.recordings) {
          const recording = data.recordings.find(r => r.filename === filename);
          if (recording) {
            return recording;
          }
        }
      }
      return null;
    }

    //global variable to track current video filename for sharing
    let currentVideoFilename = null;

    //play recording in modal
    function playRecording(videoUrl, filename) {
      const modal = document.getElementById('videoModal');
      const video = document.getElementById('modalVideo');
      const title = document.getElementById('videoTitle');
      
      //set video source and title
      video.src = videoUrl;
      title.textContent = filename || 'Recording Playback';
      
      //extract filename from videoUrl for sharing
      //videoUrl format: /api/recordings/video/YYYY-MM-DD_HH-MM-SS_motion_cameraId_uniqueId.mp4
      if (videoUrl && videoUrl.includes('/api/recordings/video/')) {
        currentVideoFilename = decodeURIComponent(videoUrl.split('/').pop());
      } else {
        currentVideoFilename = null;
      }
      
      //show modal
      modal.showModal();
      
      //pause video when modal closes
      modal.addEventListener('close', () => {
        video.pause();
        video.currentTime = 0;
        currentVideoFilename = null; //clear filename when modal closes
      }, { once: true });
    }

    //share current video from modal
    window.shareCurrentVideo = function() {
      if (currentVideoFilename) {
        openShareModal(currentVideoFilename);
      } else {
        console.error('[Share] No video filename available for sharing');
        showToast('Unable to share this recording', 'error');
      }
    };

    //show reaction popup
    function showReactionPopup(filename) {
      //get the global popup
      const popup = document.getElementById('globalReactionPopup');
      
      //find the button that was clicked
      const container = document.querySelector(`.reactions-container[data-filename="${filename}"]`);
      const button = container.querySelector('.reaction-trigger');
      const buttonRect = button.getBoundingClientRect();
      
      //get current recording data and user reactions
      const recording = findRecordingByFilename(filename);
      if (!recording || !window.reactionTypes) return;
      
      //populate popup content
      const content = popup.querySelector('.reaction-popup-content');
      
      //get current tone (all reactions use the same tone now)
      const currentTone = window.globalReactionTone || 'marshmallow';
      
      //create safe popup elements
      const elements = [];
      
      //create the global tone cycler button first
      const toneButton = DOMUtils.createElement('button', null, 'tone-cycle-button');
      toneButton.title = `Change color for all reactions (currently: ${DOMUtils.escapeHtml(currentTone)})`;
      toneButton.addEventListener('click', cycleGlobalTone);
      
      const toneSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12a10 10 0 0 1 18.8-4.3M22 12a10 10 0 0 1-18.8 4.3"/>
      </svg>`;
      DOMUtils.setSafeHTML(toneButton, toneSvg);
      elements.push(toneButton);
      
      //then add all reaction buttons safely
      Object.entries(window.reactionTypes || {}).forEach(([type, imageSrc]) => {
        //check if user has this reaction with the current tone
        const isActive = recording.reactions?.userReactions?.some(r => 
          (typeof r === 'string' ? r === type : r.type === type && r.tone === currentTone)
        ) || false;
        
        //get image path based on current global tone
        const imagePath = getReactionImagePath(type, currentTone);
        
        const reactionButton = DOMUtils.createElement('button', null, `reaction-option ${isActive ? 'active' : ''}`);
        reactionButton.setAttribute('data-reaction', DOMUtils.escapeHtml(type));
        reactionButton.title = DOMUtils.escapeHtml(type);
        reactionButton.addEventListener('click', () => {
          selectReaction(DOMUtils.escapeHtml(filename), DOMUtils.escapeHtml(type));
        });
        
        const reactionImg = DOMUtils.createElement('img', null, 'reaction-option-img');
        reactionImg.src = DOMUtils.escapeHtml(imagePath);
        reactionImg.alt = DOMUtils.escapeHtml(type);
        reactionImg.onerror = function() {
          handleReactionImageError(this, DOMUtils.escapeHtml(type));
        };
        
        reactionButton.appendChild(reactionImg);
        elements.push(reactionButton);
      });
      
      DOMUtils.replaceContent(content, elements);
      
      //store current filename
      popup.dataset.currentFilename = filename;
      
      //reset any existing styles
      popup.style.position = 'fixed';
      popup.style.left = '-9999px';
      popup.style.top = '-9999px';
      
      //temporarily show popup off-screen to measure its size
      popup.classList.remove('hidden');
      popup.style.visibility = 'hidden';
      
      //force layout to get accurate dimensions
      popup.offsetHeight;
      
      //get actual popup dimensions
      const popupRect = popup.getBoundingClientRect();
      const popupHeight = popupRect.height;
      const popupWidth = popupRect.width;
      
      //position popup to the left of the button
      let left = buttonRect.left - popupWidth - 8;
      
      //center vertically with the button
      let top = buttonRect.top + (buttonRect.height / 2) - (popupHeight / 2);
      
      //check if popup would go off left edge of viewport
      if (left < 10) {
        //show to the right of button instead
        left = buttonRect.right + 8;
      }
      
      //ensure popup stays within viewport bounds
      left = Math.max(10, Math.min(left, window.innerWidth - popupWidth - 10));
      top = Math.max(10, Math.min(top, window.innerHeight - popupHeight - 10));
      
      //apply final position
      popup.style.left = left + 'px';
      popup.style.top = top + 'px';
      
      console.log('Popup positioning:', {
        buttonRect: buttonRect,
        popupWidth: popupWidth,
        popupHeight: popupHeight,
        finalLeft: left,
        finalTop: top
      });
      
      //make visible after position is set
      requestAnimationFrame(() => {
        popup.style.visibility = 'visible';
        popup.classList.add('show');
      });
      
      //add click outside handler
      TimerManager.setTimeout(() => {
        const clickHandler = (e) => {
          //don't hide if clicking on the trigger button or inside popup
          if (e.target.closest('.reaction-trigger') || e.target.closest('.reaction-popup-global')) {
            return;
          }
          hideAllPopups();
        };
        document.addEventListener('click', clickHandler);
        //store handler reference for proper cleanup
        popup._clickHandler = clickHandler;
      }, 100);
    }
    
    //hide all reaction popups
    function hideAllPopups(e) {
      //don't hide if clicking inside a popup
      if (e && e.target.closest('.reaction-popup-global')) return;
      
      const popup = document.getElementById('globalReactionPopup');
      popup.classList.remove('show');
      
      //wait for animation to complete before hiding
      TimerManager.setTimeout(() => {
        popup.classList.add('hidden');
        popup.dataset.currentFilename = '';
      }, 200);
      
      //clean up stored click handler
      if (popup._clickHandler) {
        document.removeEventListener('click', popup._clickHandler);
        delete popup._clickHandler;
      }
      
    }
    
    //select a reaction from the popup
    async function selectReaction(filename, reactionType, specifiedTone = null) {
      //hide popup
      hideAllPopups();
      
      //toggle the reaction with specified tone or current tone
      await toggleReaction(filename, reactionType, specifiedTone);
    }
    
    //toggle reaction on a recording
    async function toggleReaction(filename, reactionType, specifiedTone = null) {
      const viewerId = getOrCreateViewerId();
      const popup = document.getElementById('globalReactionPopup');
      const option = popup.querySelector(`.reaction-option[data-reaction="${reactionType}"]`);
      const isActive = option?.classList.contains('active') || false;
      const currentTone = specifiedTone || window.globalReactionTone || 'marshmallow';
      
      //get the recording's reaction data
      const recording = findRecordingByFilename(filename);
      
      //check if user has this specific reaction with the current tone
      let hasReactionWithCurrentTone = false;
      if (recording?.reactions?.userReactions) {
        hasReactionWithCurrentTone = recording.reactions.userReactions.some(r => 
          (typeof r === 'string' ? r === reactionType : r.type === reactionType && r.tone === currentTone)
        );
      }
      
      //add animation to the trigger button
      const container = document.querySelector(`.reactions-container[data-filename="${filename}"]`);
      const trigger = container.querySelector('.reaction-trigger');
      if (trigger) {
        trigger.style.animation = 'none';
        TimerManager.setTimeout(() => trigger.style.animation = '', 10, 'animationReset');
      }
      
      try {
        let response;
        if (hasReactionWithCurrentTone) {
          //remove specific reaction with tone
          response = await fetch(`/api/recordings/${filename}/reactions`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'x-viewer-id': viewerId
            },
            body: JSON.stringify({ reactionType, tone: currentTone })
          });
        } else {
          //add reaction with current tone
          response = await fetch(`/api/recordings/${filename}/reactions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-viewer-id': viewerId
            },
            body: JSON.stringify({ reaction: reactionType, tone: currentTone })
          });
        }
        
        const data = await response.json();
        
        if (data.success) {
          //update UI with new reaction data
          updateReactionUI(filename, data.summary, data.userReactions);
          
          //update cached recording data across all cameras
          if (window.lastRecordingsData) {
            const recording = findRecordingByFilename(filename);
            if (recording && recording.reactions) {
              recording.reactions.summary = data.summary;
              recording.reactions.userReactions = data.userReactions;
            }
          }
        }
      } catch (error) {
        console.error('Failed to toggle reaction:', error);
      }
    }
    
    //update reaction UI for a recording
    function updateReactionUI(filename, summary, userReactions) {
      const container = document.querySelector(`.reactions-container[data-filename="${filename}"]`);
      if (!container) return;
      
      //update global popup if it's showing this recording's reactions
      const globalPopup = document.getElementById('globalReactionPopup');
      if (globalPopup.dataset.currentFilename === filename) {
        const currentTone = window.globalReactionTone || 'marshmallow';
        globalPopup.querySelectorAll('.reaction-option').forEach(option => {
          const reactionType = option.dataset.reaction;
          const hasReactionWithTone = userReactions?.some(r => 
            (typeof r === 'string' ? r === reactionType : r.type === reactionType && r.tone === currentTone)
          );
          if (hasReactionWithTone) {
            option.classList.add('active');
          } else {
            option.classList.remove('active');
          }
        });
      }
      
      //update reaction badges
      const badgesContainer = container.querySelector('.reaction-badges');
      if (badgesContainer) {
        let badgesHTML = '';
        
        //collect all unique type+tone combinations from the summary
        const allReactionCombos = [];
        Object.entries(summary || {}).forEach(([type, toneData]) => {
          if (typeof toneData === 'object') {
            Object.entries(toneData).forEach(([tone, count]) => {
              if (count > 0) {
                allReactionCombos.push({ type, tone, count });
              }
            });
          }
        });
        
        //sort by count descending
        allReactionCombos.sort((a, b) => b.count - a.count);
        
        //check which ones are the user's reactions
        const userReactionMap = new Map();
        if (userReactions && userReactions.length > 0) {
          userReactions.forEach(reaction => {
            const type = typeof reaction === 'string' ? reaction : reaction.type;
            const tone = typeof reaction === 'object' ? reaction.tone : 'marshmallow';
            userReactionMap.set(`${type}-${tone}`, true);
          });
        }
        
        //create safe reaction badge elements
        const badgeElements = allReactionCombos.map(({ type, tone, count }) => {
          const comboKey = `${type}-${tone}`;
          const isUserReaction = userReactionMap.has(comboKey);
          const imagePath = getReactionImagePath(type, tone);
          
          const reactionItem = DOMUtils.createElement('div', null, `reaction-item ${isUserReaction ? 'user-reaction' : ''}`);
          reactionItem.title = `React with ${DOMUtils.escapeHtml(type)} (${DOMUtils.escapeHtml(tone)})`;
          reactionItem.addEventListener('click', (event) => {
            event.stopPropagation();
            selectReaction(DOMUtils.escapeHtml(filename), DOMUtils.escapeHtml(type), DOMUtils.escapeHtml(tone));
          });
          
          const reactionImg = DOMUtils.createElement('img', null, '');
          reactionImg.src = DOMUtils.escapeHtml(imagePath);
          reactionImg.alt = DOMUtils.escapeHtml(type);
          reactionImg.onerror = function() {
            handleReactionImageError(this, DOMUtils.escapeHtml(type));
          };
          
          const countText = count > 99 ? '99+' : String(count);
          const reactionCount = DOMUtils.createElement('span', countText, 'reaction-count');
          
          reactionItem.appendChild(reactionImg);
          reactionItem.appendChild(reactionCount);
          return reactionItem;
        });
        
        DOMUtils.replaceContent(badgesContainer, badgeElements);
      }
    }
    
    //helper to get reaction image
    function getReactionImage(type) {
      const imageMap = {
        sleeping: '/art/reactions/ChickenSleeping.gif',
        peck: '/art/reactions/ChickenPeck.gif',
        fly: '/art/reactions/ChickenFly.gif',
        jump: '/art/reactions/ChickenJump.gif',
        love: '/art/reactions/ChickenLove.gif'
      };
      return imageMap[type] || '/art/reactions/ChickenLove.gif';
    }
    
    //get or create viewer ID for anonymous tracking
    function getOrCreateViewerId() {
      let viewerId = localStorage.getItem('viewerId');
      if (!viewerId) {
        //generate unique viewer ID
        viewerId = 'viewer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('viewerId', viewerId);
      }
      return viewerId;
    }
    
    //global reaction tone state
    window.globalReactionTone = 'marshmallow';
    
    //tone order for cycling
    const TONE_ORDER = ['marshmallow', 'charcoal', 'cheetopuff', 'rusty', 'toasty', 'uv'];
    
    //load tone preference from localStorage
    function loadTonePreference() {
      const saved = localStorage.getItem('globalReactionTone');
      if (saved && TONE_ORDER.includes(saved)) {
        window.globalReactionTone = saved;
      }
    }
    
    //save tone preference to localStorage
    function saveTonePreference() {
      localStorage.setItem('globalReactionTone', window.globalReactionTone);
    }
    
    //load preference on page load
    loadTonePreference();
    
    //helper function to get correct reaction image path
    function getReactionImagePath(reactionType, tone) {
      //map reaction types to actual filenames
      const typeMap = {
        'jump': 'Jumping',    // fix: jump -> ChickenJumping.gif
        'sleeping': 'Sleeping',
        'peck': 'Peck',
        'fly': 'Fly',
        'love': 'Love'
      };
      
      const mappedType = typeMap[reactionType] || reactionType;
      
      //handle typo in love files for specific tones
      if (reactionType === 'love' && (tone === 'cheetopuff' || tone === 'marshmallow')) {
        return `/art/reactions/${tone}/ChichkenLove.gif`;
      }
      
      //standard path
      return `/art/reactions/${tone}/Chicken${mappedType}.gif`;
    }
    
    //handle reaction image load errors
    function handleReactionImageError(img, reactionType) {
      console.warn(`Failed to load reaction image: ${img.src}`);
      
      //try fallback strategies in order
      const currentSrc = img.src;
      let fallbackSrc = null;
      
      //extract current tone from path
      const toneMatch = currentSrc.match(/\/reactions\/([^\/]+)\//);
      const currentTone = toneMatch ? toneMatch[1] : 'marshmallow';
      
      //strategy 1: try marshmallow tone if not already
      if (currentTone !== 'marshmallow') {
        fallbackSrc = getReactionImagePath(reactionType, 'marshmallow');
      }
      //strategy 2: try root reactions folder
      else {
        const typeMap = {
          'jump': 'ChickenJump.gif',
          'sleeping': 'ChickenSleeping.gif',
          'peck': 'ChickenPeck.gif',
          'fly': 'ChickenFly.gif',
          'love': 'ChickenLove.gif'
        };
        fallbackSrc = `/art/reactions/${typeMap[reactionType] || 'ChickenLove.gif'}`;
      }
      
      //prevent infinite loops
      if (!img.dataset.fallbackAttempted && fallbackSrc && fallbackSrc !== currentSrc) {
        img.dataset.fallbackAttempted = 'true';
        img.src = fallbackSrc;
      } else {
        //final fallback: use text emoji
        const emojiMap = {
          'jump': '🦘',
          'sleeping': '😴',
          'peck': '🐓',
          'fly': '🦅',
          'love': '❤️'
        };
        
        //replace image with emoji span
        const emoji = document.createElement('span');
        emoji.style.fontSize = '24px';
        emoji.style.display = 'inline-block';
        emoji.style.width = '30px';
        emoji.style.height = '30px';
        emoji.style.lineHeight = '30px';
        emoji.style.textAlign = 'center';
        emoji.textContent = emojiMap[reactionType] || '🐔';
        emoji.title = reactionType;
        
        img.parentElement.replaceChild(emoji, img);
      }
    }
    
    //cooldown state for cycle button
    let cycleButtonCooldown = false;
    
    //cycle global tone for all reactions
    function cycleGlobalTone(event) {
      event.stopPropagation();
      event.preventDefault();
      
      //check cooldown
      if (cycleButtonCooldown) {
        return;
      }
      
      //set cooldown
      cycleButtonCooldown = true;
      TimerManager.setTimeout(() => {
        cycleButtonCooldown = false;
      }, 300, 'cycleButtonCooldown'); // 300ms cooldown
      
      //get current tone
      const currentIndex = TONE_ORDER.indexOf(window.globalReactionTone);
      const nextIndex = (currentIndex + 1) % TONE_ORDER.length;
      const nextTone = TONE_ORDER[nextIndex];
      
      //update state
      window.globalReactionTone = nextTone;
      saveTonePreference();
      
      //update all reaction images in the popup
      const popup = document.getElementById('globalReactionPopup');
      const reactionImages = popup.querySelectorAll('.reaction-option-img');
      
      reactionImages.forEach(img => {
        const reactionType = img.alt;
        const newImagePath = getReactionImagePath(reactionType, nextTone);
        
        //fade effect
        img.style.opacity = '0.5';
        TimerManager.setTimeout(() => {
          //reset fallback flag when changing tones
          delete img.dataset.fallbackAttempted;
          img.src = newImagePath;
          img.style.opacity = '1';
        }, 100);
      });
      
      //update the cycle button title
      const cycleButton = event.target.closest('.tone-cycle-button');
      if (cycleButton) {
        cycleButton.title = `Change color for all reactions (currently: ${nextTone})`;
        
        //add visual feedback for cooldown
        cycleButton.style.opacity = '0.6';
        TimerManager.setTimeout(() => {
          cycleButton.style.opacity = '1';
        }, 300, 'cycleButtonFeedback');
      }
    }
    
    //update only reactions for all visible recordings
    async function updateReactionsOnly() {
      const containers = document.querySelectorAll('.reactions-container');
      if (containers.length === 0) return;
      
      const filenames = Array.from(containers).map(c => c.dataset.filename);
      const viewerId = getOrCreateViewerId();
      
      try {
        //use request queue on mobile
        const fetchOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-viewer-id': viewerId
          },
          body: JSON.stringify({ filenames })
        };
        
        const response = isMobile 
          ? await requestQueue.fetch('/api/recordings/reactions/batch', fetchOptions, { priority: 0 })
          : await fetch('/api/recordings/reactions/batch', fetchOptions);
        
        const data = await response.json();
        
        if (data.success && data.reactions) {
          //update UI for each recording
          Object.entries(data.reactions).forEach(([filename, reactionData]) => {
            updateReactionUI(filename, reactionData.summary, reactionData.userReactions);
          });
        }
      } catch (error) {
        console.error('Failed to update reactions:', error);
      }
    }

    //toggle fullscreen mode
    async function toggleFullscreen() {
      const container = document.getElementById('videoContainer');
      
      try {
        if (!document.fullscreenElement && 
            !document.webkitFullscreenElement && 
            !document.mozFullScreenElement && 
            !document.msFullscreenElement) {
          //enter fullscreen
          if (container.requestFullscreen) {
            await container.requestFullscreen();
          } else if (container.webkitRequestFullscreen) { //safari
            await container.webkitRequestFullscreen();
          } else if (container.mozRequestFullScreen) { //firefox
            await container.mozRequestFullScreen();
          } else if (container.msRequestFullscreen) { //ie/edge
            await container.msRequestFullscreen();
          }
        } else {
          //exit fullscreen
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) { //safari
            await document.webkitExitFullscreen();
          } else if (document.mozCancelFullScreen) { //firefox
            await document.mozCancelFullScreen();
          } else if (document.msExitFullscreen) { //ie/edge
            await document.msExitFullscreen();
          }
        }
      } catch (error) {
        console.error('Fullscreen API error:', error);
        alert('Fullscreen mode is not supported or was blocked by your browser');
      }
    }
    
    //update fullscreen button icon based on state
    function updateFullscreenButton() {
      const icon = document.getElementById('fullscreenIcon');
      const btn = document.getElementById('fullscreenBtn');
      
      if (isFullscreen) {
        //show compress icon (safe static SVG)
        const compressPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />';
        DOMUtils.setSafeHTML(icon, compressPath);
        btn.style.opacity = '1';
        btn.style.visibility = 'visible';
      } else {
        //show expand icon (safe static SVG)
        const expandPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />';
        DOMUtils.setSafeHTML(icon, expandPath);
      }
    }
    
    //handle fullscreen change events
    function handleFullscreenChange() {
      isFullscreen = !!(document.fullscreenElement || 
                       document.webkitFullscreenElement || 
                       document.mozFullScreenElement || 
                       document.msFullscreenElement);
      updateFullscreenButton();
    }
    
    //handle keyboard shortcuts
    function handleKeyDown(event) {
      //f key for fullscreen
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleFullscreen();
      }
    }
    
    //setup fullscreen event listeners
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    //keyboard event listener
    window.addEventListener('keydown', handleKeyDown);
    
    //double-tap to fullscreen (mobile)
    let lastTapTime = 0;
    const doubleTapDelay = 300; //milliseconds
    
    function handleStreamDoubleTap(event) {
      const currentTime = new Date().getTime();
      const tapInterval = currentTime - lastTapTime;
      
      if (tapInterval < doubleTapDelay && tapInterval > 0) {
        event.preventDefault();
        toggleFullscreen();
      }
      
      lastTapTime = currentTime;
    }
    
    //add double-tap listener to stream
    const streamElement = document.getElementById('stream');
    if (streamElement) {
      streamElement.addEventListener('click', handleStreamDoubleTap);
      
      //prevent default touch behaviors on stream
      streamElement.addEventListener('touchstart', (e) => {
        //allow single touch only
        if (e.touches.length > 1) {
          e.preventDefault();
        }
      }, { passive: false });
    }
    
    //SSE connection management with exponential backoff
    let sseReconnectDelay = 1000;
    let sseConnectionAttempts = 0;
    const maxSSEReconnectDelay = 30000; //max 30 seconds
    
    //motion detection and notifications
    function initializeSSE() {
      //clean up existing connection
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      
      //clear any pending reconnect
      if (sseReconnectTimer) {
        TimerManager.clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }
      
      //don't connect if page is hidden (mobile background)
      if (document.hidden) {
        console.log('[SSE] Page hidden, skipping connection');
        return;
      }
      
      console.log(`[SSE] Connecting to motion events (attempt ${sseConnectionAttempts + 1})`);
      eventSource = new EventSource('/api/events/motion');
      
      eventSource.onopen = function() {
        console.log('[SSE] Connected to motion events');
        //reset reconnect delay on successful connection
        sseReconnectDelay = 1000;
        sseConnectionAttempts = 0;
      };
      
      eventSource.onmessage = function(event) {
        try {
          const data = JSON.parse(event.data);
          handleMotionEvent(data);
        } catch (error) {
          console.error('[SSE] Failed to parse message:', error);
        }
      };
      
      eventSource.onerror = function(error) {
        console.error('[SSE] Connection error:', error);
        eventSource.close();
        eventSource = null;
        
        //exponential backoff with jitter
        const jitter = Math.random() * 1000; //0-1 second jitter
        const delay = Math.min(sseReconnectDelay + jitter, maxSSEReconnectDelay);
        
        console.log(`[SSE] Reconnecting in ${Math.round(delay / 1000)}s`);
        sseConnectionAttempts++;
        
        sseReconnectTimer = TimerManager.setTimeout(() => {
          sseReconnectDelay = Math.min(sseReconnectDelay * 2, maxSSEReconnectDelay);
          initializeSSE();
        }, delay, 'sseReconnect');
      };
    }
    
    //handle motion events
    function handleMotionEvent(data) {
      if (data.type === 'motion') {
        console.log('[Motion] Detected:', data);
        
        // Add to history
        motionEvents.unshift(data);
        if (motionEvents.length > MAX_MOTION_EVENTS) {
          motionEvents.pop();
        }
        
        // Update UI
        motionNotificationCount++;
        updateMotionIndicator();
        updateMotionHistory();
        
        // Show notification
        if (notificationsEnabled && document.hidden) {
          showMotionNotification(data);
        }
        
        // Show toast if on page
        if (!document.hidden) {
          showMotionToast(data);
        }
      } else {
        // Handle other event types (like high motion alerts)
        NotificationManager.handleSSEMessage(data);
      }
    }
    
    //update motion indicator
    function updateMotionIndicator() {
      const indicator = document.getElementById('motionIndicator');
      const count = document.getElementById('motionCount');
      
      if (motionNotificationCount > 0) {
        indicator.classList.remove('hidden');
        count.textContent = motionNotificationCount > 9 ? '9+' : motionNotificationCount;
      } else {
        indicator.classList.add('hidden');
      }
    }
    
    //update motion history panel
    function updateMotionHistory() {
      const container = document.getElementById('motionHistory');
      
      if (motionEvents.length === 0) {
        const emptyState = DOMUtils.createElement('div', null, 'text-center text-base-content/60 py-8');
        const emptyText = DOMUtils.createElement('p', 'No motion events yet');
        emptyState.appendChild(emptyText);
        DOMUtils.replaceContent(container, [emptyState]);
        return;
      }
      
      //create safe motion event elements
      const eventElements = motionEvents.map(event => {
        const time = new Date(event.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        
        const eventDiv = DOMUtils.createElement('div', null, 'bg-base-200 rounded-lg p-3 hover:bg-base-300 transition-colors');
        
        const headerDiv = DOMUtils.createElement('div', null, 'flex items-center justify-between');
        const leftSection = DOMUtils.createElement('div', null, 'flex items-center gap-2');
        
        //add motion icon (safe static SVG)
        const iconDiv = DOMUtils.createElement('div');
        const motionIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-primary">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>`;
        DOMUtils.setSafeHTML(iconDiv, motionIcon);
        
        const labelSpan = DOMUtils.createElement('span', 'Motion Detected', 'text-sm font-medium');
        const timeSpan = DOMUtils.createElement('span', timeStr, 'text-xs text-base-content/60');
        
        leftSection.appendChild(iconDiv);
        leftSection.appendChild(labelSpan);
        headerDiv.appendChild(leftSection);
        headerDiv.appendChild(timeSpan);
        eventDiv.appendChild(headerDiv);
        
        //add intensity if available
        if (event.intensity) {
          const intensityText = `Intensity: ${Math.round(event.intensity * 100)}%`;
          const intensityDiv = DOMUtils.createElement('div', intensityText, 'text-xs text-base-content/60 mt-1');
          eventDiv.appendChild(intensityDiv);
        }
        
        return eventDiv;
      });
      
      DOMUtils.replaceContent(container, eventElements);
    }
    
    //show browser notification
    async function showMotionNotification(data) {
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const notification = new Notification('Motion Detected!', {
            body: 'Movement detected in the chicken coop',
            icon: '/icons/chicken-icon.png',
            tag: 'motion-alert',
            renotify: true,
            requireInteraction: false
          });
          
          notification.onclick = function() {
            window.focus();
            notification.close();
            toggleMotionPanel();
          };
          
          // Auto-close after 5 seconds
          TimerManager.setTimeout(() => notification.close(), 5000, 'notificationAutoClose');
        } catch (error) {
          console.error('[Notification] Failed to show:', error);
        }
      }
    }
    
    //show motion toast on page
    function showMotionToast(data) {
      const existingToast = document.querySelector('.motion-toast');
      if (existingToast) {
        existingToast.remove();
      }
      
      const toast = DOMUtils.createElement('div', null, 'motion-toast');
      
      const container = DOMUtils.createElement('div', null, 'flex items-center gap-3');
      
      const iconDiv = DOMUtils.createElement('div');
      const motionIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary flex-shrink-0">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>`;
      DOMUtils.setSafeHTML(iconDiv, motionIcon);
      
      const textDiv = DOMUtils.createElement('div');
      const titleDiv = DOMUtils.createElement('div', 'Motion Detected', 'font-semibold');
      const descDiv = DOMUtils.createElement('div', 'Movement in the coop', 'text-sm text-base-content/70');
      
      textDiv.appendChild(titleDiv);
      textDiv.appendChild(descDiv);
      container.appendChild(iconDiv);
      container.appendChild(textDiv);
      toast.appendChild(container);
      
      document.body.appendChild(toast);
      
      // Remove after 3 seconds
      TimerManager.setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        TimerManager.setTimeout(() => toast.remove(), 300, 'toastRemoval');
      }, 3000, 'toastAutoRemove');
    }
    
    //toggle motion panel
    function toggleMotionPanel() {
      const panel = document.getElementById('motionPanel');
      panel.classList.toggle('show');
      
      // Reset notification count when panel is opened
      if (panel.classList.contains('show')) {
        motionNotificationCount = 0;
        updateMotionIndicator();
      }
    }
    
    //request notification permission
    async function requestNotificationPermission() {
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          const permission = await Notification.requestPermission();
          console.log('[Notification] Permission:', permission);
        } catch (error) {
          console.error('[Notification] Permission request failed:', error);
        }
      }
    }
    
    //handle notification toggle
    document.getElementById('notificationToggle').addEventListener('change', function(e) {
      notificationsEnabled = e.target.checked;
      if (notificationsEnabled) {
        requestNotificationPermission();
      }
    });
    
    //mobile detection and optimization
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isFirefoxMobile = isMobile && /Firefox/i.test(navigator.userAgent);
    
    //batch API updates for mobile optimization
    async function batchUpdate() {
      if (!isMobile) {
        //on desktop, use regular individual updates
        updateStats();
        updateWeather();
        return;
      }
      
      try {
        //use batch API to reduce connections
        const response = await requestQueue.fetch('/api/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: [
              { endpoint: '/api/stats' },
              { endpoint: '/api/weather' },
              { endpoint: `/api/stream/${currentCamera}/status` },
              { endpoint: '/api/flashlight/status' }
            ]
          })
        }, { priority: 1 });
        
        const data = await response.json();
        
        if (data.success && data.results) {
          //process results
          data.results.forEach(result => {
            if (result.success) {
              switch (result.endpoint) {
                case '/api/stats':
                  handleStatsUpdate(result.data);
                  break;
                case '/api/weather':
                  handleWeatherUpdate({ success: true, data: result.data });
                  break;
                case `/api/stream/${currentCamera}/status`:
                  handleStreamStatusUpdate(result.data);
                  break;
                case '/api/flashlight/status':
                  handleFlashlightStatusUpdate(result.data);
                  break;
              }
            }
          });
        }
      } catch (error) {
        console.error('[Batch API] Error:', error);
        //fallback to individual updates
        updateStats();
        updateWeather();
      }
    }
    
    //heavily optimized intervals to reduce server load and fix extreme lag
    const intervals = {
      stats: isMobile ? 45000 : 30000,       //45s mobile, 30s desktop (was 15s/5s - reduced by 6x/5x)
      weather: 15 * 60 * 1000,               //15 minutes both (was 5 minutes - reduced by 3x)
      flashlight: isMobile ? 60000 : 45000,  //1min mobile, 45s desktop (was 10s/5s - reduced by 6x/9x)
      recordings: isMobile ? 180000 : 90000, //3min mobile, 1.5min desktop (was 60s/30s - reduced by 3x)
      pauseStatus: isMobile ? 60000 : 45000, //1min mobile, 45s desktop (was 10s/5s - reduced by 6x/9x)
      reactions: isMobile ? 90000 : 45000    //1.5min mobile, 45s desktop (was 30s/10s - reduced by 3x/4.5x)
    };
    
    //interval references for pause/resume
    const intervalRefs = {
      stats: null,
      flashlight: null,
      recordings: null,
      pauseStatus: null,
      reactions: null,
      weather: null,
      time: null
    };
    
    //pause all intervals
    function pauseAllIntervals() {
      console.log('[Intervals] Pausing all intervals');
      Object.keys(intervalRefs).forEach(key => {
        if (intervalRefs[key]) {
          TimerManager.clearInterval(intervalRefs[key]);
          intervalRefs[key] = null;
        }
      });
    }
    
    //resume all intervals
    function resumeAllIntervals() {
      console.log('[Intervals] Resuming all intervals');
      
      //immediate updates
      if (isMobile) {
        batchUpdate(); //use batch on mobile
      } else {
        updateStats();
        updateWeather();
      }
      checkFlashlightStatus();
      updateAllRecordings();
      checkPauseStatus();
      updateReactionsOnly();
      
      //set intervals
      if (isMobile) {
        //use batch update for stats and weather on mobile
        intervalRefs.stats = TimerManager.setInterval(batchUpdate, intervals.stats, 'batchUpdate');
      } else {
        intervalRefs.stats = TimerManager.setInterval(updateStats, intervals.stats, 'updateStats');
        intervalRefs.weather = TimerManager.setInterval(updateWeather, intervals.weather, 'updateWeather');
      }
      intervalRefs.flashlight = TimerManager.setInterval(checkFlashlightStatus, intervals.flashlight, 'checkFlashlightStatus');
      intervalRefs.recordings = TimerManager.setInterval(updateAllRecordings, intervals.recordings, 'updateAllRecordings');
      intervalRefs.pauseStatus = TimerManager.setInterval(checkPauseStatus, intervals.pauseStatus, 'checkPauseStatus');
      intervalRefs.reactions = TimerManager.setInterval(updateReactionsOnly, intervals.reactions, 'updateReactionsOnly');
    }
    
    //visibility API handling
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('[Visibility] Page hidden, pausing updates');
        pauseAllIntervals();
        //close SSE connection on mobile to free up connection slot
        if (isMobile && eventSource) {
          eventSource.close();
          eventSource = null;
        }
      } else {
        console.log('[Visibility] Page visible, resuming updates');
        resumeAllIntervals();
        //reconnect SSE
        if (isMobile) {
          initializeSSE();
        }
      }
    });
    
    //log mobile optimization status
    if (isMobile) {
      console.log('[Mobile] Mobile device detected, using optimized intervals');
      console.log('[Mobile] User Agent:', navigator.userAgent);
      if (isFirefoxMobile) {
        console.log('[Mobile] Firefox Mobile detected - connection limits enforced');
      }
    }
    
    //initialize
    updateTime();
    updateStats();
    updateWeather();
    checkFlashlightStatus();
    setupStreamReconnection();
    updateActiveButton(currentCamera); //set initial camera button state
    updateAllRecordings();
    updateFullscreenButton();
    initializeSSE();
    checkPauseStatus();
    
    //periodic updates - add time to managed intervals
    intervalRefs.time = TimerManager.setInterval(updateTime, 1000, 'timeUpdate'); //always update time
    resumeAllIntervals(); //start managed intervals
    
    //comprehensive cleanup handlers to prevent memory leaks
    function cleanupAllTimers() {
      console.log('[Cleanup] Cleaning up all timers and connections');
      
      //clean up all managed timers
      TimerManager.clearAll();
      
      //close SSE connection
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      
      //clean up specific timer variables
      if (streamReconnectTimeout) {
        streamReconnectTimeout = null;
      }
      if (streamSustainedSuccessTimeout) {
        streamSustainedSuccessTimeout = null;
      }
      if (streamStallTimeout) {
        streamStallTimeout = null;
      }
      if (flashlightCountdownInterval) {
        flashlightCountdownInterval = null;
      }
      if (passwordCountdownInterval) {
        passwordCountdownInterval = null;
      }
      if (sseReconnectTimer) {
        sseReconnectTimer = null;
      }
      
      //clear all interval refs
      Object.keys(intervalRefs).forEach(key => {
        intervalRefs[key] = null;
      });
    }
    
    //cleanup on page unload to prevent memory leaks
    window.addEventListener('beforeunload', cleanupAllTimers);
    window.addEventListener('unload', cleanupAllTimers);
    
    //cleanup on visibility change (mobile background)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('[Cleanup] Page hidden - cleaning up timers');
        //don't do full cleanup, just pause intervals
        pauseAllIntervals();
      } else {
        console.log('[Cleanup] Page visible - resuming intervals');
        resumeAllIntervals();
      }
    });
    
    //expose cleanup function for debugging
    window.cleanupTimers = cleanupAllTimers;
    window.getTimerCount = () => TimerManager.getActiveCount();
    window.listTimers = () => TimerManager.listActive();
    
    //initialize lucide icons after DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      
      //initialize notification manager
      NotificationManager.init();
      
      //initialize frame preservation system
      FramePreservation.init();
      
      //setup stream error handling and reconnection
      setupStreamReconnection();
    });
    
    //global function for flashlight overlay button
    window.toggleFlashlightOverlay = async function() {
      try {
        //track flashlight action for smart polling optimization
        flashlightLastAction = Date.now();
        //get current flashlight status first
        const statusResponse = await fetch('/api/flashlight/status', {
          headers: { 'Accept': 'application/json' }
        });
        const statusData = await statusResponse.json();
        
        //flashlight can only be turned on (auto-off after 5 minutes)
        //if already on, do nothing or show message
        if (statusData.isOn) {
          console.log('Flashlight is already on, remaining time:', statusData.remainingSeconds);
          return;
        }
        
        //turn on flashlight
        const response = await fetch('/api/flashlight/on', {
          method: 'PUT',
          headers: { 'Accept': 'application/json' }
        });
        
        const data = await response.json();
        if (data.success) {
          console.log('Flashlight turned on:', data.message);
          //update overlay UI immediately
          updateOverlayFlashlightUI(true, data.remainingSeconds || 300);
          //update existing flashlight status if elements exist
          checkFlashlightStatus();
        } else {
          console.error('Flashlight toggle failed:', data.message);
        }
      } catch (error) {
        console.error('Error toggling flashlight:', error);
      }
    };
    
    //notification system state
    const NotificationManager = {
      isSupported: 'Notification' in window,
      permission: null,
      isEnabled: false,
      
      init() {
        this.permission = this.isSupported ? Notification.permission : 'denied';
        this.isEnabled = this.permission === 'granted';
        this.updateBellStatus();
        
        //listen for high motion alerts from SSE
        this.setupSSEListener();
      },
      
      updateBellStatus() {
        const bellStatus = document.getElementById('notificationStatus');
        if (!bellStatus) return;
        
        bellStatus.classList.remove('bg-success', 'bg-warning', 'bg-error');
        
        if (this.permission === 'granted') {
          bellStatus.classList.add('bg-success');
          bellStatus.classList.remove('hidden');
        } else if (this.permission === 'denied') {
          bellStatus.classList.add('bg-error');
          bellStatus.classList.remove('hidden');
        } else {
          bellStatus.classList.add('bg-warning');
          bellStatus.classList.remove('hidden');
        }
      },
      
      async requestPermission() {
        if (!this.isSupported) {
          throw new Error('Notifications not supported in this browser');
        }
        
        const permission = await Notification.requestPermission();
        this.permission = permission;
        this.isEnabled = permission === 'granted';
        this.updateBellStatus();
        
        return permission;
      },
      
      showNotification(title, options = {}) {
        if (!this.isEnabled) return null;
        
        const defaultOptions = {
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'coop-motion',
          requireInteraction: false,
          ...options
        };
        
        return new Notification(title, defaultOptions);
      },
      
      setupSSEListener() {
        //will be set up when SSE connects
        console.log('[Notifications] SSE listener ready for high motion alerts');
      },
      
      handleSSEMessage(data) {
        //handle high motion alerts from SSE
        if (data.type === 'high-motion-alert' && this.isEnabled) {
          this.showNotification('High Motion Detected! 🐔', {
            body: data.data.message,
            icon: '/favicon.ico',
            tag: 'high-motion'
          });
        }
      }
    };
    
    //global notification functions
    window.openNotificationModal = function() {
      const modal = document.getElementById('notificationModal');
      if (modal) {
        modal.showModal();
      }
    };
    
    window.closeNotificationModal = function() {
      const modal = document.getElementById('notificationModal');
      if (modal) {
        modal.close();
      }
    };
    
    window.enableNotifications = async function() {
      try {
        const permission = await NotificationManager.requestPermission();
        
        if (permission === 'granted') {
          //send demo notification
          const demoNotification = NotificationManager.showNotification('Thank you! 🎉', {
            body: 'Motion notifications will look like this',
            tag: 'demo-notification'
          });
          
          //auto-close demo notification after 5 seconds
          if (demoNotification) {
            TimerManager.setTimeout(() => {
              demoNotification.close();
            }, 5000, 'closeDemoNotification');
          }
          
          //close modal
          window.closeNotificationModal();
          
          console.log('[Notifications] Successfully enabled motion notifications');
        } else if (permission === 'denied') {
          alert('Notifications were blocked. You can enable them in your browser settings.');
        } else {
          alert('Notification permission was not granted.');
        }
      } catch (error) {
        console.error('[Notifications] Error enabling notifications:', error);
        alert('Failed to enable notifications: ' + error.message);
      }
    };
    
    //global function to open password modal for stream pause
    window.openPasswordModal = function() {
      const modal = document.getElementById('passwordModal');
      const passwordInput = document.getElementById('passwordInput');
      
      //clear previous input
      if (passwordInput) {
        passwordInput.value = '';
      }
      
      //show modal
      if (modal) {
        modal.showModal();
        //focus input after a brief delay
        TimerManager.setTimeout(() => {
          if (passwordInput) {
            passwordInput.focus();
          }
        }, 100, 'focusPasswordInput');
      }
    };

    // ===============================================================================
    // SHARE FUNCTIONALITY
    // ===============================================================================

    //global share functionality
    let currentShareFilename = null;

    //open share modal for a recording
    window.openShareModal = function(filename) {
      currentShareFilename = filename;
      
      //reset modal state
      resetShareModal();
      
      //show modal
      const modal = document.getElementById('shareModal');
      if (modal) {
        modal.showModal();
      }
    };

    //reset share modal to initial state
    function resetShareModal() {
      document.getElementById('shareExpiration').value = '';
      document.getElementById('sharePassword').checked = false;
      document.getElementById('sharePasswordValue').value = '';
      document.getElementById('sharePasswordValue').classList.add('hidden');
      document.getElementById('shareMessage').value = '';
      document.getElementById('shareResult').classList.add('hidden');
      document.getElementById('generateShareBtn').style.display = 'inline-flex';
    }

    //toggle password field visibility
    document.addEventListener('DOMContentLoaded', function() {
      const passwordCheckbox = document.getElementById('sharePassword');
      const passwordField = document.getElementById('sharePasswordValue');
      
      if (passwordCheckbox && passwordField) {
        passwordCheckbox.addEventListener('change', function() {
          if (this.checked) {
            passwordField.classList.remove('hidden');
            passwordField.focus();
          } else {
            passwordField.classList.add('hidden');
            passwordField.value = '';
          }
        });
      }
    });

    //generate share link
    window.generateShareLink = async function() {
      if (!currentShareFilename) {
        console.error('[Share] No filename selected');
        return;
      }

      try {
        const expiration = document.getElementById('shareExpiration').value;
        const usePassword = document.getElementById('sharePassword').checked;
        const password = document.getElementById('sharePasswordValue').value;
        const message = document.getElementById('shareMessage').value;

        const requestBody = {
          filename: currentShareFilename,
          expiresIn: expiration || null,
          requirePassword: usePassword,
          password: usePassword ? password : null,
          customMessage: message || null
        };

        const response = await fetch('/api/share/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const result = await response.json();
        
        if (result.success) {
          showShareResult(result.shareUrl, result.token);
        } else {
          console.error('[Share] Failed to create share link:', result.error);
          alert('Failed to create share link: ' + result.error);
        }
      } catch (error) {
        console.error('[Share] Error generating share link:', error);
        alert('Failed to create share link: ' + error.message);
      }
    };

    //show share result with URL
    function showShareResult(shareUrl, token) {
      document.getElementById('shareUrl').value = shareUrl;
      document.getElementById('shareResult').classList.remove('hidden');
      document.getElementById('generateShareBtn').style.display = 'none';
    }

    //copy share link to clipboard
    window.copyShareLink = async function() {
      try {
        const url = document.getElementById('shareUrl').value;
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard!', 'success');
      } catch (error) {
        console.error('[Share] Failed to copy link:', error);
        
        //fallback for older browsers
        const urlField = document.getElementById('shareUrl');
        urlField.select();
        urlField.setSelectionRange(0, 99999);
        document.execCommand('copy');
        showToast('Link copied to clipboard!', 'success');
      }
    };

    // Social media sharing functions
    window.shareToFacebook = function() {
      const url = document.getElementById('shareUrl').value;
      const message = document.getElementById('shareMessage').value;
      const shareText = message || 'Check out this chicken coop recording! 🐓';
      const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(shareText)}`;
      window.open(fbUrl, '_blank', 'width=600,height=400');
    };

    window.shareToTwitter = function() {
      const url = document.getElementById('shareUrl').value;
      const message = document.getElementById('shareMessage').value;
      const text = message || 'Check out this chicken coop recording! 🐓';
      const twitterUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
      window.open(twitterUrl, '_blank', 'width=600,height=400');
    };

    window.shareToWhatsApp = function() {
      const url = document.getElementById('shareUrl').value;
      const message = document.getElementById('shareMessage').value;
      const text = `${message || 'Check out this chicken coop recording! 🐓'} ${url}`;
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(whatsappUrl, '_blank');
    };

    window.shareToEmail = function() {
      const url = document.getElementById('shareUrl').value;
      const message = document.getElementById('shareMessage').value;
      const subject = 'Chicken Coop Recording';
      const body = `${message || 'Check out this chicken coop recording!'}\n\n${url}`;
      const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoUrl;
    };

    window.shareToDiscord = function() {
      const url = document.getElementById('shareUrl').value;
      const message = document.getElementById('shareMessage').value;
      const text = `${message || 'Check out this chicken coop recording! 🐓'} ${url}`;
      
      //copy to clipboard for Discord
      copyToClipboard(text).then(() => {
        showToast('Message copied! Paste it in Discord.', 'info');
      }).catch(() => {
        //fallback alert
        alert('Copy this message to Discord:\n\n' + text);
      });
    };

    //helper function to copy text to clipboard
    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        //fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    }

    //helper function to show toast notifications
    function showToast(message, type = 'info') {
      //create toast element
      const toast = document.createElement('div');
      toast.className = `alert alert-${type} fixed top-4 right-4 z-50 max-w-xs shadow-lg`;
      toast.innerHTML = `
        <span>${DOMUtils.escapeHtml(message)}</span>
      `;
      
      document.body.appendChild(toast);
      
      //remove toast after 3 seconds
      TimerManager.setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 3000, 'removeToast');
    };
