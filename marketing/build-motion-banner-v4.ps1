$ErrorActionPreference='Stop'
$d=Split-Path -Parent $MyInvocation.MyCommand.Path
$src=Join-Path $d 'onecode-motion-hero-v3.png'
$out=Join-Path $d 'onecode-banner-soft-float-transparent.webm'
$font='C\:/Windows/Fonts/arialbd.ttf'
$filter=@"
[0:v]format=rgba,crop=980:900:0:60,scale=690:-1[hero];
color=c=black@0:s=1080x650:r=30:d=8,format=rgba[blank];
color=c=0x111111:s=430x116:r=30:d=8,format=rgba,geq=r=17:g=17:b=17:a='if(gt(between(X,58,W-59)+between(Y,58,H-59)+lte((X-58)*(X-58)+(Y-58)*(Y-58),3364)+lte((X-W+59)*(X-W+59)+(Y-58)*(Y-58),3364)+lte((X-58)*(X-58)+(Y-H+59)*(Y-H+59),3364)+lte((X-W+59)*(X-W+59)+(Y-H+59)*(Y-H+59),3364),0),255,0)'[border];
color=c=0xffd323:s=416x102:r=30:d=8,format=rgba,geq=r=255:g=211:b=35:a='if(gt(between(X,51,W-52)+between(Y,51,H-52)+lte((X-51)*(X-51)+(Y-51)*(Y-51),2601)+lte((X-W+52)*(X-W+52)+(Y-51)*(Y-51),2601)+lte((X-51)*(X-51)+(Y-H+52)*(Y-H+52),2601)+lte((X-W+52)*(X-W+52)+(Y-H+52)*(Y-H+52),2601),0),255,0)'[yellow];
[blank][hero]overlay=x=-35:y=-5[c1];[c1][border]overlay=x=585:y=342[c2];[c2][yellow]overlay=x=592:y=349[c3];
[c3]drawtext=fontfile='$font':text='One':fontsize=48:fontcolor=0x111111:borderw=3:bordercolor=white:x=590:y=30,drawtext=fontfile='$font':text='Code':fontsize=48:fontcolor=0x1257e5:borderw=3:bordercolor=white:x=681:y=30,drawtext=fontfile='$font':text='STOP':fontsize=82:fontcolor=0x111111:borderw=5:bordercolor=white:shadowx=3:shadowy=3:shadowcolor=black@0.35:x=590:y=92,drawtext=fontfile='$font':text='OVERPAYING':fontsize=57:fontcolor=0x1257e5:borderw=5:bordercolor=white:shadowx=3:shadowy=3:shadowcolor=black@0.35:x=590:y=188,drawtext=fontfile='$font':text='REAL CODES. REAL DEALS.':fontsize=27:fontcolor=0x111111:borderw=3:bordercolor=white:x=592:y=278,drawtext=fontfile='$font':text='GET MY DEAL':fontsize=43:fontcolor=0x111111:x=660:y=377,drawtext=fontfile='$font':text='odinkod.onrender.com':fontsize=28:fontcolor=white:borderw=5:bordercolor=0x1257e5:x=600:y=505[art];
color=c=black@0:s=1080x1920:r=30:d=8,format=rgba[canvas];
[canvas][art]overlay=x='4*sin(2*PI*t/8)':y='1195+12*sin(2*PI*t/8)':format=auto,format=yuva420p[out]
"@
ffmpeg -y -loop 1 -framerate 30 -t 8 -i $src -filter_complex $filter -map '[out]' -an -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 18 -auto-alt-ref 0 -metadata:s:v:0 alpha_mode=1 $out
ffprobe -v error -show_entries stream=width,height,pix_fmt:stream_tags=alpha_mode:format=duration -of default=nw=1 $out
