//reaction routes - manages user reactions to recordings
//maps HTTP methods and paths to controller functions

import express from 'express';

//factory function receives the controller
export const createReactionRouter = ({ reactionController }) => {
  const router = express.Router();

  //route mapping to controller methods
  router.get('/recordings/:filename/reactions', reactionController.getReactions);
  router.post('/recordings/:filename/reactions', reactionController.addReaction);
  router.delete('/recordings/:filename/reactions', reactionController.removeReaction);
  router.post('/recordings/reactions/batch', reactionController.getBatchReactions);

  return router;
};