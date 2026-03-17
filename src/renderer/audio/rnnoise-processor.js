'use strict';

const RNNOISE_FRAME_SIZE = 480;
const SHIFT_16_BIT_NR = 32768;

// Handle WASM module initialization
class WasmModuleInitializer {
    constructor(messagePort) {
        this.messagePort = messagePort;
        this.Module = null;
    }

    async initSyncModule(jsContent) {
        try {
            if (!jsContent) throw new Error('Missing sync module JS content');

            // The content from rnnoise-sync.js defines createRNNWasmModuleSync
            const createFunction = new Function(jsContent + '; return createRNNWasmModuleSync;')();
            this.Module = await createFunction();

            if (this.Module.ready) {
                await this.Module.ready;
            }

            console.log('[RNNoise] Sync module initialized');
            this.messagePort.postMessage({ type: 'wasm-ready' });
            return this.Module;
        } catch (error) {
            console.error('[RNNoise] Sync module initialization error:', error);
            this.messagePort.postMessage({ type: 'wasm-error', error: error.message });
            throw error;
        }
    }

    getModule() {
        return this.Module;
    }
}

// Handle RNNoise context and buffer management
class RNNoiseContextManager {
    constructor(module) {
        this.module = module;
        this.rnnoiseContext = null;
        this.wasmPcmInput = null;
        this.wasmPcmInputF32Index = null;
        this.setupWasm();
    }

    setupWasm() {
        // Allocate memory for 480 float samples (4 bytes each)
        this.wasmPcmInput = this.module._malloc(RNNOISE_FRAME_SIZE * 4);
        this.wasmPcmInputF32Index = this.wasmPcmInput >> 2;
        if (!this.wasmPcmInput) throw new Error('Failed to allocate WASM buffer');

        this.rnnoiseContext = this.module._rnnoise_create();
        if (!this.rnnoiseContext) throw new Error('Failed to create RNNoise context');
    }

    processFrame(frameBuffer, processedBuffer) {
        if (!this.rnnoiseContext || !this.module || !this.module.HEAPF32) return;

        try {
            // Copy input to WASM heap
            for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
                this.module.HEAPF32[this.wasmPcmInputF32Index + i] = frameBuffer[i] * SHIFT_16_BIT_NR;
            }

            // Process
            this.module._rnnoise_process_frame(
                this.rnnoiseContext,
                this.wasmPcmInput,
                this.wasmPcmInput
            );

            // Copy output back
            for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
                processedBuffer[i] = this.module.HEAPF32[this.wasmPcmInputF32Index + i] / SHIFT_16_BIT_NR;
            }
        } catch (error) {
            console.error('[RNNoise] Frame processing failed:', error);
            processedBuffer.set(frameBuffer);
        }
    }

    destroy() {
        if (this.wasmPcmInput && this.module?._free) {
            this.module._free(this.wasmPcmInput);
            this.wasmPcmInput = null;
        }
        if (this.rnnoiseContext && this.module?._rnnoise_destroy) {
            this.module._rnnoise_destroy(this.rnnoiseContext);
            this.rnnoiseContext = null;
        }
    }
}

// Handle audio frame buffering (128 -> 480 samples)
class AudioFrameBuffer {
    constructor() {
        this.frameBuffer = new Float32Array(RNNOISE_FRAME_SIZE);
        this.bufferIndex = 0;
        
        this.processedBuffer = new Float32Array(RNNOISE_FRAME_SIZE);
        this.processedIndex = 0;
        this.hasProcessedFrame = false;
    }

    addSample(sample) {
        this.frameBuffer[this.bufferIndex++] = sample;
        if (this.bufferIndex === RNNOISE_FRAME_SIZE) {
            this.bufferIndex = 0;
            return true;
        }
        return false;
    }

    getProcessedSample() {
        if (!this.hasProcessedFrame) return 0;
        const sample = this.processedBuffer[this.processedIndex++];
        if (this.processedIndex === RNNOISE_FRAME_SIZE) {
            this.processedIndex = 0;
            this.hasProcessedFrame = false;
        }
        return sample;
    }

    getFrameBuffer() {
        return this.frameBuffer;
    }

    getProcessedBuffer() {
        return this.processedBuffer;
    }

    markProcessed() {
        this.hasProcessedFrame = true;
        this.processedIndex = 0;
    }
}

class RNNoiseProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.initialized = false;
        this.enabled = false;
        
        this.wasmInitializer = new WasmModuleInitializer(this.port);
        this.contextManager = null;
        this.frameBuffer = new AudioFrameBuffer();

        this.port.onmessage = async (event) => {
            const { type, jsContent, enabled } = event.data;
            if (type === 'sync-module') {
                try {
                    const module = await this.wasmInitializer.initSyncModule(jsContent);
                    this.contextManager = new RNNoiseContextManager(module);
                    this.initialized = true;
                    console.log('[RNNoise] Processor fully initialized');
                } catch (error) {
                    console.error('[RNNoise] Failed to initialize:', error);
                }
            } else if (type === 'enable') {
                this.enabled = enabled;
            }
        };
    }

    process(inputs, outputs) {
        const input = inputs[0]?.[0];
        const output = outputs[0]?.[0];

        if (!input || !output) return true;

        if (!this.initialized || !this.enabled) {
            output.set(input);
            return true;
        }

        for (let i = 0; i < input.length; i++) {
            const isFrameReady = this.frameBuffer.addSample(input[i]);

            if (isFrameReady) {
                this.contextManager.processFrame(
                    this.frameBuffer.getFrameBuffer(),
                    this.frameBuffer.getProcessedBuffer()
                );
                this.frameBuffer.markProcessed();
            }

            // If we have processed samples to give, give them. 
            // Otherwise, we might have a gap during the first 480 samples.
            // For simplicity, we just output the processed sample if available, else silence or passthrough.
            // Note: This introduces the 480-sample latency (~10ms).
            output[i] = this.frameBuffer.getProcessedSample();
        }

        return true;
    }
}

registerProcessor('noise-suppression-processor', RNNoiseProcessor);
