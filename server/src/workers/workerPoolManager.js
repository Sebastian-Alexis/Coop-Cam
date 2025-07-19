import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

//manages a pool of worker threads for CPU-intensive tasks
class WorkerPoolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    //configuration
    this.workerScript = options.workerScript || path.join(__dirname, 'motionDetectionWorker.js');
    this.poolSize = options.poolSize || Math.max(1, os.cpus().length - 1);
    this.maxQueueSize = options.maxQueueSize || 100;
    this.taskTimeout = options.taskTimeout || 5000; //5 seconds default timeout
    
    //state
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.activeJobs = new Map();
    this.workerStats = new Map();
    this.isShuttingDown = false;
    
    //metrics
    this.metrics = {
      tasksQueued: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksDropped: 0,
      totalProcessingTime: 0
    };
    
    console.log(`[WorkerPool] Initializing pool with ${this.poolSize} workers`);
    this.initializePool();
  }
  
  initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker(i);
    }
  }
  
  createWorker(id) {
    const worker = new Worker(this.workerScript);
    
    //worker metadata
    const workerInfo = {
      id,
      worker,
      isAvailable: true,
      currentJob: null,
      stats: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalProcessingTime: 0
      }
    };
    
    //setup event handlers
    worker.on('message', (message) => this.handleWorkerMessage(workerInfo, message));
    worker.on('error', (error) => this.handleWorkerError(workerInfo, error));
    worker.on('exit', (code) => this.handleWorkerExit(workerInfo, code));
    
    //add to pool
    this.workers.push(workerInfo);
    this.availableWorkers.push(workerInfo);
    this.workerStats.set(id, workerInfo.stats);
    
    console.log(`[WorkerPool] Worker ${id} created`);
  }
  
  async processFrame(frame, config) {
    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down');
    }
    
    //check queue size
    if (this.taskQueue.length >= this.maxQueueSize) {
      this.metrics.tasksDropped++;
      throw new Error('Task queue is full');
    }
    
    return new Promise((resolve, reject) => {
      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'processFrame',
        data: {
          frame: frame.buffer || frame,
          config: {
            width: config.width,
            height: config.height
          },
          isColorMode: config.isColorMode || false,
          shadowRemovalEnabled: config.shadowRemovalEnabled || false,
          shadowRemovalIntensity: config.shadowRemovalIntensity || 0.7
        },
        resolve,
        reject,
        timestamp: Date.now()
      };
      
      this.metrics.tasksQueued++;
      
      //try to assign immediately or queue
      if (!this.assignTask(task)) {
        this.taskQueue.push(task);
        
        //set timeout for queued task
        task.timeout = setTimeout(() => {
          const index = this.taskQueue.indexOf(task);
          if (index > -1) {
            this.taskQueue.splice(index, 1);
            this.metrics.tasksFailed++;
            reject(new Error('Task timeout while queued'));
          }
        }, this.taskTimeout);
      }
    });
  }
  
  assignTask(task) {
    const worker = this.availableWorkers.shift();
    if (!worker) {
      return false;
    }
    
    //mark worker as busy
    worker.isAvailable = false;
    worker.currentJob = task;
    
    //store active job
    this.activeJobs.set(task.id, { worker, task });
    
    //set task timeout
    task.timeout = setTimeout(() => {
      if (this.activeJobs.has(task.id)) {
        this.handleTaskTimeout(task.id);
      }
    }, this.taskTimeout);
    
    //send task to worker
    try {
      const transferList = task.data.frame instanceof ArrayBuffer ? [task.data.frame] : [];
      worker.worker.postMessage({
        id: task.id,
        type: task.type,
        data: task.data
      }, transferList);
    } catch (error) {
      //handle postMessage error
      this.handleTaskError(worker, task, error);
      return false;
    }
    
    return true;
  }
  
  handleWorkerMessage(workerInfo, message) {
    const { id, type, data, error } = message;
    
    //find the associated task
    const jobInfo = this.activeJobs.get(id);
    if (!jobInfo) {
      console.warn(`[WorkerPool] Received message for unknown job: ${id}`);
      return;
    }
    
    const { task } = jobInfo;
    
    //clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }
    
    //remove from active jobs
    this.activeJobs.delete(id);
    
    //handle response
    if (error) {
      this.metrics.tasksFailed++;
      workerInfo.stats.tasksFailed++;
      task.reject(new Error(error));
    } else {
      const processingTime = Date.now() - task.timestamp;
      this.metrics.tasksCompleted++;
      this.metrics.totalProcessingTime += processingTime;
      workerInfo.stats.tasksCompleted++;
      workerInfo.stats.totalProcessingTime += processingTime;
      
      //convert ArrayBuffer back to Buffer
      if (data.processed instanceof ArrayBuffer) {
        data.processed = Buffer.from(data.processed);
      }
      
      task.resolve(data);
    }
    
    //make worker available again
    workerInfo.isAvailable = true;
    workerInfo.currentJob = null;
    this.availableWorkers.push(workerInfo);
    
    //process next queued task
    this.processNextTask();
  }
  
  handleWorkerError(workerInfo, error) {
    console.error(`[WorkerPool] Worker ${workerInfo.id} error:`, error);
    
    //fail current job if any
    if (workerInfo.currentJob) {
      const task = workerInfo.currentJob;
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      this.activeJobs.delete(task.id);
      task.reject(error);
    }
    
    //restart worker
    this.restartWorker(workerInfo);
  }
  
  handleWorkerExit(workerInfo, code) {
    console.log(`[WorkerPool] Worker ${workerInfo.id} exited with code ${code}`);
    
    if (!this.isShuttingDown) {
      this.restartWorker(workerInfo);
    }
  }
  
  handleTaskTimeout(taskId) {
    const jobInfo = this.activeJobs.get(taskId);
    if (!jobInfo) return;
    
    const { worker, task } = jobInfo;
    
    console.warn(`[WorkerPool] Task ${taskId} timed out on worker ${worker.id}`);
    
    //remove from active jobs
    this.activeJobs.delete(taskId);
    
    //fail the task
    this.metrics.tasksFailed++;
    worker.stats.tasksFailed++;
    task.reject(new Error('Task timeout'));
    
    //terminate and restart the worker (it might be stuck)
    this.restartWorker(worker);
  }
  
  handleTaskError(worker, task, error) {
    console.error(`[WorkerPool] Error assigning task to worker ${worker.id}:`, error);
    
    //clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }
    
    //make worker available again
    worker.isAvailable = true;
    worker.currentJob = null;
    this.availableWorkers.push(worker);
    
    //fail the task
    this.metrics.tasksFailed++;
    task.reject(error);
  }
  
  restartWorker(workerInfo) {
    console.log(`[WorkerPool] Restarting worker ${workerInfo.id}`);
    
    //remove from available workers
    const availableIndex = this.availableWorkers.indexOf(workerInfo);
    if (availableIndex > -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }
    
    //terminate old worker
    workerInfo.worker.terminate();
    
    //create new worker with same ID
    this.createWorker(workerInfo.id);
    
    //remove old worker from pool
    const poolIndex = this.workers.indexOf(workerInfo);
    if (poolIndex > -1) {
      this.workers.splice(poolIndex, 1);
    }
  }
  
  processNextTask() {
    if (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift();
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      this.assignTask(task);
    }
  }
  
  async getStats() {
    const workerStatsArray = [];
    
    //collect stats from each worker
    for (const worker of this.workers) {
      workerStatsArray.push({
        id: worker.id,
        isAvailable: worker.isAvailable,
        ...worker.stats
      });
    }
    
    return {
      poolSize: this.poolSize,
      availableWorkers: this.availableWorkers.length,
      queueLength: this.taskQueue.length,
      activeJobs: this.activeJobs.size,
      metrics: { ...this.metrics },
      workers: workerStatsArray,
      averageProcessingTime: this.metrics.tasksCompleted > 0
        ? this.metrics.totalProcessingTime / this.metrics.tasksCompleted
        : 0
    };
  }
  
  async shutdown() {
    console.log('[WorkerPool] Shutting down worker pool');
    this.isShuttingDown = true;
    
    //clear task queue
    for (const task of this.taskQueue) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(new Error('Worker pool shutting down'));
    }
    this.taskQueue = [];
    
    //wait for active jobs to complete (with timeout)
    const shutdownTimeout = setTimeout(() => {
      //force fail remaining jobs
      for (const [taskId, jobInfo] of this.activeJobs) {
        jobInfo.task.reject(new Error('Shutdown timeout'));
      }
      this.activeJobs.clear();
    }, 5000);
    
    //wait for active jobs
    while (this.activeJobs.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    clearTimeout(shutdownTimeout);
    
    //terminate all workers
    await Promise.all(this.workers.map(workerInfo => {
      return workerInfo.worker.terminate();
    }));
    
    console.log('[WorkerPool] Worker pool shut down complete');
  }
}

export default WorkerPoolManager;