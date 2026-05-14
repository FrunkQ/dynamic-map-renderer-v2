/*
    Copyright (c) 2023 al-ro

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/


#define PI 3.14159
#define TWO_PI (2.0 * PI)

// Side length of domain. Max 184
const uint width = 90u;
const uint maxIdx = width * width * width;
const vec3 scale = vec3(width);

float saturate(float x){
    return clamp(x, 0.0, 1.0);
}

vec3 remap(vec3 x, vec3 low1, vec3 high1, vec3 low2, vec3 high2){
    return low2 + (x - low1) * (high2 - low2) / (high1 - low1);
}

// -------------------- Camera --------------------

vec3 rayDirection(float fieldOfView, vec2 fragCoord, vec2 resolution) {
    vec2 xy = fragCoord - resolution / 2.0;
    float z = (0.5 * resolution.y) / tan(radians(fieldOfView) / 2.0);
    return normalize(vec3(xy, -z));
}

// https://www.geertarien.com/blog/2017/07/30/breakdown-of-the-lookAt-function-in-OpenGL/
mat3 lookAt(vec3 targetDir, vec3 up){
  vec3 zaxis = normalize(targetDir);
  vec3 xaxis = normalize(cross(zaxis, up));
  vec3 yaxis = normalize(cross(xaxis, zaxis));

  return mat3(xaxis, yaxis, -zaxis);
}

// ----------------- Data lookup -----------------

// Morton code approach is not used
// https://fgiesen.wordpress.com/2009/12/13/decoding-morton-codes/

uint compact1By1(uint x){
  x &= 0x55555555u;
  x = (x ^ (x >>  1u)) & 0x33333333u;
  x = (x ^ (x >>  2u)) & 0x0f0f0f0fu;
  x = (x ^ (x >>  4u)) & 0x00ff00ffu;
  x = (x ^ (x >>  8u)) & 0x0000ffffu;
  return x;
}

// "Insert" a 0 bit after each of the 16 low bits of x
uint part1By1(uint x){
  x &= 0x0000ffffu;
  x = (x ^ (x <<  8u)) & 0x00ff00ffu;
  x = (x ^ (x <<  4u)) & 0x0f0f0f0fu;
  x = (x ^ (x <<  2u)) & 0x33333333u;
  x = (x ^ (x <<  1u)) & 0x55555555u;
  return x;
}

uint encodeMorton2(uint x, uint y){
  return (part1By1(y) << 1u) + part1By1(x);
}

uint decodeMorton2X(uint code){
  return compact1By1(code >> 0u);
}

uint decodeMorton2Y(uint code){
  return compact1By1(code >> 1u);
}

vec3 idxToPoint(uint idx){
    return min(scale, vec3(idx % width,
                           uint(float(idx)/float(width)) % width,
                           uint(float(idx)/float(width * width))));
}

uint pointToIdx(vec3 p){
    return uint(p.z * float(width * width) + p.y * float(width) + p.x);
}

vec3 idxToDir(uint idx){

    uint face = uint(float(idx)/float(1024u * 1024u));
    vec2 fragCoord = vec2(idx % 1024u, uint(float(idx)/float(1024u)) % 1024u) + 0.5;
    vec2 uv = 2.0 * (fragCoord/1024.0) - 1.0;

    vec3 rayDir;
    switch(face){
        case 0u: rayDir = vec3(1,  -uv.yx); break;
        case 1u: rayDir = vec3(-1,  -uv.y, uv.x); break;
        case 2u: rayDir = vec3(uv.x,  1,  uv.y); break;
        case 3u: rayDir = vec3(uv.x,  -1,  -uv.y); break;
        case 4u: rayDir = vec3(uv.x, -uv.y,  1); break;
        case 5u: rayDir = vec3(-uv,  -1);  break;
    }

    return rayDir;
}

vec4 getDataInterpolated(vec3 p, samplerCube s){

    p = clamp(p, vec3(0), scale-1.0);
    vec3 f = fract(p);
    vec3 c = floor(p);

    return mix( mix(  mix(texture(s, idxToDir(pointToIdx(c+vec3(0,0,0)))),
                          texture(s, idxToDir(pointToIdx(c+vec3(1,0,0)))), f.x),
                      mix(texture(s, idxToDir(pointToIdx(c+vec3(0,1,0)))),
                          texture(s, idxToDir(pointToIdx(c+vec3(1,1,0)))), f.x), f.y),
                 mix( mix(texture(s, idxToDir(pointToIdx(c+vec3(0,0,1)))),
                          texture(s, idxToDir(pointToIdx(c+vec3(1,0,1)))), f.x),
                      mix(texture(s, idxToDir(pointToIdx(c+vec3(0,1,1)))),
                          texture(s, idxToDir(pointToIdx(c+vec3(1,1,1)))), f.x), f.y), f.z);
}

vec4 getData(vec3 p, samplerCube s){
    p += vec3(0.5 * scale);
    p = clamp(p, vec3(0), scale-1.0);
    return texture(s, idxToDir(pointToIdx(p)));
}
