/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const log = function() { dump(Array.slice(arguments).join(' ') + '\n'); };
const trace = function(error) { log(error); log(error.stack); };
const dirobj = function(obj) { for (let i in obj) { log(i, ':', obj[i]); } };

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const NS_XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

/* library */

const Utils = (function() {

    const sbService = Cc['@mozilla.org/intl/stringbundle;1']
                         .getService(Ci.nsIStringBundleService);
    const windowMediator = Cc['@mozilla.org/appshell/window-mediator;1']
                              .getService(Ci.nsIWindowMediator);
    const clipboardHelper = Cc['@mozilla.org/widget/clipboardhelper;1']
                               .getService(Ci.nsIClipboardHelper);
    const prefService = Cc['@mozilla.org/preferences-service;1']
                           .getService(Ci.nsIPrefService)
                           .QueryInterface(Ci.nsIPrefBranch);

    let localization = function(id, name) {
        let uri = 'chrome://' + id + '/locale/' + name + '.properties';
        return sbService.createBundle(uri).GetStringFromName;
    };

    let setAttrs = function(widget, attrs) {
        for (let [key, value] in Iterator(attrs)) {
            widget.setAttribute(key, value);
        }
    };

    let getMostRecentWindow = function(winType) {
        return windowMediator.getMostRecentWindow(winType);
    };

    let copyToClipboard = function(text) {
        clipboardHelper.copyString(text);
    };

    let browserOpenTab = function(url) {
        let browser = getMostRecentWindow('navigator:browser');
        if (browser) {
            let gBrowser = browser.gBrowser;
            gBrowser.selectedTab = gBrowser.addTab(url);
        } else {
            getMostRecentWindow(null).open(url);
        }
    };

    let exports = {
        localization: localization,
        setAttrs: setAttrs,
        getMostRecentWindow: getMostRecentWindow,
        copyToClipboard: copyToClipboard,
        browserOpenTab: browserOpenTab,
    };
    return exports;
})();

const DialogManager = (function() {

    const windowWatcher = Cc['@mozilla.org/embedcomp/window-watcher;1']
                             .getService(Ci.nsIWindowWatcher);

    const DIALOG_URI = 'chrome://mozapps/content/downloads/unknownContentType.xul';

    let listeners = [];

    let onload = function(event) {
        for (let listener of listeners) {
            let window = event.currentTarget;
            window.removeEventListener('load', onload);
            if (window.location.href !== DIALOG_URI) {
                return;
            }
            try {
                listener(window);
            } catch(error) {
                trace(error);
            }
        }
    };

    let observer = {
        observe: function(window, topic, data) {
            if (topic !== 'domwindowopened') {
                return;
            }
            window.addEventListener('load', onload);
        }
    };

    let addListener = function(listener) {
        listeners.push(listener);
    };

    let removeListener = function(listener) {
        let start = listeners.indexOf(listener);
        if (start !== -1) {
            listeners.splice(start, 1);
        }
    };

    let initialize = function() {
        windowWatcher.registerNotification(observer);
    };

    let destory = function() {
        windowWatcher.unregisterNotification(observer);
        listeners = null;
    };

    initialize();

    let exports = {
        addListener: addListener,
        removeListener: removeListener,
        destory: destory,
    };
    return exports;
})();

const Pref = function(branchRoot) {

    const supportsStringClass = Cc['@mozilla.org/supports-string;1'];
    const prefService = Cc['@mozilla.org/preferences-service;1']
                           .getService(Ci.nsIPrefService);

    const new_nsiSupportsString = function(data) {
        let string = supportsStringClass.createInstance(Ci.nsISupportsString);
        string.data = data;
        return string;
    };

    let branch = prefService.getBranch(branchRoot);

    let setString = function(key, value) {
        try {
            branch.setComplexValue(key, Ci.nsISupportsString,
                                   new_nsiSupportsString(value));
        } catch(error) {
            branch.clearUserPref(key)
            branch.setComplexValue(key, Ci.nsISupportsString,
                                   new_nsiSupportsString(value));
        }
    };
    let getString = function(key, defaultValue) {
        let value;
        try {
            value = branch.getComplexValue(key, Ci.nsISupportsString).data;
        } catch(error) {
            value = defaultValue || null;
        }
        return value;
    };

    let exports = {
        setString: setString,
        getString: getString,
    }
    return exports;
};

/* main */

let _ = null;
let loadLocalization = function() {
    _ = Utils.localization('downloaddialogtweak', 'global');
};

let DownloadDialogTweak = function() {

    const PREF_BRANCH = 'extensions.downloaddialogtweak.';

    let pref = Pref(PREF_BRANCH);

    let prefHelper = {

        getUrlEntries: function() {
            let text = pref.getString('sendto');
            if (!text) {
                return [];
            }

            let entries = [];
            let lines = text.split('\n');
            for (let line of lines) {
                line = line.trim();
                if (!line || line.startsWith('#')) {
                    continue;
                }
                let delimiter = line.indexOf(':');
                let label = line.slice(0, delimiter).trim();
                let url = line.slice(delimiter + 1).trim();
                if (label && url) {
                    entries.push([label, url]);
                }
            }
            return entries;
        },

    };

    let copyListener = function(value) {
        return function() Utils.copyToClipboard(value);
    };

    let UiMaker = function(document) {
        let Element = document.createElementNS.bind(document, NS_XUL);

        let Info = function(key, value) {
            let label = Element('label');
            label.setAttribute('value', key);

            let description = Element('description');
            Utils.setAttrs(description, {
                'class': 'plain',
                crop: 'end',
                flex: 1,
                tooltiptext: value,
                value: value,
            });
            description.addEventListener('dblclick', copyListener(value))

            let hbox = Element('hbox');
            hbox.appendChild(label);
            hbox.appendChild(description);
            return hbox;
        };

        let CopyRadio = function(url) {
            let radio = Element('radio');
            Utils.setAttrs(radio, {
                id: 'copy',
                label: _('copyUrl'),
                tooltiptext: url,
                accesskey: _('copyUrlAccesskey'),
            });
            return radio;
        };

        let SendtoWidgets = function(url, urlEntries) {
            let url2 = encodeURIComponent(url);
            let menupopup = Element('menupopup');
            for (let i = 0; i < urlEntries.length; i += 1) {
                let [entryLabel, entryUrl] = urlEntries[i];
                let menuitem = Element('menuitem');
                let value = entryUrl.replace('${url}', url)
                                    .replace('${url2}', url2);
                Utils.setAttrs(menuitem, {
                    label: entryLabel,
                    value: value,
                    tooltiptext: value,
                });
                if (i === 0) {
                    menuitem.setAttribute('selected', true);
                }
                menupopup.appendChild(menuitem);
            }

            let menulist = Element('menulist');
            menulist.setAttribute('id', 'sendto-menulist');
            menulist.appendChild(menupopup);

            let radio = Element('radio');
            Utils.setAttrs(radio, {
                id: 'sendto',
                label: _('sendtoUrl'),
                accesskey: _('sendtoUrlAccesskey'),
            });

            let box = Element('hbox');
            box.appendChild(radio);
            box.appendChild(menulist);
            return [box, radio];
        };

        let exports = {
            Info: Info,
            CopyRadio: CopyRadio,
            SendtoWidgets: SendtoWidgets,
        };
        return exports;
    };


    let getInfos = function(dialog) {
        let url = decodeURIComponent(dialog.mLauncher.source.spec);
        let referrer;
        try {
            referrer = dialog.mContext
                             .QueryInterface(Ci.nsIWebNavigation)
                             .currentURI.spec;
        } catch(error) {
            referrer = null;
        }
        return [url, referrer];
    };

    let insertWidgets= function(document, url, referrer) {
        let $id = document.getElementById.bind(document);
        let {
            Info, CopyRadio, SendtoWidgets
        } = UiMaker(document);

        // add url and referrer labels
        let infosContainer = $id('location').parentNode;
        infosContainer.appendChild(Info(_('urlLabel'), url));
        if (referrer) {
            infosContainer.appendChild(Info(_('referrerLabel'), referrer));
        }

        // add "copy url"
        let saveRadio = $id('save');
        let radiosBox = saveRadio.parentNode;
        let copyRadio = CopyRadio(url);
        radiosBox.insertBefore(copyRadio, saveRadio);

        // add sendto radio
        let sendtoRadio;
        let urlEntries = prefHelper.getUrlEntries();
        if (urlEntries.length) {
            let sendtoBox;
            [sendtoBox, sendtoRadio] = SendtoWidgets(url, urlEntries);
            copyRadio.parentNode.insertBefore(sendtoBox, copyRadio);
        } else {
            sendtoRadio = null;
        }

        return [copyRadio, sendtoRadio];
    };

    let addAcceptListener = function(window, url) {
        let document = window.document;
        let $id = document.getElementById.bind(document);

        let cancelDefault = function(event) {
            let dialog = $id('unknownContentType');
            try {
                dialog.removeAttribute('ondialogaccept');
            } catch(error) {
            }

            try {
                window.dialog.mLauncher.cancel(Cr.NS_BINDING_ABORTED);
            } catch(error) {
            }

            dialog.cancelDialog();
            event.stopPropagation();
            event.preventDefault();
        };

        window.addEventListener('dialogaccept', function(event) {
            let selectedItem = $id('mode').selectedItem;

            let copyRadio = $id('copy');
            if (copyRadio && copyRadio.selected) {
                Utils.copyToClipboard(url);
                cancelDefault(event);
                return;
            }

            let sendtoRadio = $id('sendto');
            if (sendtoRadio && sendtoRadio.selected) {
                Utils.browserOpenTab($id('sendto-menulist').value);
                cancelDefault(event);
                return;
            }

        });
    };

    let addMoreOptions = function(window) {
        let [url, referrer] = getInfos(window.dialog);
        insertWidgets(window.document, url, referrer);
        addAcceptListener(window, url);
    };

    let initialize = function() {
        DialogManager.addListener(addMoreOptions);
    };

    let destory = function() {
        DialogManager.destory();
    };

    let exports = {
        initialize: initialize,
        destory: destory,
    };
    return exports;
};

/* bootstrap entry points */

let downloadDialogTweak;

let install = function(data, reason) {};
let uninstall = function(data, reason) {};

let startup = function(data, reason) {
    loadLocalization();
    downloadDialogTweak = DownloadDialogTweak();
    downloadDialogTweak.initialize();
};

let shutdown = function(data, reason) {
    downloadDialogTweak.destory();
};
