#!/usr/bin/env python3

import aiohttp
from aiohttp import web
import os

DROIDCAM_HOST = "192.168.1.147"
DROIDCAM_PORT = 4747
DROIDCAM_BASE_URL = f"http://{DROIDCAM_HOST}:{DROIDCAM_PORT}"

async def control_proxy_handler(request):
    """Proxy flashlight control command to DroidCam"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return web.Response(
            status=200,
            headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        )
    
    async with aiohttp.ClientSession() as session:
        try:
            # Forward the flashlight toggle request to DroidCam
            url = f"{DROIDCAM_BASE_URL}/v1/camera/torch_toggle"
            print(f"Toggling flashlight: {url}")
            
            async with session.request(
                method='PUT',
                url=url,
                headers={
                    'Accept': '*/*',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': DROIDCAM_BASE_URL,
                    'Referer': f'{DROIDCAM_BASE_URL}/remote'
                }
            ) as response:
                text = await response.text()
                return web.Response(
                    text=text,
                    status=response.status,
                    headers={
                        'Content-Type': 'text/plain',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': '*'
                    }
                )
        except Exception as e:
            print(f"Control proxy error: {e}")
            return web.Response(
                text=f"Error: {str(e)}",
                status=500,
                headers={
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': '*'
                }
            )

app = web.Application()

# Single endpoint for flashlight toggle
app.router.add_route('*', '/api/flashlight', control_proxy_handler)

# Serve React build in production
if os.path.exists('dist'):
    app.router.add_static('/', path='dist', name='static')
    
    # Serve index.html for all routes (React SPA)
    async def index(request):
        return web.FileResponse(os.path.join('dist', 'index.html'))
    
    app.router.add_get('/{path:.*}', index)

if __name__ == '__main__':
    port = 8080
    print(f"Starting Coop Cam API on http://localhost:{port}")
    print(f"DroidCam URL: {DROIDCAM_BASE_URL}")
    print(f"\nMake sure stream_proxy.py is running on port 8443!")
    print(f"\nFor development: run 'npm install' then 'npm run dev'")
    print(f"For production: run 'npm run build' then this script")
    print(f"\nAPI endpoint: http://localhost:{port}/api/flashlight")
    web.run_app(app, host='0.0.0.0', port=port)