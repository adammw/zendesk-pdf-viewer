export function extractPdfAttachments(client) {
  return client.get('ticket.comments').then((data) => {
    const comments = data['ticket.comments'];
    const pdfAttachments = [];
    comments.forEach((comment) => {
      comment.nonImageAttachments.forEach((attachment) => {
        if (attachment.contentType == 'application/pdf') {
          pdfAttachments.push(attachment);
        }
      })
    });
    return pdfAttachments;
  });
}
