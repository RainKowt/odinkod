$ErrorActionPreference='Stop'
$d=Split-Path -Parent $MyInvocation.MyCommand.Path
$src=Join-Path $d 'onecode-banner-static.png'
$out=Join-Path $d 'onecode-banner-motion-loop-transparent.webm'
$items=@(@('headphones',99,186,'HEADPHONES DEALS'),@('sneakers',317,186,'SNEAKER DEALS'),@('watch',317,405,'TECH DEALS'))
foreach($i in $items){ffmpeg -loglevel error -y -i $src -vf "crop=205:204:$($i[1]):$($i[2])" -frames:v 1 (Join-Path $d "motion-product-$($i[0]).png")}
$f=@'
color=c=black@0:s=1080x1920:r=30:d=12,format=rgba,drawbox=x=30:y=1190:w=1020:h=560:color=0x000000@.2:t=fill:replace=1,drawbox=x=20:y=1180:w=1020:h=560:color=0xfaf8f1@.98:t=fill:replace=1,drawbox=x=20:y=1180:w=1020:h=560:color=0x111111:t=6:replace=1,drawbox=x=20:y=1180:w=20:h=560:color=0x1257e5:t=fill:replace=1[bg];
[0:v]scale=330:330,format=rgba,split=2[p0][p0b];[1:v]scale=330:330,format=rgba[p1];[2:v]scale=330:330,format=rgba[p2];
[p0][p1]xfade=transition=fade:duration=0.65:offset=3.35[q1];[q1][p2]xfade=transition=fade:duration=0.65:offset=6.7[q2];[q2][p0b]xfade=transition=fade:duration=0.65:offset=10.05,trim=duration=10.7[product];
[bg][product]overlay=x='70+10*sin(2*PI*t/3.35)':y='1300+12*cos(2*PI*t/3.35)'[a];
[a]drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='One':fontsize=96:fontcolor=0x111111:x=430:y=1250,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='Code':fontsize=96:fontcolor=0x1257e5:x=600:y=1250,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='PROMO CODES & DEALS':fontsize=42:fontcolor=0x111111:x=430:y=1380,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='New deals rotate automatically':fontsize=27:fontcolor=0x444444:x=430:y=1445,drawbox=x=430:y=1525:w=465:h=100:color=0xffd323:t=fill:replace=1,drawbox=x=430:y=1525:w=465:h=100:color=0x111111:t=5:replace=1,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='GET 1 CODE FREE':fontsize=39:fontcolor=0x111111:x=475:y=1553,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='odinkod.onrender.com':fontsize=28:fontcolor=0x1257e5:x=430:y=1670,trim=duration=10.7,format=yuva420p[out]
'@
ffmpeg -y -loop 1 -t 4 -framerate 30 -i (Join-Path $d 'motion-product-headphones.png') -loop 1 -t 4 -framerate 30 -i (Join-Path $d 'motion-product-sneakers.png') -loop 1 -t 4 -framerate 30 -i (Join-Path $d 'motion-product-watch.png') -filter_complex $f -map '[out]' -an -c:v libvpx-vp9 -pix_fmt yuva420p -crf 20 -b:v 0 -auto-alt-ref 0 -metadata:s:v:0 alpha_mode=1 $out
