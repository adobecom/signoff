const { browser } = require('@wdio/globals')

module.exports = class Page {

    open (path) {
        return browser.url(`https://www.adobe.com${path}`);
    }

    get pageLoadOk () {
        return $('div#page-load-ok-milo');
    }
}
