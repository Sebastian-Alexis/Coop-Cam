import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { PassThrough } from 'stream';

//video encoder service using FFmpeg
class VideoEncoderService {
  constructor(config) {
    this.config = config.recording;
    this.activeEncodings = new Map();
  }

  //encode frames to video file
  async encodeFramesToVideo(frames, outputPath, recordingId) {
    console.log(`[VideoEncoder] ========== ENCODING START ==========`);
    console.log(`[VideoEncoder] Recording ID: ${recordingId}`);
    console.log(`[VideoEncoder] Output path: ${outputPath}`);
    console.log(`[VideoEncoder] Frame count: ${frames?.length || 0}`);
    
    if (!frames || frames.length === 0) {
      console.error('[VideoEncoder] ERROR: No frames provided for encoding');
      throw new Error('No frames provided for encoding');
    }

    console.log(`[VideoEncoder] Starting encoding for ${recordingId} with ${frames.length} frames`);

    //ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    //create a pass-through stream for piping frames
    const inputStream = new PassThrough();

    //calculate actual fps from frame timestamps
    const startTime = frames[0].timestamp;
    const endTime = frames[frames.length - 1].timestamp;
    const durationSeconds = (endTime - startTime) / 1000;
    const actualFps = Math.round(frames.length / durationSeconds) || this.config.fps;

    console.log(`[VideoEncoder] Calculated FPS: ${actualFps} (${durationSeconds.toFixed(2)}s duration)`);

    //video quality presets
    const qualityPresets = {
      low: { videoBitrate: '500k', crf: 28 },
      medium: { videoBitrate: '1000k', crf: 23 },
      high: { videoBitrate: '2000k', crf: 18 }
    };

    const quality = qualityPresets[this.config.videoQuality] || qualityPresets.medium;

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(inputStream)
        .inputFormat('image2pipe')
        .inputFPS(actualFps)
        .videoCodec(this.config.videoCodec)
        .outputOptions([
          `-preset ${this.config.videoPreset}`,
          `-crf ${quality.crf}`,
          `-b:v ${quality.videoBitrate}`,
          '-pix_fmt yuv420p',
          '-movflags +faststart'
        ])
        .fps(this.config.fps)
        .on('start', (commandLine) => {
          console.log(`[VideoEncoder] FFmpeg command: ${commandLine}`);
          this.activeEncodings.set(recordingId, command);
        })
        .on('progress', (progress) => {
          console.log(`[VideoEncoder] ${recordingId} progress: ${progress.percent?.toFixed(1)}%`);
        })
        .on('error', (err) => {
          console.error(`[VideoEncoder] ========== ENCODING ERROR ==========`);
          console.error(`[VideoEncoder] ${recordingId} error:`, err.message);
          console.error(`[VideoEncoder] Full error:`, err);
          console.error(`[VideoEncoder] Stack trace:`, err.stack);
          this.activeEncodings.delete(recordingId);
          reject(err);
        })
        .on('end', () => {
          console.log(`[VideoEncoder] ========== ENCODING SUCCESS ==========`);
          console.log(`[VideoEncoder] ${recordingId} completed successfully`);
          console.log(`[VideoEncoder] Output file: ${outputPath}`);
          this.activeEncodings.delete(recordingId);
          resolve(outputPath);
        })
        .save(outputPath);

      //pipe frames to ffmpeg
      this.pipeFramesToFFmpeg(inputStream, frames, recordingId);
    });
  }

  //pipe frames to ffmpeg input stream
  async pipeFramesToFFmpeg(stream, frames, recordingId) {
    try {
      console.log(`[VideoEncoder] Piping ${frames.length} frames to FFmpeg`);
      
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (!frame || !frame.data) {
          console.warn(`[VideoEncoder] Skipping invalid frame ${i}`);
          continue;
        }

        //write frame data to stream
        const writeSuccess = stream.write(frame.data);
        
        //handle backpressure
        if (!writeSuccess) {
          await new Promise(resolve => stream.once('drain', resolve));
        }

        //log progress periodically
        if (i % 30 === 0) {
          console.log(`[VideoEncoder] ${recordingId} piped ${i}/${frames.length} frames`);
        }
      }

      //close the stream
      stream.end();
      console.log(`[VideoEncoder] ${recordingId} finished piping frames`);
    } catch (error) {
      console.error(`[VideoEncoder] ${recordingId} pipe error:`, error);
      stream.destroy(error);
    }
  }

  //cancel an active encoding
  cancelEncoding(recordingId) {
    const command = this.activeEncodings.get(recordingId);
    if (command) {
      console.log(`[VideoEncoder] Cancelling encoding for ${recordingId}`);
      command.kill('SIGKILL');
      this.activeEncodings.delete(recordingId);
      return true;
    }
    return false;
  }

  //get active encoding count
  getActiveEncodingCount() {
    return this.activeEncodings.size;
  }

  //check if ffmpeg is available
  async checkFFmpegAvailable() {
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          console.error('[VideoEncoder] FFmpeg not available:', err.message);
          resolve(false);
        } else {
          console.log('[VideoEncoder] FFmpeg is available');
          resolve(true);
        }
      });
    });
  }
}

export default VideoEncoderService;