/**
 * Performance Dashboard UI Component
 * Displays real-time recording and encoding metrics
 */

class PerformanceDashboard {
  constructor(app, monitor) {
    this.app = app;
    this.monitor = monitor;
    this.isVisible = false;
    this.dashboard = null;
    this.charts = {};
  }

  /**
   * Initialize the dashboard UI
   */
  init() {
    const dashboardHTML = `
      <div id="performance-dashboard" class="performance-dashboard hidden">
        <div class="dashboard-header">
          <h3>Performance Monitor</h3>
          <div class="dashboard-controls">
            <button id="dashboard-tab-stats" class="dashboard-tab active">Stats</button>
            <button id="dashboard-tab-hotspots" class="dashboard-tab">Hotspots</button>
            <button id="dashboard-tab-report" class="dashboard-tab">Report</button>
            <button id="dashboard-close-btn" class="dashboard-close">✕</button>
          </div>
        </div>

        <div class="dashboard-content">
          <!-- Stats Tab -->
          <div id="dashboard-tab-stats-content" class="dashboard-tab-content active">
            <!-- Recording Stats -->
            <div class="dashboard-section">
              <h4>Recording</h4>
              <div class="stat-row">
                <span class="stat-label">FPS:</span>
                <span class="stat-value" id="stat-fps">0</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Duration:</span>
                <span class="stat-value" id="stat-duration">00:00:00</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">File Size:</span>
                <span class="stat-value" id="stat-filesize">0 MB</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Frames:</span>
                <span class="stat-value" id="stat-frames">0</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Dropped Frames:</span>
                <span class="stat-value" id="stat-dropped-frames">0</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Avg Frame Time:</span>
                <span class="stat-value" id="stat-frame-time">0 ms</span>
              </div>
            </div>

            <!-- Memory Stats -->
            <div class="dashboard-section">
              <h4>Memory Usage</h4>
              <div class="stat-row">
                <span class="stat-label">Renderer:</span>
                <span class="stat-value" id="stat-memory-renderer">0 MB</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Main Process:</span>
                <span class="stat-value" id="stat-memory-main">0 MB</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Peak:</span>
                <span class="stat-value" id="stat-memory-peak">0 MB</span>
              </div>
              <canvas id="memory-chart" class="dashboard-chart" width="200" height="100"></canvas>
            </div>

            <!-- IPC Stats -->
            <div class="dashboard-section">
              <h4>IPC Performance</h4>
              <div class="stat-row">
                <span class="stat-label">Avg Latency:</span>
                <span class="stat-value" id="stat-ipc-avg">0 ms</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Max Latency:</span>
                <span class="stat-value" id="stat-ipc-max">0 ms</span>
              </div>
            </div>

            <!-- Encoding Stats -->
            <div class="dashboard-section" id="encoding-section" style="display: none;">
              <h4>Encoding</h4>
              <div class="stat-row">
                <span class="stat-label">Encoder:</span>
                <span class="stat-value" id="stat-encoder">libx264</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Progress:</span>
                <span class="stat-value" id="stat-encode-progress">0%</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Throughput:</span>
                <span class="stat-value" id="stat-throughput">0 Mbps</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Avg Throughput:</span>
                <span class="stat-value" id="stat-encode-avg-throughput">0 Mbps</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" id="encode-progress-fill"></div>
              </div>
            </div>
          </div>

          <!-- Hotspots Tab -->
          <div id="dashboard-tab-hotspots-content" class="dashboard-tab-content">
            <div class="dashboard-section">
              <h4>Performance Hotspots</h4>
              <div id="hotspots-list" class="hotspots-list"></div>
            </div>

            <div class="dashboard-section">
              <h4>Optimization Recommendations</h4>
              <div id="recommendations-list" class="recommendations-list"></div>
            </div>
          </div>

          <!-- Report Tab -->
          <div id="dashboard-tab-report-content" class="dashboard-tab-content">
            <div class="dashboard-section">
              <h4>Performance Report</h4>
              <div id="report-content" class="report-content"></div>
              <button id="generate-report-btn" class="report-btn">Generate Report</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Insert dashboard HTML (assuming there's a body or container)
    const container = document.querySelector(".app-container") || document.body;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = dashboardHTML;
    container.appendChild(wrapper.firstElementChild);

    this.dashboard = document.getElementById("performance-dashboard");
    this.setupEventListeners();
    this.setupCharts();
    this.attachMonitorListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    const closeBtn = document.getElementById("dashboard-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.hide());
    }

    // Tab buttons
    const tabButtons = document.querySelectorAll(".dashboard-tab");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => this.switchTab(e.target.id));
    });

    // Generate report button
    const reportBtn = document.getElementById("generate-report-btn");
    if (reportBtn) {
      reportBtn.addEventListener("click", () => this.generateAndShowReport());
    }
  }

  /**
   * Switch between dashboard tabs
   */
  switchTab(tabId) {
    // Hide all tabs
    document
      .querySelectorAll(".dashboard-tab-content")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".dashboard-tab")
      .forEach((btn) => btn.classList.remove("active"));

    // Show selected tab
    const tabName = tabId.replace("dashboard-tab-", "");
    const contentId = `dashboard-tab-${tabName}-content`;
    const contentEl = document.getElementById(contentId);
    const btnEl = document.getElementById(tabId);

    if (contentEl) contentEl.classList.add("active");
    if (btnEl) btnEl.classList.add("active");
  }

  /**
   * Setup chart canvases
   */
  setupCharts() {
    const memoryCanvas = document.getElementById("memory-chart");
    if (memoryCanvas) {
      this.charts.memory = {
        canvas: memoryCanvas,
        ctx: memoryCanvas.getContext("2d"),
        data: [],
      };
    }
  }

  /**
   * Attach listeners to performance monitor
   */
  attachMonitorListeners() {
    this.monitor.on("recording-updated", (data) => {
      this.updateRecordingStats(data);
    });

    this.monitor.on("memory-updated", (data) => {
      this.updateMemoryStats(data);
      this.drawMemoryChart(data);
    });

    this.monitor.on("ipc-updated", (data) => {
      this.updateIPCStats(data);
    });

    this.monitor.on("hotspots-updated", (hotspots) => {
      this.updateHotspotsList(hotspots);
    });

    this.monitor.on("encoding-started", (data) => {
      this.showEncodingSection(true);
      this.updateEncodingStats(data);
    });

    this.monitor.on("encoding-progress", (data) => {
      this.updateEncodingStats(data);
    });

    this.monitor.on("encoding-finished", (data) => {
      this.updateEncodingStats(data.encoder);
      setTimeout(() => this.showEncodingSection(false), 2000);
    });
  }

  /**
   * Update recording stats display
   */
  updateRecordingStats(data) {
    const fpsEl = document.getElementById("stat-fps");
    const durationEl = document.getElementById("stat-duration");
    const filesizeEl = document.getElementById("stat-filesize");
    const framesEl = document.getElementById("stat-frames");
    const droppedEl = document.getElementById("stat-dropped-frames");
    const frameTimeEl = document.getElementById("stat-frame-time");

    if (fpsEl) fpsEl.textContent = data.fps || 0;
    if (durationEl) durationEl.textContent = this.formatDuration(data.duration);
    if (filesizeEl) filesizeEl.textContent = this.formatFileSize(data.fileSize);
    if (framesEl) framesEl.textContent = data.frames || 0;
    if (droppedEl) droppedEl.textContent = data.droppedFrames || 0;
    if (frameTimeEl) frameTimeEl.textContent = `${data.avgFrameTime?.toFixed(2) || 0} ms`;
  }

  /**
   * Update memory stats display
   */
  updateMemoryStats(data) {
    const rendererEl = document.getElementById("stat-memory-renderer");
    const mainEl = document.getElementById("stat-memory-main");
    const peakEl = document.getElementById("stat-memory-peak");

    if (rendererEl) rendererEl.textContent = `${data.renderer || 0} MB`;
    if (mainEl) mainEl.textContent = `${data.main || 0} MB`;
    if (peakEl) peakEl.textContent = `${data.peak || 0} MB`;
  }

  /**
   * Update IPC stats display
   */
  updateIPCStats(data) {
    const avgEl = document.getElementById("stat-ipc-avg");
    const maxEl = document.getElementById("stat-ipc-max");

    if (avgEl) avgEl.textContent = `${data.avgLatency?.toFixed(2) || 0} ms`;
    if (maxEl) maxEl.textContent = `${data.maxLatency || 0} ms`;
  }

  /**
   * Update encoding stats display
   */
  updateEncodingStats(data) {
    const encoderEl = document.getElementById("stat-encoder");
    const progressEl = document.getElementById("stat-encode-progress");
    const throughputEl = document.getElementById("stat-throughput");
    const avgThroughputEl = document.getElementById("stat-encode-avg-throughput");
    const progressFill = document.getElementById("encode-progress-fill");

    if (encoderEl) {
      const label = data.isHardware ? `${data.name} (HW)` : data.name;
      encoderEl.textContent = label;
    }
    if (progressEl) progressEl.textContent = `${data.progress || 0}%`;
    if (throughputEl)
      throughputEl.textContent = `${data.throughput?.toFixed(1) || 0} Mbps`;
    if (avgThroughputEl)
      avgThroughputEl.textContent = `${data.avgThroughput?.toFixed(1) || 0} Mbps`;
    if (progressFill) progressFill.style.width = `${data.progress || 0}%`;
  }

  /**
   * Draw memory usage chart
   */
  drawMemoryChart(data) {
    const chart = this.charts.memory;
    if (!chart || !chart.ctx || !data.history || data.history.length === 0)
      return;

    const ctx = chart.ctx;
    const canvas = chart.canvas;
    const padding = 10;
    const graphWidth = canvas.width - 2 * padding;
    const graphHeight = canvas.height - 2 * padding;

    // Clear canvas
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw border
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.strokeRect(padding, padding, graphWidth, graphHeight);

    // Find max value for scaling
    const maxMemory = Math.max(...data.history.map((d) => d.renderer), 500);

    // Draw line graph
    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.history.forEach((point, index) => {
      const x = padding + (index / data.history.length) * graphWidth;
      const y =
        canvas.height -
        padding -
        ((point.renderer / maxMemory) * graphHeight || 0);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw current value label
    if (data.renderer) {
      ctx.fillStyle = "#333";
      ctx.font = "12px monospace";
      ctx.textAlign = "right";
      ctx.fillText(
        `${data.renderer}MB`,
        canvas.width - padding - 2,
        padding + 12,
      );
    }
  }

  /**
   * Format duration (ms) to HH:MM:SS
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return [hours, minutes, secs]
      .map((v) => v.toString().padStart(2, "0"))
      .join(":");
  }

  /**
   * Format file size (bytes) to human readable
   */
  formatFileSize(bytes) {
    if (bytes === 0) return "0 MB";
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  /**
   * Show/hide encoding section
   */
  showEncodingSection(visible) {
    const section = document.getElementById("encoding-section");
    if (section) {
      section.style.display = visible ? "block" : "none";
    }
  }

  /**
   * Update hotspots list display
   */
  updateHotspotsList(hotspots) {
    const list = document.getElementById("hotspots-list");
    if (!list) return;

    if (hotspots.length === 0) {
      list.innerHTML = '<div class="empty-state">No hotspots detected</div>';
      return;
    }

    list.innerHTML = hotspots
      .map(
        (h) =>
          `<div class="hotspot-item hotspot-${h.severity}">
        <div class="hotspot-name">${h.name}</div>
        <div class="hotspot-description">${h.description}</div>
        <div class="hotspot-severity">${h.severity.toUpperCase()}</div>
      </div>`,
      )
      .join("");
  }

  /**
   * Update recommendations list display
   */
  updateRecommendationsList(recommendations) {
    const list = document.getElementById("recommendations-list");
    if (!list) return;

    if (recommendations.length === 0) {
      list.innerHTML = '<div class="empty-state">No recommendations yet</div>';
      return;
    }

    list.innerHTML = recommendations
      .map(
        (r, i) =>
          `<div class="recommendation-item">
        <div class="recommendation-number">${i + 1}.</div>
        <div class="recommendation-text">${r}</div>
      </div>`,
      )
      .join("");
  }

  /**
   * Generate and display performance report
   */
  generateAndShowReport() {
    const report = this.monitor.generateReport();
    const reportEl = document.getElementById("report-content");
    if (!reportEl) return;

    const reportHTML = `
      <div class="report-section">
        <h5>Recording Summary</h5>
        <div class="report-row">
          <span>Duration:</span>
          <span>${this.formatDuration(report.duration)}</span>
        </div>
        <div class="report-row">
          <span>Total Frames:</span>
          <span>${report.totalFrames}</span>
        </div>
        <div class="report-row">
          <span>Average FPS:</span>
          <span>${report.fps}</span>
        </div>
        <div class="report-row">
          <span>Dropped Frames:</span>
          <span>${report.droppedFrames} (${report.droppedFramePercent}%)</span>
        </div>
        <div class="report-row">
          <span>Avg Frame Time:</span>
          <span>${report.avgFrameTime} ms</span>
        </div>
      </div>

      <div class="report-section">
        <h5>Memory Usage</h5>
        <div class="report-row">
          <span>Peak Usage:</span>
          <span>${report.memory.peakUsage} MB</span>
        </div>
        <div class="report-row">
          <span>Final Renderer:</span>
          <span>${report.memory.finalRenderer} MB</span>
        </div>
        <div class="report-row">
          <span>Final Main Process:</span>
          <span>${report.memory.finalMain} MB</span>
        </div>
        <div class="report-row">
          <span>Memory Spikes:</span>
          <span>${report.memory.spikes}</span>
        </div>
      </div>

      <div class="report-section">
        <h5>Encoding</h5>
        <div class="report-row">
          <span>Encoder:</span>
          <span>${report.encoder.name} ${report.encoder.isHardware ? "(HW)" : "(SW)"}</span>
        </div>
        <div class="report-row">
          <span>Duration:</span>
          <span>${this.formatDuration(report.encoder.duration)}</span>
        </div>
        <div class="report-row">
          <span>Avg Throughput:</span>
          <span>${report.encoder.avgThroughput} Mbps</span>
        </div>
        <div class="report-row">
          <span>Slow Segments:</span>
          <span>${report.encoder.slowSegments}</span>
        </div>
      </div>

      <div class="report-section">
        <h5>IPC Performance</h5>
        <div class="report-row">
          <span>Avg Latency:</span>
          <span>${report.ipc.avgLatency} ms</span>
        </div>
        <div class="report-row">
          <span>Max Latency:</span>
          <span>${report.ipc.maxLatency} ms</span>
        </div>
        <div class="report-row">
          <span>Samples:</span>
          <span>${report.ipc.sampleCount}</span>
        </div>
      </div>

      ${report.hotspots.length > 0 ? `
      <div class="report-section">
        <h5>Identified Hotspots</h5>
        ${report.hotspots.map((h) => `<div class="report-hotspot hotspot-${h.severity}">${h.name}: ${h.description}</div>`).join("")}
      </div>
      ` : ""}

      ${report.recommendations.length > 0 ? `
      <div class="report-section">
        <h5>Recommendations</h5>
        <ol class="report-recommendations">
          ${report.recommendations.map((r) => `<li>${r}</li>`).join("")}
        </ol>
      </div>
      ` : ""}
    `;

    reportEl.innerHTML = reportHTML;

    // Also update hotspots and recommendations in the hotspots tab
    this.updateHotspotsList(report.hotspots);
    this.updateRecommendationsList(report.recommendations);
  }

  /**
   * Show dashboard
   */
  show() {
    if (this.dashboard) {
      this.dashboard.classList.remove("hidden");
      this.isVisible = true;
    }
  }

  /**
   * Hide dashboard
   */
  hide() {
    if (this.dashboard) {
      this.dashboard.classList.add("hidden");
      this.isVisible = false;
    }
  }

  /**
   * Toggle dashboard visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}

window.PerformanceDashboard = PerformanceDashboard;
