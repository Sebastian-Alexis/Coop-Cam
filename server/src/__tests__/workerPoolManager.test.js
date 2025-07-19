import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WorkerPoolManager from '../workers/workerPoolManager.js';
import { Worker } from 'worker_threads';

//mock worker_threads
vi.mock('worker_threads', () => ({
  Worker: vi.fn()
}));

describe('WorkerPoolManager', () => {
  let workerPool;
  let mockWorkers;
  
  beforeEach(() => {
    mockWorkers = [];
    
    //mock Worker constructor
    Worker.mockImplementation(() => {
      const worker = {
        on: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn().mockResolvedValue(undefined)
      };
      mockWorkers.push(worker);
      return worker;
    });
  });
  
  afterEach(async () => {
    if (workerPool) {
      await workerPool.shutdown();
    }
    vi.clearAllMocks();
  });
  
  describe('initialization', () => {
    it('should create pool with default size based on CPU cores', () => {
      workerPool = new WorkerPoolManager();
      
      //should create at least 1 worker
      expect(mockWorkers.length).toBeGreaterThanOrEqual(1);
      expect(workerPool.workers.length).toBe(mockWorkers.length);
      expect(workerPool.availableWorkers.length).toBe(mockWorkers.length);
    });
    
    it('should create pool with specified size', () => {
      workerPool = new WorkerPoolManager({ poolSize: 4 });
      
      expect(mockWorkers.length).toBe(4);
      expect(workerPool.workers.length).toBe(4);
      expect(workerPool.availableWorkers.length).toBe(4);
    });
    
    it('should set up event handlers for each worker', () => {
      workerPool = new WorkerPoolManager({ poolSize: 2 });
      
      mockWorkers.forEach(worker => {
        expect(worker.on).toHaveBeenCalledWith('message', expect.any(Function));
        expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(worker.on).toHaveBeenCalledWith('exit', expect.any(Function));
      });
    });
  });
  
  describe('processFrame', () => {
    beforeEach(() => {
      workerPool = new WorkerPoolManager({ poolSize: 2, maxQueueSize: 5 });
    });
    
    it('should process frame successfully', async () => {
      const frame = Buffer.from('test frame data');
      const config = { width: 320, height: 240 };
      
      //process frame
      const processPromise = workerPool.processFrame(frame, config);
      
      //get the task ID from the postMessage call
      await vi.waitFor(() => {
        expect(mockWorkers[0].postMessage).toHaveBeenCalled();
      });
      
      const postMessageCall = mockWorkers[0].postMessage.mock.calls[0];
      const taskId = postMessageCall[0].id;
      
      //set up worker response
      const workerMessageHandler = mockWorkers[0].on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      //simulate worker response with correct task ID
      workerMessageHandler({
        id: taskId,
        type: 'frameProcessed',
        data: {
          processed: frame.buffer,
          processingTime: 10,
          frameNumber: 1
        }
      });
      
      const result = await processPromise;
      
      expect(result.processed).toBeInstanceOf(Buffer);
      expect(result.processingTime).toBe(10);
      expect(workerPool.metrics.tasksCompleted).toBe(1);
    });
    
    it('should queue tasks when all workers are busy', async () => {
      const frames = [
        Buffer.from('frame1'),
        Buffer.from('frame2'),
        Buffer.from('frame3')
      ];
      const config = { width: 320, height: 240 };
      
      //fill up all workers
      const promises = frames.map(frame => 
        workerPool.processFrame(frame, config)
      );
      
      //all workers should be busy
      expect(workerPool.availableWorkers.length).toBe(0);
      //one task should be queued
      expect(workerPool.taskQueue.length).toBe(1);
    });
    
    it('should throw error when queue is full', async () => {
      const config = { width: 320, height: 240 };
      
      //fill up workers and queue
      for (let i = 0; i < 7; i++) { //2 workers + 5 queue size
        workerPool.processFrame(Buffer.from(`frame${i}`), config).catch(() => {});
      }
      
      //next frame should be rejected
      await expect(
        workerPool.processFrame(Buffer.from('overflow'), config)
      ).rejects.toThrow('Task queue is full');
      
      expect(workerPool.metrics.tasksDropped).toBe(1);
    });
    
    it('should handle worker errors', async () => {
      const frame = Buffer.from('test frame');
      const config = { width: 320, height: 240 };
      
      const processPromise = workerPool.processFrame(frame, config);
      
      //wait for postMessage to be called
      await vi.waitFor(() => {
        expect(mockWorkers[0].postMessage).toHaveBeenCalled();
      });
      
      const postMessageCall = mockWorkers[0].postMessage.mock.calls[0];
      const taskId = postMessageCall[0].id;
      
      //set up worker error response
      const workerMessageHandler = mockWorkers[0].on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      //simulate worker error with correct task ID
      workerMessageHandler({
        id: taskId,
        error: 'Processing failed'
      });
      
      await expect(processPromise).rejects.toThrow('Processing failed');
      expect(workerPool.metrics.tasksFailed).toBe(1);
    });
    
    it('should handle task timeout', async () => {
      workerPool = new WorkerPoolManager({ 
        poolSize: 1, 
        taskTimeout: 100 
      });
      
      const frame = Buffer.from('test frame');
      const config = { width: 320, height: 240 };
      
      //process frame but don't respond
      const processPromise = workerPool.processFrame(frame, config);
      
      await expect(processPromise).rejects.toThrow('Task timeout');
      expect(workerPool.metrics.tasksFailed).toBe(1);
    });
  });
  
  describe('worker management', () => {
    beforeEach(() => {
      workerPool = new WorkerPoolManager({ poolSize: 2 });
    });
    
    it('should restart worker on error', () => {
      const errorHandler = mockWorkers[0].on.mock.calls
        .find(call => call[0] === 'error')[1];
      
      const initialWorkerCount = mockWorkers.length;
      const firstWorker = mockWorkers[0];
      
      //trigger worker error
      errorHandler(new Error('Worker crashed'));
      
      //should create a new worker
      expect(mockWorkers.length).toBe(initialWorkerCount + 1);
      expect(firstWorker.terminate).toHaveBeenCalled();
    });
    
    it('should restart worker on unexpected exit', () => {
      const exitHandler = mockWorkers[0].on.mock.calls
        .find(call => call[0] === 'exit')[1];
      
      const initialWorkerCount = mockWorkers.length;
      
      //trigger worker exit
      exitHandler(1);
      
      //should create a new worker
      expect(mockWorkers.length).toBe(initialWorkerCount + 1);
    });
  });
  
  describe('getStats', () => {
    beforeEach(() => {
      workerPool = new WorkerPoolManager({ poolSize: 2 });
    });
    
    it('should return current statistics', async () => {
      const stats = await workerPool.getStats();
      
      expect(stats).toMatchObject({
        poolSize: 2,
        availableWorkers: 2,
        queueLength: 0,
        activeJobs: 0,
        metrics: {
          tasksQueued: 0,
          tasksCompleted: 0,
          tasksFailed: 0,
          tasksDropped: 0,
          totalProcessingTime: 0
        },
        workers: expect.any(Array),
        averageProcessingTime: 0
      });
      
      expect(stats.workers).toHaveLength(2);
      stats.workers.forEach(worker => {
        expect(worker).toMatchObject({
          id: expect.any(Number),
          isAvailable: true,
          tasksCompleted: 0,
          tasksFailed: 0,
          totalProcessingTime: 0
        });
      });
    });
  });
  
  describe('shutdown', () => {
    beforeEach(() => {
      workerPool = new WorkerPoolManager({ poolSize: 2 });
    });
    
    it('should terminate all workers on shutdown', async () => {
      await workerPool.shutdown();
      
      mockWorkers.forEach(worker => {
        expect(worker.terminate).toHaveBeenCalled();
      });
      
      expect(workerPool.isShuttingDown).toBe(true);
    });
    
    it('should reject queued tasks on shutdown', async () => {
      const frame = Buffer.from('test frame');
      const config = { width: 320, height: 240 };
      
      //fill up workers (pool size is 2)
      const activePromises = [
        workerPool.processFrame(frame, config),
        workerPool.processFrame(frame, config)
      ];
      
      //wait for workers to be assigned
      await vi.waitFor(() => {
        expect(workerPool.availableWorkers.length).toBe(0);
      });
      
      //queue a task (should go to queue since all workers are busy)
      const queuedPromise = workerPool.processFrame(frame, config);
      
      //verify task is queued
      expect(workerPool.taskQueue.length).toBe(1);
      
      //shutdown without waiting for active tasks
      workerPool.shutdown();
      
      //queued task should be rejected
      await expect(queuedPromise).rejects.toThrow('Worker pool shutting down');
      
      //clean up active promises
      activePromises.forEach(p => p.catch(() => {}));
    });
    
    it('should reject new tasks after shutdown', async () => {
      await workerPool.shutdown();
      
      const frame = Buffer.from('test frame');
      const config = { width: 320, height: 240 };
      
      await expect(
        workerPool.processFrame(frame, config)
      ).rejects.toThrow('Worker pool is shutting down');
    });
  });
});