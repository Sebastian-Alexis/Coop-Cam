import http from 'http';

const DROIDCAM_IP = '192.168.1.67';
const DROIDCAM_PORT = '4747';

console.log('Testing DroidCam endpoints...\n');

const endpoints = [
  '/',
  '/remote',
  '/video',
  '/mjpegfeed',
  '/mjpegfeed?640x480',
  '/shot.jpg',
  '/stream',
  '/videofeed'
];

async function testEndpoint(path) {
  return new Promise((resolve) => {
    const url = `http://${DROIDCAM_IP}:${DROIDCAM_PORT}${path}`;
    console.log(`Testing: ${url}`);
    
    const req = http.get(url, (res) => {
      console.log(`  Status: ${res.statusCode}`);
      console.log(`  Headers:`, res.headers);
      
      // Get first chunk of data
      let firstChunk = null;
      res.on('data', (chunk) => {
        if (!firstChunk) {
          firstChunk = chunk;
          // Check if it's JPEG data
          if (chunk[0] === 0xFF && chunk[1] === 0xD8) {
            console.log('  Data: Looks like JPEG data!');
          } else {
            console.log(`  Data: First bytes: ${chunk.slice(0, 20).toString('hex')}...`);
          }
        }
      });
      
      res.on('end', () => {
        console.log('');
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.log(`  Error: ${err.message}\n`);
      resolve();
    });
    
    req.setTimeout(3000, () => {
      console.log('  Timeout after 3s\n');
      req.destroy();
      resolve();
    });
  });
}

async function runTests() {
  for (const endpoint of endpoints) {
    await testEndpoint(endpoint);
  }
  
  console.log('\nTesting complete!');
  console.log('\nNOTE: DroidCam must be running and configured to stream.');
  console.log('Make sure the DroidCam app is open on your phone and showing the camera view.');
}

runTests();