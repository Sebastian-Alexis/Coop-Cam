//reaction controller - manages user reactions to recordings
//factory function receives dependencies for clean testing and modularity

export const createReactionController = ({ reactionService, REACTION_TYPES, CHICKEN_TONES }) => {
  if (!reactionService) {
    throw new Error('ReactionController: reactionService dependency is required.');
  }
  if (!REACTION_TYPES) {
    throw new Error('ReactionController: REACTION_TYPES dependency is required.');
  }
  if (!CHICKEN_TONES) {
    throw new Error('ReactionController: CHICKEN_TONES dependency is required.');
  }

  //helper to extract user ID from cookies or headers
  const getUserId = (req) => {
    return req.cookies?.viewerId || req.headers['x-viewer-id'];
  };

  //get reactions for a single recording
  const getReactions = async (req, res) => {
    try {
      const filename = req.params.filename;
      const userId = getUserId(req);
      
      const reactions = await reactionService.getReactions(filename, userId);
      
      res.json({
        success: true,
        ...reactions,
        reactionTypes: REACTION_TYPES,
        chickenTones: CHICKEN_TONES
      });
    } catch (error) {
      console.error('[Reactions API] Error getting reactions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get reactions',
        message: error.message
      });
    }
  };

  //add or update a reaction
  const addReaction = async (req, res) => {
    try {
      const filename = req.params.filename;
      const { reaction, tone } = req.body;
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User identification required'
        });
      }
      
      if (!reaction || !REACTION_TYPES[reaction]) {
        return res.status(400).json({
          success: false,
          error: 'Invalid reaction type',
          validTypes: Object.keys(REACTION_TYPES)
        });
      }
      
      const result = await reactionService.addReaction(filename, userId, reaction, tone);
      res.json(result);
    } catch (error) {
      console.error('[Reactions API] Error adding reaction:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add reaction',
        message: error.message
      });
    }
  };

  //remove a reaction
  const removeReaction = async (req, res) => {
    try {
      const filename = req.params.filename;
      const userId = getUserId(req);
      const { reactionType, tone } = req.body; //optional: specific reaction and/or tone to remove
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User identification required'
        });
      }
      
      const result = await reactionService.removeReaction(filename, userId, reactionType, tone);
      res.json(result);
    } catch (error) {
      console.error('[Reactions API] Error removing reaction:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove reaction',
        message: error.message
      });
    }
  };

  //get reactions for multiple recordings (batch)
  const getBatchReactions = async (req, res) => {
    try {
      const { filenames } = req.body;
      const userId = getUserId(req);
      
      if (!filenames || !Array.isArray(filenames)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'filenames array required'
        });
      }
      
      const reactions = await reactionService.getMultipleReactions(filenames, userId);
      
      res.json({
        success: true,
        reactions,
        reactionTypes: REACTION_TYPES,
        chickenTones: CHICKEN_TONES
      });
    } catch (error) {
      console.error('[Reactions API] Error getting batch reactions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get reactions',
        message: error.message
      });
    }
  };

  return {
    getReactions,
    addReaction,
    removeReaction,
    getBatchReactions
  };
};