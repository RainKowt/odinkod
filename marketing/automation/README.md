# Automated short-video pipeline

The stable production path is Codex -> verified script -> narration/assets -> FFmpeg -> review queue -> official platform APIs. CapCut can remain an optional finishing step; its desktop editor does not provide a dependable public editing API for this workflow.

Render the included vertical prototype:

```powershell
$env:FFMPEG_PATH = 'C:\Users\andar\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe'
node marketing\automation\render-short.mjs marketing\automation\shorts\001.json
```

Output is written to `marketing/automation/output`. Each JSON manifest holds the title, caption, and timed scenes. Publishing stays behind an explicit review step until each platform account and official API application are approved.

For real-footage edits matching the supplied references, use `render-source-short.mjs` with a manifest based on `shorts/source-example.json`. The renderer creates the blurred vertical background, centered source frame, large outlined captions, and OneCode watermark. It also requires source and usage-rights metadata for every clip. See `REAL_FOOTAGE_FORMAT.md`.
