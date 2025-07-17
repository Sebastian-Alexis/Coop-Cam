import http from 'http';

const DROIDCAM_URL = 'http://192.168.1.67:4747/video';

console.log('Direct DroidCam test...');
console.log('Make sure no other clients are connected to DroidCam!\n');

const req = http.get(DROIDCAM_URL, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Content-Type: ${res.headers['content-type']}`);
  console.log(`Headers:`, res.headers);
  // console.log(`Body:`, res.body);
  
  if (res.headers['content-type']?.includes('text/html')) {
    console.log('\n❌ DroidCam returned HTML - it\'s not streaming video!');
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (body.includes('DroidCam is Busy')) {
        console.log('   DroidCam says it\'s busy - another client is connected.');
        console.log('   Disconnect all other DroidCam clients and try again.');
      } else {
        console.log('   HTML content received. DroidCam might not be in video mode.');
      }
      process.exit(1);
    });
    return;
  }
  
  console.log('\n✓ Connected! Waiting for video data...\n');
  
  let totalBytes = 0;
  let frameCount = 0;
  let buffer = Buffer.alloc(0);
  const startTime = Date.now();
  
  res.on('data', (chunk) => {
    totalBytes += chunk.length;
    buffer = Buffer.concat([buffer, chunk]);
    
    //look for any jpeg frames, need this for mjpeg proxy. basically grabbing each frame and replaying it
    //just bc droidcam only allows 1 client at a time, this proxy is needed
    while (true) {
      const jpegStart = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
      if (jpegStart === -1) break;
      
      const jpegEnd = buffer.indexOf(Buffer.from([0xFF, 0xD9]), jpegStart + 2);
      if (jpegEnd === -1) break;
      
      frameCount++;
      const frameSize = jpegEnd + 2 - jpegStart;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Frame ${frameCount}: ${frameSize} bytes (${elapsed}s elapsed)`);
      
      buffer = buffer.slice(jpegEnd + 2);
      
      if (frameCount >= 10) {
        console.log(`\n✓ Success! Received ${frameCount} frames, ${totalBytes} bytes total`);
        console.log('DroidCam stream is working correctly!');
        process.exit(0);
      }
    }
  });
  
  res.on('error', (err) => {
    console.error('Stream error:', err);
    process.exit(1);
  });
  
  res.on('end', () => {
    console.log(`\nStream ended. Received ${frameCount} frames, ${totalBytes} bytes`);
    if (frameCount === 0) {
      console.log('❌ No frames received!');
    }
  });
});

req.on('error', (err) => {
  console.error('Connection error:', err.message);
  console.error('\nMake sure:');
  console.error('1. DroidCam app is running on your phone');
  console.error('2. Phone is connected to the same network');
  console.error('3. IP address 192.168.1.147 is correct');
  process.exit(1);
});

req.setTimeout(10000, () => {
  console.log(`\nTimeout after 10s. Received ${frameCount} frames`);
  if (frameCount === 0) {
    console.log('❌ No video frames received!');
    console.log('\nTroubleshooting:');
    console.log('1. Make sure DroidCam app is open and showing camera preview');
    console.log('2. Check that no other clients are connected');
    console.log('3. Try restarting the DroidCam app');
  }
  req.destroy();
  process.exit(1);
});