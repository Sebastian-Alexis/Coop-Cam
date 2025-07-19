import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('Mobile Optimization Tests', () => {
  describe('Mobile Detection', () => {
    it('should detect mobile user agents', async () => {
      const mobileUserAgents = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Mobile Safari/537.36',
        'Mozilla/5.0 (iPad; CPU OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/94.0.4606.76 Mobile/15E148 Safari/604.1'
      ];

      for (const userAgent of mobileUserAgents) {
        const response = await request(app)
          .get('/api/stats')
          .set('User-Agent', userAgent);

        expect(response.status).toBe(200);
        expect(response.headers['x-mobile-optimized']).toBe('true');
        expect(response.headers['connection']).toBe('close');
      }
    });

    it('should not detect desktop user agents as mobile', async () => {
      const desktopUserAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15'
      ];

      for (const userAgent of desktopUserAgents) {
        const response = await request(app)
          .get('/api/stats')
          .set('User-Agent', userAgent);

        expect(response.status).toBe(200);
        expect(response.headers['x-mobile-optimized']).toBeUndefined();
      }
    });
  });

  describe('Connection Headers', () => {
    it('should add Connection: close header for mobile non-streaming endpoints', async () => {
      const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) Mobile/15E148 Safari/604.1';
      
      // Test various endpoints
      const endpoints = ['/api/stats', '/api/weather', '/api/flashlight/status'];
      
      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .set('User-Agent', mobileUA);

        expect(response.headers['connection']).toBe('close');
      }
    });

    it('should NOT add Connection: close for streaming endpoints', (done) => {
      const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) Mobile/15E148 Safari/604.1';
      
      // SSE endpoint should keep connection alive
      const req = request(app)
        .get('/api/events/motion')
        .set('User-Agent', mobileUA);

      req.on('response', (res) => {
        expect(res.headers['connection']).toBe('keep-alive');
        req.abort();
        done();
      });
    });
  });

  describe('Mobile-Specific Caching', () => {
    it('should set appropriate cache headers for mobile requests', async () => {
      const mobileUA = 'Mozilla/5.0 (Android 11; Mobile) AppleWebKit/537.36';
      
      // Test stats endpoint
      const statsResponse = await request(app)
        .get('/api/stats')
        .set('User-Agent', mobileUA);
      
      expect(statsResponse.headers['cache-control']).toBe('private, max-age=10');
      
      // Test weather endpoint
      const weatherResponse = await request(app)
        .get('/api/weather')
        .set('User-Agent', mobileUA);
      
      expect(weatherResponse.headers['cache-control']).toBe('private, max-age=300');
    });
  });

  describe('Batch API for Mobile', () => {
    it('should handle batch requests with mobile-specific headers', async () => {
      const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) Mobile/15E148';
      
      const batchRequest = {
        requests: [
          { endpoint: '/api/stats' },
          { endpoint: '/api/flashlight/status' }
        ]
      };
      
      const response = await request(app)
        .post('/api/batch')
        .set('User-Agent', mobileUA)
        .send(batchRequest);
      
      expect(response.status).toBe(200);
      expect(response.headers['x-mobile-optimized']).toBe('true');
      expect(response.headers['x-batch-request']).toBe('true');
      expect(response.headers['cache-control']).toBe('private, max-age=10');
    });
  });

  describe('SSE Mobile Optimizations', () => {
    it('should include mobile flag in SSE connection message', (done) => {
      const mobileUA = 'Mozilla/5.0 (Android 11; Mobile) AppleWebKit/537.36';
      
      const req = request(app)
        .get('/api/events/motion')
        .set('User-Agent', mobileUA);
      
      req.on('response', (res) => {
        expect(res.headers['x-accel-buffering']).toBe('no');
        
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          
          // Check for initial connection message
          if (buffer.includes('connected')) {
            const lines = buffer.split('\\n');
            const dataLine = lines.find(line => line.startsWith('data:'));
            if (dataLine) {
              const data = JSON.parse(dataLine.replace('data: ', ''));
              expect(data.type).toBe('connected');
              expect(data.isMobile).toBe(true);
              req.abort();
              done();
            }
          }
        });
      });
    });
  });
});