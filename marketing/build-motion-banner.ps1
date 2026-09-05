$ErrorActionPreference = 'Stop'

$marketingDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $marketingDir 'onecode-banner-static.png'
$output = Join-Path $marketingDir 'onecode-banner-motion-loop-transparent.webm'

# The animation is periodic over exactly eight seconds. Every movement is based
# on sin(2*PI*t/8), so the first and final frames meet without a visible jump.
$filter = @'
[0:v]format=rgba,colorkey=0x00ff24:0.32:0.10,drawbox=x=91:y=178:w=666:h=447:color=0xf7f4ed@1:t=fill[base];
[0:v]crop=214:214:91:180,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.025*sin(2*PI*t/8)':ow=rotw(iw):oh=roth(ih):c=none[p1];
[0:v]crop=220:214:310:180,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.025*sin(2*PI*t/8+1.0472)':ow=rotw(iw):oh=roth(ih):c=none[p2];
[0:v]crop=214:214:535:180,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.025*sin(2*PI*t/8+2.0944)':ow=rotw(iw):oh=roth(ih):c=none[p3];
[0:v]crop=214:214:91:399,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.025*sin(2*PI*t/8+3.1416)':ow=rotw(iw):oh=roth(ih):c=none[p4];
[0:v]crop=220:214:310:399,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.025*sin(2*PI*t/8+4.1888)':ow=rotw(iw):oh=roth(ih):c=none[p5];
[0:v]crop=214:214:535:399,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.025*sin(2*PI*t/8+5.2360)':ow=rotw(iw):oh=roth(ih):c=none[p6];
[0:v]crop=380:350:1530:265,format=rgba,colorkey=0x00ff24:0.32:0.10,rotate='0.045*sin(2*PI*t/8)':ow=rotw(iw):oh=roth(ih):c=none[ticket];
[base][p1]overlay=x='82+220*mod(floor(t/2),3)+8*sin(2*PI*t/8)':y='171+18*sin(4*PI*t/8)'[v1];
[v1][p2]overlay=x='82+220*mod(1+floor(t/2),3)+8*sin(2*PI*t/8+1.0472)':y='171+18*sin(4*PI*t/8+1.0472)'[v2];
[v2][p3]overlay=x='82+220*mod(2+floor(t/2),3)+8*sin(2*PI*t/8+2.0944)':y='171+18*sin(4*PI*t/8+2.0944)'[v3];
[v3][p4]overlay=x='82+220*mod(floor(t/2),3)+8*sin(2*PI*t/8+3.1416)':y='390+18*sin(4*PI*t/8+3.1416)'[v4];
[v4][p5]overlay=x='82+220*mod(1+floor(t/2),3)+8*sin(2*PI*t/8+4.1888)':y='390+18*sin(4*PI*t/8+4.1888)'[v5];
[v5][p6]overlay=x='82+220*mod(2+floor(t/2),3)+8*sin(2*PI*t/8+5.2360)':y='390+18*sin(4*PI*t/8+5.2360)'[v6];
[v6][ticket]overlay=x='1515+8*sin(2*PI*t/8)':y='245+5*cos(2*PI*t/8)'[designed];
[designed]scale=1000:-1:flags=lanczos[scaled];
color=c=black@0.0:s=1080x1920:r=30:d=8,format=rgba[canvas];
[canvas][scaled]overlay=x=40:y='1450+5*sin(2*PI*t/8)':format=auto,format=yuva420p[out]
'@

ffmpeg -y -loop 1 -framerate 30 -i $source -filter_complex $filter -map '[out]' -t 8 -an -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 -auto-alt-ref 0 -metadata:s:v:0 alpha_mode=1 $output
ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt:stream_tags=alpha_mode:format=duration -of default=noprint_wrappers=1 $output
