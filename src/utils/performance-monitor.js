/**
 * Performance Monitoring & Profiling Utility
 * Tracks recording metrics, memory usage, encoder performance, hotspots, bottlenecks, etc.
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      recording: {
        startTime: null,
        duration: 0,
        fileSize: 0,
        frames: 0,
        fps: 0,
        avgFrameTime: 0,
        droppedFrames: 0,
      },
      memory: {
        renderer: 0,
        main: 0,
        peak: 0,
        history: [],
        spikes: [],
      },
      encoder: {
        name: "libx264",
        isHardware: false,
        startTime: null,
        duration: 0,
        progress: 0,
        throughput: 0,
        avgThroughput: 0,
        slowSegments: [],
      },
      ipc: {
        latencies: [],
        avgLatency: 0,
        maxLatency: 0,
      },
      system: {
        cpuUsage: 0,
        processCpuUsage: 0,
      },
      hotspots: [],
      bottlenecks: [],
      recommendations: [],
    };

    this.listeners = new Map();
    this.recordingStartTime = null;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.frameTimes = [];
    this.memoryCheckInterval = null;
    this.enabled = false;
    this.encoderSegmentStart = null;
    this.encoderSegmentBytes = 0;
  }

  /**
   * Start monitoring recording session
   */
  startRecording() {
    this.enabled = true;
    this.recordingStartTime = Date.now();
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.frameTimes = [];

    this.metrics.recording = {
      startTime: this.recordingStartTime,
      duration: 0,
      fileSize: 0,
      frames: 0,
      fps: 0,
      avgFrameTime: 0,
      droppedFrames: 0,
    };

    // Sample memory every 2 seconds
    this.memoryCheckInterval = setInterval(() => {
      this.updateMemoryMetrics();
    }, 2000);

    this.emit("recording-started", this.metrics);
  }

  /**
   * Stop monitoring recording session
   */
  stopRecording() {
    this.enabled = false;

    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }

    const duration = Date.now() - this.recordingStartTime;
    this.metrics.recording.duration = duration;
    this.metrics.recording.fps =
      this.frameCount > 0 ? Math.round((this.frameCount / duration) * 1000) : 0;

    this.emit("recording-stopped", this.metrics);
  }

  /**
   * Record a video frame with timing
   */
  recordFrame() {
    if (this.enabled) {
      const now = Date.now();
      this.frameCount++;

      if (this.lastFrameTime > 0) {
        const frameTime = now - this.lastFrameTime;
        this.frameTimes.push(frameTime);

        // Keep only last 100 frame times for analysis
        if (this.frameTimes.length > 100) {
          this.frameTimes.shift();
        }

        // Detect dropped frames (frame time > 50ms means dropped at 20fps)
        if (frameTime > 50) {
          this.metrics.recording.droppedFrames++;
          this.analyzeFrameDrops();
        }

        // Calculate average frame time
        this.metrics.recording.avgFrameTime =
          this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      }

      this.lastFrameTime = now;
    }
  }

  /**
   * Update memory usage metrics (renderer-side)
   */
  updateMemoryMetrics() {
    if (!this.enabled) return;

    try {
      const memUsage = performance.memory || process.memoryUsage();
      if (memUsage && memUsage.usedJSHeapSize) {
        this.metrics.memory.renderer = Math.round(
          memUsage.usedJSHeapSize / 1024 / 1024,
        ); // MB
      } else if (memUsage && memUsage.heapUsed) {
        this.metrics.memory.renderer = Math.round(
          memUsage.heapUsed / 1024 / 1024,
        ); // MB
      }

      // Track peak memory
      const totalMemory =
        this.metrics.memory.renderer + this.metrics.memory.main;
      if (totalMemory > this.metrics.memory.peak) {
        this.metrics.memory.peak = totalMemory;
      }

      // Keep last 30 samples (1 minute of history)
      this.metrics.memory.history.push({
        timestamp: Date.now(),
        renderer: this.metrics.memory.renderer,
      });

      if (this.metrics.memory.history.length > 30) {
        this.metrics.memory.history.shift();
      }

      // Detect memory spikes (>10MB increase in one sample)
      if (
        this.metrics.memory.history.length > 1 &&
        this.metrics.memory.renderer -
        this.metrics.memory.history[this.metrics.memory.history.length - 2]
          .renderer >
        10
      ) {
        this.metrics.memory.spikes.push({
          timestamp: Date.now(),
          value: this.metrics.memory.renderer,
        });
        this.analyzeMemorySpikes();
      }

      this.emit("memory-updated", this.metrics.memory);
    } catch (err) {
      console.warn("Failed to update memory metrics:", err);
    }
  }

  /**
   * Record main process memory usage
   */
  setMainProcessMemory(mainMemoryMB) {
    this.metrics.memory.main = mainMemoryMB;
    this.emit("memory-updated", this.metrics.memory);
  }

  /**
   * Update recording file size
   */
  setRecordingFileSize(bytes) {
    this.metrics.recording.fileSize = bytes;
    this.metrics.recording.frames = this.frameCount;

    if (this.recordingStartTime) {
      const duration = Date.now() - this.recordingStartTime;
      this.metrics.recording.duration = duration;
      this.metrics.recording.fps =
        this.frameCount > 0
          ? Math.round((this.frameCount / duration) * 1000)
          : 0;
    }

    this.emit("recording-updated", this.metrics.recording);
  }

  /**
   * Start monitoring encoding/conversion
   */
  startEncoding(encoderName, isHardware = false) {
    this.metrics.encoder.name = encoderName;
    this.metrics.encoder.isHardware = isHardware;
    this.metrics.encoder.startTime = Date.now();
    this.metrics.encoder.duration = 0;
    this.metrics.encoder.progress = 0;
    this.metrics.encoder.throughput = 0;
    this.metrics.encoder.avgThroughput = 0;
    this.metrics.encoder.slowSegments = [];
    this.metrics.encoder.throughputs = [];

    this.emit("encoding-started", this.metrics.encoder);
  }

  /**
   * Update encoding progress
   */
  updateEncodingProgress(
    progressPercent,
    throughputMbps = 0,
    bytesProcessed = 0,
  ) {
    if (!this.metrics.encoder.startTime) return;

    this.metrics.encoder.progress = progressPercent;
    this.metrics.encoder.throughput = throughputMbps;
    this.metrics.encoder.duration = Date.now() - this.metrics.encoder.startTime;

    // Track throughput for averaging
    if (!this.metrics.encoder.throughputs) {
      this.metrics.encoder.throughputs = [];
    }
    this.metrics.encoder.throughputs.push(throughputMbps);
    this.metrics.encoder.avgThroughput =
      this.metrics.encoder.throughputs.reduce((a, b) => a + b, 0) /
      this.metrics.encoder.throughputs.length;

    // Detect slow encoding segments
    if (
      throughputMbps > 0 &&
      throughputMbps < this.metrics.encoder.avgThroughput * 0.5
    ) {
      this.metrics.encoder.slowSegments.push({
        progress: progressPercent,
        throughput: throughputMbps,
        timestamp: Date.now(),
      });
    }

    this.analyzeEncoderPerformance();
    this.emit("encoding-progress", this.metrics.encoder);
  }

  /**
   * Finish encoding and record stats
   */
  finishEncoding(success = true, error = null) {
    if (!this.metrics.encoder.startTime) return;

    this.metrics.encoder.duration = Date.now() - this.metrics.encoder.startTime;
    this.metrics.encoder.startTime = null;

    this.emit("encoding-finished", {
      encoder: this.metrics.encoder,
      success,
      error,
    });
  }

  /**
   * Get all current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Register listener for metric events
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
  }

  /**
   * Unregister listener
   */
  off(eventName, callback) {
    if (!this.listeners.has(eventName)) return;

    const callbacks = this.listeners.get(eventName);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit metric event
   */
  emit(eventName, data) {
    if (!this.listeners.has(eventName)) return;

    const callbacks = this.listeners.get(eventName);
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (err) {
        console.error(`Error in listener for ${eventName}:`, err);
      }
    });
  }

  /**
   * Analyze frame drops and recommend optimizations
   */
  analyzeFrameDrops() {
    const droppedPercent = (
      (this.metrics.recording.droppedFrames / this.frameCount) *
      100
    ).toFixed(1);

    if (droppedPercent > 5) {
      this.addHotspot(
        "Frame Drops",
        `${droppedPercent}% dropped frames detected`,
        "warning",
      );
      this.addRecommendation(
        "Reduce resolution or display refresh rate to improve FPS stability",
      );
    }

    this.emit("hotspots-updated", this.metrics.hotspots);
  }

  /**
   * Analyze memory spikes
   */
  analyzeMemorySpikes() {
    if (this.metrics.memory.spikes.length > 3) {
      this.addHotspot(
        "Memory Spikes",
        `${this.metrics.memory.spikes.length} memory spikes detected`,
        "warning",
      );
      this.addRecommendation(
        "Check for unfreed resources, use smaller chunk sizes for recording",
      );
    }

    if (this.metrics.memory.peak > 500) {
      this.addHotspot(
        "High Memory Usage",
        `Peak: ${this.metrics.memory.peak}MB`,
        "critical",
      );
      this.addRecommendation(
        "Use hardware encoding to reduce memory footprint",
      );
    }
  }

  /**
   * Analyze encoder performance
   */
  analyzeEncoderPerformance() {
    if (!this.metrics.encoder.avgThroughput) return;

    // If hardware encoder is slower than expected
    if (
      this.metrics.encoder.isHardware &&
      this.metrics.encoder.slowSegments.length > 5
    ) {
      this.addHotspot(
        "Slow Hardware Encoder",
        `${this.metrics.encoder.slowSegments.length} slow segments`,
        "warning",
      );
      this.addRecommendation(
        "Consider using software encoder (libx264) for this content",
      );
    }

    // If encoding is very slow
    if (this.metrics.encoder.avgThroughput < 1) {
      this.addHotspot(
        "Low Encoder Throughput",
        `${this.metrics.encoder.avgThroughput.toFixed(1)} Mbps`,
        "critical",
      );
      this.addRecommendation(
        "Enable hardware acceleration or reduce video resolution",
      );
    }
  }

  /**
   * Record IPC latency
   */
  recordIPCLatency(latencyMs) {
    this.metrics.ipc.latencies.push(latencyMs);

    // Keep last 100 samples
    if (this.metrics.ipc.latencies.length > 100) {
      this.metrics.ipc.latencies.shift();
    }

    this.metrics.ipc.avgLatency =
      this.metrics.ipc.latencies.reduce((a, b) => a + b, 0) /
      this.metrics.ipc.latencies.length;
    this.metrics.ipc.maxLatency = Math.max(...this.metrics.ipc.latencies);

    // Alert if IPC latency is high
    if (this.metrics.ipc.maxLatency > 100) {
      this.addHotspot(
        "High IPC Latency",
        `Max: ${this.metrics.ipc.maxLatency}ms, Avg: ${this.metrics.ipc.avgLatency.toFixed(1)}ms`,
        "warning",
      );
      this.addRecommendation(
        "Increase chunk size or optimize IPC message frequency",
      );
    }

    this.emit("ipc-updated", this.metrics.ipc);
  }

  /**
   * Add a performance hotspot
   */
  addHotspot(name, description, severity = "info") {
    // Avoid duplicate hotspots
    const exists = this.metrics.hotspots.some((h) => h.name === name);
    if (!exists) {
      this.metrics.hotspots.push({
        name,
        description,
        severity,
        timestamp: Date.now(),
      });

      // Keep last 20 hotspots
      if (this.metrics.hotspots.length > 20) {
        this.metrics.hotspots.shift();
      }
    }
  }

  /**
   * Add a performance recommendation
   */
  addRecommendation(text) {
    // Avoid duplicates
    if (!this.metrics.recommendations.includes(text)) {
      this.metrics.recommendations.push(text);

      // Keep last 10 recommendations
      if (this.metrics.recommendations.length > 10) {
        this.metrics.recommendations.shift();
      }
    }
  }

  /**
   * Generate performance report
   */
  generateReport() {
    const droppedFrames = this.metrics.recording.droppedFrames || 0;
    const avgFrameTime = this.metrics.recording.avgFrameTime || 0;
    const droppedFramePercent = this.frameCount > 0
      ? ((droppedFrames / this.frameCount) * 100).toFixed(2)
      : "0.00";
    const avgThroughput = this.metrics.encoder.avgThroughput || 0;
    const avgLatency = this.metrics.ipc.avgLatency || 0;

    return {
      duration: this.metrics.recording.duration || 0,
      totalFrames: this.frameCount,
      fps: this.metrics.recording.fps || 0,
      droppedFrames: droppedFrames,
      droppedFramePercent: droppedFramePercent,
      avgFrameTime: avgFrameTime.toFixed(2),
      memory: {
        peakUsage: this.metrics.memory.peak,
        finalRenderer: this.metrics.memory.renderer,
        finalMain: this.metrics.memory.main,
        spikes: this.metrics.memory.spikes.length,
      },
      encoder: {
        name: this.metrics.encoder.name,
        isHardware: this.metrics.encoder.isHardware,
        duration: this.metrics.encoder.duration,
        avgThroughput: avgThroughput.toFixed(2),
        slowSegments: this.metrics.encoder.slowSegments.length,
      },
      ipc: {
        avgLatency: avgLatency.toFixed(2),
        maxLatency: this.metrics.ipc.maxLatency || 0,
        sampleCount: this.metrics.ipc.latencies.length,
      },
      hotspots: this.metrics.hotspots,
      recommendations: this.metrics.recommendations,
    };
  }
}

// Singleton instance
const monitor = new PerformanceMonitor();

if (typeof window !== "undefined") {
  window.performanceMonitor = monitor;
  window.PerformanceMonitor = PerformanceMonitor;
}
