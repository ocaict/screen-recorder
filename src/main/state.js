let isRecording = false;
let isPaused = false;

function setRecordingState(recording) {
  isRecording = recording;
}

function getRecordingState() {
  return isRecording;
}

function setPaused(paused) {
  isPaused = paused;
}

function getPaused() {
  return isPaused;
}

module.exports = {
  setRecordingState,
  getRecordingState,
  setPaused,
  getPaused,
};
