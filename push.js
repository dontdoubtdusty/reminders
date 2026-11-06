// Push notifications: lets a Big app alert you when it is closed.
// The same file is used by Big Healthy and Big Tidy. Edit it in one, copy it to the other.
//
// How it works
// - This device asks the browser for notification permission, gets a push address (a "token") from Firebase Cloud
//   Messaging, and saves it at users/{uid}/devices/{id}.
// - Whenever the app's data changes it also saves a small plain "schedule" at users/{uid}/notify/{app}
//   (doses and their times, or the reminder digest settings).
// - A Firebase Cloud Function (notify-functions repo) wakes up every minute, reads the schedule and sends the push.
// - sw.js shows the notification, even when the app is closed.
// Needs sync.js to be signed in, because that is how the schedule reaches the server.
(function () {
  const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const VAPID = '';   // optional: a Web Push key from Firebase console → Project settings → Cloud Messaging. Empty uses Firebase's default key.
  const ls = {
    get: k => { try { return localStorage.getItem(k) } catch (e) { return null } },
    set: (k, v) => { try { localStorage.setItem(k, v) } catch (e) {} },
    del: k => { try { localStorage.removeItem(k) } catch (e) {} }
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform == 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

  let o = null, busy = false, msg = '', timer = 0, lastSent = '';
  const onKey = () => 'push:on:' + o.app, devKey = () => 'push:dev:' + o.app;
  const draw = () => { try { o.render() } catch (e) {} };
  const devId = () => { let d = ls.get(devKey()); if (!d) { d = Math.random().toString(36).slice(2, 12); ls.set(devKey(), d) } return d };
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) { return 'UTC' } };

  // Why this device can't do it, or '' when it can
  function why() {
    if (window !== window.top) return 'frame';
    if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return iOS && !installed() ? 'install' : 'unsupported';
    if (iOS && !installed()) return 'install';
    if (Notification.permission == 'denied') return 'blocked';
    if (!location.protocol.startsWith('http')) return 'unsupported';
    return '';
  }
  const enabled = () => !!ls.get(onKey()) && Notification.permission == 'granted';

  async function token() {
    const [A, M] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-messaging.js')]);
    if (!(await M.isSupported())) throw { code: 'unsupported' };
    const reg = await navigator.serviceWorker.ready;
    const opts = { serviceWorkerRegistration: reg };
    if (VAPID) opts.vapidKey = VAPID;
    return M.getToken(M.getMessaging(A.getApp()), opts);
  }
  async function saveDevice(t) {
    await CloudSync.mine.put('devices/' + devId(), { app: o.app, token: t, ua: navigator.userAgent.slice(0, 120) });
  }

  async function publishNow() {
    if (!o || !enabled() || !window.CloudSync || !CloudSync.signedIn()) return;
    const s = { tz: tz(), ...o.schedule() }, j = JSON.stringify(s);
    if (j == lastSent) return;
    try { await CloudSync.mine.put('notify/' + o.app, s); lastSent = j } catch (e) { console.warn('push schedule not saved', e) }
  }

  const API = {
    // opts: {app, schedule() -> object saved for the server, render()}
    init(opts) {
      o = opts;
      document.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('[data-push]');
        if (!b) return;
        if (b.dataset.push == 'on') API.enable(); else if (b.dataset.push == 'off') API.disable();
      });
      // Once signed in, keep this device's address fresh (browsers rotate them now and then) and the schedule current
      let tries = 0;
      const go = async () => {
        if (!enabled()) return;
        if (!CloudSync.signedIn()) { if (++tries < 6) setTimeout(go, 4000); return }
        try { await saveDevice(await token()) } catch (e) {}
        publishNow();
      };
      setTimeout(go, 2500);
    },
    // Call after every save of the app's data
    publish() {
      if (!o || !enabled()) return;
      clearTimeout(timer); timer = setTimeout(publishNow, 3000);
    },
    async enable() {
      if (busy) return;
      msg = '';
      if (why()) { msg = 'This device can’t get notifications from here.'; return draw() }
      if (!window.CloudSync || !CloudSync.signedIn()) { msg = 'Sign in under Sync across devices first, so the server knows your schedule.'; return draw() }
      busy = true; draw();
      try {
        const p = await Notification.requestPermission();
        if (p != 'granted') throw { code: 'denied' };
        await saveDevice(await token());
        ls.set(onKey(), '1'); lastSent = '';
        await publishNow();
        msg = 'Notifications are on for this device.';
      } catch (e) {
        msg = e && e.code == 'denied' ? 'Notifications were not allowed. You can allow them in your phone’s or browser’s site settings.'
          : 'Couldn’t turn notifications on. Check your connection and try again.';
        console.warn('push enable failed', e);
      }
      busy = false; draw();
    },
    async disable() {
      ls.del(onKey()); lastSent = '';
      try { if (window.CloudSync && CloudSync.signedIn()) await CloudSync.mine.del('devices/' + devId()) } catch (e) {}
      msg = 'Notifications are off for this device.'; draw();
    },
    enabled,
    // The Settings card body. `extra` is the app's own options (shown only while notifications are on).
    view(extra) {
      const w = why(), on = enabled();
      let body;
      if (w == 'frame') body = 'Open Big ' + esc(o.name) + ' on its own (not inside Big Juicy Suite) to turn notifications on.';
      else if (w == 'install') body = 'On iPhone and iPad, notifications only work from the Home Screen app. Tap Share, then <b>Add to Home Screen</b>, open it from there, and come back here.';
      else if (w == 'unsupported') body = 'This browser can’t show notifications from a website.';
      else if (w == 'blocked') body = 'Notifications are blocked for this site. Allow them in your browser’s or phone’s site settings, then come back.';
      else body = on ? 'On for this device.' : 'Off on this device.';
      const btn = w && w != 'blocked' ? '' : on
        ? '<button class="g bd" data-push="off">Turn off on this device</button>'
        : `<button data-push="on"${busy ? ' disabled' : ''}>${busy ? 'Working…' : 'Turn on notifications'}</button>`;
      return `<div class="card"><h2>Notifications</h2><p class="mu" style="margin:0 0 10px">${body}</p>${btn}${on && extra ? extra : ''}${msg ? `<p class="mu" style="margin:10px 0 0">${esc(msg)}</p>` : ''}</div>`;
    }
  };
  window.Push = API;
})();
