// Track mouse movement and resolution change between frames and set camera position.
// Source: https://www.shadertoy.com/view/dsKfWR (al-ro, MIT)

#define CAMERA_DIST 2.5

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {

    // Work with just the first four pixels.
    if((fragCoord.x == 0.5) && (fragCoord.y < 4.0)){

        vec4 oldData = texelFetch(iChannel0, ivec2(0.5), 0).xyzw;

        vec2 oldPolarAngles = oldData.xy;
        vec2 oldMouse = oldData.zw;

        vec2 polarAngles = vec2(0);
        vec2 mouse = iMouse.xy / iResolution.xy;

        // Stop camera going directly above and below
        float angleEps = 0.01;

        float mouseDownLastFrame = texelFetch(iChannel0, ivec2(0.5, 3.5), 0).x;

        // If mouse button is down and was down last frame.
        if(iMouse.z > 0.0 && mouseDownLastFrame > 0.0){
            // Difference between mouse position last frame and now.
            vec2 mouseMove = mouse - oldMouse;
            polarAngles = oldPolarAngles + vec2(5.0, 3.0) * mouseMove;

        }else{
            polarAngles = oldPolarAngles;
        }

        polarAngles.x = mod(polarAngles.x, 2.0 * PI - angleEps);
        polarAngles.y = min(PI - angleEps, max(angleEps, polarAngles.y));

        // Store mouse data in the first pixel of Buffer A.
        if(fragCoord == vec2(0.5, 0.5)){
                    // Set value at first frames.
            if(iFrame < 10){
                polarAngles = vec2(2.9, 1.7);
                mouse = vec2(0);
            }

            // Set value at first frames.
            fragColor = vec4(polarAngles, mouse);
        }

        // Store camera position in the second pixel of Buffer A.
        if(fragCoord == vec2(0.5, 1.5)){
            // Cartesian direction from polar coordinates.
            vec3 cameraPos = normalize(vec3(-cos(polarAngles.x) * sin(polarAngles.y),
                                             cos(polarAngles.y),
                                            -sin(polarAngles.x) * sin(polarAngles.y)));

            fragColor = vec4(CAMERA_DIST * cameraPos, 1.0);
        }

        // Store resolution change data in the third pixel of Buffer B.
        if(fragCoord == vec2(0.5, 2.5)){
            float resolutionChangeFlag = 0.0;
            // The resolution last frame.
            vec2 oldResolution = texelFetch(iChannel0, ivec2(0.5, 2.5), 0).yz;

            if(iResolution.xy != oldResolution){
                resolutionChangeFlag = 1.0;
            }

            fragColor = vec4(resolutionChangeFlag, iResolution.xy, 1.0);
        }

        // Store whether the mouse button is down in the fourth pixel of Buffer A
        if(fragCoord == vec2(0.5, 3.5)){
            if(iMouse.z > 0.0){
                fragColor = vec4(vec3(1.0), 1.0);
            }else{
                fragColor = vec4(vec3(0.0), 1.0);
            }
        }

    }
}
