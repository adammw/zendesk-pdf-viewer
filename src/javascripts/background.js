import { extractPdfAttachments } from './attachment_extractor';

class Background {
  constructor(client, data) {
    this.client = client;
    this._metadata = data.metadata;
    this._context = data.context;

    this.client.on('instance.created', this.onInstanceCreated.bind(this));
    this.client.get('instances').then((data) => {
      Object.keys(data.instances).forEach((instanceGuid) => {
        this.onInstanceCreated(data.instances[instanceGuid]);
      })
    })
  }

  onInstanceCreated(context) {
    const client = this.client.instance(context.instanceGuid);
    if (context.location == 'modal') {
      // TODO: dynamically detect correct size
      client.invoke('resize', { width: '800px', height: '500px' });
    } else if (context.location == 'ticket_sidebar') {
      // defer loading ticket sidebar app until we are certain there are pdf attachments on the ticket
      extractPdfAttachments(client).then((pdfAttachments) => {
        if (pdfAttachments.length > 0) {
          client.invoke('load');
        }
      })
    }
  }
}

export default Background;
