//recording controller - manages video recordings, thumbnails, and streaming
//factory function receives dependencies for clean testing and modularity

import fs from 'fs';
import path from 'path';

//helper function to centralize security-critical path validation
const _validateAndConstructPath = (filename, config) => {
  const dateRegex = /(\d{4}-\d{2}-\d{2})/;
  const match = filename.match(dateRegex);
  if (!match) {
    return { error: 'Invalid filename format', status: 400 };
  }

  const dateDir = match[1];
  const videoPath = path.join(config.recording.outputDir, dateDir, filename);
  
  //security: ensure the resolved path is within the intended directory
  const recordingsDir = path.resolve(config.recording.outputDir);
  const resolvedVideoPath = path.resolve(videoPath);

  if (!resolvedVideoPath.startsWith(recordingsDir)) {
    //return 404 for path traversal attempts to match original behavior and tests
    return { error: 'Video not found', status: 404 };
  }

  return { videoPath, dateDir };
};

export const createRecordingController = ({ thumbnailService, reactionService, config, REACTION_TYPES, CHICKEN_TONES }) => {
  if (!thumbnailService) {
    throw new Error('RecordingController: thumbnailService dependency is required.');
  }
  if (!reactionService) {
    throw new Error('RecordingController: reactionService dependency is required.');
  }
  if (!config) {
    throw new Error('RecordingController: config dependency is required.');
  }
  if (!REACTION_TYPES) {
    throw new Error('RecordingController: REACTION_TYPES dependency is required.');
  }
  if (!CHICKEN_TONES) {
    throw new Error('RecordingController: CHICKEN_TONES dependency is required.');
  }

  //helper to extract user ID from cookies or headers
  const getUserId = (req) => {
    return req.cookies?.viewerId || req.headers['x-viewer-id'];
  };

  //get recent recordings with metadata and reaction data
  const getRecentRecordings = async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 3;
      const userId = getUserId(req);
      const recordings = await thumbnailService.getRecentRecordings(config.recording.outputDir, limit);
      
      //get reactions for all recordings
      const filenames = recordings.map(rec => rec.filename);
      const reactionsData = await reactionService.getMultipleReactions(filenames, userId);
      
      //transform paths to relative URLs and include reactions
      const recordingsWithUrls = recordings.map(rec => ({
        ...rec,
        thumbnailUrl: rec.thumbnailExists ? `/api/recordings/thumbnail/${encodeURIComponent(rec.filename)}` : null,
        videoUrl: `/api/recordings/video/${encodeURIComponent(rec.filename)}`,
        //calculate duration from metadata if available
        duration: rec.metadata.endTime && rec.metadata.startTime ? 
          Math.round((new Date(rec.metadata.endTime) - new Date(rec.metadata.startTime)) / 1000) : null,
        //include reaction data
        reactions: reactionsData[rec.filename] || {
          summary: Object.keys(REACTION_TYPES).reduce((acc, type) => {
            acc[type] = {};
            return acc;
          }, {}),
          totalReactions: 0,
          userReaction: null
        }
      }));
      
      res.json({
        success: true,
        recordings: recordingsWithUrls,
        reactionTypes: REACTION_TYPES,
        chickenTones: CHICKEN_TONES
      });
    } catch (error) {
      console.error('[Recordings API] Error getting recent recordings:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recent recordings',
        message: error.message
      });
    }
  };

  //serve thumbnail image with dynamic generation
  const getThumbnail = async (req, res) => {
    try {
      const filename = req.params.filename;
      const validation = _validateAndConstructPath(filename, config);
      
      if (validation.error) {
        return res.status(validation.status).json({ error: validation.error });
      }
      
      const { videoPath } = validation;
      const thumbnailPath = thumbnailService.getThumbnailPath(videoPath);
      
      //check if thumbnail exists
      if (!fs.existsSync(thumbnailPath)) {
        //try to generate thumbnail if it doesn't exist
        try {
          await thumbnailService.generateThumbnail(videoPath);
        } catch (genError) {
          console.error('[Thumbnail API] Generation failed:', genError);
          return res.status(404).json({ error: 'Thumbnail not found and could not be generated' });
        }
      }
      
      //serve the thumbnail with cache headers
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600' //cache for 1 hour
      });
      
      //ensure absolute path for sendFile
      const absoluteThumbnailPath = path.resolve(thumbnailPath);
      res.sendFile(absoluteThumbnailPath);
    } catch (error) {
      console.error('[Thumbnail API] Error serving thumbnail:', error);
      res.status(500).json({ error: 'Failed to serve thumbnail' });
    }
  };

  //serve video file with range request support for streaming
  const getVideo = async (req, res) => {
    try {
      const filename = req.params.filename;
      const validation = _validateAndConstructPath(filename, config);
      
      if (validation.error) {
        return res.status(validation.status).json({ error: validation.error });
      }
      
      const { videoPath } = validation;
      
      //check if video exists
      if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: 'Video not found' });
      }
      
      //get video stats
      const stats = await fs.promises.stat(videoPath);
      const fileSize = stats.size;
      
      //handle range requests for video streaming
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };
        
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
      }
    } catch (error) {
      console.error('[Video API] Error serving video:', error);
      res.status(500).json({ error: 'Failed to serve video' });
    }
  };

  return {
    getRecentRecordings,
    getThumbnail,
    getVideo
  };
};