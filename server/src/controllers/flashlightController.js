//flashlight controller - business logic for flashlight operations
//factory function receives dependencies for clean testing and modularity

export const createFlashlightController = ({ flashlightState }) => {
  if (!flashlightState) {
    throw new Error('FlashlightController: flashlightState dependency is required.');
  }

  //get flashlight status with mobile caching headers
  const getStatus = (req, res) => {
    const { sourceId } = req.params;
    const status = flashlightState.getStatus(sourceId);
    
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
    const { sourceId } = req.params;
    const result = await flashlightState.turnOn(sourceId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  };

  //turn flashlight off
  const turnOff = async (req, res) => {
    const { sourceId } = req.params;
    const result = await flashlightState.turnOff(sourceId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  };

  //legacy endpoint - for backwards compatibility
  const legacyToggle = async (req, res) => {
    //legacy behavior uses default camera (no sourceId)
    const result = await flashlightState.turnOn();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  };

  //legacy status endpoint - for backwards compatibility
  const legacyGetStatus = (req, res) => {
    //legacy behavior uses default camera (no sourceId)
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

  //legacy turn off endpoint - for backwards compatibility
  const legacyTurnOff = async (req, res) => {
    //legacy behavior uses default camera (no sourceId)
    const result = await flashlightState.turnOff();
    
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
    legacyToggle,
    legacyGetStatus,
    legacyTurnOff
  };
};