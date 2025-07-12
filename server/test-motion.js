import { config } from './src/config.js';

//ensure motion detection is enabled for this test
if (!config.motionDetection.enabled) {
  console.log('[Test] Motion detection is disabled. Enable it in .env file.');
  process.exit(1);
}

console.log('[Test] Motion detection configuration:');
console.log(`  - Enabled: ${config.motionDetection.enabled}`);
console.log(`  - FPS: ${config.motionDetection.fps}`);
console.log(`  - Threshold: ${config.motionDetection.threshold}`);
console.log(`  - Cooldown: ${config.motionDetection.cooldownMs}ms`);
console.log(`  - Processing size: ${config.motionDetection.width}x${config.motionDetection.height}`);
console.log('\n[Test] Starting server with motion detection...');
console.log('[Test] Try moving in front of the camera to trigger motion detection.');
console.log('[Test] Motion events will be logged to the console.');
console.log('[Test] Press Ctrl+C to stop.\n');

//import and start the server
import('./src/index.js');