$ErrorActionPreference='Stop'
$d=Split-Path -Parent $MyInvocation.MyCommand.Path
$src=Join-Path $d 'onecode-motion-hero-v3.png'
$out=Join-Path $d 'onecode-banner-motion-loop-transparent.webm'
$font='C\:/Windows/Fonts/arialbd.ttf'
$f=@"
[0:v]format=rgba,crop=980:900:0:60,scale=690:-1[hero];
color=c=black@0:s=1080x1920:r=30:d=9,format=rgba[canvas];
[canvas][hero]overlay=x='-30+8*sin(2*PI*t/9)':y='1185+10*cos(2*PI*t/9)'[base];
color=c=black@0:s=1080x1920:r=30:d=3,format=rgba,drawtext=fontfile='$font':text='SAVE':fontsize=82:fontcolor=0x111111:x=590:y=1260,drawtext=fontfile='$font':text='UP TO 70 PCT':fontsize=63:fontcolor=0x1257e5:x=590:y=1350,drawtext=fontfile='$font':text='ON THINGS YOU WANT':fontsize=26:fontcolor=0x111111:x=592:y=1442[t1];
color=c=black@0:s=1080x1920:r=30:d=3,format=rgba,drawtext=fontfile='$font':text='FRESH':fontsize=82:fontcolor=0x111111:x=590:y=1260,drawtext=fontfile='$font':text='DEALS DAILY':fontsize=65:fontcolor=0x1257e5:x=590:y=1350,drawtext=fontfile='$font':text='REAL CODES. REAL SAVINGS.':fontsize=25:fontcolor=0x111111:x=592:y=1442[t2];
color=c=black@0:s=1080x1920:r=30:d=3,format=rgba,drawtext=fontfile='$font':text='YOUR FIRST':fontsize=65:fontcolor=0x111111:x=590:y=1265,drawtext=fontfile='$font':text='CODE FREE':fontsize=75:fontcolor=0x1257e5:x=590:y=1345,drawtext=fontfile='$font':text='TRY ONECODE NOW':fontsize=29:fontcolor=0x111111:x=592:y=1442[t3];
[t1]split=2[t1a][t1b];[t1a][t2]xfade=transition=fade:duration=0.55:offset=2.45[x1];[x1][t3]xfade=transition=fade:duration=0.55:offset=4.9[x2];[x2][t1b]xfade=transition=fade:duration=0.55:offset=7.35,trim=duration=7.9[textloop];
[base][textloop]overlay=0:0[copy];
[copy]drawbox=x='590+5*sin(2*PI*t/1.8)':y=1515:w=420:h=105:color=0xffd323:t=fill:replace=1,drawbox=x='590+5*sin(2*PI*t/1.8)':y=1515:w=420:h=105:color=0x111111:t=5:replace=1,drawtext=fontfile='$font':text='GET MY DEAL':fontsize=43:fontcolor=0x111111:x='665+5*sin(2*PI*t/1.8)':y=1545,drawtext=fontfile='$font':text='odinkod.onrender.com':fontsize=28:fontcolor=white:borderw=5:bordercolor=0x1257e5:x=600:y=1660,trim=duration=7.9,format=yuva420p[out]
"@
ffmpeg -y -loop 1 -framerate 30 -t 9 -i $src -filter_complex $f -map '[out]' -an -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 18 -auto-alt-ref 0 -metadata:s:v:0 alpha_mode=1 $out
ffprobe -v error -show_entries stream=width,height,pix_fmt:stream_tags=alpha_mode:format=duration -of default=nw=1 $out
