import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const input = resolve(process.argv[2] || 'marketing/automation/shorts/source-example.json');
const spec = JSON.parse(readFileSync(input, 'utf8'));
const output = resolve(process.argv[3] || `marketing/automation/output/${spec.slug}.mp4`);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const font = 'C\\:/Windows/Fonts/arialbd.ttf';

if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error('At least one scene is required.');
for (const [index, scene] of spec.scenes.entries()) {
  if (!scene.file || !existsSync(resolve(dirname(input), scene.file))) throw new Error(`Scene ${index + 1}: source file is missing.`);
  if (!scene.rights || !scene.source) throw new Error(`Scene ${index + 1}: record both rights and source before rendering.`);
}

mkdirSync(dirname(output), { recursive: true });
const esc = value => String(value || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%').replace(/,/g, '\\,');
const inputs = [];
const filters = [];

for (const [i, scene] of spec.scenes.entries()) {
  const duration = Number(scene.duration || 2.5);
  const start = Number(scene.start || 0);
  inputs.push('-ss', String(start), '-t', String(duration), '-i', resolve(dirname(input), scene.file));
  const caption = esc(String(scene.caption || '').toUpperCase());
  const base = `[${i}:v]split=2[b${i}i][f${i}i];` +
    `[b${i}i]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=32:3,colorchannelmixer=aa=.82[b${i}];` +
    `[f${i}i]scale=1080:1920:force_original_aspect_ratio=decrease[f${i}];` +
    `[b${i}][f${i}]overlay=(W-w)/2:(H-h)/2`;
  const text = caption ? `,drawtext=fontfile='${font}':text='${caption}':fontcolor=white:fontsize=${scene.fontSize || 78}:line_spacing=12:borderw=10:bordercolor=black@0.96:x=(w-text_w)/2:y=h*0.66-text_h/2` : '';
  const brand = `,drawtext=fontfile='${font}':text='ONECODE':fontcolor=white@0.88:fontsize=30:borderw=4:bordercolor=black@0.75:x=(w-text_w)/2:y=h-155`;
  filters.push(`${base}${text}${brand},fps=30,setsar=1[v${i}]`);
}

filters.push(`${spec.scenes.map((_, i) => `[v${i}]`).join('')}concat=n=${spec.scenes.length}:v=1:a=0,format=yuv420p[v]`);
if (spec.audio) inputs.push('-i', resolve(dirname(input), spec.audio));
const args = ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[v]'];
if (spec.audio) args.push('-map', `${spec.scenes.length}:a:0`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-movflags', '+faststart', output);
const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Rendered ${output}`);
