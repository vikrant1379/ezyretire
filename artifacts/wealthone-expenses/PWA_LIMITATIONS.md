# PWA support limitations

ezyRetire's offline page requires the browser's Cache Storage API. If a privacy
policy or browser setting blocks Cache Storage, the service worker continues to
serve online requests without throwing an unhandled error, but it cannot save or
open the offline document.

When the network is unavailable under that policy, navigation stops on the
browser's standard offline error page. ezyRetire does not automatically reload
or retry that navigation. Restoring network access and reloading the page returns
the user to the app.