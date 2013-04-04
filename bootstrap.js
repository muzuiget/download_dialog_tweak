/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const NS_XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const DOWNLOAD_DIALOG_URI = 'chrome://mozapps/content/downloads/unknownContentType.xul';
const LOCALIZATION_URI = 'chrome://downloaddialogtweak/locale/global.properties';
const PREFERENCE_BRANCH = 'extensions.downloaddialogtweak.';

const log = function() { dump(Array.slice(arguments).join(' ') + '\n'); }

const {classes: Cc, interfaces: Ci, results: Cr} = Components;
const CB = Cc['@mozilla.org/widget/clipboardhelper;1']
             .getService(Ci.nsIClipboardHelper);
const WM = Cc['@mozilla.org/appshell/window-mediator;1']
             .getService(Ci.nsIWindowMediator);
const WW = Cc['@mozilla.org/embedcomp/window-watcher;1']
             .getService(Ci.nsIWindowWatcher);
const SBS = Cc['@mozilla.org/intl/stringbundle;1']
              .getService(Ci.nsIStringBundleService);
const PFS = Cc['@mozilla.org/preferences-service;1']
              .getService(Ci.nsIPrefService).getBranch(PREFERENCE_BRANCH);
const nsISupportsString = function(data) {
    let string = Cc['@mozilla.org/supports-string;1']
                   .createInstance(Ci.nsISupportsString);
    string.data = data;
    return string;
};
const browserOpenTab = function(url) {
    let browser = WM.getMostRecentWindow('navigator:browser');
    if (!browser) {
        return;
    }
    let gBrowser = browser.gBrowser;
    gBrowser.selectedTab = gBrowser.addTab(url);
};

// keep all current status
let Settings = {
    urlEntries: [] // url for sendto
};

// localization properties file, unavaiable until startup() call
let _;
let loadLocalization = function() {
    _ = SBS.createBundle(LOCALIZATION_URI).GetStringFromName;
};

let loadPreferences = function() {
    let key = 'sendto';
    let data;
    try {
        data = PFS.getComplexValue(key, Ci.nsISupportsString).data;
    } catch(error) {
        data = '';
        PFS.setComplexValue(key, Ci.nsISupportsString,
                            nsISupportsString(data));
    }

    let urlEntries = [];
    let lines = data.split('\n');
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('//')) {
            continue;
        }
        let delimiter = line.indexOf(':');
        let label = line.slice(0, delimiter).trim();
        let url = line.slice(delimiter + 1).trim();
        if (label && url) {
            urlEntries.push([label, url]);
        }
    }
    Settings.urlEntries = urlEntries;
};

let ui = {
    Info: function(document, key, value) {
        let label = document.createElementNS(NS_XUL, 'label');
        let description = document.createElementNS(NS_XUL, 'description');
        let hbox = document.createElementNS(NS_XUL, 'hbox');

        label.setAttribute('value', key);
        description.setAttribute('class', 'plain');
        description.setAttribute('crop', 'end');
        description.setAttribute('flex', 1);
        description.setAttribute('tooltiptext', value);
        description.setAttribute('value', value);
        description.addEventListener('dblclick', function(event) {
            CB.copyString(value);
        })

        hbox.appendChild(label);
        hbox.appendChild(description);
        return hbox;
    },

    CopyRadio: function(document, url) {
        let radio = document.createElementNS(NS_XUL, 'radio');
        radio.setAttribute('id', 'copy');
        radio.setAttribute('label', _('copyUrl'));
        radio.setAttribute('tooltiptext', url);
        radio.setAttribute('accesskey', 'c');
        return radio;
    },

    SendtoWidgets: function(document, url, urlEntries) {
        let box = document.createElementNS(NS_XUL, 'hbox');
        let radio = document.createElementNS(NS_XUL, 'radio');
        let menulist = document.createElementNS(NS_XUL, 'menulist');
        let menupopup = document.createElementNS(NS_XUL, 'menupopup');

        let url2 = encodeURIComponent(url);
        for (let i = 0; i < urlEntries.length; i += 1) {
            let [entryLabel, entryUrl] = urlEntries[i];
            let menuitem = document.createElementNS(NS_XUL, 'menuitem');
            let value = entryUrl.replace('${url}', url)
                                 .replace('${url2}', url2);
            menuitem.setAttribute('label', entryLabel);
            menuitem.setAttribute('value', value);
            menuitem.setAttribute('tooltiptext', value);
            if (i === 0) {
                menuitem.setAttribute('selected', true);
            }
            menupopup.appendChild(menuitem);
        }

        menulist.setAttribute('id', 'sendto-menulist');
        radio.setAttribute('label', _('sendtoUrl'));
        radio.setAttribute('accesskey', 'u');
        box.setAttribute('id', 'sendto');
        radio.selectedUrl = function() menulist.value;

        menulist.appendChild(menupopup);
        box.appendChild(radio);
        box.appendChild(menulist);
        return [box, radio];
    }
};

let windowOpenedListener = {
    observe: function(window, topic) {
        if (topic !== 'domwindowopened') {
            return;
        }
        let $this = this;
        window.addEventListener('load', function(event) {
            if (window.location.href !== DOWNLOAD_DIALOG_URI) {
                return;
            }
            try {
                let [url, referrer] = $this.getInfos(window.dialog);
                let [copyRadio, sendtoRadio] =
                                    $this.insertWidgets(window, url, referrer);
                $this.addCallback(window, url, copyRadio, sendtoRadio);
            } catch(error) {
                log(error);
            }
        });
    },
    getInfos: function(dialog) {
        let url = dialog.mLauncher.source.spec;
        let referrer;
        try {
            referrer = dialog.mContext
                             .QueryInterface(Ci.nsIWebNavigation)
                             .currentURI.spec;
        } catch(error) {
            referrer = null;
        }
        return [url, referrer];
    },
    insertWidgets: function(window, url, referrer) {
        let document = window.document;

        // add labels
        let position = document.getElementById('location').parentNode;
        position.appendChild(ui.Info(document, 'url:', url));
        if (referrer) {
            position.appendChild(ui.Info(document, 'referrer:', referrer));
        }

        // add copy radio
        let saveNode = document.getElementById('save');
        let copyRadio = ui.CopyRadio(document, url);
        saveNode.parentNode.insertBefore(copyRadio, saveNode);

        // add sendto radio
        let sendtoBox, sendtoRadio;
        if (Settings.urlEntries.length) {
            [sendtoBox, sendtoRadio] = ui.SendtoWidgets(document, url,
                                                        Settings.urlEntries);
            copyRadio.parentNode.insertBefore(sendtoBox, copyRadio);
        }

        return [copyRadio, sendtoRadio];
    },
    addCallback: function(window, url, copyRadio, sendtoRadio) {
        let document = window.document;
        let cancelDefault = function(event) {
            let dialog = document.getElementById('unknownContentType');
            try {
                dialog.removeAttribute('ondialogaccept');
            }
            catch(error) {
            }
            try {
                window.dialog.mLauncher.cancel(Cr.NS_BINDING_ABORTED);
            }
            catch(error) {
            }
            dialog.cancelDialog();
            event.stopPropagation();
            event.preventDefault();
        };
        window.addEventListener('dialogaccept', function(event) {
            let selectedItem = document.getElementById('mode').selectedItem;
            if (selectedItem === copyRadio) {
                CB.copyString(url);
                cancelDefault(event);
            } else if (selectedItem === sendtoRadio) {
                browserOpenTab(sendtoRadio.selectedUrl());
                cancelDefault(event);
            }
        });
    }
};

let preferenceChangedListener = {
    observe: function(subject, topic, data) {
        if (data === 'sendto') {
            loadPreferences();
        }
    }
};

/* bootstrap entry points */

let install = function(data, reason) {};
let uninstall = function(data, reason) {};

let startup = function(data, reason) {
    loadLocalization();
    loadPreferences();
    WW.registerNotification(windowOpenedListener);
    PFS.addObserver('', preferenceChangedListener, false);
};

let shutdown = function(data, reason) {
    WW.unregisterNotification(windowOpenedListener);
    PFS.removeObserver('', preferenceChangedListener, false);
};
