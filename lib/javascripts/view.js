import $ from 'jquery';

class View {
  constructor(opts) {
    this.afterRender = opts.afterRender;
  }

  renderTemplate(name, data) {
    let template = require(`../../src/templates/${name}.hdbs`);
    return template(data);
  }

  switchTo(name, data) {
    $('[data-main]').html(this.renderTemplate(name, data));
    'function' == typeof this.afterRender && this.afterRender();
  }
}

export default View;
