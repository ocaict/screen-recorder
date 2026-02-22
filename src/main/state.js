let isRecording = false;

function setRecordingState(recording) {
  isRecording = recording;
}

function getRecordingState() {
  return isRecording;
}

module.exports = {
  setRecordingState,
  getRecordingState,
};
