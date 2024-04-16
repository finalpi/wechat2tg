const ffmpeg = require('fluent-ffmpeg');

import ffmpegStatic from "ffmpeg-static";
// Tell fluent-ffmpeg where it can find FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

// Run FFmpeg
ffmpeg()

    // Input file
    .input('save-files/sticker.webm')

    // Scale the video to 720 pixels in height. The -2 means FFmpeg should figure out the
    // exact size of the other dimension. In other words, to make the video 720 pixels wide
    // and make FFmpeg calculate its height, use scale=720:-2 instead.
    // .outputOptions('-vf','scale=-2:720')
    // .outputOptions('-vf', 'fps=24,scale=120:-1')
    // .outputOptions('-loop', '-1')
    // .outputOptions('-vf', 'fps=16,scale=360:-1')
    .format('gif')
    // Output file
    .saveToFile('save-files/sticker.gif')

    // Log the percentage of work completed
    .on('progress', () => {
        // if (progress.percent) {
        //     console.log(`Processing: ${Math.floor(progress.percent)}% done`);
        // }
    })

    // The callback that is run when FFmpeg is finished
    .on('end', () => {
        console.log('FFmpeg has finished.');
    })

    // The callback that is run when FFmpeg encountered an error
    .on('error', (error: Error) => {
        console.error(error);
    });
