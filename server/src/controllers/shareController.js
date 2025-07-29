//share controller - manages sharing functionality for recordings
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

export const createShareController = ({ shareService, thumbnailService, config }) => {
  if (!shareService) {
    throw new Error('ShareController: shareService dependency is required.');
  }
  if (!thumbnailService) {
    throw new Error('ShareController: thumbnailService dependency is required.');
  }
  if (!config) {
    throw new Error('ShareController: config dependency is required.');
  }

  //create new share link for a recording
  const createShareLink = async (req, res) => {
    try {
      const { filename, expiresIn, requirePassword, password, customMessage } = req.body;
      
      if (!filename) {
        return res.status(400).json({
          success: false,
          error: 'Filename is required'
        });
      }

      //validate that the recording exists
      const validation = _validateAndConstructPath(filename, config);
      if (validation.error) {
        return res.status(validation.status).json({
          success: false,
          error: validation.error
        });
      }

      //check if video file exists
      if (!fs.existsSync(validation.videoPath)) {
        return res.status(404).json({
          success: false,
          error: 'Recording not found'
        });
      }

      //create share with options
      const shareOptions = {
        expiresIn: expiresIn || null,
        password: requirePassword ? password : null,
        customMessage: customMessage || null
      };

      const result = await shareService.createShare(filename, shareOptions);
      
      if (result.success) {
        res.json({
          success: true,
          token: result.token,
          shareUrl: result.shareUrl,
          expiresAt: result.expiresAt
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to create share link'
        });
      }
    } catch (error) {
      console.error('[ShareController] Error creating share link:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  //access shared recording via token
  const accessSharedRecording = async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body || {};
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Token is required'
        });
      }

      const validation = await shareService.validateShare(token, password);
      
      if (!validation.valid) {
        const status = validation.requiresPassword ? 401 : 404;
        return res.status(status).json({
          success: false,
          error: validation.error,
          requiresPassword: validation.requiresPassword || false
        });
      }

      //return share info and recording metadata
      res.json({
        success: true,
        share: validation.share,
        videoUrl: `/api/share/${token}/video`,
        thumbnailUrl: `/api/share/${token}/thumbnail`
      });
    } catch (error) {
      console.error('[ShareController] Error accessing shared recording:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  //serve shared video file
  const serveSharedVideo = async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.query;
      
      const validation = await shareService.validateShare(token, password);
      
      if (!validation.valid) {
        return res.status(404).json({
          success: false,
          error: validation.error
        });
      }

      const filename = validation.share.filename;
      const pathValidation = _validateAndConstructPath(filename, config);
      
      if (pathValidation.error) {
        return res.status(pathValidation.status).json({ error: pathValidation.error });
      }
      
      const { videoPath } = pathValidation;
      
      //check if video exists
      if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: 'Video not found' });
      }
      
      //get video stats for range requests
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
      console.error('[ShareController] Error serving shared video:', error);
      res.status(500).json({ error: 'Failed to serve video' });
    }
  };

  //serve shared thumbnail
  const serveSharedThumbnail = async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.query;
      
      const validation = await shareService.validateShare(token, password);
      
      if (!validation.valid) {
        return res.status(404).json({
          success: false,
          error: validation.error
        });
      }

      const filename = validation.share.filename;
      const pathValidation = _validateAndConstructPath(filename, config);
      
      if (pathValidation.error) {
        return res.status(pathValidation.status).json({ error: pathValidation.error });
      }
      
      const { videoPath } = pathValidation;
      const thumbnailPath = thumbnailService.getThumbnailPath(videoPath);
      
      //check if thumbnail exists, generate if not
      if (!fs.existsSync(thumbnailPath)) {
        try {
          await thumbnailService.generateThumbnail(videoPath);
        } catch (genError) {
          console.error('[ShareController] Thumbnail generation failed:', genError);
          return res.status(404).json({ error: 'Thumbnail not found and could not be generated' });
        }
      }
      
      //serve the thumbnail with cache headers
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600' //cache for 1 hour
      });
      
      const absoluteThumbnailPath = path.resolve(thumbnailPath);
      res.sendFile(absoluteThumbnailPath);
    } catch (error) {
      console.error('[ShareController] Error serving shared thumbnail:', error);
      res.status(500).json({ error: 'Failed to serve thumbnail' });
    }
  };

  //get share statistics
  const getShareStats = async (req, res) => {
    try {
      const { token } = req.params;
      
      const result = await shareService.getShareStats(token);
      
      if (result.error) {
        return res.status(404).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        stats: result.stats
      });
    } catch (error) {
      console.error('[ShareController] Error getting share stats:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  //revoke share link
  const revokeShare = async (req, res) => {
    try {
      const { token } = req.params;
      
      const result = await shareService.revokeShare(token);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Share link has been revoked'
        });
      } else {
        res.status(404).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error('[ShareController] Error revoking share:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  return {
    createShareLink,
    accessSharedRecording,
    serveSharedVideo,
    serveSharedThumbnail,
    getShareStats,
    revokeShare
  };
};