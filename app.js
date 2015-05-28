/* global escape */
(function() {
  return {
    defaultState: 'loading',

    events: {
      'app.created': 'onAppCreated',
      'iframe.thumbnail': 'onThumbnailReady',
      'click a[data-open-in-pdf-viewer]': 'onPdfViewerLinkClick',
      'click a[data-dismiss="modal"]': 'onDismissModalClick',
      'click .modal-wrapper': 'onDismissModalClick'
    },

    requests: {
      makeRequest: function(options) {
        return options;
      }
    },

    paginateRequest: function(options) {
      return this.promise(function(resolve, reject) {
        var data = [];
        var key = /\/([^\/]+?)(?:\.\w+)?(?:\?.+?)?$/.exec(options.url)[1];
        var handlePage = function(page) {
          data = [].concat.apply(data, page[key]);
          if (page.next_page) {
            this.ajax('makeRequest', _.extend({}, options, { url: page.next_page })).then(handlePage, reject);
          } else {
            resolve(data);
          }
        };
        this.ajax('makeRequest', options).then(handlePage, reject);
      });
    },

    loadAuditsForTicket: function(ticketId) {
      return this.paginateRequest({
        url: helpers.fmt('/api/v2/tickets/%@/audits.json', ticketId),
        type: 'GET',
        dataType : 'json'
      });
    },

    loadAttachments: function() {
      return this.promise(function(resolve, reject) {
        this.loadAuditsForTicket(this.ticket().id()).then(function(audits) {
          var attachments = _.chain(audits).map('events').flatten().map('attachments').flatten().compact().value();
          resolve(attachments);
        }, reject);
      });
    },

    fetchS3Url: function(attachmentUrl) {
      // This relies on an external service to fetch the Zendesk attachment redirect to the assets server
      return this.promise(function(resolve, reject) {
        this.ajax('makeRequest', {
          url: 'https://cors-anywhere.herokuapp.com/' + attachmentUrl,
          method: 'HEAD',
          cors: true
        }).then(function(data, status, jqXHR) {
          resolve(jqXHR.getResponseHeader('X-Final-Url'));
        }, reject);
      });
    },

    generateThumbnailsFor: function(attachments) {
      attachments.forEach(function(attachment) {
        if (this.store('thumbnail_' + attachment.id)) {
          this.updateThumbnail({ id: attachment.id, dataUri: this.store('thumbnail_' + attachment.id) });
        } else {
          this.fetchS3Url(attachment.content_url).then(function(s3AttachmentUrl) {
            this.postMessage('generate_thumbnail', {
              id: attachment.id,
              width: 180,
              url: s3AttachmentUrl
            });
          }.bind(this));
        }
      }, this);
    },

    updateThumbnail: function(data) {
      this.$(helpers.fmt('.attachment[data-attachment-id=%@] .thumbnail', data.id)).attr('src', data.dataUri);
    },

    onAppCreated: function() {
      this.loadAttachments().then(function(attachments) {
        var filteredAttachments = _.where(attachments, { content_type: 'application/pdf' });
        if (filteredAttachments.length) {
          this.switchTo('attachment_selector', {
            attachments: filteredAttachments,
            thumbnail_generator_src: this.assetURL('thumbnail_generator.html')
          });
          this.generateThumbnailsFor(filteredAttachments);
        } else {
          this.hide();
        }
      }.bind(this));
    },

    onThumbnailReady: function(data) {
      this.updateThumbnail(data);
      this.store('thumbnail_' + data.id, data.dataUri);
    },

    onPdfViewerLinkClick: function(e) {
      e.preventDefault();

      var $link = this.$(e.target).parents('a') || this.$(e.target);
      var attachmentUrl = $link.attr('href');

      $link.addClass('loading');

      this.fetchS3Url(attachmentUrl).then(function(s3AttachmentUrl) {
        $link.removeClass('loading');
        var modalHtml = this.renderTemplate('pdf_viewer', {
          title: $link.text(),
          url: 'http://mozilla.github.io/pdf.js/web/viewer.html?file=' + escape(s3AttachmentUrl)
        });
        this.$(modalHtml).appendTo(this.$());
      }.bind(this));
    },

    onDismissModalClick: function() {
      this.$('.modal-wrapper').remove();
    }
  };

}());
