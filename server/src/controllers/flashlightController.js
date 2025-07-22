//flashlight controller - business logic for flashlight operations
//factory function receives dependencies for clean testing and modularity

export const createFlashlightController = ({ flashlightState }) => {
  if (!flashlightState) {
    throw new Error('FlashlightController: flashlightState dependency is required.');
  }

  //get flashlight status with mobile caching headers
  const getStatus = (req, res) => {
    const status = flashlightState.getStatus();
    
    //mobile-specific caching
    if (req.isMobile) {
      res.set({
        'Cache-Control': 'private, max-age=5', //short cache for mobile
        'X-Mobile-Optimized': 'true'
      });
    }
    
    res.json(status);
  };

  //turn flashlight on
  const turnOn = async (req, res) => {
    const result = await flashlightState.turnOn();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  };

  //turn flashlight off
  const turnOff = async (req, res) => {
    const result = await flashlightState.turnOff();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  };

  //legacy endpoint - for backwards compatibility
  const legacyToggle = async (req, res) => {
    const result = await flashlightState.turnOn();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  };

  return {
    getStatus,
    turnOn,
    turnOff,
    legacyToggle
  };
};