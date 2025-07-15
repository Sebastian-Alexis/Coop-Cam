import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

//get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//available reaction types
export const REACTION_TYPES = {
  sleeping: '/art/reactions/ChickenSleeping.gif',
  peck: '/art/reactions/ChickenPeck.gif',
  fly: '/art/reactions/ChickenFly.gif',
  jump: '/art/reactions/ChickenJump.gif',
  love: '/art/reactions/ChickenLove.gif'
};

//reaction service for managing video reactions
class ReactionService {
  constructor(config) {
    this.config = config;
    //reactions will be stored alongside recordings
    this.reactionsDir = config.recording.outputDir;
    console.log('[Reactions] Service initialized with directory:', this.reactionsDir);
  }

  //get reactions file path for a recording
  getReactionsFilePath(recordingFilename) {
    //extract date from filename (format: motion_YYYY-MM-DDTHH-MM-SS-sss_random.mp4)
    const match = recordingFilename.match(/motion_(\d{4}-\d{2}-\d{2})/);
    if (!match) {
      throw new Error('Invalid recording filename format');
    }
    
    const dateFolder = match[1];
    const baseName = path.basename(recordingFilename, '.mp4');
    const reactionsFilename = `${baseName}_reactions.json`;
    
    return path.join(this.reactionsDir, dateFolder, reactionsFilename);
  }

  //load reactions for a recording
  async loadReactions(recordingFilename) {
    try {
      const filePath = this.getReactionsFilePath(recordingFilename);
      
      if (!existsSync(filePath)) {
        //return empty reactions structure
        return {
          reactions: [],
          summary: Object.keys(REACTION_TYPES).reduce((acc, type) => {
            acc[type] = 0;
            return acc;
          }, {})
        };
      }
      
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[Reactions] Error loading reactions:', error);
      //return empty reactions on error
      return {
        reactions: [],
        summary: Object.keys(REACTION_TYPES).reduce((acc, type) => {
          acc[type] = 0;
          return acc;
        }, {})
      };
    }
  }

  //save reactions for a recording
  async saveReactions(recordingFilename, reactionsData) {
    try {
      const filePath = this.getReactionsFilePath(recordingFilename);
      const dir = path.dirname(filePath);
      
      //ensure directory exists
      await fs.mkdir(dir, { recursive: true });
      
      //save reactions
      await fs.writeFile(filePath, JSON.stringify(reactionsData, null, 2));
      
      console.log(`[Reactions] Saved reactions to ${filePath}`);
      return true;
    } catch (error) {
      console.error('[Reactions] Error saving reactions:', error);
      throw error;
    }
  }

  //add or update a user's reaction
  async addReaction(recordingFilename, userId, reactionType) {
    //validate reaction type
    if (!REACTION_TYPES[reactionType]) {
      throw new Error(`Invalid reaction type: ${reactionType}`);
    }
    
    //load current reactions
    const reactionsData = await this.loadReactions(recordingFilename);
    
    //find existing reaction from this user
    const existingIndex = reactionsData.reactions.findIndex(r => r.userId === userId);
    
    if (existingIndex >= 0) {
      //update existing reaction
      const oldReaction = reactionsData.reactions[existingIndex].reaction;
      reactionsData.reactions[existingIndex] = {
        userId,
        reaction: reactionType,
        timestamp: new Date().toISOString()
      };
      
      //update summary counts
      if (reactionsData.summary[oldReaction] > 0) {
        reactionsData.summary[oldReaction]--;
      }
      reactionsData.summary[reactionType]++;
    } else {
      //add new reaction
      reactionsData.reactions.push({
        userId,
        reaction: reactionType,
        timestamp: new Date().toISOString()
      });
      
      //update summary
      reactionsData.summary[reactionType]++;
    }
    
    //save updated reactions
    await this.saveReactions(recordingFilename, reactionsData);
    
    return {
      success: true,
      summary: reactionsData.summary,
      userReaction: reactionType
    };
  }

  //remove a user's reaction
  async removeReaction(recordingFilename, userId) {
    //load current reactions
    const reactionsData = await this.loadReactions(recordingFilename);
    
    //find user's reaction
    const existingIndex = reactionsData.reactions.findIndex(r => r.userId === userId);
    
    if (existingIndex >= 0) {
      //remove reaction
      const removedReaction = reactionsData.reactions[existingIndex];
      reactionsData.reactions.splice(existingIndex, 1);
      
      //update summary
      if (reactionsData.summary[removedReaction.reaction] > 0) {
        reactionsData.summary[removedReaction.reaction]--;
      }
      
      //save updated reactions
      await this.saveReactions(recordingFilename, reactionsData);
      
      return {
        success: true,
        summary: reactionsData.summary,
        userReaction: null
      };
    }
    
    //no reaction to remove
    return {
      success: false,
      message: 'No reaction found for this user',
      summary: reactionsData.summary,
      userReaction: null
    };
  }

  //get reactions for a recording including user's reaction
  async getReactions(recordingFilename, userId = null) {
    const reactionsData = await this.loadReactions(recordingFilename);
    
    const result = {
      summary: reactionsData.summary,
      totalReactions: reactionsData.reactions.length,
      userReaction: null
    };
    
    //find user's reaction if userId provided
    if (userId) {
      const userReaction = reactionsData.reactions.find(r => r.userId === userId);
      if (userReaction) {
        result.userReaction = userReaction.reaction;
      }
    }
    
    return result;
  }

  //get reactions for multiple recordings (batch operation)
  async getMultipleReactions(recordingFilenames, userId = null) {
    const results = {};
    
    //process in parallel for efficiency
    await Promise.all(
      recordingFilenames.map(async (filename) => {
        try {
          results[filename] = await this.getReactions(filename, userId);
        } catch (error) {
          console.error(`[Reactions] Error getting reactions for ${filename}:`, error);
          //return empty reactions on error
          results[filename] = {
            summary: Object.keys(REACTION_TYPES).reduce((acc, type) => {
              acc[type] = 0;
              return acc;
            }, {}),
            totalReactions: 0,
            userReaction: null
          };
        }
      })
    );
    
    return results;
  }

  //delete reactions file when recording is deleted
  async deleteReactions(recordingFilename) {
    try {
      const filePath = this.getReactionsFilePath(recordingFilename);
      
      if (existsSync(filePath)) {
        await fs.unlink(filePath);
        console.log(`[Reactions] Deleted reactions file: ${filePath}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[Reactions] Error deleting reactions:', error);
      return false;
    }
  }

  //get top reactions for analytics
  async getTopReactions(recordingFilename, limit = 3) {
    const reactionsData = await this.loadReactions(recordingFilename);
    
    //sort reaction types by count
    const sorted = Object.entries(reactionsData.summary)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    
    return sorted.map(([type, count]) => ({
      type,
      emoji: REACTION_TYPES[type],
      count
    }));
  }
}

export default ReactionService;