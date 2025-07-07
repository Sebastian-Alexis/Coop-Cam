import http from 'http';

const DROIDCAM_URL = 'http://192.168.1.67:4747/video';

console.log(`Testing MJPEG stream from: ${DROIDCAM_URL}\n`);

const req = http.get(DROIDCAM_URL, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  console.log('\nReceiving data...\n');
  
  let totalBytes = 0;
  let frameCount = 0;
  let buffer = Buffer.alloc(0);
  
  res.on('data', (chunk) => {
    totalBytes += chunk.length;
    buffer = Buffer.concat([buffer, chunk]);
    
    // Look for JPEG markers
    while (true) {
      const jpegStart = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
      if (jpegStart === -1) break;
      
      const jpegEnd = buffer.indexOf(Buffer.from([0xFF, 0xD9]), jpegStart + 2);
      if (jpegEnd === -1) break;
      
      frameCount++;
      const frameSize = jpegEnd + 2 - jpegStart;
      console.log(`Frame ${frameCount}: ${frameSize} bytes`);
      
      buffer = buffer.slice(jpegEnd + 2);
      
      if (frameCount >= 5) {
        console.log(`\nReceived ${frameCount} frames, ${totalBytes} total bytes`);
        console.log('Stream is working correctly!');
        process.exit(0);
      }
    }
  });
  
  res.on('error', (err) => {
    console.error('Stream error:', err);
  });
  
  res.on('end', () => {
    console.log('Stream ended');
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
  console.error('\nMake sure DroidCam is running and streaming!');
});

req.setTimeout(10000, () => {
  console.log(`\nTimeout after 10s. Received ${frameCount} frames`);
  if (frameCount === 0) {
    console.log('No frames received. Check if DroidCam is actually streaming video.');
  }
  req.destroy();
});