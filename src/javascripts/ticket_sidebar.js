import View from 'view';
import Storage from 'storage'
import { PDFJS } from 'pdfjs-dist';
import { extractPdfAttachments } from './attachment_extractor';

class TicketSidebar {
  constructor(client, data) {
    this.client = client;
    this._metadata = data.metadata;
    this._context = data.context;

    this.storage = new Storage(this._metadata.installationId);
    this.view = new View({ afterRender: () => {
      const newHeight = $('html').height();
      this.client.invoke('resize', { height: newHeight, width: '100%' });
    }});

    extractPdfAttachments(this.client).then((pdfAttachments) => {
      this.view.switchTo('attachment_selector', { attachments: pdfAttachments });
      $('.thumbnail').click(this.handleAttachmentClick.bind(this));

      pdfAttachments.forEach((attachment, index) => {
        this.loadThumbnail(attachment.contentUrl, index);
      });
    });
  }

  handleAttachmentClick(e) {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const url = e.currentTarget.getAttribute('href');

    // TODO: create custom viewer with zendesk theme
    this.client.invoke('instances.create', {
      location: 'modal',
      url: `https://mozilla.github.io/pdf.js/web/viewer.html?file=${escape(url)}`
    });
  }

  loadThumbnail(url, index) {
    const cachedDataUri = localStorage[url];
    const thumbnail = $(`.thumbnail[data-attachment-index="${index}"]`);
    const canvas = thumbnail.find('.thumbnail__canvas').get(0);
    if (cachedDataUri) {
      this.renderThumbnail(cachedDataUri, canvas);
      thumbnail.removeClass('thumbnail--loading');
    } else {
      this.generateThumbnail(url, canvas).then((dataUri) => {
        localStorage[url] = dataUri;
        thumbnail.removeClass('thumbnail--loading');
      });
    }
  }

  renderThumbnail(url, canvas) {
    const img = new Image();
    img.addEventListener('load', () => {
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    });
    img.setAttribute('src', url);
  }

  generateThumbnail(url, canvas, width = 300) {
    const ctx = canvas.getContext('2d');

    return PDFJS.getDocument(url).then(function(pdf) {
      return pdf.getPage(1);
    }).then(function(page) {
      const viewport = page.getViewport(1);
      const desiredWidth = width;
      const scaledViewport = page.getViewport(desiredWidth / viewport.width);
      canvas.height = scaledViewport.height;
      canvas.width = scaledViewport.width;

      return page.render({
        canvasContext: ctx,
        viewport: scaledViewport
      });
    }).then(function(){
      console.log('rendered page 1');

      //set to draw behind current content
      ctx.globalCompositeOperation = "destination-over";

      //set background color
      ctx.fillStyle = "#ffffff";

      //draw background / rect on entire canvas
      ctx.fillRect(0,0,canvas.width,canvas.height);
      return canvas.toDataURL();
    });
  }
}

export default TicketSidebar;
