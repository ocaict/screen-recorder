/**
 * AudioWorkletProcessor for high-performance audio meter visualization
 * Evaluates frequency data off the main UI thread.
 */
class MeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 128; // Sample fast slices
        this.updateInterval = 60; // Max updates per second (FPS limit)
        this.lastUpdate = currentTime;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        // Throttle UI messaging to match screen refresh roughly
        const now = currentTime;
        if (now - this.lastUpdate < 1 / this.updateInterval) {
            return true;
        }

        const channelData = input[0];
        let sum = 0;

        // Calculate fast RMS root mean square amplitude of the slice
        for (let i = 0; i < channelData.length; i++) {
            sum += channelData[i] * channelData[i];
        }

        let rms = Math.sqrt(sum / channelData.length);
        let volume = Math.max(0, Math.min(1, Math.log10(rms * 100 + 1) / 2));

        if (volume < 0.01) volume = 0;

        // Send the scalar volume back to the main thread securely
        this.port.postMessage({ volume });
        this.lastUpdate = now;

        return true; // Keep processor alive
    }
}

registerProcessor("meter-processor", MeterProcessor);
