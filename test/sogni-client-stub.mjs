import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';

const ClientEvent = {
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
  PROJECT_PROGRESS: 'PROJECT_PROGRESS'
};

function getState() {
  if (!globalThis.__SOGNI_GEN_TEST_STATE__) {
    globalThis.__SOGNI_GEN_TEST_STATE__ = { instances: [] };
  }
  return globalThis.__SOGNI_GEN_TEST_STATE__;
}

function persistState() {
  const statePath = process.env.SOGNI_GEN_TEST_STATE_PATH;
  if (!statePath) return;
  const state = getState();
  try {
    writeFileSync(statePath, JSON.stringify({
      lastImageProject: state.lastImageProject ?? null,
      lastVideoProject: state.lastVideoProject ?? null,
      lastEditProject: state.lastEditProject ?? null,
      emittedJobs: state.emittedJobs ?? null
    }));
  } catch (err) {
    // Ignore persistence errors in tests.
  }
}

class SogniClientWrapper extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.connected = false;
    this.lastImageProject = null;
    this.lastVideoProject = null;
    this.lastEditProject = null;
    this.emittedJobs = 0;
    const state = getState();
    state.instances.push(this);
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  async createImageProject(config) {
    const state = getState();
    this.lastImageProject = config;
    state.lastImageProject = config;
    persistState();
    this._emitJobs('imageUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' } };
  }

  async createImageEditProject(config) {
    const state = getState();
    this.lastEditProject = config;
    state.lastEditProject = config;
    persistState();
    this._emitJobs('imageUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' } };
  }

  async createVideoProject(config) {
    const state = getState();
    this.lastVideoProject = config;
    state.lastVideoProject = config;
    persistState();
    this._emitJobs('videoUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' }, videoUrls: ['https://example.com/video.mp4'] };
  }

  async getBalance() {
    return {
      sogni: 100,
      spark: 100,
      lastUpdated: new Date()
    };
  }

  async estimateVideoCost() {
    return {
      token: '1',
      usd: '0.01',
      spark: '1',
      sogni: '1'
    };
  }

  _emitJobs(urlField, count, seed) {
    queueMicrotask(() => {
      const state = getState();
      for (let i = 0; i < count; i++) {
        this.emittedJobs += 1;
        state.emittedJobs = this.emittedJobs;
        this.emit(ClientEvent.JOB_COMPLETED, {
          [urlField]: `https://example.com/${urlField}-${i + 1}.png`,
          job: { data: { seed: seed ?? 123 } },
          jobIndex: i,
          projectId: 'proj-1'
        });
      }
      persistState();
    });
  }
}

function getMaxContextImages(modelId) {
  if (modelId && modelId.includes('qwen_image_edit_2511')) return 3;
  return 0;
}

export { SogniClientWrapper, ClientEvent, getMaxContextImages };
