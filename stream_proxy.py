#!/usr/bin/env python3

import asyncio
import aiohttp
from aiohttp import web
import weakref

DROIDCAM_URL = "http://192.168.1.147:4747/video"

class StreamProxy:
    def __init__(self):
        self.clients = weakref.WeakSet()
        self.frame_data = None
        self.running = False
    
    async def start_capture(self):
        """Continuously capture frames from DroidCam"""
        self.running = True
        async with aiohttp.ClientSession() as session:
            while self.running:
                try:
                    async with session.get(DROIDCAM_URL) as response:
                        if response.status == 200:
                            buffer = b''
                            async for chunk in response.content.iter_chunked(1024):
                                buffer += chunk
                                
                                # Look for JPEG boundaries
                                while True:
                                    start = buffer.find(b'\xff\xd8')
                                    if start == -1:
                                        break
                                    
                                    end = buffer.find(b'\xff\xd9', start)
                                    if end == -1:
                                        break
                                    
                                    # Extract complete JPEG
                                    frame = buffer[start:end+2]
                                    buffer = buffer[end+2:]
                                    
                                    # Broadcast to all clients
                                    if self.clients:
                                        await self.broadcast_frame(frame)
                except Exception as e:
                    print(f"Capture error: {e}")
                    await asyncio.sleep(1)
    
    async def broadcast_frame(self, frame):
        """Send frame to all connected clients"""
        frame_data = b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
        
        dead_clients = []
        for client in self.clients:
            try:
                await client.write(frame_data)
            except:
                dead_clients.append(client)
        
        # Remove dead clients
        for client in dead_clients:
            self.clients.discard(client)

proxy = StreamProxy()

async def stream_handler(request):
    """Handle client connections"""
    response = web.StreamResponse(
        status=200,
        headers={
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        }
    )
    
    await response.prepare(request)
    proxy.clients.add(response)
    
    try:
        # Keep connection alive
        while True:
            await asyncio.sleep(1)
    except:
        pass
    finally:
        proxy.clients.discard(response)
    
    return response

async def index_handler(request):
    """Serve a simple HTML page"""
    html = '''<!DOCTYPE html>
<html>
<head>
    <title>DroidCam Stream</title>
    <style>
        body { margin: 0; padding: 0; background: #000; }
        img { width: 100%; height: 100vh; object-fit: contain; }
    </style>
</head>
<body>
    <img src="/video" />
</body>
</html>'''
    return web.Response(text=html, content_type='text/html')

async def start_background_tasks(app):
    app['capture_task'] = asyncio.create_task(proxy.start_capture())

async def cleanup_background_tasks(app):
    proxy.running = False
    app['capture_task'].cancel()
    await app['capture_task']

app = web.Application()
app.router.add_get('/', index_handler)
app.router.add_get('/video', stream_handler)
app.on_startup.append(start_background_tasks)
app.on_cleanup.append(cleanup_background_tasks)

if __name__ == '__main__':
    print(f"Starting MJPEG proxy server on http://localhost:8443")
    print(f"Stream URL: http://localhost:8443/video")
    print(f"Web interface: http://localhost:8443/")
    web.run_app(app, host='0.0.0.0', port=8443)