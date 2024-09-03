const getTimeDuration = (ffmpeg, tempFilePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
      if (err) {
        return reject(err);
      }
      resolve(metadata.format.duration); // Duration in seconds
    });
  });
};

module.exports = { getTimeDuration };
