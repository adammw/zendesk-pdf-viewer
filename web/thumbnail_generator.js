PDFJS.workerSrc = '../build/pdf.worker.js';

var zafClient = ZAFClient.init();
zafClient.on('generate_thumbnail', function(data) {
  PDFJS.getDocument(data.url).then(function(pdf) {
    pdf.getPage(1).then(function(page) {
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
