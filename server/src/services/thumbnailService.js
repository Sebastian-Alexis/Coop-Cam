import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

//thumbnail generation service
class ThumbnailService {
  constructor() {
    this.thumbnailCache = new Map();
  }

  //generate thumbnail from video file
  async generateThumbnail(videoPath, options = {}) {
    const {
      seekTime = 3, //capture frame at 3 seconds (during motion)
      width = 320,
      height = 240,
      quality = 2 //1-31, lower is better quality
    } = options;

    //validate video exists
    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    //generate thumbnail path
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath, '.mp4');
    const thumbnailPath = path.join(videoDir, `${videoBasename}_thumb.jpg`);

    //check if thumbnail already exists
    if (existsSync(thumbnailPath)) {
      console.log(`[Thumbnail] Already exists: ${thumbnailPath}`);
      return thumbnailPath;
    }

    console.log(`[Thumbnail] Generating thumbnail for: ${videoPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [seekTime],
          filename: `${videoBasename}_thumb.jpg`,
          folder: videoDir,
          size: `${width}x${height}`
        })
        .outputOptions([
          `-q:v ${quality}` //jpeg quality
        ])
        .on('end', () => {
          console.log(`[Thumbnail] Generated: ${thumbnailPath}`);
          resolve(thumbnailPath);
        })
        .on('error', (err) => {
          console.error(`[Thumbnail] Generation failed:`, err);
          reject(err);
        });
    });
  }

  //get thumbnail path for a video
  getThumbnailPath(videoPath) {
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath, '.mp4');
    return path.join(videoDir, `${videoBasename}_thumb.jpg`);
  }

  //check if thumbnail exists
  async thumbnailExists(videoPath) {
    const thumbnailPath = this.getThumbnailPath(videoPath);
    return existsSync(thumbnailPath);
  }

  //delete thumbnail
  async deleteThumbnail(videoPath) {
    const thumbnailPath = this.getThumbnailPath(videoPath);
    if (existsSync(thumbnailPath)) {
      await fs.unlink(thumbnailPath);
      console.log(`[Thumbnail] Deleted: ${thumbnailPath}`);
    }
  }

  //generate thumbnails for all videos in a directory
  async generateDirectoryThumbnails(directory, options = {}) {
    try {
      const files = await fs.readdir(directory);
      const videoFiles = files.filter(file => file.endsWith('.mp4'));
      
      console.log(`[Thumbnail] Processing ${videoFiles.length} videos in ${directory}`);
      
      const results = [];
      for (const videoFile of videoFiles) {
        const videoPath = path.join(directory, videoFile);
        try {
          const thumbnailPath = await this.generateThumbnail(videoPath, options);
          results.push({ video: videoPath, thumbnail: thumbnailPath, success: true });
        } catch (error) {
          console.error(`[Thumbnail] Failed for ${videoFile}:`, error.message);
          results.push({ video: videoPath, error: error.message, success: false });
        }
      }
      
      return results;
    } catch (error) {
      console.error(`[Thumbnail] Directory processing error:`, error);
      throw error;
    }
  }

  //get today's recordings with thumbnails (top 3 by movement) for specific camera
  async getTodaysRecordings(recordingsDir, limit = 3, camera = 'default') {
    try {
      const recordings = [];
      
      //get today's date directory
      const today = new Date().toISOString().split('T')[0]; //YYYY-MM-DD
      const todayDir = path.join(recordingsDir, today);
      
      //check if today's directory exists
      if (!existsSync(todayDir)) {
        console.log('[Thumbnail] No recordings directory for today');
        return [];
      }
      
      const stats = await fs.stat(todayDir);
      if (!stats.isDirectory()) {
        return [];
      }
      
      //get video files in today's directory for specific camera
      const files = await fs.readdir(todayDir);
      const allVideoFiles = files.filter(file => file.endsWith('.mp4'));
      
      //filter by camera using the new filename format: motion_${sourceId}_${recordingId}.mp4
      const videoFiles = allVideoFiles.filter(file => {
        //check for new format with camera prefix
        if (file.includes(`motion_${camera}_`)) {
          return true;
        }
        //backward compatibility: if no camera specified and file doesn't have camera prefix
        return camera === 'default' && file.startsWith('motion_') && !file.match(/motion_[^_]+_/);
      });
      
      console.log(`[Thumbnail] Found ${videoFiles.length} recordings for camera ${camera} (${allVideoFiles.length} total)`);
      
      //load all recordings with metadata
      for (const videoFile of videoFiles) {
        const videoPath = path.join(todayDir, videoFile);
        const metadataPath = videoPath.replace('.mp4', '.json');
        const thumbnailPath = this.getThumbnailPath(videoPath);
        
        //read metadata if exists
        let metadata = {};
        if (existsSync(metadataPath)) {
          try {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            metadata = JSON.parse(metadataContent);
          } catch (error) {
            console.error(`[Thumbnail] Failed to read metadata:`, error);
          }
        }
        
        //get file stats for fallback timestamp
        const videoStats = await fs.stat(videoPath);
        
        recordings.push({
          id: path.basename(videoFile, '.mp4'),
          filename: videoFile,
          videoPath: videoPath,
          thumbnailPath: thumbnailPath,
          thumbnailExists: existsSync(thumbnailPath),
          metadata: metadata,
          timestamp: metadata.startTime || videoStats.mtime.toISOString(),
          duration: metadata.duration || null,
          size: videoStats.size,
          movement: metadata.motion?.difference || 0,
          movementIntensity: metadata.motion?.intensity || '0%'
        });
      }
      
      //sort by movement (highest first)
      recordings.sort((a, b) => b.movement - a.movement);
      
      //return top 3
      return recordings.slice(0, limit);
    } catch (error) {
      console.error(`[Thumbnail] Error getting today's recordings:`, error);
      return [];
    }
  }
  
  //legacy method for compatibility
  async getRecentRecordings(recordingsDir, limit = 3, camera = 'default') {
    return this.getTodaysRecordings(recordingsDir, limit, camera);
  }
}

export default ThumbnailService;