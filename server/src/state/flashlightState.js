import { config } from '../config.js';

//flashlight state management service
class FlashlightState {
  constructor() {
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

  //get current flashlight status with remaining time calculation
  getStatus() {
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

  //turn on flashlight
  async turnOn() {
    try {
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
      
    } catch (error) {
      console.error('[Flashlight] Turn on error:', error.message);
      console.error('[Flashlight] Full error:', error);
      return { 
        success: false, 
        message: 'Failed to turn on flashlight',
        error: error.message 
      };
    }
  }

  //turn off flashlight
  async turnOff() {
    try {
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
      
    } catch (error) {
      console.error('[Flashlight] Turn off error:', error);
      return { 
        success: false, 
        message: 'Failed to turn off flashlight',
        error: error.message 
      };
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