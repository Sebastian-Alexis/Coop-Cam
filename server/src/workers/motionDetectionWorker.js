import { parentPort } from 'worker_threads';
import sharp from 'sharp';
import { 
  normalizeIllumination, 
  normalizeColorIllumination 
} from '../utils/shadowRemovalUtils.js';
import {
  normalizeColorIllumination as normalizeColorIlluminationUtils
} from '../utils/colorShadowRemovalUtils.js';

//worker thread for processing motion detection frames
//this runs in a separate thread to avoid blocking the main event loop

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

//performance metrics
let processedFrames = 0;
let totalProcessingTime = 0;

//handle messages from the main thread
parentPort.on('message', async (message) => {
  const { type, data, id } = message;
  
  try {
    switch (type) {
      case 'processFrame':
        await handleProcessFrame(data, id);
        break;
        
      case 'getStats':
        handleGetStats(id);
        break;
        
      case 'shutdown':
        handleShutdown();
        break;
        
      default:
        parentPort.postMessage({
          id,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    console.error('[Worker] Error processing message:', error);
    parentPort.postMessage({
      id,
      error: error.message,
      stack: error.stack
    });
  }
});

async function handleProcessFrame(data, messageId) {
  const startTime = Date.now();
  const {
    frame,
    config,
    isColorMode,
    shadowRemovalEnabled,
    shadowRemovalIntensity
  } = data;
  
  try {
    let processed;
    
    if (isColorMode) {
      //resize and keep RGB color data
      processed = await sharp(Buffer.from(frame))
        .resize(config.width, config.height, {
          fit: 'fill',
          kernel: sharp.kernel.nearest //fast resize
        })
        .raw()
        .toBuffer();
      
      //apply color-aware shadow removal if enabled
      if (shadowRemovalEnabled) {
        processed = await normalizeColorIlluminationUtils(
          processed, 
          config.width, 
          config.height,
          shadowRemovalIntensity
        );
      }
    } else {
      //original grayscale processing
      processed = await sharp(Buffer.from(frame))
        .resize(config.width, config.height, {
          fit: 'fill',
          kernel: sharp.kernel.nearest //fast resize
        })
        .grayscale()
        .raw()
        .toBuffer();
      
      //apply shadow removal if enabled
      if (shadowRemovalEnabled) {
        processed = await normalizeIllumination(
          processed, 
          config.width, 
          config.height,
          shadowRemovalIntensity
        );
      }
    }
    
    //update metrics
    const processingTime = Date.now() - startTime;
    processedFrames++;
    totalProcessingTime += processingTime;
    
    //send processed frame back to main thread
    //we transfer the buffer to avoid copying
    parentPort.postMessage({
      id: messageId,
      type: 'frameProcessed',
      data: {
        processed: processed.buffer,
        processingTime,
        frameNumber: processedFrames
      }
    }, [processed.buffer]);
    
  } catch (error) {
    console.error('[Worker] Error processing frame:', error);
    parentPort.postMessage({
      id: messageId,
      error: error.message,
      stack: error.stack
    });
  }
}

function handleGetStats(messageId) {
  const stats = {
    processedFrames,
    totalProcessingTime,
    averageProcessingTime: processedFrames > 0 
      ? totalProcessingTime / processedFrames 
      : 0,
    uptime: process.uptime()
  };
  
  parentPort.postMessage({
    id: messageId,
    type: 'stats',
    data: stats
  });
}

function handleShutdown() {
  console.log(`[Worker] Shutting down. Processed ${processedFrames} frames`);
  process.exit(0);
}

//handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Worker] Uncaught exception:', error);
  parentPort.postMessage({
    type: 'error',
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Worker] Unhandled rejection at:', promise, 'reason:', reason);
  parentPort.postMessage({
    type: 'error',
    error: 'Unhandled promise rejection',
    reason: reason?.toString()
  });
  process.exit(1);
});

console.log('[Worker] Motion detection worker started');