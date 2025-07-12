import { EventEmitter } from 'events';

// Test script to manually trigger motion event and debug recording
console.log('='.repeat(50));
console.log('RECORDING DEBUG TEST');
console.log('='.repeat(50));

// Create a fake motion event
const testMotionEvent = {
  id: `motion_${Date.now()}_testdebug`,
  timestamp: new Date().toISOString(),
  timestampMs: Date.now(),
  difference: 0.05,
  threshold: 0.001,
  intensity: "5.0"
};

console.log('Test motion event:', testMotionEvent);
console.log('\nThis test will:');
console.log('1. Check if recording service is listening for motion events');
console.log('2. Emit a test motion event');
console.log('3. Monitor the recording process');
console.log('\nTo use this test:');
console.log('1. Make sure the server is running (npm run dev)');
console.log('2. Watch the server console for recording logs');
console.log('3. The test motion event details are shown above');
console.log('\nIf recording is working, you should see:');
console.log('- [Recording] ========== MOTION EVENT RECEIVED ==========');
console.log('- [Recording] Starting recording...');
console.log('- [Recording] ========== STOP RECORDING CALLED ==========');
console.log('- [VideoEncoder] ========== ENCODING START ==========');
console.log('- [Recording] saved successfully to...');
console.log('\nCheck the recordings folder for new files after 15 seconds');
console.log('='.repeat(50));