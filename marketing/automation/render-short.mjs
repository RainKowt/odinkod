import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const input = resolve(process.argv[2] || 'marketing/automation/shorts/001.json');
const spec = JSON.parse(readFileSync(input, 'utf8'));
const output = resolve(process.argv[3] || `marketing/automation/output/${spec.slug}.mp4`);
mkdirSync(dirname(output), { recursive: true });

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const font = 'C\\:/Windows/Fonts/arialbd.ttf';
const escapeText = value => String(value)
  .replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’')
  .replace(/%/g, '\\%').replace(/,/g, '\\,');
const colors = ['0x17150f', '0x3956d8', '0xffe24a', '0xf7f4ea'];
const inputs = [];
const filters = [];
for (const [index, scene] of spec.scenes.entries()) {
  const duration = Number(scene.duration || 3);
  if (scene.image) inputs.push('-loop','1','-t',String(duration),'-i',resolve(dirname(input),scene.image));
  else inputs.push('-f','lavfi','-t',String(duration),'-i',`color=c=${colors[index % colors.length]}:s=1080x1920:r=30`);
  const darkText = index % colors.length >= 2;
  const size = scene.size || 82;
  const lines = String(scene.text).split('\n');
  const lineFilters = lines.map((line,lineIndex)=>{
    const offset = Math.round((lineIndex-(lines.length-1)/2)*size*1.55);
    return `drawtext=fontfile='${font}':text='${escapeText(line)}':fontcolor=${darkText?'0x17150f':'white'}:fontsize=${size}:x=(w-text_w)/2:y=(h-text_h)/2+${offset}:box=1:boxcolor=${darkText?'white@0.18':'black@0.22'}:boxborderw=24`;
  });
  const motion = `drawbox=x='mod(t*260+${index*170}\\,1580)-500':y=270:w=430:h=28:color=${darkText?'0x3956d8@0.55':'0xffe24a@0.7'}:t=fill,drawbox=x='1080-mod(t*190+${index*120}\\,1480)':y=1510:w=400:h=22:color=${darkText?'0x17150f@0.35':'0x3956d8@0.7'}:t=fill`;
  const brand = `drawtext=fontfile='${font}':text='ONECODE  /  SAVE SMARTER':fontcolor=${darkText?'0x17150f':'white'}@0.78:fontsize=32:x=70:y=150`;
  const finish = `${motion},${brand},${lineFilters.join(',')},fade=t=in:st=0:d=0.22,fade=t=out:st=${Math.max(0.2,duration-0.25)}:d=0.25[v${index}]`;
  if (scene.image) filters.push(`[${index}:v]split=2[bg${index}i][fg${index}i];[bg${index}i]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bg${index}];[fg${index}i]scale=960:960[fg${index}];[bg${index}][fg${index}]overlay=(W-w)/2:(H-h)/2,${finish}`);
  else filters.push(`[${index}:v]${finish}`);
}
filters.push(`${spec.scenes.map((_,i)=>`[v${i}]`).join('')}concat=n=${spec.scenes.length}:v=1:a=0,format=yuv420p[v]`);
if (spec.audio) inputs.push('-i',resolve(dirname(input),spec.audio));
const args = ['-y',...inputs,'-filter_complex',filters.join(';'),'-map','[v]'];
if (spec.audio) args.push('-map',`${spec.scenes.length}:a:0`,'-c:a','aac','-b:a','192k','-shortest');
args.push('-c:v','libx264','-preset','medium','-crf','19','-movflags','+faststart',output);
const result = spawnSync(ffmpeg,args,{stdio:'inherit'});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Rendered ${output}`);
