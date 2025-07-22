//motion controller - business logic for motion events and SSE connections
//factory function receives dependencies for clean testing and modularity

export const createMotionController = ({ sseService, motionEventsService }) => {
  if (!sseService) {
    throw new Error('MotionController: sseService dependency is required.');
  }
  if (!motionEventsService) {
    throw new Error('MotionController: motionEventsService dependency is required.');
  }

  //handle SSE connection for real-time motion events
  const handleSseConnection = (req, res) => {
    sseService.addClient(req, res);
  };

  //get motion event history with pagination support
  const getHistory = (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const since = req.query.since ? parseInt(req.query.since) : null;
    
    let events;
    
    //use service method based on query parameters
    if (since) {
      events = motionEventsService.getEventsSince(since);
    } else {
      events = motionEventsService.getRecentEvents(limit, offset);
    }
    
    //get total count for pagination info
    const totalEvents = motionEventsService.getCurrentSize();
    
    res.json({
      success: true,
      events: events,
      total: totalEvents,
      offset: offset,
      limit: limit,
      stats: motionEventsService.getStats()
    });
  };

  return {
    handleSseConnection,
    getHistory
  };
};