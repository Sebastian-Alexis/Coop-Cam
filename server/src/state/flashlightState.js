import { config } from '../config.js';

//flashlight state management service
class FlashlightState {
  constructor() {
    //multi-camera state management using Map<sourceId, state>
    this.cameras = new Map();
    
    //legacy single-camera state for backward compatibility
    this.state = {
      isOn: false,
      turnedOnAt: null,
      autoOffTimeout: null
    };
    
    //auto-off duration (5 minutes)
    this.AUTO_OFF_DURATION = 5 * 60 * 1000;
    
    //motion detection service reference (set externally)
    this.motionDetectionService = null;
  }

  //set motion detection service reference
  setMotionDetectionService(service) {
    this.motionDetectionService = service;
  }

  //initialize camera state if it doesn't exist
  _initializeCameraState(sourceId) {
    if (!this.cameras.has(sourceId)) {
      this.cameras.set(sourceId, {
        isOn: false,
        turnedOnAt: null,
        autoOffTimeout: null
      });
    }
    return this.cameras.get(sourceId);
  }

  //get camera source URL for API calls
  _getCameraUrl(sourceId) {
    if (!sourceId) {
      //fallback to legacy config for default camera
      return `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}`;
    }

    //find camera source in config
    const source = config.streamSources?.find(s => s.id === sourceId);
    if (!source) {
      throw new Error(`Camera source '${sourceId}' not found in configuration`);
    }

    //extract base URL from stream URL (remove /video path)
    const url = new URL(source.url);
    return `${url.protocol}//${url.host}`;
  }

  //get current flashlight status with remaining time calculation
  getStatus(sourceId = null) {
    if (sourceId) {
      //camera-specific status
      const cameraState = this._initializeCameraState(sourceId);
      let remainingSeconds = 0;
      
      if (cameraState.isOn && cameraState.turnedOnAt) {
        const elapsed = Date.now() - cameraState.turnedOnAt.getTime();
        const remaining = Math.max(0, this.AUTO_OFF_DURATION - elapsed);
        remainingSeconds = Math.floor(remaining / 1000);
        
        //auto-reset if timer has expired
        if (remainingSeconds <= 0) {
          this._resetCameraState(sourceId);
          console.log(`[Flashlight] Auto-reset state for camera ${sourceId} due to expired timer`);
        }
      }
      
      return {
        isOn: cameraState.isOn,
        remainingSeconds,
        sourceId,
        droidcamUrl: this._getCameraUrl(sourceId)
      };
    } else {
      //legacy behavior for backward compatibility
      let remainingSeconds = 0;
      
      if (this.state.isOn && this.state.turnedOnAt) {
        const elapsed = Date.now() - this.state.turnedOnAt.getTime();
        const remaining = Math.max(0, this.AUTO_OFF_DURATION - elapsed);
        remainingSeconds = Math.floor(remaining / 1000);
        
        //auto-reset if timer has expired
        if (remainingSeconds <= 0) {
          this._resetState();
          console.log('[Flashlight] Auto-reset state due to expired timer');
        }
      }
      
      return {
        isOn: this.state.isOn,
        remainingSeconds,
        droidcamUrl: `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}`
      };
    }
  }

  //reset camera state (private method)
  _resetCameraState(sourceId) {
    const cameraState = this.cameras.get(sourceId);
    if (cameraState) {
      cameraState.isOn = false;
      cameraState.turnedOnAt = null;
      this._clearCameraTimeout(sourceId);
    }
  }

  //clear camera timeout (private method)
  _clearCameraTimeout(sourceId) {
    const cameraState = this.cameras.get(sourceId);
    if (cameraState && cameraState.autoOffTimeout) {
      clearTimeout(cameraState.autoOffTimeout);
      cameraState.autoOffTimeout = null;
    }
  }

  //turn on flashlight
  async turnOn(sourceId = null) {
    try {
      if (sourceId) {
        //camera-specific logic
        const cameraState = this._initializeCameraState(sourceId);
        
        //if already on, return current state without resetting timer
        if (cameraState.isOn) {
          const elapsed = Date.now() - cameraState.turnedOnAt.getTime();
          const remaining = Math.max(0, this.AUTO_OFF_DURATION - elapsed);
          const remainingSeconds = Math.floor(remaining / 1000);
          
          console.log(`[Flashlight] Camera ${sourceId} already on, returning current state`);
          return {
            success: true,
            isOn: true,
            remainingSeconds,
            sourceId,
            message: 'Flashlight is already on'
          };
        }
        
        //clear any existing timeout before toggling
        this._clearCameraTimeout(sourceId);
        
        //turn on flashlight via camera API
        const baseUrl = this._getCameraUrl(sourceId);
        const flashlightUrl = `${baseUrl}/v1/camera/torch_toggle`;
        console.log(`[Flashlight] Toggling flashlight ON for camera ${sourceId} at:`, flashlightUrl);
        
        const response = await fetch(flashlightUrl, { 
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain'
          }
        });
        
        console.log(`[Flashlight] Camera ${sourceId} response status:`, response.status);
        
        if (!response.ok) {
          throw new Error(`DroidCam API error: ${response.status}`);
        }
        
        //update camera state - flashlight is now ON
        cameraState.isOn = true;
        cameraState.turnedOnAt = new Date();
        
        //pause motion detection when flashlight is on
        if (this.motionDetectionService) {
          this.motionDetectionService.pause('flashlight');
          console.log(`[Flashlight] Motion detection paused for camera ${sourceId}`);
        }
        
        //set auto-off timer
        cameraState.autoOffTimeout = setTimeout(async () => {
          console.log(`[Flashlight] Auto-off timer triggered for camera ${sourceId}`);
          await this._autoCameraOff(sourceId);
        }, this.AUTO_OFF_DURATION);
        
        return { 
          success: true,
          isOn: true,
          remainingSeconds: 300, // 5 minutes
          sourceId,
          message: 'Flashlight turned on successfully'
        };
      } else {
        //legacy behavior for backward compatibility
        //if already on, return current state without resetting timer
        if (this.state.isOn) {
          const elapsed = Date.now() - this.state.turnedOnAt.getTime();
          const remaining = Math.max(0, this.AUTO_OFF_DURATION - elapsed);
          const remainingSeconds = Math.floor(remaining / 1000);
          
          console.log('[Flashlight] Already on, returning current state');
          return {
            success: true,
            isOn: true,
            remainingSeconds,
            message: 'Flashlight is already on'
          };
        }
        
        //clear any existing timeout before toggling
        this._clearTimeout();
        
        //turn on flashlight via DroidCam API
        const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
        console.log('[Flashlight] Toggling flashlight ON at:', flashlightUrl);
        
        const response = await fetch(flashlightUrl, { 
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain'
          }
        });
        
        console.log('[Flashlight] Response status:', response.status);
        console.log('[Flashlight] Response ok:', response.ok);
        
        if (!response.ok) {
          throw new Error(`DroidCam API error: ${response.status}`);
        }
        
        //update state - flashlight is now ON
        this.state.isOn = true;
        this.state.turnedOnAt = new Date();
        
        //pause motion detection when flashlight is on
        if (this.motionDetectionService) {
          this.motionDetectionService.pause('flashlight');
          console.log('[Flashlight] Motion detection paused');
        }
        
        //set auto-off timer
        this.state.autoOffTimeout = setTimeout(async () => {
          console.log('[Flashlight] Auto-off timer triggered');
          await this._autoOff();
        }, this.AUTO_OFF_DURATION);
        
        return { 
          success: true,
          isOn: true,
          remainingSeconds: 300, // 5 minutes
          message: 'Flashlight turned on successfully'
        };
      }
      
    } catch (error) {
      console.error(`[Flashlight] Turn on error${sourceId ? ` for camera ${sourceId}` : ''}:`, error.message);
      console.error('[Flashlight] Full error:', error);
      return { 
        success: false, 
        message: 'Failed to turn on flashlight',
        error: error.message 
      };
    }
  }

  //turn off flashlight
  async turnOff(sourceId = null) {
    try {
      if (sourceId) {
        //camera-specific logic
        const cameraState = this.cameras.get(sourceId);
        
        //if already off, return current state
        if (!cameraState || !cameraState.isOn) {
          console.log(`[Flashlight] Camera ${sourceId} already off`);
          return {
            success: true,
            isOn: false,
            sourceId,
            message: 'Flashlight is already off'
          };
        }
        
        //clear any existing timeout
        this._clearCameraTimeout(sourceId);
        
        //turn off flashlight via camera API
        const baseUrl = this._getCameraUrl(sourceId);
        const flashlightUrl = `${baseUrl}/v1/camera/torch_toggle`;
        console.log(`[Flashlight] Toggling flashlight OFF for camera ${sourceId} at:`, flashlightUrl);
        
        const response = await fetch(flashlightUrl, { 
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain'
          }
        });
        
        if (response.ok) {
          this._resetCameraState(sourceId);
          console.log(`[Flashlight] Successfully turned off camera ${sourceId}`);
          
          //resume motion detection when flashlight turns off
          this._resumeMotionDetection();
          
          return { 
            success: true,
            isOn: false,
            sourceId,
            message: 'Flashlight turned off successfully'
          };
        } else {
          throw new Error(`DroidCam API error: ${response.status}`);
        }
      } else {
        //legacy behavior for backward compatibility
        //if already off, return current state
        if (!this.state.isOn) {
          console.log('[Flashlight] Already off');
          return {
            success: true,
            isOn: false,
            message: 'Flashlight is already off'
          };
        }
        
        //clear any existing timeout
        this._clearTimeout();
        
        //turn off flashlight via DroidCam API
        const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
        console.log('[Flashlight] Toggling flashlight OFF at:', flashlightUrl);
        
        const response = await fetch(flashlightUrl, { 
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain'
          }
        });
        
        if (response.ok) {
          this._resetState();
          console.log('[Flashlight] Successfully turned off');
          
          //resume motion detection when flashlight turns off
          this._resumeMotionDetection();
          
          return { 
            success: true,
            isOn: false,
            message: 'Flashlight turned off successfully'
          };
        } else {
          throw new Error(`DroidCam API error: ${response.status}`);
        }
      }
      
    } catch (error) {
      console.error(`[Flashlight] Turn off error${sourceId ? ` for camera ${sourceId}` : ''}:`, error);
      return { 
        success: false, 
        message: 'Failed to turn off flashlight',
        error: error.message 
      };
    }
  }

  //auto-off functionality for camera (private method)
  async _autoCameraOff(sourceId) {
    const cameraState = this.cameras.get(sourceId);
    //only toggle if flashlight is still on
    if (cameraState && cameraState.isOn) {
      try {
        //turn off via camera API
        console.log(`[Flashlight] Auto-off: Toggling flashlight OFF for camera ${sourceId}`);
        const baseUrl = this._getCameraUrl(sourceId);
        const flashlightUrl = `${baseUrl}/v1/camera/torch_toggle`;
        const response = await fetch(flashlightUrl, { 
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain'
          }
        });
        
        if (response.ok) {
          this._resetCameraState(sourceId);
          console.log(`[Flashlight] Auto-off: Successfully turned off camera ${sourceId}`);
          
          //resume motion detection when flashlight turns off
          this._resumeMotionDetection();
        } else {
          console.error(`[Flashlight] Auto-off: Failed to turn off camera ${sourceId}:`, response.status);
        }
      } catch (error) {
        console.error(`[Flashlight] Auto-off error for camera ${sourceId}:`, error);
      }
    }
  }

  //auto-off functionality (private method)
  async _autoOff() {
    //only toggle if flashlight is still on
    if (this.state.isOn) {
      try {
        //turn off via DroidCam API
        console.log('[Flashlight] Auto-off: Toggling flashlight OFF');
        const flashlightUrl = `http://${config.DROIDCAM_IP}:${config.DROIDCAM_PORT}/v1/camera/torch_toggle`;
        const response = await fetch(flashlightUrl, { 
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain'
          }
        });
        
        if (response.ok) {
          this._resetState();
          console.log('[Flashlight] Auto-off: Successfully turned off');
          
          //resume motion detection when flashlight turns off
          this._resumeMotionDetection();
        } else {
          console.error('[Flashlight] Auto-off: Failed to turn off:', response.status);
        }
      } catch (error) {
        console.error('[Flashlight] Auto-off error:', error);
      }
    }
  }

  //resume motion detection (private method)
  _resumeMotionDetection() {
    if (this.motionDetectionService) {
      this.motionDetectionService.resume();
      console.log('[Flashlight] Motion detection resumed');
    }
  }

  //reset state (private method)
  _resetState() {
    this.state.isOn = false;
    this.state.turnedOnAt = null;
    this._clearTimeout();
  }

  //clear timeout (private method)
  _clearTimeout() {
    if (this.state.autoOffTimeout) {
      clearTimeout(this.state.autoOffTimeout);
      this.state.autoOffTimeout = null;
    }
  }

  //cleanup method for shutdown
  cleanup() {
    this._clearTimeout();
    
    //cleanup all camera timeouts
    for (const [sourceId] of this.cameras) {
      this._clearCameraTimeout(sourceId);
    }
    
    console.log('[Flashlight] State cleanup completed');
  }

  //get raw state (for compatibility with existing code)
  getRawState() {
    return { ...this.state };
  }

  //backwards compatibility properties for tests
  get isOn() {
    return this.state.isOn;
  }

  set isOn(value) {
    this.state.isOn = value;
  }

  get turnedOnAt() {
    return this.state.turnedOnAt;
  }

  set turnedOnAt(value) {
    this.state.turnedOnAt = value;
  }

  get autoOffTimeout() {
    return this.state.autoOffTimeout;
  }

  set autoOffTimeout(value) {
    this.state.autoOffTimeout = value;
  }
}

//create and export singleton instance
const flashlightState = new FlashlightState();
export default flashlightState;