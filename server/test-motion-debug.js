import { config } from './src/config.js';

//ensure motion detection is enabled
if (!config.motionDetection.enabled) {
  console.log('[Test] Motion detection is disabled. Enable it in .env file.');
  process.exit(1);
}

console.log('[Test] Motion Detection Debug Mode');
console.log('==================================');
console.log('[Test] Configuration:');
console.log(`  - Motion threshold: ${(config.motionDetection.threshold * 100).toFixed(2)}%`);
console.log(`  - Processing at: ${config.motionDetection.fps} FPS`);
console.log(`  - Image size: ${config.motionDetection.width}x${config.motionDetection.height}`);
console.log(`  - Cooldown: ${config.motionDetection.cooldownMs}ms`);
console.log(`  - Recording enabled: ${config.recording.enabled}`);
console.log('\n[Test] Starting server with debug logging...');
console.log('[Test] Watch console for motion detection logs.');
console.log('[Test] Every 10 frames will show the difference percentage.');
console.log('[Test] Press Ctrl+C to stop.\n');

//import and start the server
import('./src/index.js');