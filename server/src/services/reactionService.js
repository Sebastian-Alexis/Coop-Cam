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

//available chicken tones
export const CHICKEN_TONES = [
  'charcoal',
  'cheetopuff',
  'rusty',
  'toasty',
  'uv',
  'marshmallow'
];

//default tone for backward compatibility
export const DEFAULT_TONE = 'marshmallow';

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

  //migrate old string reactions to new object format
  migrateReactions(reactionsData) {
    let needsMigration = false;
    
    //check if any reactions are in old format (string)
    reactionsData.reactions.forEach((reaction, index) => {
      if (typeof reaction.reaction === 'string') {
        needsMigration = true;
        //convert to new format with default tone
        reactionsData.reactions[index] = {
          ...reaction,
          reaction: {
            type: reaction.reaction,
            tone: DEFAULT_TONE
          }
        };
      }
    });
    
    return { data: reactionsData, migrated: needsMigration };
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
      let reactionsData = JSON.parse(content);
      
      //migrate old format if needed
      const { data, migrated } = this.migrateReactions(reactionsData);
      reactionsData = data;
      
      if (migrated) {
        //save migrated data
        await this.saveReactions(recordingFilename, reactionsData);
        console.log(`[Reactions] Migrated reactions for ${recordingFilename} to new format`);
      }
      
      return reactionsData;
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
  async addReaction(recordingFilename, userId, reactionType, tone = DEFAULT_TONE) {
    //validate reaction type
    if (!REACTION_TYPES[reactionType]) {
      throw new Error(`Invalid reaction type: ${reactionType}`);
    }
    
    //validate tone
    if (!CHICKEN_TONES.includes(tone)) {
      throw new Error(`Invalid tone: ${tone}`);
    }
    
    //load current reactions
    const reactionsData = await this.loadReactions(recordingFilename);
    
    //find if user already has this specific reaction type WITH the same tone
    const existingIndex = reactionsData.reactions.findIndex(
      r => r.userId === userId && r.reaction.type === reactionType && r.reaction.tone === tone
    );
    
    if (existingIndex >= 0) {
      //update timestamp for existing reaction (same type and tone)
      reactionsData.reactions[existingIndex].timestamp = new Date().toISOString();
    } else {
      //add new reaction (user can have multiple of same type with different tones)
      reactionsData.reactions.push({
        userId,
        reaction: {
          type: reactionType,
          tone: tone
        },
        timestamp: new Date().toISOString()
      });
      
      //update summary (increment for any new reaction, even if same type with different tone)
      reactionsData.summary[reactionType]++;
    }
    
    //save updated reactions
    await this.saveReactions(recordingFilename, reactionsData);
    
    return {
      success: true,
      summary: reactionsData.summary,
      userReactions: this.getUserReactions(reactionsData, userId)
    };
  }

  //remove a specific user's reaction
  async removeReaction(recordingFilename, userId, reactionType = null, tone = null) {
    //load current reactions
    const reactionsData = await this.loadReactions(recordingFilename);
    
    let removed = false;
    
    if (reactionType) {
      //find reactions to remove based on criteria
      let toRemove = [];
      
      if (tone) {
        //remove specific reaction type with specific tone
        const existingIndex = reactionsData.reactions.findIndex(
          r => r.userId === userId && r.reaction.type === reactionType && r.reaction.tone === tone
        );
        if (existingIndex >= 0) {
          toRemove.push(existingIndex);
        }
      } else {
        //remove all reactions of this type regardless of tone (backward compatibility)
        reactionsData.reactions.forEach((r, index) => {
          if (r.userId === userId && r.reaction.type === reactionType) {
            toRemove.push(index);
          }
        });
      }
      
      //remove reactions in reverse order to maintain indices
      toRemove.sort((a, b) => b - a);
      toRemove.forEach(index => {
        const removedReaction = reactionsData.reactions[index];
        reactionsData.reactions.splice(index, 1);
        
        //update summary
        if (reactionsData.summary[removedReaction.reaction.type] > 0) {
          reactionsData.summary[removedReaction.reaction.type]--;
        }
        removed = true;
      });
    } else {
      //remove all reactions from this user (backward compatibility)
      const userReactions = reactionsData.reactions.filter(r => r.userId === userId);
      reactionsData.reactions = reactionsData.reactions.filter(r => r.userId !== userId);
      
      //update summary for each removed reaction
      userReactions.forEach(reaction => {
        if (reactionsData.summary[reaction.reaction.type] > 0) {
          reactionsData.summary[reaction.reaction.type]--;
        }
      });
      
      removed = userReactions.length > 0;
    }
    
    if (removed) {
      //save updated reactions
      await this.saveReactions(recordingFilename, reactionsData);
      
      return {
        success: true,
        summary: reactionsData.summary,
        userReactions: this.getUserReactions(reactionsData, userId)
      };
    }
    
    //no reaction to remove
    return {
      success: false,
      message: 'No reaction found for this user',
      summary: reactionsData.summary,
      userReactions: []
    };
  }
  
  //helper to get all reactions for a specific user
  getUserReactions(reactionsData, userId) {
    return reactionsData.reactions
      .filter(r => r.userId === userId)
      .map(r => r.reaction);
  }

  //get reactions for a recording including user's reaction
  async getReactions(recordingFilename, userId = null) {
    const reactionsData = await this.loadReactions(recordingFilename);
    
    const result = {
      summary: reactionsData.summary,
      totalReactions: reactionsData.reactions.length,
      userReactions: []
    };
    
    //find user's reactions if userId provided (multiple allowed)
    if (userId) {
      result.userReactions = this.getUserReactions(reactionsData, userId);
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