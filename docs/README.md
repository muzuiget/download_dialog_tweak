# Download Dialog Tweak

The "Send to" menu item can custom in preferences panel. One line one menu item. The format is a colon separate label and api url. Other format, empty line and comment(starts with <code>#</code>) will be ignored. Here is a Google Chart "QR Code" example:

    QR Code: http://chart.googleapis.com/chart?cht=qr&chs=128x128&choe=UTF-8&chld=H|0&chl=${url}

Placeholder `${url}` will replace with file url, and `${url2}` will replace with `encodeURIComponent(url)`.