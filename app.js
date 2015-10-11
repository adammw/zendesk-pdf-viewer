/* global escape fetch Headers Request */
(function() {
  var STATIC_ASSET_SERVER = 'https://adammw.github.io/zendesk-pdf-viewer/';
  var base64 = require('b64');
  var REDIRECT_RESOLVER_SERVER = 'https://cors-anywhere.herokuapp.com/';

  return {
    defaultState: 'loading',

    events: {
      'app.created': 'onAppCreated',
      'app.registered': 'onAppRegistered',
      'app.willDestroy': 'onAppDestroy',
      'iframe.thumbnail': 'onThumbnailReady',
      'iframe.data_transport_request': 'onDataTransportRequest',
      'click a[data-open-in-pdf-viewer]': 'onPdfViewerLinkClick',
      'click a[data-dismiss="modal"]': 'onDismissModalClick',
      'click .modal-wrapper': 'onDismissModalClick',
      'click .maximize': 'onMaximizeClick'
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
          url: REDIRECT_RESOLVER_SERVER + attachmentUrl,
          method: 'HEAD',
          cors: true
        }).then(function(data, status, jqXHR) {
          resolve(jqXHR.getResponseHeader('X-Final-Url'));
        }, reject);
      });
    },

    generateThumbnailsFor: function(attachments) {
      attachments.forEach(function(attachment) {
        /*if (this.store('thumbnail_' + attachment.id)) {
          this.updateThumbnail({ id: attachment.id, dataUri: this.store('thumbnail_' + attachment.id) });
        } else */if (this.supportsFetch) {
          this.pendingAttachments[attachment.id] = attachment;
          this.ensureAppRegistered(function() {
            this.postMessage('generate_thumbnail', {
              id: attachment.id,
              width: 180,
              size: attachment.size,
              supportsFetch: true
            });
          });
        } else {
          this.fetchS3Url(attachment.content_url).then(function(s3AttachmentUrl) {
            this.ensureAppRegistered(function() {
              this.postMessage('generate_thumbnail', {
                id: attachment.id,
                width: 180,
                url: s3AttachmentUrl
              });
            });
          }.bind(this));
        }
      }, this);
    },

    updateThumbnail: function(data) {
      this.$(helpers.fmt('.attachment[data-attachment-id=%@] .thumbnail', data.id)).attr('src', data.dataUri);
    },

    ensureAppRegistered: function(cb) {
      if (this.appRegistered) {
        setImmediate(cb.bind(this));
      } else {
        this.onAppRegisteredCallbacks.push(cb);
      }
    },

    onAppCreated: function() {
      this.supportsFetch = ('function' === typeof fetch);
      this.appRegistered = false;
      this.pendingAttachments = {};
      this.onAppRegisteredCallbacks = [];

      this.loadAttachments().then(function(attachments) {
        var filteredAttachments = _.where(attachments, { content_type: 'application/pdf' });
        if (filteredAttachments.length) {
          this.switchTo('attachment_selector', {
            attachments: filteredAttachments,
            thumbnail_generator_src: STATIC_ASSET_SERVER + '/web/thumbnail_generator.html'
          });
          this.generateThumbnailsFor(filteredAttachments);
        } else {
          this.hide();
        }
      }.bind(this));
    },

    onAppRegistered: function() {
      var cb;
      while(cb = this.onAppRegisteredCallbacks.pop()) { cb.call(this); }
      this.appRegistered = true;
    },

    onAppDestroy: function() {
      this.appDestroyed = true;
    },

    onDataTransportRequest: function(data) {
      var attachment = this.pendingAttachments[data.id];
      if (!attachment) return;

      var headers = new Headers();
      var start = data.start || 0;
      var end = data.end || '';
      headers.append('Range', 'bytes=' + start + '-' + end);

      var request = new Request(attachment.s3_content_url || attachment.content_url, {
        method: 'GET',
        headers: headers
      });

      fetch(request).then(function fetchHandler(response) {
        if (this.appDestroyed) return; // https://github.com/whatwg/fetch/issues/27
        if (!response.ok) {
          // expired token?
          if (attachment.s3_content_url) {
            delete attachment.s3_content_url;
            request = request.clone();
            request.url = attachment.content_url
            fetch(request).then(fetchHandler);
            return;
          } else {
            console.error(response.status, response);
            //TODO: error handling
          }
        }

        attachment.s3_content_url = response.url; // store short-lived final url for range requests

        var bytesRead = 0;
        var reader = response.body.getReader();
        var contentRangeHeader = response.headers.get('Content-Range');
        console.log(contentRangeHeader);
        var contentRange = contentRangeHeader && /bytes\s*(\d+)-(\d+)?\/(\d+)?/.exec(contentRangeHeader);
        var start = contentRange && contentRange[0] || 0;
        var bytesToRead = (data.end) ? end - start : null;
        var readHandler = function(result) {
          console.log(result);
          this.postMessage('data_transport_response', {
            id: attachment.id,
            start: start + bytesRead,
            result: base64.fromByteArray(result.value)
          });
          bytesRead += result.value.byteLength;

          // manually keep track if we have read enough bytes because range requests don't work on redirect: https://github.com/whatwg/fetch/issues/139
          if (!result.done && (bytesToRead == null || bytesRead < bytesToRead)) {
            reader.read().then(readHandler);
          } else {
            reader.cancel();
          }
        }.bind(this);
        reader.read().then(readHandler);
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
          url: STATIC_ASSET_SERVER + '/web/viewer.html?file=' + escape(s3AttachmentUrl)
        });
        this.$(modalHtml).appendTo(this.$());
      }.bind(this));
    },

    onDismissModalClick: function() {
      this.$('.modal-wrapper').remove();
    },

    onMaximizeClick: function(e) {
      e.preventDefault();
      e.stopPropagation();
      var elem = this.$('.pdf-viewer-frame').get(0);
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      }
    }
  };

}());
