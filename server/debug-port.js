import net from 'net';
import { config } from './src/config.js';

const PORT = config.SERVER_PORT;
const HOST = config.SERVER_HOST;

console.log('=== Port Diagnostics ===');
console.log('Platform:', process.platform);
console.log('Node.js version:', process.version);
console.log('Process PID:', process.pid);
console.log('Target port:', PORT);
console.log('Target host:', HOST);
console.log('');

// Test 1: Basic port availability
console.log('Test 1: Basic port test...');
const testServer1 = net.createServer();

testServer1.listen(PORT, HOST, () => {
  console.log(`✓ Port ${PORT} is available on ${HOST}`);
  testServer1.close(() => {
    console.log('✓ Test server closed successfully');
    
    // Test 2: Rapid succession test (simulating the real scenario)
    console.log('');
    console.log('Test 2: Rapid succession test...');
    setTimeout(() => {
      const testServer2 = net.createServer();
      testServer2.listen(PORT, HOST, () => {
        console.log(`✓ Port ${PORT} still available after delay`);
        testServer2.close(() => {
          console.log('✓ Second test server closed successfully');
          console.log('');
          console.log('=== Diagnosis Complete ===');
          console.log('Port appears to be available. The issue may be:');
          console.log('1. Express-specific binding problem');
          console.log('2. Windows process/service conflict');
          console.log('3. Firewall or security software interference');
          console.log('');
          console.log('Recommendation: Run from PowerShell to see the enhanced error output.');
        });
      });
      
      testServer2.on('error', (error) => {
        console.error('✗ Second test failed:', error.message);
        console.error('This suggests a timing or cleanup issue');
      });
    }, 100);
  });
});

testServer1.on('error', (error) => {
  console.error('✗ Port test failed:', error.message);
  console.error('Error code:', error.code);
  
  if (error.code === 'EADDRINUSE') {
    console.error('');
    console.error('Port is indeed in use. Check:');
    console.error('1. Other Node.js processes running');
    console.error('2. Windows reserved port ranges');
    console.error('3. Other services using this port');
  }
});