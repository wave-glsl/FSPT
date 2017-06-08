function PathTracer(){
  "use strict";
  var gl;
  var programs = {};
  var squareBuffer;
  var textures = {};
  var framebuffers = [];
  var scale = 1;
  var corners = {rightMax: [1,1,0],leftMin: [-1,-1,0], leftMax: [-1,1,0],rightMin: [1,-1,0]};
  var eye = new Float32Array([0,0,scale * 4]);
  var pingpong = 0;

  function initGL(canvas) {
    gl = canvas.getContext("webgl2");
    gl.viewportWidth = canvas.width = window.innerHeight;
    gl.viewportHeight = canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  }

  function getShader(gl, str, id) {
    var shader = gl.createShader(gl[id]);
    gl.shaderSource(shader, str);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.log(id + gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  function initProgram(path, uniforms, attributes, assets) {
    var fs = getShader(gl, assets[path+".fs"],"FRAGMENT_SHADER");
    var vs = getShader(gl, assets[path+".vs"],"VERTEX_SHADER");
    var program = gl.createProgram();
    program.uniforms = {};
    program.attributes = {};
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    uniforms.forEach(function(name){
      program.uniforms[name] = gl.getUniformLocation(program, name);
    });
    attributes.forEach(function(name){
      program.attributes[name] = gl.getAttribLocation(program, name);
    });

    return program;
  }

  function initPrograms(assets){
    programs.tracer = initProgram(
      "shader/tracer",
      ["tick","dims","eye","fbTex", "triTex", "bvhTex", "matTex", "scale", "rightMax", "rightMin", "leftMax", "leftMin"],
      ["corner"],
      assets
    );
    programs.draw = initProgram(
      "shader/draw",
      ["fbTex","imageTex","dims"],
      ["corner"],
      assets
    );
  }

  function requiredRes(num_elements, per_element, per_pixel){
    var num_pixels = num_elements / per_pixel;
    var root = Math.sqrt(num_pixels);
    var width = Math.ceil(root/per_element) * per_element;
    var height = Math.ceil(num_pixels / width);
    return [width, height]
  }

  function padBuffer(buffer, width, height, channels){
    var numToPad = channels * width * height - buffer.length;
    console.assert(numToPad >= 0);
    for(var i=0; i< numToPad; i++){
      buffer.push(-1);
    }
  }

  function initBVH(assets){
	  var scene = JSON.parse(assets['scene/scene.json']);
    var geometry = [];
    for(var i=0; i<scene.props.length; i++){
      var prop = scene.props[i];
      geometry = geometry.concat(parseMesh(assets[prop.path], prop));
    }
    var bvh = new BVH(geometry, 4);
    var bvhArray = bvh.serializeTree();
    var bvhBuffer = [];
    var trianglesBuffer = [];
    var materialBuffer = [];
    for(var i=0; i< bvhArray.length; i++){
      var e = bvhArray[i];
      var node = e.node;
      var box = node.boundingBox.getBounds();
      var triIndex = node.leaf ? trianglesBuffer.length/3/3 : -1;
      // 4 pixels
      var reordered = [box[0], box[2], box[4], box[1], box[3], box[5]];
      var bufferNode = [e.parent, e.sibling, node.split, e.left, e.right, triIndex].concat(reordered);
      if(node.leaf){
        var tris = node.triangles;
        for(var j=0; j<tris.length; j++){
          var subBuffer = [].concat(tris[j].v1, tris[j].v2, tris[j].v3);
          subBuffer.forEach(function(el){trianglesBuffer.push(el)});
        }
        for(var j=0; j<tris.length; j++){
          var subBuffer = [].concat(tris[j].transforms.emittance, tris[j].transforms.reflectance);
          subBuffer.forEach(function(el){materialBuffer.push(el)});
        }
      }
      for(var j=0; j<bufferNode.length; j++){
        bvhBuffer.push(bufferNode[j]);
      }
    }

    textures.materials = createTexture();
    var res = requiredRes(materialBuffer.length, 2, 3);
    padBuffer(materialBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.materials);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(materialBuffer));

    textures.bvh = createTexture();
    res = requiredRes(bvhBuffer.length, 4, 3);
    padBuffer(bvhBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.bvh);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(bvhBuffer));

    textures.triangles = createTexture();
    res = requiredRes(trianglesBuffer.length, 3, 3);
    padBuffer(trianglesBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.triangles);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(trianglesBuffer));
  }
  
  // function initNoise(){
  //   var randBuffer = [];
  //   for(var i=0; i<512 * 512 * 2; i++){
  //     randBuffer.push(Math.random());
  //   }
  //   randTexture = createTexture();
  //   gl.bindTexture(gl.TEXTURE_2D, randTexture);
  //   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 512, 512, 0, gl.RG, gl.FLOAT, new Float32Array(randBuffer));
  // }

  function createTexture() {
    var t = gl.createTexture () ;
    gl.getExtension('EXT_color_buffer_float');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gl.viewportWidth, gl.viewportHeight, 0, gl.RGBA, gl.FLOAT, null);
    return t;
  }

  function createFramebuffer(tex){
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  }

  function initBuffers(){
    squareBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
    var vertices = [
      1.0,  1.0,  0.0,
     -1.0,  1.0,  0.0,
      1.0, -1.0,  0.0,
     -1.0, -1.0,  0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(programs.tracer.corner, 3, gl.FLOAT, false, 0, 0);
    textures.screen = [];
    textures.screen.push(createTexture());
    textures.screen.push(createTexture());
    framebuffers.push(createFramebuffer(textures.screen[0]));
    framebuffers.push(createFramebuffer(textures.screen[1]));
  }

  function initEvents(){
    var element = document.getElementById("trace");
    var xi, yi;
    var mode = 0;
    element.addEventListener("mousedown", function(e){
      mode = 1;
	    xi = e.layerX;
      yi = e.layerY;
    }, false);
    element.addEventListener("mousemove", function(e){
      if(mode){
		    var rx = (e.layerX - xi) / 180.0;
		    var ry = -(e.layerY - yi) / 180.0;
        eye = rotateY(eye, rx);
        corners.rightMax = rotateY(corners.rightMax, rx);
        corners.rightMin = rotateY(corners.rightMin, rx);
        corners.leftMax = rotateY(corners.leftMax, rx);
        corners.leftMin = rotateY(corners.leftMin, rx);
        eye = rotateX(eye, ry);
        corners.rightMax = rotateX(corners.rightMax, ry);
        corners.rightMin = rotateX(corners.rightMin, ry);
        corners.leftMax = rotateX(corners.leftMax, ry);
        corners.leftMin = rotateX(corners.leftMin, ry);
        xi = e.layerX;
        yi = e.layerY;
        pingpong = 0;
      }
    }, false);
    element.addEventListener("mouseup", function(){
      mode = 0;
    }, false);
    element.addEventListener('mousewheel', function(e) {
      scale -= e.wheelDelta / 1200 * scale;
      pingpong = 0;
    }, false)
  }

  function drawTracer(i){
    var program = programs.tracer;
    //console.log(program)
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform1f(program.uniforms.scale, scale);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.uniform1i(program.uniforms.triTex, 1);
    gl.uniform1i(program.uniforms.bvhTex, 2);
    gl.uniform1i(program.uniforms.matTex, 3);
    //gl.uniform1i(program.uniforms.randTex, 3);
    gl.uniform1i(program.uniforms.tick, i);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform3f(program.uniforms.eye, eye[0],eye[1],eye[2]);
    gl.uniform3f(program.uniforms.rightMax, corners.rightMax[0], corners.rightMax[1], corners.rightMax[2]);
    gl.uniform3f(program.uniforms.leftMin, corners.leftMin[0], corners.leftMin[1], corners.leftMin[2]);
    gl.uniform3f(program.uniforms.leftMax, corners.leftMax[0], corners.leftMax[1], corners.leftMax[2]);
    gl.uniform3f(program.uniforms.rightMin, corners.rightMin[0], corners.rightMin[1], corners.rightMin[2]);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, textures.materials);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures.bvh);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures.triangles);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.screen[(i+1)%2]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i%2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function drawQuad(i){
    var program = programs.draw;
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, textures.screen[i%2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function tick() {
    requestAnimationFrame(tick);
    for (var i = 0; i < 1; i++){
      pingpong++;
      drawTracer(pingpong);
    }
    drawQuad(pingpong);
    if(!(pingpong % 1000)){
      console.log(pingpong);
    }
  }

  function start(res) {
    var canvas = document.getElementById("trace");
    initGL(canvas);
    initPrograms(res);
    initBVH(res);
    //initNoise();
    initBuffers();
    initEvents();

    console.log("initialized");

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.disable(gl.BLEND);

    tick();
  }

  getText('scene/scene.json', function (res) {
    var paths = {
      "scene/scene.json":true,
      "shader/tracer.vs":true,
      "shader/tracer.fs":true,
      "shader/draw.vs":true,
      "shader/draw.fs":true
    };
    var scene = JSON.parse(res);
    scene.props.forEach(function(e){
      paths[e.path] = true;
    });
    loadAll(Object.keys(paths),start)
  });
}

new PathTracer();
