const { $ } = require('@wdio/globals')
const Page = require('./page');

class PlansPage extends Page {
    open () {
        return super.open('/creativecloud/plans.html');
    }
}

module.exports = new PlansPage();
