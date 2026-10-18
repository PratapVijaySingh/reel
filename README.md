# Reel

Reel is a video editor that runs in the browser. Pictures, video, titles, and audio stay on your machine. Nothing is uploaded.

**Use it:** [https://reel-azure.vercel.app](https://reel-azure.vercel.app)

## Short demo

Import a picture and a video, place the picture over the video, add a title, then play.

[![Nine second Reel demo](docs/demo.gif)](docs/demo.mp4)

[Open the demo video](docs/demo.mp4)

<video src="docs/demo.mp4" width="720" controls playsinline></video>

## Try the editor

1. Open [the demo](https://reel-azure.vercel.app).
2. Click **Import** and choose pictures, video, or audio.
3. Use **Arrange** for Sequence, Picture over video, Video over picture, or Side by side. Drag a clip between the Video and Overlay lanes when you want them to play together.
4. Drag a picture, video, matte, or title in the preview to move it. Drag a corner to resize it. The Place controls in the clip panel do the same.
5. Audio lands at the playhead, including on top of other audio. Both play together.
6. Press **Space** to play. **S** splits, **Ctrl+D** duplicates, **Delete** removes, **Ctrl+Z** undoes.
7. Choose a size (720p, 1080p, or 4K) and **Export**. MP4, WebM, MKV, M4A, and GIF are offered when this browser can record them. GIF has no audio.

## What you can do

- Sequence pictures and video, or play them at the same time.
- Fit any picture, video, matte, or title anywhere in the frame.
- Add a title, a lower third, a color matte, or a tone.
- Restyle a clip with a remix look, or apply that look to every matching clip.
- Mark, loop, and undo while you edit.

## Run it yourself

```bash
npm install
npm run dev
```

Open [http://localhost:5174](http://localhost:5174).

## Support

This is the same support QR used for LearningPal. Scan it with Google Pay, PhonePe, or Paytm and enter any amount. It is voluntary crowd support: no equity and no promised return.

<img src="docs/support-qr.png" width="220" alt="UPI QR code for LearningPal crowd support">
