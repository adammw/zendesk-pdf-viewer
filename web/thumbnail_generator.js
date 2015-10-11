PDFJS.workerSrc = '../build/pdf.worker.js';

var RANGE_CHUNK_SIZE = 65536;

var zafClient = ZAFClient.init();
var ZAFSDKPDFDataRangeTransport = function(data) {
  this.data = data;
  PDFJS.PDFDataRangeTransport.call(this, data.size);
  this.chunks = [];
  this.chunksLength = 0;
  zafClient.on('data_transport_response', function(data) {
    if (this.data.id != data.id) return;
    var chunkData = base64js.toByteArray(data.result);
    this.chunks.push({
      start: data.start,
      value: chunkData
    });
    this.chunksLength += chunkData.byteLength;
    this.flushChunks();
  }.bind(this));
};
ZAFSDKPDFDataRangeTransport.prototype = Object.create(PDFJS.PDFDataRangeTransport.prototype);
ZAFSDKPDFDataRangeTransport.prototype.constructor = ZAFSDKPDFDataRangeTransport;
ZAFSDKPDFDataRangeTransport.prototype.flushChunks = function() {
  // var start = null;
  // var length = this.chunks.reduce(function(len, chunk) {
  //   if (start === null) {
  //     start = chunk.start;
  //   } else if (start + len != chunk.start) {
  //     throw new Error('non contigious chunks');
  //   }
  //   return len + chunk.byteLength;
  // }, 0);
  while (this.chunksLength >= RANGE_CHUNK_SIZE) {
    var outBuf = new ArrayBuffer(RANGE_CHUNK_SIZE);
    var uint8 = new Uint8Array(outBuf);
    var bytesRemaining = RANGE_CHUNK_SIZE;
    var chunk;
    var start = this.chunks[0].start;
    while(bytesRemaining > 0 && (chunk = this.chunks.shift())) {
      var partial = bytesRemaining < chunk.value.byteLength;
      var slice = (partial) ? chunk.value.slice(0, bytesRemaining) : chunk.value;
      console.log(partial, chunk, RANGE_CHUNK_SIZE - bytesRemaining, bytesRemaining, slice.byteLength);
      uint8.set(slice, RANGE_CHUNK_SIZE - bytesRemaining);
      bytesRemaining -= slice.byteLength;
      if (partial) {
        chunk.value = chunk.value.slice(slice.byteLength);
        chunk.start += slice.byteLength;
        this.chunks.unshift(chunk);
      }
    }
    this.chunksLength -= RANGE_CHUNK_SIZE;
    console.log('onDataRange', start, start+uint8.byteLength, uint8.byteLength, uint8);
    this.onDataRange(start, uint8);
  }
};
ZAFSDKPDFDataRangeTransport.prototype.requestDataRange = function(begin, end) {
  zafClient.postMessage('data_transport_request', {
    id: this.data.id,
    begin: begin,
    end: end
  });
};

zafClient.on('generate_thumbnail', function(data) {
  var documentArgs = { src: data.url };
  if (data.supportsFetch) {
    documentArgs = { range: new ZAFSDKPDFDataRangeTransport(data) };
  }
  PDFJS.getDocument(documentArgs).then(function(pdf) {
    console.log('pdf doc ready');
    pdf.getPage(1).then(function(page) {
      console.log('pdf page 1 ready');
      var viewport = page.getViewport(1);
      var desiredWidth = data.width || 200;
      var scaledViewport = page.getViewport(desiredWidth / viewport.width);
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      canvas.height = scaledViewport.height;
      canvas.width = scaledViewport.width;

      var renderContext = {
        canvasContext: ctx,
        viewport: scaledViewport
      };

      page.render(renderContext).then(function(){
        console.log('pdf page 1 rendered');
        //set to draw behind current content
        ctx.globalCompositeOperation = "destination-over";

        //set background color
        ctx.fillStyle = "#ffffff";

        //draw background / rect on entire canvas
        ctx.fillRect(0,0,canvas.width,canvas.height);
        zafClient.postMessage('thumbnail', { id: data.id, dataUri: canvas.toDataURL() });
      });
    });
  });
});
